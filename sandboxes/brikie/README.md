# brikie Sandbox

OpenShell sandbox image pre-configured with
[brikie](https://github.com/VeelaCleave/brikie) — a modular agent
harness where every capability is an optional, hot-swappable Brick.

## What's Included

- **brikie** (from PyPI)
- Everything from the [base sandbox](../base/README.md)

## Build

```bash
docker build -t openshell-brikie .
```

To build against a specific base image:

```bash
docker build -t openshell-brikie --build-arg BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest .
```

## Usage

### Create a sandbox

```bash
openshell sandbox create --from brikie
```

### Pick your provider

brikie reads provider credentials from the environment, so OpenShell's
managed inference works out of the box. Choose a provider preset at
launch:

```bash
openshell sandbox create --from brikie -- --preset anthropic   # ANTHROPIC_API_KEY
openshell sandbox create --from brikie -- --preset openai      # OPENAI_API_KEY
openshell sandbox create --from brikie -- --preset openrouter  # OPENROUTER_API_KEY
openshell sandbox create --from brikie -- --preset groq        # GROQ_API_KEY
```

brikie also honors `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`, so
`openshell inference set` rerouting applies with no extra configuration.

### Choose your bricks

By default brikie boots a full stack (file tools, memory, logging,
security, and the AFK orchestration souls). To run a leaner set:

```bash
openshell sandbox create --from brikie -- --set minimal --preset anthropic
```

Compose a custom Build Set at [brikie.co](https://brikie.co).

## Network Policy

The bundled `policy.yaml` allows brikie to reach:

- model provider APIs (Anthropic, OpenAI, OpenRouter, Groq, DeepSeek,
  Mistral, Cerebras, xAI, Together, Fireworks, Hugging Face, Vercel AI
  Gateway, Google, and NVIDIA-hosted inference)
- the brikie.co brick registry (search / install / publish)
- the GitHub REST API, read-only (the optional issue-reading brick)
- PyPI (installing additional bricks at runtime)

Everything else is denied by default.
