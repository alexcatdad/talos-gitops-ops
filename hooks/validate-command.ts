#!/usr/bin/env bun
/**
 * Pre-tool hook: Validates Bash commands before execution
 *
 * - Blocks kubectl (except bootstrap)
 * - Blocks helm install/upgrade (except bootstrap)
 * - Warns on argocd app sync without prior diff
 * - Validates before git push
 */

import { isGitOpsRepo } from "../lib/cluster-context.js";
import { hookResponse, type HookInput } from "../lib/types.js";

// Session state file for tracking dry-runs
const SESSION_STATE_FILE = "/tmp/talos-gitops-ops-session.json";

interface SessionState {
  validatedApps: string[];
  diffedApps: string[];
  lastCommand: string;
  loopCount: number;
}

async function loadSessionState(): Promise<SessionState> {
  try {
    const content = await Bun.file(SESSION_STATE_FILE).text();
    return JSON.parse(content);
  } catch {
    return { validatedApps: [], diffedApps: [], lastCommand: "", loopCount: 0 };
  }
}

async function saveSessionState(state: SessionState): Promise<void> {
  await Bun.write(SESSION_STATE_FILE, JSON.stringify(state, null, 2));
}

async function main(): Promise<void> {
  // Read hook input from stdin
  const input = await Bun.stdin.text();
  let hookInput: HookInput;

  try {
    hookInput = JSON.parse(input);
  } catch {
    // Not valid JSON, allow
    process.exit(0);
  }

  // Only handle Bash tool
  if (hookInput.tool_name !== "Bash") {
    process.exit(0);
  }

  const command = (hookInput.tool_input.command as string) || "";
  const cwd = process.cwd();

  // Check if we're in a GitOps repo
  const inGitOps = await isGitOpsRepo(cwd);
  if (!inGitOps) {
    process.exit(0);
  }

  // Check bootstrap mode
  const bootstrapMode = process.env.TALOS_GITOPS_BOOTSTRAP === "true";

  // Load session state
  const state = await loadSessionState();

  // Loop detection
  if (command === state.lastCommand) {
    state.loopCount++;
    if (state.loopCount >= 2) {
      console.log(
        JSON.stringify(
          hookResponse.deny(
            `Loop detected: same command repeated ${state.loopCount} times. Fix the underlying issue.`
          )
        )
      );
      state.loopCount = 0;
      await saveSessionState(state);
      process.exit(0);
    }
  } else {
    state.lastCommand = command;
    state.loopCount = 0;
  }

  // kubectl - BLOCKED (except bootstrap)
  if (/\bkubectl\s+/.test(command)) {
    if (bootstrapMode) {
      console.log(
        JSON.stringify(
          hookResponse.ask("Bootstrap mode: kubectl allowed. Proceed?")
        )
      );
    } else {
      console.log(
        JSON.stringify(
          hookResponse.deny(
            "kubectl is blocked. Use omnictl, talosctl, or ArgoCD via git. " +
              "For bootstrap: export TALOS_GITOPS_BOOTSTRAP=true"
          )
        )
      );
    }
    await saveSessionState(state);
    process.exit(0);
  }

  // helm install/upgrade - BLOCKED (except bootstrap)
  if (/\bhelm\s+(install|upgrade)\b/.test(command)) {
    if (bootstrapMode) {
      console.log(
        JSON.stringify(
          hookResponse.ask("Bootstrap mode: helm install allowed. Proceed?")
        )
      );
    } else {
      console.log(
        JSON.stringify(
          hookResponse.deny(
            "helm install/upgrade is blocked. Use GitOps: edit values.yaml, git push, let ArgoCD sync. " +
              "For bootstrap: export TALOS_GITOPS_BOOTSTRAP=true"
          )
        )
      );
    }
    await saveSessionState(state);
    process.exit(0);
  }

  // helm template - ALLOWED, track it
  if (/\bhelm\s+template\b/.test(command)) {
    // Extract app name if possible
    const match = command.match(/helm\s+template\s+(\S+)/);
    if (match) {
      state.validatedApps.push(match[1]);
    }
    await saveSessionState(state);
    process.exit(0);
  }

  // argocd app diff - ALLOWED, track it
  if (/\bargocd\s+app\s+diff\b/.test(command)) {
    const match = command.match(/argocd\s+app\s+diff\s+(\S+)/);
    if (match) {
      state.diffedApps.push(match[1]);
    }
    await saveSessionState(state);
    process.exit(0);
  }

  // argocd app sync - WARN (prefer git push)
  if (/\bargocd\s+app\s+sync\b/.test(command)) {
    const match = command.match(/argocd\s+app\s+sync\s+(\S+)/);
    const appName = match ? match[1] : "unknown";

    if (!state.diffedApps.includes(appName)) {
      console.log(
        JSON.stringify(
          hookResponse.ask(
            `No 'argocd app diff ${appName}' in this session. Run diff first or proceed anyway?`
          )
        )
      );
      await saveSessionState(state);
      process.exit(0);
    }

    // Diff was run, but still prefer git push
    console.log(
      JSON.stringify(
        hookResponse.ask(
          "Prefer 'git push' and let ArgoCD auto-sync. Proceed with manual sync?"
        )
      )
    );
    await saveSessionState(state);
    process.exit(0);
  }

  // git push - triggers validation
  if (/\bgit\s+push\b/.test(command)) {
    // The actual validation happens in validate-yaml hook on file edits
    // Here we just note that a push is happening
    await saveSessionState(state);
    process.exit(0);
  }

  // All other commands - ALLOWED
  await saveSessionState(state);
  process.exit(0);
}

main().catch((error) => {
  console.error("Hook error:", error);
  process.exit(0); // Don't block on hook errors
});
