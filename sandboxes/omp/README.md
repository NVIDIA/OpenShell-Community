# OMP Sandbox

OpenShell sandbox image pre-configured with [OMP](https://github.com/can1357/oh-my-pi) — a terminal coding agent.

## What's Included

- **OMP** (`@oh-my-pi/pi-coding-agent@17.4.0`) — coding agent CLI
- **Bun** 1.3.14 — pinned JavaScript runtime
- Everything from the [base sandbox](../base/README.md)

## Build

From this directory:

```bash
docker build -t openshell-omp:latest .
```

To build against a specific base image:

```bash
docker build -t openshell-omp:latest --build-arg BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest .
```

## Usage

A gateway is required for OpenShell sandbox creation.
The commands below use the locally built `openshell-omp:latest` image. The selected gateway must use the same Docker daemon. To use the published sandbox instead, replace `openshell-omp:latest` with `omp`; remote gateways require a pushed registry image.

### Create a sandbox

```bash
openshell sandbox create --from openshell-omp:latest
```

### Start OMP directly

```bash
openshell sandbox create --from openshell-omp:latest -- omp
```

### Attach an OpenShell provider

Use an already-created provider instance to attach credentials without putting a raw secret in the command line:

```bash
openshell sandbox create --from openshell-omp:latest --name omp-dev --provider my-nvidia -- omp
```

`--provider` attaches OpenShell-managed credentials as opaque placeholders that resolve inside the sandbox. Do not pass raw API keys through `--env`. See the [OpenShell Providers v2 documentation](https://docs.nvidia.com/openshell/sandboxes/providers-v2) for provider profile setup and credential handling.

## Network policy

The initial OMP policy permits the Anthropic, OpenAI/ChatGPT, Google Gemini, Groq, OpenRouter, Mistral, xAI, and NVIDIA endpoints listed in [`policy.yaml`](policy.yaml), plus the listed GitHub, GitHub Copilot, and source-reading endpoints. It also permits read-only Git Smart HTTP, the GitHub REST API, and the base Python package-management endpoints.

Other providers and endpoints are denied until they are intentionally added to the policy and the image is rebuilt.
