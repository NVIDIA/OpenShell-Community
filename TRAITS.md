# Sandbox Traits

Traits are cross-cutting capabilities you add to any NemoClaw sandbox. A trait is **not** a sandbox — it's a property you compose into one.

"Give me openclaw **with capability ratcheting**."
"Give me sdg **with observability tracing**."

Each trait ships as a Docker image containing its binaries, configs, and startup script. You compose a trait into your sandbox at build time using Docker multi-stage `COPY --from`.

## Available Traits

| Trait | Description |
| ----- | ----------- |
| [`capability-ratchet`](traits/capability-ratchet/) | Prevents AI agent data exfiltration by dynamically revoking capabilities when private/untrusted data enters the context |

## Using a Trait

### 1. Copy trait artifacts into your sandbox Dockerfile

Each trait publishes a container image to GHCR. Use multi-stage `COPY --from` to pull in its exports:

```dockerfile
# Start from the base sandbox
ARG BASE_IMAGE=ghcr.io/nvidia/nemoclaw-community/sandboxes/base:latest
FROM ${BASE_IMAGE}

# --- Add the capability-ratchet trait ---
ARG RATCHET_IMAGE=ghcr.io/nvidia/nemoclaw-community/traits/capability-ratchet:latest
COPY --from=${RATCHET_IMAGE} /usr/local/bin/capability-ratchet-sidecar /usr/local/bin/
COPY --from=${RATCHET_IMAGE} /usr/local/bin/bash-ast /usr/local/bin/
COPY --from=${RATCHET_IMAGE} /usr/local/bin/ratchet-start /usr/local/bin/
COPY --from=${RATCHET_IMAGE} /app/ratchet-config.yaml /app/
COPY --from=${RATCHET_IMAGE} /app/policy.yaml /app/

# ... your sandbox setup ...
```

The paths to copy are declared in the trait's `trait.yaml` under `exports`.

### 2. Chain the startup script

Call the trait's startup script from your sandbox entrypoint:

```bash
# Start the ratchet sidecar (runs in background)
ratchet-start

# Then start your sandbox's own services
exec your-sandbox-entrypoint
```

### 3. Merge network policy entries

If your sandbox has a `policy.yaml`, add the trait's `network_policy` entries from `trait.yaml`:

```yaml
network_policies:
  # Your existing policies...

  # From capability-ratchet trait
  ratchet_sidecar:
    name: ratchet_sidecar
    endpoints:
      - { host: api.anthropic.com, port: 443 }
      - { host: api.openai.com, port: 443 }
      - { host: integrate.api.nvidia.com, port: 443 }
    binaries:
      - { path: /usr/local/bin/capability-ratchet-sidecar }

inference:
  allowed_routes:
    - ratchet
```

### Full Example: OpenClaw with Capability Ratcheting

```dockerfile
ARG BASE_IMAGE=ghcr.io/nvidia/nemoclaw-community/sandboxes/base:latest
ARG RATCHET_IMAGE=ghcr.io/nvidia/nemoclaw-community/traits/capability-ratchet:latest

FROM ${BASE_IMAGE}

USER root

# --- Capability Ratchet trait ---
COPY --from=${RATCHET_IMAGE} /usr/local/bin/capability-ratchet-sidecar /usr/local/bin/
COPY --from=${RATCHET_IMAGE} /usr/local/bin/bash-ast /usr/local/bin/
COPY --from=${RATCHET_IMAGE} /usr/local/bin/ratchet-start /usr/local/bin/
COPY --from=${RATCHET_IMAGE} /app/ratchet-config.yaml /app/
COPY --from=${RATCHET_IMAGE} /app/policy.yaml /app/
RUN mkdir -p /sandbox/.ratchet && chown sandbox:sandbox /sandbox/.ratchet

# --- OpenClaw setup ---
RUN npm install -g @anthropic/openclaw-cli

COPY entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

USER sandbox
ENTRYPOINT ["/usr/local/bin/entrypoint"]
```

Where `entrypoint.sh` chains the trait startup:

```bash
#!/usr/bin/env bash
set -euo pipefail
ratchet-start          # Start capability ratchet sidecar
exec openclaw-start    # Then start OpenClaw
```

## `trait.yaml` Format

Every trait must include a `trait.yaml` manifest at its root. This declares what the trait provides and how a sandbox consumes it.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `name` | string | Trait identifier (matches the directory name under `traits/`) |
| `version` | string | Semantic version |
| `description` | string | What the trait does |
| `exports.binaries` | list | Executable paths installed by the trait |
| `exports.config` | list | Configuration file paths |
| `exports.scripts` | list | Startup/utility script paths |
| `exports.workspace` | list | Directories created for runtime state |
| `startup.script` | string | Path to the startup script |
| `startup.health_check` | string | URL to check that the trait is running |
| `ports` | list | Ports the trait listens on |
| `network_policy` | object | Network policy entries to merge into the sandbox's `policy.yaml` |
| `inference` | object | Inference routing configuration (route name + endpoint) |

## Creating a Trait

1. Create a directory under `traits/<name>/`
2. Add a `Dockerfile` that builds the trait's artifacts
3. Add a `trait.yaml` manifest declaring exports, startup, and policies
4. Add a `README.md` describing the trait and its usage
5. Add the trait to the table at the top of this file
6. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full checklist
