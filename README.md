# Talos GitOps Ops

A Claude Code plugin for Talos + GitOps operations. Enforces research-first, dry-run workflow. Prevents mistakes before they happen.

## Philosophy

- **Research first** - 5 minutes of reading docs prevents 2 hours of debugging
- **Dry-run always** - See what will happen before it happens
- **Fail fast** - Stop on first error, don't loop
- **Silent guardian** - No output when things are right, direct feedback when they're not

## Features

### Hooks (Automatic Enforcement)

| Hook | Trigger | Action |
|------|---------|--------|
| validate-command | Bash | Blocks kubectl, warns on helm install |
| validate-yaml | Edit/Write | Lints YAML, validates chart URLs/versions |
| sync-watcher | After git push | Monitors ArgoCD sync status |

### Skills

| Skill | Use |
|-------|-----|
| talos-ops | Main ops workflow, tool precedence, gotchas |
| add-service | Scaffold new service with correct config |
| add-secret | Generate KSOPS-encrypted secrets |
| cluster-status | Health overview, troubleshooting |

### Agents

| Agent | Use |
|-------|-----|
| pre-deploy-validator | Validates changes before commit |
| ops-assistant | Investigates cluster issues |
| service-scaffolder | Generates new service configs |

## Installation

```bash
# Install bun dependencies
cd talos-gitops-ops
bun install

# Install plugin
claude plugin install /path/to/talos-gitops-ops
```

## Auto-Activation

Plugin activates when working directory contains:
- `omniconfig.yaml`
- `apps/` with ArgoCD Application manifests
- `.talos-gitops-ops` marker file

## Bootstrap Mode

For initial cluster setup before ArgoCD:

```bash
export TALOS_GITOPS_BOOTSTRAP=true
```

This allows kubectl and helm install commands.

## Tool Precedence

1. `omnictl` - Omni platform resources
2. `talosctl` - Node operations, container inspection
3. `argocd` - Application status, diff, logs
4. `kubectl` - **NEVER** (except bootstrap)

## Requirements

- Bun >= 1.0.0
- omnictl, talosctl, argocd CLI tools
- Helm 3
- SOPS + age (for secrets)
