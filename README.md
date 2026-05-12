# OpenShell Community

[![License](https://img.shields.io/badge/License-Apache_2.0-blue)](https://github.com/NVIDIA/OpenShell/blob/main/LICENSE)
[![PyPI](https://img.shields.io/badge/PyPI-openshell-orange?logo=pypi)](https://pypi.org/project/openshell/)
[![Security Policy](https://img.shields.io/badge/Security-Report%20a%20Vulnerability-red)](SECURITY.md)
[![Project Status](https://img.shields.io/badge/status-alpha-orange)](https://docs.nvidia.com/openshell/latest/about/release-notes.html)

[OpenShell](https://github.com/NVIDIA/OpenShell) is the runtime environment for autonomous agents -- the infrastructure where they live, work, and verify. It provides a programmable factory where agents can generate synthetic data to fix edge cases and safely iterate through thousands of failures in isolated sandboxes. The core engine includes the sandbox runtime, policy engine, gateway (with k3s harness), privacy router, and CLI.

This repo is the community ecosystem around OpenShell -- a hub for contributed skills, sandbox images, launchables, and integrations that extend its capabilities. For the core engine, docs, and published artifacts (PyPI, containers, binaries), see the [OpenShell](https://github.com/NVIDIA/OpenShell) repo.

> Alpha software — single-player mode. OpenShell is proof-of-life: one developer, one environment, one gateway. We are building toward multi-tenant enterprise deployments, but the starting point is getting your own environment up and running. Expect rough edges. Bring your agent.

## What's Here

| Directory    | Description                                                                       |
| ------------ | --------------------------------------------------------------------------------- |
| `brev/`      | [Brev](https://brev.dev) launchable for one-click cloud deployment of OpenShell    |
| `sandboxes/` | Pre-built sandbox images for domain-specific workloads (each with its own skills) |

### Sandboxes

| Sandbox                 | Description                                                  |
| ----------------------- | ------------------------------------------------------------ |
| `sandboxes/base/`       | Foundational image with system tools, users, and dev environment |
| `sandboxes/ollama/`     | Ollama for local and cloud LLMs with Claude Code, Codex, OpenCode pre-installed |
| `sandboxes/sdg/`        | Synthetic data generation workflows                          |
| `sandboxes/openclaw/`   | OpenClaw -- open agent manipulation and control              |
| `sandboxes/nvidia-gpu/` | GPU-enabled VM sandbox image with NVIDIA userspace tooling   |

## Getting Started

### Prerequisites

- [OpenShell CLI](https://github.com/NVIDIA/OpenShell) installed (`uv pip install openshell`)
- Docker or a compatible container runtime
- NVIDIA GPU with appropriate drivers (for GPU-accelerated images)

### Quick Start with Brev

Skip the setup and launch OpenShell Community on a fully configured Brev instance, whether you want to use Brev as a remote OpenShell gateway with or without GPU accelerators, or as an all-in-one playground for sandboxes, inference, and UI workflows.

| Instance | Best For | Deploy |
| -------- | -------- | ------ |
| CPU-only | Remote OpenShell gateway deployments, external inference endpoints, remote APIs, and lighter-weight sandbox workflows | <a href="https://brev.nvidia.com/"><img src="https://brev-assets.s3.us-west-1.amazonaws.com/nv-lb-dark.svg" alt="Deploy on Brev" height="40"/></a> |
| NVIDIA H100 | All-in-one OpenShell playgrounds, locally hosted LLM endpoints, GPU-heavy sandboxes, and higher-throughput agent workloads | <a href="https://brev.nvidia.com/"><img src="https://brev-assets.s3.us-west-1.amazonaws.com/nv-lb-dark.svg" alt="Deploy on Brev" height="40"/></a> |

After the Brev instance is ready, access the Welcome UI to inject provider keys and access your Openclaw sandbox.

### Using Sandboxes

```bash
openshell sandbox create --from openclaw
```

The `--from` flag accepts any sandbox defined under `sandboxes/` (e.g., `openclaw`, `ollama`, `sdg`), a local path, or a container image reference.

### Ollama Sandbox

The Ollama sandbox provides Ollama for running local LLMs and routing to cloud models, with Claude Code and Codex pre-installed.

**Quick start:**

```bash
openshell sandbox create --from ollama 

curl http://127.0.0.1:11434/api/tags
```

See the [Ollama sandbox README](sandboxes/ollama/README.md) for full details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md). Do not file public issues for security vulnerabilities.

## License

This project is licensed under the Apache 2.0 License -- see the [LICENSE](LICENSE) file for details.
