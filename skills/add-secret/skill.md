---
name: add-secret
description: Use to add SOPS-encrypted secrets via KSOPS. Generates properly encrypted secrets that ArgoCD can decrypt.
---

# Add KSOPS-Encrypted Secret

## Prerequisites

- age key available at `~/.config/sops/age/keys.txt`
- `.sops.yaml` configured in repo root
- ArgoCD configured with KSOPS plugin

## Step 1: Create Secret YAML

Create the secret in plaintext first:

```yaml
# apps/<service>/secrets/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: <service>-credentials
  namespace: <namespace>
type: Opaque
stringData:
  password: "actual-password-here"
  api-key: "actual-key-here"
```

## Step 2: Encrypt with SOPS

```bash
# Encrypt in place
sops -e -i apps/<service>/secrets/secret.yaml

# Or encrypt to new file
sops -e apps/<service>/secrets/secret.yaml > apps/<service>/secrets/secret.enc.yaml
```

The encrypted file will have:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: <service>-credentials
  namespace: <namespace>
type: Opaque
stringData:
  password: ENC[AES256_GCM,data:...,type:str]
  api-key: ENC[AES256_GCM,data:...,type:str]
sops:
  age:
    - recipient: age1...
      enc: |
        -----BEGIN AGE ENCRYPTED FILE-----
        ...
```

## Step 3: Create KSOPS Generator

```yaml
# apps/<service>/secrets/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
generators:
  - ksops-generator.yaml
```

```yaml
# apps/<service>/secrets/ksops-generator.yaml
apiVersion: viaduct.ai/v1
kind: ksops
metadata:
  name: <service>-secrets
files:
  - ./secret.yaml
```

## Step 4: Update ArgoCD Application

Add secrets path as a source:

```yaml
spec:
  sources:
    # Secrets via KSOPS
    - repoURL: git@github.com.<user>/<repo>.
      targetRevision: HEAD
      path: apps/<service>/secrets
    # Helm chart
    - repoURL: <helm-repo>
      chart: <chart>
      ...
```

## Step 5: Reference in Values

```yaml
# apps/<service>/values.yaml
existingSecret: <service>-credentials
# or
secretName: <service>-credentials
# or via env
env:
  - name: PASSWORD
    valueFrom:
      secretKeyRef:
        name: <service>-credentials
        key: password
```

## .sops.yaml Configuration

Ensure `.sops.yaml` has correct regex:

```yaml
creation_rules:
  - path_regex: \.yaml$
    encrypted_regex: ^(data|stringData)$
    age: age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Common Patterns

### Database Credentials

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: <service>-db-credentials
  namespace: <namespace>
type: Opaque
stringData:
  username: <service>
  password: "generated-password"
```

### OAuth Credentials

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: <service>-oauth
  namespace: <namespace>
type: Opaque
stringData:
  client-id: "oauth-client-id"
  client-secret: "oauth-client-secret"
```

### CloudNativePG Password Secret

For CNPG managed roles:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: <role>-password
  namespace: postgres
type: Opaque
stringData:
  password: "generated-password"
```

Reference in Cluster:
```yaml
managed:
  roles:
    - name: <role>
      passwordSecret:
        name: <role>-password
```

## Validation

```bash
# Verify encryption
sops -d apps/<service>/secrets/secret.yaml

# Verify KSOPS can decrypt
kustomize build --enable-alpha-plugins apps/<service>/secrets/
```

## Troubleshooting

**"age: no identity matched"**
- Check age key is at correct path
- Verify recipient in `.sops.yaml` matches your public key

**"ksops: executable not found"**
- KSOPS needs to be in PATH
- Check ArgoCD repo-server has KSOPS installed

**Secret not updating**
- ArgoCD caches manifests
- Force refresh: `argocd app get <app> --refresh`
