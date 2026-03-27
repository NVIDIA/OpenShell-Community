# Base Sandbox

The foundational sandbox image that all other OpenShell Community sandbox images build from.

## What's Included

| Category | Tools |
|----------|-------|
| OS | Ubuntu 24.04 |
| Languages | `python3` (3.13), `node` (22.22.1) |
| Package managers | `npm` (11.11.0), `uv` (0.10.8), `pip` |
| Coding agents | `claude`, `opencode`, `codex`, `copilot` |
| Developer | `gh`, `git`, `vim`, `nano` |
| Networking | `ping`, `dig`, `nslookup`, `nc`, `traceroute`, `netstat`, `curl` |

### Users

| User | Purpose |
|------|---------|
| `supervisor` | Privileged process management (nologin shell) |
| `sandbox` | Unprivileged user for agent workloads (default) |

### Directory Layout

```
/sandbox/                  # Home directory (sandbox user)
  .bashrc, .profile        # Shell init (PATH, VIRTUAL_ENV, UV_PYTHON_INSTALL_DIR)
  .venv/                   # Writable Python venv (pip install, uv pip install)
  .agents/skills/          # Agent skill discovery
  .claude/skills/          # Claude skill discovery (symlinked from .agents/skills)
```

### Skills

The base image ships with the following agent skills:

| Skill | Description |
|-------|-------------|
| `github` | REST-only GitHub CLI usage guide (GraphQL is blocked in sandboxes) |

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

## Codex authentication

For remote or headless OpenShell environments, if browser login hangs, try authenticating Codex with:

```bash
codex login --device-auth
```

If device-code login is unreliable in your environment, you can authenticate on another machine and copy ~/.codex/auth.json into the sandbox.