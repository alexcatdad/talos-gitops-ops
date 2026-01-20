#!/usr/bin/env bun
/**
 * Pre-tool hook: Validates YAML files before Edit/Write
 *
 * - Lints YAML syntax
 * - Validates application.yaml chart URLs and versions
 * - Validates values.yaml against helm schema
 * - Checks for missing tolerations
 */

import { parse as parseYaml } from "yaml";
import { isGitOpsRepo, findRepoRoot, getApp } from "../lib/cluster-context.js";
import { validateChartRepo, validateChartVersion, checkUrl } from "../lib/url-checker.js";
import { checkTolerations, checkCommonMistakes } from "../lib/helm-validator.js";
import { hookResponse, type HookInput, type ValidationError } from "../lib/types.js";

async function main(): Promise<void> {
  // Read hook input from stdin
  const input = await Bun.stdin.text();
  let hookInput: HookInput;

  try {
    hookInput = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  // Only handle Edit/Write tools
  if (!["Edit", "Write"].includes(hookInput.tool_name)) {
    process.exit(0);
  }

  const filePath = (hookInput.tool_input.file_path as string) || "";
  const content = (hookInput.tool_input.content as string) ||
    (hookInput.tool_input.new_string as string) || "";

  // Only validate YAML files
  if (!filePath.endsWith(".yaml") && !filePath.endsWith(".yml")) {
    process.exit(0);
  }

  // Check if we're in a GitOps repo
  const cwd = process.cwd();
  const inGitOps = await isGitOpsRepo(cwd);
  if (!inGitOps) {
    process.exit(0);
  }

  const errors: ValidationError[] = [];

  // 1. Lint YAML syntax
  try {
    parseYaml(content);
  } catch (error) {
    errors.push({
      file: filePath,
      severity: "error",
      message: `Invalid YAML: ${error instanceof Error ? error.message : "Parse error"}`,
    });

    // Can't continue if YAML is invalid
    outputErrors(errors);
    return;
  }

  // 2. Validate application.yaml
  if (filePath.includes("application")) {
    const appErrors = await validateApplicationYaml(content, filePath);
    errors.push(...appErrors);
  }

  // 3. Validate values.yaml
  if (filePath.includes("values")) {
    const valuesErrors = await validateValuesYaml(content, filePath);
    errors.push(...valuesErrors);
  }

  outputErrors(errors);
}

async function validateApplicationYaml(
  content: string,
  filePath: string
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  try {
    const doc = parseYaml(content);

    if (doc?.kind !== "Application") {
      return errors;
    }

    const spec = doc.spec;
    const sources = spec?.sources || (spec?.source ? [spec.source] : []);

    for (const source of sources) {
      // Validate chart repo URL
      if (source.repoURL && !source.repoURL.startsWith("git@")) {
        const repoError = await validateChartRepo(source.repoURL);
        if (repoError) {
          repoError.file = filePath;
          errors.push(repoError);
        }

        // Validate chart version
        if (source.chart && source.targetRevision) {
          const versionError = await validateChartVersion(
            source.repoURL,
            source.chart,
            source.targetRevision
          );
          if (versionError) {
            versionError.file = filePath;
            errors.push(versionError);
          }
        }
      }

      // Validate git repo URL is reachable (for git repos)
      if (source.repoURL?.startsWith("https://")) {
        const result = await checkUrl(source.repoURL);
        if (!result.ok) {
          errors.push({
            file: filePath,
            severity: "error",
            message: `Git repo unreachable: ${source.repoURL}`,
          });
        }
      }
    }

    // Check for ignoreDifferences on known problematic charts
    const chartNames = sources
      .filter((s: Record<string, unknown>) => s.chart)
      .map((s: Record<string, unknown>) => s.chart as string);

    const needsIgnoreDifferences = ["harbor", "argocd"];
    for (const chart of chartNames) {
      if (needsIgnoreDifferences.some((c) => chart.includes(c))) {
        if (!spec?.ignoreDifferences?.length) {
          errors.push({
            file: filePath,
            severity: "warning",
            message: `${chart} chart typically needs ignoreDifferences for auto-generated secrets`,
            fix: "Add ignoreDifferences for secrets that change on each helm render",
          });
        }
      }
    }
  } catch (error) {
    errors.push({
      file: filePath,
      severity: "error",
      message: `Failed to parse Application: ${error instanceof Error ? error.message : "Unknown"}`,
    });
  }

  return errors;
}

async function validateValuesYaml(
  content: string,
  filePath: string
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  // Check for tolerations
  const tolerationErrors = await checkTolerations(filePath);
  errors.push(...tolerationErrors);

  // Check for common mistakes
  const mistakeErrors = await checkCommonMistakes(filePath);
  errors.push(...mistakeErrors);

  // Check if content has hostNetwork but no privileged PSA
  if (content.includes("hostNetwork: true")) {
    errors.push({
      file: filePath,
      severity: "warning",
      message: "hostNetwork requires privileged PSA namespace",
      fix: "Ensure namespace has pod-security.kubernetes.io/enforce: privileged",
    });
  }

  // Check for Recreate strategy with hostNetwork
  if (content.includes("hostNetwork: true") && !content.includes("Recreate")) {
    errors.push({
      file: filePath,
      severity: "warning",
      message: "hostNetwork deployments should use Recreate strategy",
      fix: "Add deploymentStrategy.type: Recreate",
    });
  }

  return errors;
}

function outputErrors(errors: ValidationError[]): void {
  // Filter to only errors (not warnings) for blocking
  const blockingErrors = errors.filter((e) => e.severity === "error");
  const warnings = errors.filter((e) => e.severity === "warning");

  if (blockingErrors.length > 0) {
    const errorMessages = blockingErrors
      .map((e) => {
        const loc = e.line ? `:${e.line}` : "";
        const fix = e.fix ? ` Fix: ${e.fix}` : "";
        return `${e.file}${loc}: ${e.message}${fix}`;
      })
      .join("\n");

    console.log(
      JSON.stringify(hookResponse.deny(`Validation errors:\n${errorMessages}`))
    );
    process.exit(0);
  }

  if (warnings.length > 0) {
    const warningMessages = warnings
      .map((e) => {
        const loc = e.line ? `:${e.line}` : "";
        return `${e.file}${loc}: ${e.message}`;
      })
      .join("\n");

    console.log(
      JSON.stringify(hookResponse.ask(`Warnings:\n${warningMessages}\n\nProceed anyway?`))
    );
    process.exit(0);
  }

  // No errors or warnings - allow silently
  process.exit(0);
}

main().catch((error) => {
  console.error("Hook error:", error);
  process.exit(0);
});
