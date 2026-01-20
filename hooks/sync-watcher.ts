#!/usr/bin/env bun
/**
 * Post-tool hook: Watches for ArgoCD sync after git push
 *
 * - Triggers after git push
 * - Waits for ArgoCD sync (30s timeout)
 * - Reports sync status
 * - Assumes failure on timeout
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { isGitOpsRepo } from "../lib/cluster-context.js";
import type { HookInput } from "../lib/types.js";

const execAsync = promisify(exec);
const SYNC_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 2_000;

interface SyncStatus {
  app: string;
  syncStatus: string;
  healthStatus: string;
  message?: string;
}

async function main(): Promise<void> {
  // Read hook input from stdin
  const input = await Bun.stdin.text();
  let hookInput: HookInput;

  try {
    hookInput = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  // Only handle Bash tool
  if (hookInput.tool_name !== "Bash") {
    process.exit(0);
  }

  const command = (hookInput.tool_input.command as string) || "";

  // Only trigger after git push
  if (!/\bgit\s+push\b/.test(command)) {
    process.exit(0);
  }

  // Check if we're in a GitOps repo
  const cwd = process.cwd();
  const inGitOps = await isGitOpsRepo(cwd);
  if (!inGitOps) {
    process.exit(0);
  }

  // Wait for ArgoCD sync
  console.error("Waiting for ArgoCD sync...");

  const startTime = Date.now();
  let lastStatus: SyncStatus[] = [];

  while (Date.now() - startTime < SYNC_TIMEOUT_MS) {
    try {
      const status = await getArgoCDStatus();

      // Check for sync completion or errors
      const syncing = status.filter((s) => s.syncStatus === "Syncing");
      const failed = status.filter(
        (s) => s.syncStatus === "Failed" || s.healthStatus === "Degraded"
      );
      const outOfSync = status.filter((s) => s.syncStatus === "OutOfSync");

      if (failed.length > 0) {
        console.error("\n--- ArgoCD Sync FAILED ---");
        for (const app of failed) {
          console.error(`${app.app}: ${app.syncStatus}/${app.healthStatus}`);
          if (app.message) {
            console.error(`  ${app.message}`);
          }
        }
        process.exit(0);
      }

      if (syncing.length === 0 && outOfSync.length === 0) {
        // All synced
        console.error("\n--- ArgoCD Sync Complete ---");
        process.exit(0);
      }

      // Still syncing, wait
      lastStatus = status;
      await sleep(POLL_INTERVAL_MS);
    } catch (error) {
      // ArgoCD CLI not available or errored - just exit
      console.error("Could not check ArgoCD status:", error);
      process.exit(0);
    }
  }

  // Timeout - assume failure
  console.error("\n--- ArgoCD Sync TIMEOUT (30s) ---");
  console.error("Assuming sync did not complete. Check ArgoCD UI.");

  if (lastStatus.length > 0) {
    const pending = lastStatus.filter(
      (s) => s.syncStatus !== "Synced" || s.healthStatus !== "Healthy"
    );
    for (const app of pending) {
      console.error(`${app.app}: ${app.syncStatus}/${app.healthStatus}`);
    }
  }

  process.exit(0);
}

interface ArgoApp {
  metadata?: { name?: string };
  status?: {
    sync?: { status?: string };
    health?: { status?: string };
    conditions?: Array<{ message?: string }>;
  };
}

async function getArgoCDStatus(): Promise<SyncStatus[]> {
  const { stdout } = await execAsync(
    "argocd app list -o json 2>/dev/null",
    { timeout: 5_000 }
  );

  const apps: ArgoApp[] = JSON.parse(stdout);

  return apps.map((app) => ({
    app: app.metadata?.name || "unknown",
    syncStatus: app.status?.sync?.status || "Unknown",
    healthStatus: app.status?.health?.status || "Unknown",
    message: app.status?.conditions?.[0]?.message,
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("Hook error:", error);
  process.exit(0);
});
