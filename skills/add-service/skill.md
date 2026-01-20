---
name: add-service
description: Use to add a new service to the cluster. Generates correctly configured ArgoCD Application and values.yaml with all gotchas pre-handled.
---

# Add Service to Cluster

## Before Starting

1. **Research the chart** - Get the actual schema, don't guess
2. **Check version exists** - Verify before writing config
3. **Identify requirements** - Storage? Secrets? hostNetwork?

## Step 1: Research

```bash
# Find the chart
helm search repo <name>

# Get schema
helm show values <repo>/<chart> > /tmp/schema.yaml

# Check available versions
helm search repo <repo>/<chart> --versions | head -10
```

Use Context7 for official docs:
```
mcp__plugin_context7_context7__resolve-library-id
mcp__plugin_context7_context7__query-docs
```

## Step 2: Create Directory Structure

```
apps/<service>/
├── application.yaml
├── values.yaml
└── manifests/           # Optional: namespace, secrets
    ├── namespace.yaml   # If PSA labels needed
    └── kustomization.yaml  # If KSOPS secrets
```

## Step 3: Generate application.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: <service>
  namespace: argocd
spec:
  project: default
  sources:
    # Git source for manifests (if needed)
    - repoURL: git@github.com.<user>/<repo>.
      targetRevision: HEAD
      path: apps/<service>/manifests
    # Helm chart
    - repoURL: <helm-repo-url>
      chart: <chart-name>
      targetRevision: <version>  # Verify this exists!
      helm:
        valueFiles:
          - $values/apps/<service>/values.yaml
    # Values from git
    - repoURL: git@github.com.<user>/<repo>.
      targetRevision: HEAD
      ref: values
  destination:
    server: https://kubernetes.default.svc
    namespace: <namespace>
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - ServerSideApply=true
```

## Step 4: Generate values.yaml

**Always include:**

```yaml
# Control-plane tolerations - REQUIRED
tolerations: &tolerations
  - key: "node-role.kubernetes.io/control-plane"
    operator: "Exists"
    effect: "NoSchedule"

# Apply to ALL components
<component1>:
  tolerations: *tolerations
<component2>:
  tolerations: *tolerations
```

**Check chart schema for toleration paths** - they vary:
- `tolerations:`
- `global.tolerations:`
- `operatorConfig.tolerations:`
- `controller.tolerations:`

## Step 5: Namespace (if privileged)

If service needs hostNetwork, hostPorts, or privileged containers:

```yaml
# apps/<service>/manifests/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: <namespace>
  labels:
    pod-security.kubernetes.io/enforce: privileged
    pod-security.kubernetes.io/audit: privileged
    pod-security.kubernetes.io/warn: privileged
```

## Step 6: Validate Before Commit

```bash
# Dry-run helm template
helm template <service> <repo>/<chart> \
  --version <version> \
  -f apps/<service>/values.yaml \
  -n <namespace>

# Check for errors, missing tolerations, etc.
```

## Step 7: Commit and Push

```bash
git add apps/<service>/
git commit -m "feat(<service>): add <service> to cluster"
git push
# ArgoCD will sync automatically
```

## Common Patterns

### External Service (via Cloudflare Tunnel)

Add route to `apps/cloudflared/values.yaml`:

```yaml
cloudflare:
  ingress:
    - hostname: <service>.escu.dev
      service: http://<service>.<namespace>.svc.cluster.local:<port>
```

Then create DNS route:
```bash
cloudflared tunnel route dns <tunnel-name> <service>.escu.dev
```

### Service with Database

1. Add managed role to CloudNativePG cluster
2. Create KSOPS-encrypted password secret
3. Reference in service values

### Service with Cache (Valkey)

Point to existing Valkey:
```yaml
redis:  # or cache:
  host: valkey-primary.valkey.svc.cluster.local
  port: 6379
```

## Validation Checklist

Before committing, verify:

- [ ] Chart version exists (`helm search repo`)
- [ ] All components have tolerations
- [ ] PSA namespace if privileged
- [ ] Service ports correct (check chart)
- [ ] ignoreDifferences if generates random secrets
- [ ] Helm template succeeds
