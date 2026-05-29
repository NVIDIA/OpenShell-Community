# Kiro CLI Sandbox

Secure sandbox environment for running [Kiro CLI](https://kiro.dev) — an AI-powered
agentic command-line interface for code generation, review, and infrastructure
management.

## What's Included

| Tool | Version | Notes |
|------|---------|-------|
| Kiro CLI | latest | Installed via official installer |

All tools from the [base sandbox](../base/) are also available (Python, Node.js,
git, gh, etc.).

## Usage

```bash
openshell sandbox create --from kiro
```

### Authentication

Kiro CLI requires a Kiro Pro, Pro+, or Power subscription for headless API key
authentication. Generate a key at <https://app.kiro.dev>, then pass it when
creating the sandbox:

```bash
openshell sandbox create --from kiro -e KIRO_API_KEY=<your-key>
```

Inside the sandbox, run `kiro` to start an interactive session.

## Build

```bash
docker build -t openshell-kiro --build-arg BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest .
```

## Network Policies

| Policy | Allowed Endpoints |
|--------|-------------------|
| kiro-cli | `*.kiro.dev:443`, `*.amazoncodewhisperer.com:443` |
| github-ssh-over-https | `github.com:443` (git fetch/clone) |
| github-rest-api | `api.github.com:443` (read + PR creation) |
| pypi | `pypi.org:443`, `files.pythonhosted.org:443` |
| npm | `registry.npmjs.org:443` |

All other outbound connections are denied by policy.

## Examples

### ECS Fargate Deployment

Run Kiro as a headless HTTP service on AWS ECS Fargate. See
[`examples/ecs/`](examples/ecs/) for the Dockerfile variant, HTTP server, task
definition, and step-by-step deployment instructions.
