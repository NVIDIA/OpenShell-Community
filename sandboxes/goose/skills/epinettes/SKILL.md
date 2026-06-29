---
name: epinettes
description: >-
  Load at the start of every OpenShell sandbox session before other work.
  OpenShell host ≥ 0.0.72. Filesystem layout, default-deny network policy,
  dependency installs, and what to do when access is blocked. Use when curl or
  a tool fails to connect, you see policy_denied, HTTP 000/403 from the proxy,
  or you need to understand what this environment allows. Trigger keywords -
  openshell, sandbox, policy, network blocked, policy_denied, policy.local,
  connection refused, exit code 56.
license: Apache-2.0
metadata:
  openshell_version: "0.0.72"
  skill_version: "1"
---

# Épinettes

You are **Goose**, running inside
[OpenShell](https://github.com/NVIDIA/OpenShell) — an isolated sandbox runtime.
OpenShell gates **outbound network access** and **filesystem writes** so agents
can work safely. Treat denials as expected behavior, not bugs — then either use
an already-allowed path or request a narrow policy change.

If `/AGENTS.md` exists at the filesystem root, read it for Policy Advisor
workflow. OpenShell creates it only when `agent_policy_proposals_enabled` is
true — it is not present by default. If absent, use the sections below.

## Version

This skill targets OpenShell **≥ 0.0.72** on the host gateway. Older hosts
lack MCP policy (`protocol: mcp`), reliable L7 denials, and other behavior
assumed here.

| Field | Value |
|-------|-------|
| Minimum OpenShell host | **≥ 0.0.72** (`metadata.openshell_version`) |
| This skill document | **1** (`metadata.skill_version`) |

The `version: 1` at the top of `/etc/openshell/policy.yaml` is the **policy
schema** version, not the OpenShell runtime version.

You usually **cannot** run `openshell --version` inside the sandbox. Ask the
operator to check on the host:

```bash
openshell status      # includes Version
openshell --version
```

If the host is **below 0.0.72**, tell the operator to upgrade OpenShell before
continuing — do not guess at policy or MCP behavior on unsupported versions.

If the host is **≥ 0.0.72** but behavior does not match this skill (missing
`policy.local` routes, different denial JSON, new settings names), this skill
may be **out of date**. Prefer
[OpenShell docs](https://docs.nvidia.com/openshell/) and the
[community skill source](https://github.com/NVIDIA/OpenShell-Community/tree/main/sandboxes/goose/skills/epinettes)
over stale guidance here.

## Goose

| Item | Path or command |
|------|-----------------|
| Provider config | `/sandbox/.config/goose/config.yaml` |
| Global hints | `/sandbox/.config/goose/.goosehints` |
| First-time setup | `goose configure` |
| Agent session | `goose session` |

## Filesystem

| Path | Access | Use for |
|------|--------|---------|
| `/sandbox` | read/write | Home directory, projects, caches, config |
| `/tmp` | read/write | Temporary files |
| `/usr`, `/etc`, `/lib`, … | read-only | System tools only — **cannot** `apt install` |

- Run as user **`sandbox`**, not root.
- Keep artifacts under `/sandbox` or the mounted workdir.
- Python venv: `/sandbox/.venv` (`pip`, `uv pip install`).
- Agent skills: `/sandbox/.agents/skills/`.

## Network policy model

Default deny. A connection is allowed only when **all** of these match an entry
in the effective policy:

1. **Binary** — the executable making the connection (e.g. `/usr/bin/curl`,
   `/usr/local/bin/goose`)
2. **Host and port** — destination (e.g. `api.github.com:443`)
3. **L7 rules** (when `protocol: rest`, `mcp`, etc.) — HTTP method/path or MCP
   method/tool for inspected HTTPS traffic

MCP policy support (`protocol: mcp`) needs OpenShell **≥ 0.0.72** on the host.
Remote Goose extensions (including `goose_mcp` rules in this image) will not
work correctly on older hosts.

This goose image ships its own policy at `/etc/openshell/policy.yaml` (LLM
providers, GitHub, PyPI, npm, etc.). The operator may also pass a custom policy
at create time.

### Inspect what is allowed

```bash
# Static policy baked into the image
cat /etc/openshell/policy.yaml

# Live effective policy (when policy advisor is enabled)
curl -s http://policy.local/v1/policy/current

# Recent denials (when policy advisor is enabled)
curl -s 'http://policy.local/v1/denials?last=10'
```

When `policy.local` returns `feature_disabled`, agent-facing policy APIs are
probably off or prohibited. The image policy file is still authoritative for
what is pre-allowed.

## Typically pre-allowed

Exact rules depend on the effective policy. This goose sandbox commonly allows:

| Need | Binary | Endpoints |
|------|--------|-----------|
| Git clone/fetch (read) | `/usr/bin/git` | `github.com:443` |
| GitHub REST (read-only) | `/usr/bin/gh` | `api.github.com:443` |
| Python packages | `/sandbox/.venv/bin/pip`, `/usr/local/bin/uv` | `pypi.org`, … |
| npm packages | `/usr/bin/node`, `/usr/local/bin/npm` | `registry.npmjs.org:443` |
| Goose LLM providers | `/usr/local/bin/goose` | See `policy.yaml` `goose:` block |
| Goose MCP extensions | `/usr/local/bin/goose` | See `goose_mcp:` in `policy.yaml` |

**Do not assume** a host is reachable until you confirm it in the effective
policy or a successful request.

For GitHub operations, read `/sandbox/.agents/skills/github/SKILL.md` —
GraphQL is blocked; prefer `gh api` REST paths.

## Installing dependencies

Prefer user-space installs into writable paths:

```bash
uv pip install <package>          # Python → /sandbox/.venv
npm install <package>             # Node (project-local or global if allowed)
```

Avoid `apt-get` / `sudo` — system directories are read-only. To add system
packages or other image changes, fork
[OpenShell-Community](https://github.com/NVIDIA/OpenShell-Community), update the
sandbox Dockerfile on a branch, rebuild the image, and contribute back if you
want the change upstream.

## When network access is blocked

Symptoms: `curl: (56)`, HTTP `000`, connection errors, or a JSON body with
`policy_denied`.

1. **Read `/AGENTS.md`** when it exists — OpenShell writes it only with Policy
   Advisor enabled (`agent_policy_proposals_enabled`).
2. **Mechanistic drafts** — OpenShell auto-proposes a rule from the denial. The
   **operator** approves via `openshell term` (sandbox → `r`) or
   `openshell rule approve`. You cannot approve your own requests.
3. **Agent proposals** — When `agent_policy_proposals_enabled` is true, read
   the OpenShell policy advisor skill and documentation:
   - `/etc/openshell/skills/policy-advisor/SKILL.md`
   - `/etc/openshell/skills/policy_advisor.md`

If agent proposals are disabled, tell the operator to enable
`agent_policy_proposals_enabled` on the sandbox or gateway. A mechanistic
pending rule may still appear for the same denial.

Do **not** bypass policy (raw IPs, iptables, alternate DNS tricks, tunneling).

## Credentials

API keys and tokens are usually injected by the operator through OpenShell
**providers**. Inside the sandbox you may see placeholder values in environment
variables; the proxy resolves them on outbound requests. You do not receive
real secrets in plaintext.

If authentication fails despite network access being allowed, the operator may
need to attach or configure a provider — that is outside your control.

## Pre-installed tools

From the base sandbox: `git`, `gh`, `curl`, `node`, `npm`, `python3`, `uv`,
`pip`, and several coding-agent CLIs (`claude`, `opencode`, `codex`, `copilot`).
This image adds **Goose** (`goose`).

## OpenShell supervisor skills

OpenShell installs runtime skills under `/etc/openshell/skills/`. These are
**not** on the usual agent discovery path (`/sandbox/.agents/skills/`). Nothing
loads them automatically — read them when `/AGENTS.md`, a denial, or the task
points you there.

When `agent_policy_proposals_enabled` is true, the supervisor typically
installs:

- `/etc/openshell/skills/policy-advisor/SKILL.md` — short entry point
- `/etc/openshell/skills/policy_advisor.md` — full policy-advisor workflow

L7 `policy_denied` responses may reference that path in `next_steps`. If you
are unsure what is installed, list the directory:

```bash
ls /etc/openshell/skills/
```

## Related skills

| Topic | Path |
|-------|------|
| Épinettes (this file) | `/sandbox/.agents/skills/epinettes/SKILL.md` |
| GitHub in sandboxes | `/sandbox/.agents/skills/github/SKILL.md` |
| Policy denials (supervisor) | `/etc/openshell/skills/policy-advisor/SKILL.md` |
