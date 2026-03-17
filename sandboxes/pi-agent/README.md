# Pi Agent Sandbox

OpenShell sandbox image pre-configured with [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent), a minimal terminal coding agent harness.

## What's Included

- **Pi coding agent** — Terminal-based coding agent with read, write, edit, and bash tools
- **Node.js 22** — Runtime required by pi
- **pi-agent-start** — Helper script that detects API keys and launches pi

## Build

```bash
docker build -t openshell-pi-agent .
```

To build against a specific base image:

```bash
docker build -t openshell-pi-agent --build-arg BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest .
```

## Usage

### Create a sandbox

```bash
openshell sandbox create --from pi-agent
```

### With an API key

```bash
openshell sandbox create --from pi-agent -- env ANTHROPIC_API_KEY=sk-ant-... pi-agent-start
```

### Interactive startup

If you prefer to start pi manually inside the sandbox:

```bash
openshell sandbox connect <sandbox-name>
export ANTHROPIC_API_KEY=sk-ant-...
pi
```

## Supported Providers

Pi supports many providers out of the box. Pass the appropriate API key:

| Variable | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI |
| `GOOGLE_API_KEY` | Google Gemini |

Or use `/login` inside pi for OAuth-based authentication (Anthropic, OpenAI, Google, GitHub Copilot).

## Network Policy

The sandbox policy allows pi to reach:

- **Anthropic** (`api.anthropic.com`)
- **OpenAI** (`api.openai.com`)
- **Google** (`generativelanguage.googleapis.com`)
- **NVIDIA** (`integrate.api.nvidia.com`)
- **GitHub** (read-only git and REST API)
- **npm** (`registry.npmjs.org` for `pi install`)

All other outbound connections are blocked by the policy engine.

## Configuration

Pi stores its configuration in `~/.pi/agent/` inside the sandbox. Customize with:

- `~/.pi/agent/settings.json` — Global settings
- `~/.pi/agent/AGENTS.md` — Global context/instructions
- `.pi/settings.json` — Project-level settings
- `AGENTS.md` — Project-level context

See the [pi documentation](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) for full details.
