# Capability Ratchet Sandbox

An OpenShell sandbox that prevents AI agent data exfiltration through dynamic capability ratcheting.

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

## Why not just `--network=none`?

Docker's `--network=none` is the simplest way to prevent network exfiltration, but it's all-or-nothing: the agent can't call *any* API. In practice, agents need network access to do useful work — calling GitHub APIs, querying internal services, fetching documentation, etc.

The capability ratchet provides a middle ground:

- **Selective enforcement** — Approved endpoints (GitHub, internal APIs, package registries) remain accessible. Only *unknown* or *suspicious* destinations are blocked, and only when private data is in context.
- **Context-aware** — The same `curl` command is allowed when no private data is present, but blocked when the conversation contains tainted tool results (email, calendar, wiki content). The restriction is dynamic, not static.
- **User approval flow** — When a tool call is blocked, the agent explains the situation and the user can approve the action. The approval is carried via the `X-Ratchet-Approve` header on retry, so legitimate workflows aren't permanently blocked.
- **Composable with network isolation** — You can still use `--network=none` or network ACLs for defense-in-depth. The ratchet adds a semantic layer on top: it understands *what* data is in context and *which* tools could leak it.

## Limitations

The capability ratchet prevents direct network exfiltration through tool calls, but it is not a complete data loss prevention system. Known limitations:

- **Indirect leakage channels** — The ratchet does not prevent encoding data in file writes, git commit messages, DNS queries, or "safe" API call request bodies. If the agent writes private data to a file that is later synced or committed, the ratchet will not catch it.
- **Tool-name-based taint** — Taint detection relies on the policy config declaring which tool names produce taint. If an unlisted tool returns sensitive data, no taint flag is set and no restrictions apply. Content-based taint detection (PII patterns, secrets scanning) is planned for a future release.
- **Non-streaming for tainted requests** — When taint is detected, the sidecar forces `stream: false` on the backend call so it can inspect the full response before returning it. This adds latency for tainted requests. The `X-Ratchet-Stream-Blocked: true` response header is set when streaming was disabled, so clients can display appropriate UX (e.g., a spinner or explanation).
- **Bash AST analysis** — Command analysis depends on the bash-ast sidecar. If bash-ast is unavailable, bash tool calls in tainted contexts are blocked by default (fail-closed).
- **Single-request scope** — The ratchet is stateless and per-request. It cannot track data flow across multiple requests or detect slow exfiltration spread over many turns.
