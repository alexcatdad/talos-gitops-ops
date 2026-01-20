import { readdir, readFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ClusterContext, AppDefinition, Node } from "./types.js";

// Cache for cluster context
let cachedContext: ClusterContext | null = null;
let cacheTime = 0;
const CACHE_TTL = 30_000; // 30 seconds

/**
 * Find the GitOps repo root by looking for markers
 */
export async function findRepoRoot(startPath: string): Promise<string | null> {
  let current = startPath;

  while (current !== "/") {
    // Check for GitOps markers
    const markers = ["omniconfig.yaml", "apps", ".talos-gitops-ops"];

    for (const marker of markers) {
      try {
        await stat(join(current, marker));
        return current;
      } catch {
        // Not found, continue
      }
    }

    current = dirname(current);
  }

  return null;
}

/**
 * Check if we're in a GitOps repo
 */
export async function isGitOpsRepo(path: string): Promise<boolean> {
  const root = await findRepoRoot(path);
  return root !== null;
}

/**
 * Parse ArgoCD Application manifest
 */
async function parseApplication(filePath: string): Promise<AppDefinition | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    const doc = parseYaml(content);

    if (doc?.kind !== "Application") return null;

    const spec = doc.spec;
    const sources = spec?.sources || (spec?.source ? [spec.source] : []);

    // Find helm source
    const helmSource = sources.find(
      (s: Record<string, unknown>) => s.chart || (typeof s.repoURL === "string" && s.repoURL.includes("helm"))
    );

    if (!helmSource) return null;

    const name = doc.metadata?.name || "";
    const namespace = spec?.destination?.namespace || "default";

    // Find values file path
    const gitSource = sources.find((s: Record<string, unknown>) => s.path);
    const valuesPath = gitSource?.path
      ? join(dirname(filePath), "..", gitSource.path as string, "values.yaml")
      : join(dirname(filePath), "values.yaml");

    return {
      name,
      namespace,
      chart: {
        repo: (helmSource.repoURL as string) || "",
        name: (helmSource.chart as string) || "",
        version: (helmSource.targetRevision as string) || "latest",
      },
      valuesPath,
      hasTolerations: false, // Will be updated when values.yaml is parsed
      psaLevel: null,
      ignoreDifferences: !!spec?.ignoreDifferences?.length,
    };
  } catch {
    return null;
  }
}

/**
 * Check values.yaml for tolerations
 */
async function checkTolerations(valuesPath: string): Promise<boolean> {
  try {
    const content = await readFile(valuesPath, "utf-8");
    return content.includes("tolerations:");
  } catch {
    return false;
  }
}

/**
 * Parse namespace manifest for PSA labels
 */
async function parsePsaLevel(
  manifestsPath: string
): Promise<"privileged" | "baseline" | "restricted" | null> {
  try {
    const files = await readdir(manifestsPath);
    const nsFile = files.find((f) => f.includes("namespace"));

    if (!nsFile) return null;

    const content = await readFile(join(manifestsPath, nsFile), "utf-8");
    const doc = parseYaml(content);

    if (doc?.kind !== "Namespace") return null;

    const enforce = doc.metadata?.labels?.["pod-security.kubernetes.io/enforce"];
    if (enforce === "privileged") return "privileged";
    if (enforce === "baseline") return "baseline";
    if (enforce === "restricted") return "restricted";

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse omniconfig.yaml for cluster info
 */
async function parseOmniConfig(
  repoRoot: string
): Promise<{ endpoint?: string; clusterName?: string }> {
  try {
    const content = await readFile(join(repoRoot, "omniconfig.yaml"), "utf-8");
    const doc = parseYaml(content);

    return {
      endpoint: doc?.context?.url,
      clusterName: doc?.context?.cluster,
    };
  } catch {
    return {};
  }
}

/**
 * Scan clusters directory for node info
 */
async function scanNodes(repoRoot: string): Promise<Node[]> {
  const nodes: Node[] = [];
  const clustersDir = join(repoRoot, "clusters");

  try {
    const clusters = await readdir(clustersDir);

    for (const cluster of clusters) {
      const patchesDir = join(clustersDir, cluster, "patches");

      try {
        const patches = await readdir(patchesDir);

        for (const patch of patches) {
          if (!patch.endsWith(".yaml")) continue;

          const content = await readFile(join(patchesDir, patch), "utf-8");

          // Look for node IP patterns in patches
          const ipMatch = content.match(/(\d+\.\d+\.\d+\.\d+)/);
          const nameMatch = patch.match(/^([^-]+)/);

          if (ipMatch && nameMatch) {
            nodes.push({
              name: nameMatch[1],
              ip: ipMatch[1],
              role: content.includes("control-plane") ? "control-plane" : "worker",
            });
          }
        }
      } catch {
        // No patches dir
      }
    }
  } catch {
    // No clusters dir
  }

  return nodes;
}

/**
 * Detect cluster context from GitOps repo structure
 */
export async function detectClusterContext(
  cwd: string = process.cwd()
): Promise<ClusterContext | null> {
  // Check cache
  if (cachedContext && Date.now() - cacheTime < CACHE_TTL) {
    return cachedContext;
  }

  const repoRoot = await findRepoRoot(cwd);
  if (!repoRoot) return null;

  const omniConfig = await parseOmniConfig(repoRoot);
  const nodes = await scanNodes(repoRoot);

  // Scan apps directory
  const apps = new Map<string, AppDefinition>();
  const appsDir = join(repoRoot, "apps");

  try {
    const appDirs = await readdir(appsDir);

    for (const appName of appDirs) {
      const appPath = join(appsDir, appName);
      const appStat = await stat(appPath);

      if (!appStat.isDirectory()) continue;

      // Look for application.yaml
      const appFiles = await readdir(appPath);
      const appFile = appFiles.find((f) => f.includes("application"));

      if (appFile) {
        const appDef = await parseApplication(join(appPath, appFile));

        if (appDef) {
          // Check for tolerations
          appDef.hasTolerations = await checkTolerations(appDef.valuesPath);

          // Check for PSA level
          const manifestsPath = join(appPath, "manifests");
          appDef.psaLevel = await parsePsaLevel(manifestsPath);

          apps.set(appName, appDef);
        }
      }
    }
  } catch {
    // No apps dir
  }

  // Try to detect domain from cloudflared config
  let domain: string | undefined;
  const cloudflaredValues = join(appsDir, "cloudflared", "values.yaml");

  try {
    const content = await readFile(cloudflaredValues, "utf-8");
    const domainMatch = content.match(/hostname:\s*[\w-]+\.([\w.-]+)/);
    if (domainMatch) {
      domain = domainMatch[1];
    }
  } catch {
    // No cloudflared config
  }

  const context: ClusterContext = {
    name: omniConfig.clusterName || "unknown",
    omniEndpoint: omniConfig.endpoint,
    nodes,
    domain,
    apps,
    repoRoot,
  };

  // Update cache
  cachedContext = context;
  cacheTime = Date.now();

  return context;
}

/**
 * Invalidate the cache (call when files change)
 */
export function invalidateCache(): void {
  cachedContext = null;
  cacheTime = 0;
}

/**
 * Get app definition by name
 */
export async function getApp(name: string): Promise<AppDefinition | null> {
  const context = await detectClusterContext();
  return context?.apps.get(name) || null;
}

/**
 * Get all app names
 */
export async function getAppNames(): Promise<string[]> {
  const context = await detectClusterContext();
  return context ? Array.from(context.apps.keys()) : [];
}
