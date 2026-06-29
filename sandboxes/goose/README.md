# Goose Sandbox

OpenShell sandbox image pre-configured with
[Goose](https://github.com/aaif-goose/goose) — an open source, extensible AI
agent for code, workflows, and automation.

## What's Included

- **Goose CLI** — from [AAIF Goose](https://github.com/aaif-goose/goose);
  **`stable` by default**, overridable at build time (see below)
- **`.goosehints`** — Goose
  [global hints file](https://goose-docs.ai/docs/guides/context-engineering/using-goosehints/)
  at `/sandbox/.config/goose/.goosehints`
- **`épinettes` skill** — filesystem, network policy, dependencies, and
  blocked-access workflow for Goose in OpenShell
  (`/sandbox/.agents/skills/epinettes/`)
- **Goose network policy** — LLM provider endpoints, GitHub, PyPI, npm, and a
  starter **`goose_mcp`** block for remote MCP extensions
- **Default `config.yaml`** — telemetry disabled only
  (`GOOSE_TELEMETRY_ENABLED: false`); provider and extensions are yours at
  runtime
- Everything from the [base sandbox](../base/README.md)

## Configuration

The image bakes a **minimal** `/sandbox/.config/goose/config.yaml` —
telemetry off, nothing else. Provider credentials, models, and extensions are
**runtime config** (12-factor): add them when you create or use the sandbox,
not in the image.

### Option 1: Configure inside the sandbox

```bash
openshell sandbox create --from goose
goose configure    # provider, extensions, etc. — merges into config.yaml
goose session
```

### Option 2: Upload your own config at create time

`--upload` **replaces** the baked file. Include provider settings **and** keep
telemetry off if you want the same default:

```bash
openshell sandbox create \
  --from openshell-goose:latest \
  --upload /path/to/goose-config.yaml:/sandbox/.config/goose/config.yaml \
  -- goose session
```

Example `goose-config.yaml`:

```yaml
GOOSE_TELEMETRY_ENABLED: false
active_provider: ollama
GOOSE_PROVIDER: ollama
GOOSE_MODEL: your-model
OLLAMA_HOST: https://your-ollama-host
providers:
  ollama:
    enabled: true
    model: your-model
    configured: true
```

### Option 3: Edit after connect

```bash
openshell sandbox connect my-goose
# edit /sandbox/.config/goose/config.yaml, then:
goose session
```

Goose also accepts `GOOSE_TELEMETRY_OFF=1` via `--env` on sandbox create as an
override; the baked config already disables telemetry unless you change it in
`goose configure`.

## Build

```bash
docker build -t openshell-goose .
```

Pin a specific Goose release:

```bash
docker build -t openshell-goose --build-arg GOOSE_VERSION=v1.39.0 .
```

To build against a specific base image:

```bash
docker build -t openshell-goose \
  --build-arg \
  BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest \
  .
```

## Usage

### Create a sandbox

```bash
openshell sandbox create --from goose
```

See [Configuration](#configuration) for provider setup.

## MCP extensions

Goose connects to tools through
[MCP extensions](https://goose-docs.ai/docs/getting-started/using-extensions).
This image ships policy for outbound LLM traffic (`goose:`) and a separate
**`goose_mcp`** block for MCP Streamable HTTP extensions.

### OpenShell MCP policy

Remote MCP extensions need OpenShell **MCP policy support** (`protocol: mcp` in
`policy.yaml`):

- OpenShell host **≥ 0.0.72** (MCP policy support)

The baked-in `goose_mcp` policy allows Goose (`/usr/local/bin/goose`) to reach
pre-listed MCP servers with method/tool inspection. Add new hosts to
`sandboxes/goose/policy.yaml` (or pass a custom policy at sandbox create time)
before enabling additional extensions.

### Excalidraw MCP App (remote)

[Excalidraw MCP App](https://goose-docs.ai/extensions/detail?id=excalidraw-mcp-app)
is a hosted Streamable HTTP extension — no local install. It is pre-allowed in
`goose_mcp` at `excalidraw-mcp-app.vercel.app/mcp`.

```bash
openshell sandbox create \
  --from openshell-goose:latest \
  -- goose session --debug \
    --with-streamable-http-extension "https://excalidraw-mcp-app.vercel.app/mcp"
```

Example prompt:

```text
Use Excalidraw to draw a simple two-box flowchart: Start → Done. Save the
output as /sandbox/output.excalidraw.
```

OpenShell runs Goose in a terminal — you will see tool traces and text
summaries, not a rendered diagram. Use `--debug` for full tool responses. To
keep output, ask Goose to export scene data to a file under `/sandbox/`.

**Persistent config** — add to `/sandbox/.config/goose/config.yaml`:

```yaml
extensions:
  excalidraw:
    name: Excalidraw
    enabled: true
    type: streamable_http
    url: https://excalidraw-mcp-app.vercel.app/mcp
    timeout: 300
```

### Adding another remote MCP extension

1. Add a `protocol: mcp` endpoint under `goose_mcp` in `policy.yaml` (host,
   port, `path`, and method/tool rules — see
   [OpenShell policy docs](https://docs.nvidia.com/openshell/latest/sandboxes/policies.html)).
2. Enable the extension in Goose (`goose configure`, `config.yaml`, or
   `--with-streamable-http-extension`).
3. Rebuild the image or pass an updated policy file at sandbox create time.

## Policy and skills

| Resource | Path |
|----------|------|
| Image policy | `/etc/openshell/policy.yaml` |
| Goose hints | `/sandbox/.config/goose/.goosehints` |
| Épinettes skill | `/sandbox/.agents/skills/epinettes/SKILL.md` |
| GitHub skill (base) | `/sandbox/.agents/skills/github/SKILL.md` |
| OpenShell supervisor skills | `/etc/openshell/skills/` |

When network access is denied, OpenShell may auto-draft rules for the operator
to approve. Agent-driven proposals require `agent_policy_proposals_enabled`
on the gateway or sandbox.
