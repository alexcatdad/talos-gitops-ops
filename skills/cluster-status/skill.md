---
name: cluster-status
description: Use to check cluster health and service status. Shows what's running, what's broken, and why.
---

# Cluster Status

## Quick Health Check

```bash
# Cluster status via Omni
omnictl cluster status

# Machine status
omnictl get machines

# All K8s containers across nodes
talosctl containers -k -n sake,soy,sushi
```

## ArgoCD Application Status

```bash
# List all apps with status
argocd app list

# Detailed status for one app
argocd app get <app-name>

# Show sync diff
argocd app diff <app-name>

# Show app logs
argocd app logs <app-name>
```

## Interpreting ArgoCD Status

| Sync Status | Health Status | Meaning |
|-------------|---------------|---------|
| Synced | Healthy | All good |
| Synced | Degraded | Resources exist but unhealthy |
| OutOfSync | - | Git differs from cluster |
| Syncing | Progressing | Sync in progress |
| Failed | - | Sync failed |

## Check Specific Service

```bash
# Containers for namespace
talosctl containers -k -n sake,soy,sushi 2>&1 | grep "<namespace>"

# ArgoCD app details
argocd app get <service>

# Health check gateway
curl -sf https://<service>.escu.dev/health && echo "OK" || echo "FAIL"
```

## Common Issues

### Pods Pending

Check for toleration issues:
```bash
argocd app get <app> -o yaml | grep -A5 "conditions:"
```

Fix: Add control-plane tolerations to ALL components.

### Pods CrashLooping

Check logs:
```bash
argocd app logs <app> --kind Deployment --name <deployment>
```

Common causes:
- Missing secrets
- Database connection failed
- Port conflicts (hostNetwork)

### OutOfSync Loop

Check for auto-generated diffs:
```bash
argocd app diff <app>
```

If secrets or checksums differ, add ignoreDifferences.

### Sync Failed

Check events:
```bash
argocd app get <app>
```

Common causes:
- PSA violation (need privileged namespace)
- CRD missing (dependency not deployed)
- Invalid YAML

## Node-Level Checks

```bash
# Talos services
talosctl services -n sake

# Disk usage
talosctl get volumes -n sake

# Kernel messages
talosctl dmesg -n sake | tail -50

# System logs
talosctl logs kubelet -n sake | tail -100
```

## Gateway Health

Check all external services:
```bash
# ArgoCD
curl -sf https://argocd.escu.dev && echo "argocd: OK"

# Longhorn
curl -sf https://longhorn.escu.dev && echo "longhorn: OK"

# Harbor
curl -sf https://harbor.escu.dev/api/v2.0/health && echo "harbor: OK"
```

## Full Status Report

Run this for complete overview:

```bash
echo "=== Cluster ==="
omnictl cluster status

echo "=== Machines ==="
omnictl get machines

echo "=== ArgoCD Apps ==="
argocd app list

echo "=== Problem Apps ==="
argocd app list | grep -v "Synced.*Healthy"

echo "=== Containers by Node ==="
for node in sake soy sushi; do
  echo "--- $node ---"
  talosctl containers -k -n $node 2>&1 | grep -E "NAMESPACE|Running" | head -20
done
```

## What NOT to Use

- `kubectl get pods` - Use `talosctl containers -k`
- `kubectl describe` - Use `argocd app get`
- `kubectl logs` - Use `argocd app logs`

All debugging should go through talosctl or argocd, never kubectl.
