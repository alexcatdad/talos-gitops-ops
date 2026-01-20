import type { ValidationError } from "./types.js";

const TIMEOUT_MS = 5_000;

interface UrlCheckResult {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Check if a URL returns 200
 */
export async function checkUrl(url: string): Promise<UrlCheckResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    return {
      url,
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    return {
      url,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check multiple URLs in parallel
 */
export async function checkUrls(urls: string[]): Promise<UrlCheckResult[]> {
  return Promise.all(urls.map(checkUrl));
}

/**
 * Validate helm chart repository URL
 */
export async function validateChartRepo(repoUrl: string): Promise<ValidationError | null> {
  // Handle OCI registries
  if (repoUrl.startsWith("oci://")) {
    // OCI registries can't be easily checked with HEAD request
    // Just validate format
    const ociPattern = /^oci:\/\/[\w.-]+\/[\w./-]+$/;
    if (!ociPattern.test(repoUrl)) {
      return {
        file: "",
        severity: "error",
        message: `Malformed OCI URL: ${repoUrl}`,
        fix: "OCI URLs should be: oci://registry/path",
      };
    }
    return null;
  }

  // Standard helm repos should have index.yaml
  const indexUrl = repoUrl.endsWith("/")
    ? `${repoUrl}index.yaml`
    : `${repoUrl}/index.yaml`;

  const result = await checkUrl(indexUrl);

  if (!result.ok) {
    return {
      file: "",
      severity: "error",
      message: `Helm repo unreachable: ${repoUrl} (${result.error || result.status})`,
      fix: "Check the repo URL is correct and accessible",
    };
  }

  return null;
}

/**
 * Validate chart version exists in repository
 */
export async function validateChartVersion(
  repoUrl: string,
  chartName: string,
  version: string
): Promise<ValidationError | null> {
  // Skip version check for HEAD/latest
  if (version === "HEAD" || version === "latest" || version === "*") {
    return null;
  }

  // For OCI registries, construct the manifest URL
  if (repoUrl.startsWith("oci://")) {
    // OCI version check would need registry API - skip for now
    return null;
  }

  // For standard repos, fetch and parse index.yaml
  const indexUrl = repoUrl.endsWith("/")
    ? `${repoUrl}index.yaml`
    : `${repoUrl}/index.yaml`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(indexUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        file: "",
        severity: "error",
        message: `Cannot fetch chart index: ${repoUrl}`,
      };
    }

    const text = await response.text();

    // Simple check: look for version string in index
    // A proper implementation would parse the YAML
    const versionPattern = new RegExp(`version:\\s*["']?${escapeRegex(version)}["']?`, "m");

    if (!versionPattern.test(text)) {
      return {
        file: "",
        severity: "error",
        message: `Chart version not found: ${chartName}@${version}`,
        fix: `Check available versions with: helm search repo ${chartName} --versions`,
      };
    }

    return null;
  } catch (error) {
    return {
      file: "",
      severity: "warning",
      message: `Could not verify chart version: ${error instanceof Error ? error.message : "Unknown"}`,
    };
  }
}

/**
 * Extract URLs from YAML content
 */
export function extractUrls(content: string): string[] {
  const urlPattern = /https?:\/\/[^\s"'<>]+/g;
  const matches = content.match(urlPattern) || [];

  // Deduplicate and clean
  return [...new Set(matches.map((url) => url.replace(/[,;)}\]]+$/, "")))];
}

/**
 * Escape string for use in regex
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
