---
name: eso-cnpg-pattern
description: External Secrets Operator + CloudNativePG integration pattern. Handles password sync, reload labels, and common pitfalls.
---

# ESO + CNPG Integration Pattern

## The Problem

When using External Secrets Operator (ESO) with CloudNativePG (CNPG) managed roles, passwords can get out of sync:

1. CNPG creates database users with passwords from Secrets at creation time
2. If Secrets change later (or are recreated by ESO), CNPG may not update PostgreSQL
3. Apps fail with `FATAL: password authentication failed`

## The `cnpg.io/reload` Label

CNPG watches Secrets with `cnpg.io/reload: "true"` label and updates passwords when they change.

**CRITICAL**: The label must be on the **generated Secret**, not the ExternalSecret CRD.

### Wrong (label on ExternalSecret)

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: postgres-myapp
  labels:
    cnpg.io/reload: "true"  # WRONG - CNPG doesn't watch ExternalSecrets
```

### Correct (label on target Secret via template)

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: postgres-myapp
  namespace: database
spec:
  refreshInterval: 1h
  secretStoreRef:
    kind: ClusterSecretStore
    name: infisical
  target:
    name: postgres-myapp
    creationPolicy: Owner
    template:
      metadata:
        labels:
          cnpg.io/reload: "true"  # CORRECT - goes on generated Secret
      data:
        password: "{{ .password }}"  # REQUIRED when using template
  data:
    - secretKey: password
      remoteRef:
        key: /postgres/myapp/PASSWORD
```

## Template.data is Required

When using `target.template` for labels or type, you MUST include `template.data`:

### Wrong (missing template.data)

```yaml
target:
  template:
    metadata:
      labels:
        cnpg.io/reload: "true"
  # Missing template.data - Secret will be empty!
```

### Correct

```yaml
target:
  template:
    metadata:
      labels:
        cnpg.io/reload: "true"
    data:
      password: "{{ .password }}"  # Maps spec.data to Secret keys
```

## Migration Pattern

When migrating from SOPS to ESO, existing PostgreSQL passwords may not match:

### Diagnosis

```bash
# Create a debug job to test connection
argocd app logs <app> --kind Job --name debug-passwords
```

Signs of password mismatch:
- App logs: `FATAL: password authentication failed`
- CNPG status shows `passwordStatus.transactionID` unchanged
- Secret is correct but PostgreSQL has different password

### Fix: One-Time Password Sync Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: sync-managed-role-passwords
  namespace: database
spec:
  template:
    spec:
      containers:
        - name: sync
          image: postgres:16-alpine
          env:
            - name: PGHOST
              value: postgres-rw.database.svc.cluster.local
            - name: PGUSER
              valueFrom:
                secretKeyRef:
                  name: postgres-superuser
                  key: username
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-superuser
                  key: password
            - name: MYAPP_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-myapp
                  key: password
          command:
            - /bin/sh
            - -c
            - |
              psql -c "ALTER ROLE myapp WITH PASSWORD '$MYAPP_PASSWORD';"
              PGPASSWORD="$MYAPP_PASSWORD" psql -U myapp -d myapp -c "SELECT 1"
```

**Delete this job after passwords are synced.**

## Verification

Check CNPG cluster status for password updates:

```bash
argocd app manifests postgres --source live | grep -A 10 "passwordStatus:"
```

Look for:
- `transactionID` changing after secret updates
- `managedRoleSecretVersion` showing current resourceVersion

## Single Source of Truth Pattern

For database credentials, use the SAME secret path for both:
- CNPG managed role (`postgres-myapp` Secret)
- Application connection (`myapp-credentials` Secret)

```
Infisical: /postgres/myapp/PASSWORD
    ├── ExternalSecret → postgres-myapp (database namespace)
    │   └── CNPG reads this to set PostgreSQL password
    └── ExternalSecret → myapp-credentials (app namespace)
        └── App reads this to connect
```

Both reference the same Infisical path = always in sync.

## Checklist

Before deploying ESO + CNPG:

- [ ] `cnpg.io/reload: "true"` in `target.template.metadata.labels`
- [ ] `template.data` maps all required Secret keys
- [ ] Single Infisical path for both DB and app secrets
- [ ] If migrating: run password sync job first
- [ ] Verify with: `argocd app logs` after deployment
