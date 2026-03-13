# Capability Ratchet Sandbox

A OpenShell sandbox that prevents AI agent data exfiltration through dynamic capability ratcheting.

## What's Included

- **Capability Ratchet sidecar** — A per-request, stateless HTTP proxy that sits between the OpenShell sandbox proxy and the real inference backend
- **bash-ast** — Go binary for AST-based bash command analysis
- **Ratchet policy** — Configurable YAML policy defining which tools produce taint and which capabilities they require

## How It Works

```
Agent (Claude/Codex)
  │
  ▼
OpenShell Sandbox Proxy (existing, Rust)
  │  TLS terminate, detect inference pattern
  │  Route to "ratchet" backend (inference-routes.yaml)
  ▼
Capability Ratchet Sidecar (:4001)
  │  1. Detect taint from tool results in request messages
  │  2. Forward to real backend
  │  3. Analyze tool calls in response
  │  4. Block/rewrite if taint + forbidden capability
  ▼
Real Inference Backend (Anthropic, OpenAI, NIM, LM Studio)
```

When an agent reads private data (email, calendar) or untrusted input (wiki pages), the ratchet detects the taint and prevents subsequent tool calls that could exfiltrate that data (e.g., `curl` to an external URL).

## Build

```bash
docker build -t openshell-ratchet --build-arg BASE_IMAGE=openshell-base .
```

## Usage

```bash
# Create a sandbox with the ratchet
openshell sandbox create --from capability-ratchet -- ratchet-start

# Inside the sandbox, verify the sidecar is running
curl http://127.0.0.1:4001/health
```

## Configuration

- `ratchet-config.yaml` — Sidecar configuration (upstream URL, API key, listen port)
- `ratchet-policy.yaml` — Tool taint and capability declarations
- `policy.yaml` — OpenShell network policy (filesystem, process, network ACLs)

### Inference Routes

Add to your OpenShell `inference-routes.yaml` to route inference traffic through the ratchet:

```yaml
routes:
  - routing_hint: ratchet
    endpoint: http://127.0.0.1:4001/v1
    model: claude-sonnet-4
    protocols:
      - openai_chat_completions
    api_key: internal
```

## Shadow Mode

Set `shadow_mode: true` in `ratchet-config.yaml` to log violations without blocking. Useful for initial deployment and tuning.
