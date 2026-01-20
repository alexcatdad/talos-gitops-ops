---
name: secret-restart-pattern
description: Kubernetes pattern for handling secret changes. Secrets don't auto-restart pods - use this pattern to ensure changes take effect.
---

# Secret Restart Pattern

## The Problem

Kubernetes does NOT restart pods when mounted Secrets change. The secret data updates in the volume (eventually), but applications that read secrets at startup won't see the new values until restarted.

This affects:
- Database credentials
- API keys
- TLS certificates
- JWT signing keys
- Any config read once at startup

## The Pattern

Add a version annotation to pod spec. Bump it when secrets change:

```yaml
# In Helm values.yaml
server:
  podAnnotations:
    secret-version: "1"  # Bump to trigger restart
```

Or use a checksum of the secret:

```yaml
# In Helm template (if you control the chart)
podAnnotations:
  checksum/secret: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}
```

## When to Use

**Always add restart mechanism when:**
- Mounting secrets as volumes
- Using `envFrom.secretRef`
- Using `env.valueFrom.secretKeyRef`
- Service reads config at startup (most services)

**Skip if:**
- Application watches for file changes (rare)
- Using dynamic secret injection (Vault Agent, etc.)

## Implementation Options

### Option 1: Manual Version Annotation (Simple)

```yaml
podAnnotations:
  secret-version: "1"
```

Pros: Simple, explicit control
Cons: Must remember to bump on secret changes

### Option 2: Checksum Annotation (Automatic)

```yaml
# Requires Helm template access
podAnnotations:
  checksum/config: {{ sha256sum (cat .Values.secretData) }}
```

Pros: Automatic restart on change
Cons: Only works if you control the template

### Option 3: Reloader (External Controller)

Install [Stakater Reloader](https://github.com/stakater/Reloader):

```yaml
# Add annotation to Deployment
metadata:
  annotations:
    reloader.stakater.com/auto: "true"
```

Pros: Fully automatic, works with any chart
Cons: Additional controller to manage

## Common Gotchas

### ArgoCD

ArgoCD server reads `server.secretkey` at startup for JWT signing. Without a restart mechanism, new tokens get signed with the old key after secret updates.

```yaml
server:
  podAnnotations:
    secret-version: "2"
configs:
  secret:
    extra:
      server.secretkey: "your-static-key"
```

### Database Credentials

Applications cache DB connections. Credential rotation requires restart:

```yaml
podAnnotations:
  secret-version: "1"  # Bump when rotating credentials
```

### TLS Certificates

Many apps load certs once at startup:

```yaml
podAnnotations:
  cert-version: "1"  # Bump on cert renewal
```

## Validation

Before deploying, check:

1. Does the service mount secrets?
2. Does it have a restart mechanism?
3. If no, add `podAnnotations` with version

The pre-deploy-validator will warn if secrets are mounted without a restart mechanism.
