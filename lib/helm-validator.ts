import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { ValidationError } from "./types.js";

const execAsync = promisify(exec);
const TIMEOUT_MS = 10_000;

/**
 * Run helm template to validate values against chart schema
 */
export async function validateHelmTemplate(
  repoUrl: string,
  chartName: string,
  version: string,
  valuesPath: string,
  namespace: string
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  try {
    // Construct helm template command
    const chart = repoUrl.startsWith("oci://")
      ? `${repoUrl}/${chartName}`
      : `${chartName}`;

    const repoArg = repoUrl.startsWith("oci://") ? "" : `--repo ${repoUrl}`;

    const cmd = `helm template test ${chart} ${repoArg} --version ${version} -f ${valuesPath} -n ${namespace} 2>&1`;

    await execAsync(cmd, { timeout: TIMEOUT_MS });

    // If we get here, template succeeded
    return [];
  } catch (error) {
    if (error instanceof Error) {
      const message = (error as { stderr?: string }).stderr || error.message;

      // Parse helm errors
      const lines = message.split("\n");

      for (const line of lines) {
        // Schema validation error
        if (line.includes("values don't meet the specifications")) {
          errors.push({
            file: valuesPath,
            severity: "error",
            message: line.trim(),
            fix: "Check helm show values for correct schema",
          });
        }

        // Unknown field
        const unknownMatch = line.match(/unknown field "([^"]+)"/);
        if (unknownMatch) {
          errors.push({
            file: valuesPath,
            severity: "error",
            message: `Unknown field: ${unknownMatch[1]}`,
            fix: `Remove or rename field "${unknownMatch[1]}"`,
          });
        }

        // Type mismatch
        const typeMatch = line.match(/expected (.+), got (.+)/);
        if (typeMatch) {
          errors.push({
            file: valuesPath,
            severity: "error",
            message: `Type mismatch: expected ${typeMatch[1]}, got ${typeMatch[2]}`,
          });
        }
      }

      // If no specific errors found, add generic one
      if (errors.length === 0) {
        errors.push({
          file: valuesPath,
          severity: "error",
          message: `Helm template failed: ${message.slice(0, 200)}`,
        });
      }
    }

    return errors;
  }
}

/**
 * Check if values.yaml has control-plane tolerations
 */
export async function checkTolerations(valuesPath: string): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  try {
    const content = await readFile(valuesPath, "utf-8");
    const doc = parseYaml(content);

    if (!doc) return [];

    // Look for tolerations at various common paths
    const tolerationPaths = [
      "tolerations",
      "global.tolerations",
      "controller.tolerations",
      "operator.tolerations",
      "operatorConfig.tolerations",
      "manager.tolerations",
      "server.tolerations",
      "agent.tolerations",
    ];

    let foundAny = false;
    const controlPlaneToleration = "node-role.kubernetes.io/control-plane";

    for (const path of tolerationPaths) {
      const value = getNestedValue(doc, path);
      if (Array.isArray(value)) {
        foundAny = true;
        const hasControlPlane = value.some(
          (t: Record<string, unknown>) =>
            t.key === controlPlaneToleration || t.operator === "Exists"
        );
        if (!hasControlPlane) {
          errors.push({
            file: valuesPath,
            severity: "warning",
            message: `Tolerations at ${path} may be missing control-plane toleration`,
            fix: `Add: { key: "${controlPlaneToleration}", operator: "Exists", effect: "NoSchedule" }`,
          });
        }
      }
    }

    // If content mentions tolerations but we didn't find structured ones
    if (!foundAny && content.includes("toleration")) {
      // Probably fine, just in a different structure
    }

    return errors;
  } catch {
    return [];
  }
}

/**
 * Check for common schema mistakes
 */
export async function checkCommonMistakes(valuesPath: string): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  try {
    const content = await readFile(valuesPath, "utf-8");
    const lines = content.split("\n");

    // Check for common mistakes
    const mistakes: Array<{ pattern: RegExp; message: string; fix: string }> = [
      {
        pattern: /^\s*master:/m,
        message: "Bitnami charts use 'primary:' not 'master:'",
        fix: "Replace 'master:' with 'primary:'",
      },
      {
        pattern: /cpu:\s*1000m/,
        message: "CPU value '1000m' will normalize to '1', may cause drift",
        fix: "Use 'cpu: \"1\"' instead of 'cpu: 1000m'",
      },
      {
        pattern: /existingSecretPasswordKey:/,
        message: "Many charts require the key to be exactly 'password'",
        fix: "Check chart docs for required secret key name",
      },
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const { pattern, message, fix } of mistakes) {
        if (pattern.test(line)) {
          errors.push({
            file: valuesPath,
            line: i + 1,
            severity: "warning",
            message,
            fix,
          });
        }
      }
    }

    return errors;
  } catch {
    return [];
  }
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce((current: unknown, key) => {
    if (current && typeof current === "object") {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
