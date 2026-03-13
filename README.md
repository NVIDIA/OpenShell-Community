# OpenShell Community

[OpenShell](https://github.com/NVIDIA/OpenShell) is the runtime environment for autonomous agents -- the infrastructure where they live, work, and verify. It provides a programmable factory where agents can spin up physics simulations to master tasks, generate synthetic data to fix edge cases, and safely iterate through thousands of failures in isolated sandboxes. The core engine includes the sandbox runtime, policy engine, gateway (with k3s harness), privacy router, and CLI.

This repo is the community ecosystem around OpenShell -- a hub for contributed skills, sandbox images, launchables, and integrations that extend its capabilities. For the core engine, docs, and published artifacts (PyPI, containers, binaries), see the [OpenShell](https://github.com/NVIDIA/OpenShell) repo.

## What's Here

| Directory    | Description                                                                       |
| ------------ | --------------------------------------------------------------------------------- |
| `brev/`      | [Brev](https://brev.dev) launchable for one-click cloud deployment of OpenShell    |
| `sandboxes/` | Pre-built sandbox images for domain-specific workloads (each with its own skills) |

### Sandboxes

| Sandbox                 | Description                                                  |
| ----------------------- | ------------------------------------------------------------ |
| `sandboxes/base/`       | Foundational image with system tools, users, and dev environment |
| `sandboxes/sdg/`        | Synthetic data generation workflows                          |
| `sandboxes/openclaw/`   | OpenClaw -- open agent manipulation and control              |
| `sandboxes/simulation/` | General-purpose simulation sandboxes                         |

## Getting Started

### Prerequisites

- [OpenShell CLI](https://github.com/NVIDIA/OpenShell) installed (`uv pip install openshell`)
- Docker or a compatible container runtime
- NVIDIA GPU with appropriate drivers (for GPU-accelerated images)

### Quick Start with Brev

TODO: Add Brev instructions

### Using Sandboxes

```bash
openshell sandbox create --from openclaw
```

The `--from` flag accepts any sandbox defined under `sandboxes/` (e.g., `openclaw`, `sdg`, `simulation`), a local path, or a container image reference.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md). Do not file public issues for security vulnerabilities.

## License

This project is licensed under the Apache 2.0 License -- see the [LICENSE](LICENSE) file for details.
