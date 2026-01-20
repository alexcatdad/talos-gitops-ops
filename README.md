# Talos GitOps Ops

A Claude Code plugin for Talos + GitOps infrastructure operations. Enforces research-first, dry-run workflow. Prevents mistakes before they happen.

## Philosophy

- **Research first** - 5 minutes reading docs prevents 2 hours debugging
- **Dry-run always** - See what will happen before it happens
- **Fail fast** - Stop on first error, don't loop
- **Silent guardian** - No output when right, direct feedback when wrong

## Installation

```bash
# Add marketplace
claude plugin marketplace add alexcatdad/talos-gitops-ops

# Install plugin
claude plugin install talos-gitops-ops@talos-gitops-ops

# Or install at project scope
claude plugin install talos-gitops-ops@talos-gitops-ops --scope project
```

## Auto-Activation

Plugin activates when working directory contains:
- `omniconfig.yaml`
- `apps/` with ArgoCD Application manifests
- `.talos-gitops-ops` marker file

## Features

### Skills

| Skill | Trigger | Purpose |
|-------|---------|---------|
| `talos-ops` | Working in GitOps repo | Main ops workflow, tool precedence |
| `add-service` | "Add X to cluster" | Scaffold new service correctly |
| `add-secret` | "Add secret for X" | Generate KSOPS-encrypted secrets |
| `cluster-status` | "Cluster status" | Health overview |

### Agents

| Agent | Purpose |
|-------|---------|
| `pre-deploy-validator` | Validates changes before commit |
| `ops-assistant` | Investigates cluster issues |
| `service-scaffolder` | Generates service configs from chart |

### Hooks

| Hook | Trigger | Action |
|------|---------|--------|
| `validate-command` | Bash commands | Blocks kubectl, warns on helm install |
| `validate-yaml` | Edit/Write YAML | Lints, validates chart URLs/versions |
| `sync-watcher` | After git push | Monitors ArgoCD sync status |

## Command Classification

| Command | Status | Notes |
|---------|--------|-------|
| `kubectl *` | **BLOCKED** | Use omnictl/talosctl/argocd |
| `helm install/upgrade` | **BLOCKED** | Use GitOps (edit values, push) |
| `helm template` | Allowed | Dry-run, encouraged |
| `helm show values` | Allowed | Research, encouraged |
| `argocd app diff` | Allowed | Validation, encouraged |
| `argocd app sync` | Warn | Prefer git push |
| `omnictl/talosctl` | Allowed | Preferred tools |

## Bootstrap Mode

For initial cluster setup before ArgoCD:

```bash
export TALOS_GITOPS_BOOTSTRAP=true
```

This allows kubectl and helm install commands.

## Auto-Detection

The plugin scans your GitOps repo to understand:

- **Cluster info** from `omniconfig.yaml`
- **Node info** from `clusters/*/patches/`
- **Apps** from `apps/*/application.yaml`
- **Values** from `apps/*/values.yaml`
- **Domain** from cloudflared config

No manual configuration needed.

## Known Gotchas (Built-in)

The plugin knows about common issues:

- **Control-plane tolerations** - All nodes tainted, every component needs tolerations
- **PSA labels** - Privileged workloads need namespace labels
- **Talos paths** - kubeletRootDir must be explicit
- **Bitnami naming** - `primary:` not `master:`
- **Chart defaults** - Don't duplicate catch-all rules
- **Resource normalization** - `1000m` → `1` causes drift

## Requirements

- Bun >= 1.0.0
- omnictl, talosctl, argocd CLI tools
- Helm 3
- SOPS + age (for secrets)

## Development

```bash
cd talos-gitops-ops
bun install
bun run typecheck
```

## License

MIT
