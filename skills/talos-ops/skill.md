---
name: talos-ops
description: Use when operating on Talos/GitOps infrastructure. Enforces research-first, dry-run workflow. Prevents mistakes before they happen.
---

# Talos GitOps Operations

## Workflow (NEVER SKIP)

```
1. RESEARCH  →  2. DRY-RUN  →  3. APPLY
     ↓              ↓             ↓
 Context7       helm template   git push
 helm show      argocd diff     (ArgoCD syncs)
 WebFetch       Review output
```

**5 minutes of research prevents 2 hours of debugging.**

## Tool Precedence

| Tool | Use | Never |
|------|-----|-------|
| `omnictl` | Omni resources, configs | |
| `talosctl` | Node ops, container inspection | |
| `argocd` | App status, diff, logs | `sync` (prefer git push) |
| `helm` | `template`, `show values`, `search` | `install`, `upgrade` |
| `kubectl` | **NEVER** | Everything |

## Research Commands

```bash
# Chart schema
helm show values <repo>/<chart> > /tmp/schema.yaml

# Chart versions
helm search repo <repo>/<chart> --versions

# Context7 for docs
# Use mcp__plugin_context7_context7__query-docs
```

## Dry-Run Commands

```bash
# Preview helm output
helm template <name> <repo>/<chart> -f values.yaml -n <ns>

# Preview ArgoCD changes
argocd app diff <app-name>

# Preview manifests
argocd app manifests <app-name>
```

## Control-Plane Cluster Checklist

All nodes have `node-role.kubernetes.io/control-plane:NoSchedule`. Every deployment needs:

```yaml
tolerations:
  - key: "node-role.kubernetes.io/control-plane"
    operator: "Exists"
    effect: "NoSchedule"
```

Check ALL components: manager, driver, UI, webhooks, jobs, sidecars.

## PSA Labels

Privileged workloads need namespace labels:

```yaml
metadata:
  labels:
    pod-security.kubernetes.io/enforce: privileged
    pod-security.kubernetes.io/audit: privileged
    pod-security.kubernetes.io/warn: privileged
```

Required for: hostNetwork, hostPorts, privileged containers, CAP_NET_BIND_SERVICE.

## Talos Specifics

- `kubeletRootDir: /var/lib/kubelet` (auto-detection fails)
- hostNetwork: Bind to node IP, not 0.0.0.0 (Talos uses 127.0.0.53:53)
- Recreate strategy for hostNetwork + nodeSelector

## Common Schema Mistakes

| Chart | Wrong | Correct |
|-------|-------|---------|
| Bitnami Valkey | `master:` | `primary:` |
| Tailscale | `tolerations:` | `operatorConfig.tolerations:` |
| Harbor | custom key | Key must be `password` |

## ArgoCD ignoreDifferences

Charts generating random secrets need:

```yaml
ignoreDifferences:
  - group: ""
    kind: Secret
    name: <secret-name>
    namespace: <ns>
    jsonPointers:
      - /data
```

Charts that need this: Harbor, ArgoCD.

## After Deploy

```bash
# Check containers
talosctl containers -k -n sake,soy,sushi | grep <namespace>

# Check ArgoCD status
argocd app get <app-name>

# Health check gateway
curl -sf https://service.escu.dev/health
```

## Bootstrap Mode

For initial cluster setup before ArgoCD:

```bash
export TALOS_GITOPS_BOOTSTRAP=true
# kubectl and helm install now allowed
```

## External Secrets Operator

When using ESO with CNPG managed roles:

- `cnpg.io/reload` label goes on **target Secret** (via `template.metadata.labels`)
- When using `template`, always include `template.data`
- Migration may require one-time password sync job

See `eso-cnpg-pattern` skill for full details.

## Related Skills

- `add-service` - Scaffold new service with correct config
- `add-secret` - Generate KSOPS-encrypted secrets
- `cluster-status` - Health overview of all services
- `eso-cnpg-pattern` - ESO + CNPG integration pattern
- `secret-restart-pattern` - Handling secret changes
