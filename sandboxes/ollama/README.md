# Ollama Sandbox

OpenShell sandbox image pre-configured with [Ollama](https://ollama.com) for running local LLMs.

## What's Included

- **Ollama** — Ollama runs cloud and local models and connects them to tools like Claude Code, Codex, OpenCode, and more. 
- **Auto-start** — Ollama server starts automatically when the sandbox starts
- **Pre-configured** — `OLLAMA_HOST` is set for OpenShell provider discovery
- **Claude Code** — Pre-installed (`claude` command)
- **Codex** — Pre-installed (`@openai/codex` npm package)
- **Node.js 22** — Runtime for npm-based tools
- **npm global** — Configured to install to user directory (works with read-only `/usr`)

## Build

```bash
docker build -t openshell-ollama .
```

## Usage

### Create a sandbox

```bash
openshell sandbox create --from ollama
```



