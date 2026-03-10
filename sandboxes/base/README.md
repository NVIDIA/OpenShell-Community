# Base Sandbox

The foundational sandbox image that all other OpenShell Community sandbox images build from.

## What's Included

| Category | Tools |
|----------|-------|
| OS | Ubuntu 24.04 |
| Language | `python3`, `node` (22) |
| Developer | `gh`, `git`, `vim`, `nano`, `uv` |
| Networking | `ping`, `dig`, `nslookup`, `nc`, `traceroute`, `netstat`, `curl` |

### Users

| User | Purpose |
|------|---------|
| `supervisor` | Privileged process management (nologin shell) |
| `sandbox` | Unprivileged user for agent workloads (default) |

### Directory Layout

```
/sandbox/                  # Home directory (sandbox user)
  .bashrc, .profile        # Shell init
  .agents/skills/          # Agent skill discovery
```

## Build

```bash
docker build -t openshell-base .
```

## Building a Sandbox on Top

Other sandbox images should use this as their base:

```dockerfile
ARG BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest
FROM ${BASE_IMAGE}

# Add your sandbox-specific layers here
```

See `sandboxes/openclaw/` for an example.
