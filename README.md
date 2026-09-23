# OpenShell Community (retired)

> [!IMPORTANT]
> This repository is retired and will be archived. Its sandbox images, policies,
> provider profiles, and other artifacts are no longer maintained or supported.
> Existing files remain available as historical examples, but you should not
> depend on this repository or its published images for new deployments.

[OpenShell](https://github.com/NVIDIA/OpenShell) no longer depends on the
community image catalog. A default installation uses the stock
`nvcr.io/nvidia/base/ubuntu:24.04` workload image, which provides a minimal
Ubuntu environment and does not bundle agent CLIs or an image-specific policy.
Bare catalog names such as `base`, `ollama`, and `pi` are no longer expanded by
`openshell sandbox create --from`.

## Host workload artifacts in your own repository

Teams that need a reusable workload should maintain its artifacts in a
repository they control. A workload collection commonly includes:

- A `Dockerfile` or other build definition for an OCI image containing the
  agent, application, and runtime dependencies.
- An OpenShell policy that grants only the filesystem, network, and process
  access the workload requires.
- Provider profiles that define the credentials, service endpoints, client
  binaries, and policy rules required by external services.
- Build and publishing automation, versioned releases, and instructions that
  identify compatible OpenShell and workload versions.

For example:

```text
my-openshell-workload/
├── Dockerfile
├── policy.yaml
├── providers/
│   └── my-service.yaml
└── README.md
```

Do not commit credentials to the repository. Provider profiles describe
credential names and handling; provider instances store the corresponding
values in the configured OpenShell credential backend.

## Launch a self-hosted workload

Build the image with the container engine used by your local gateway. For a
remote gateway, publish it to a registry the gateway can access:

```bash
docker build -t registry.example.com/your-org/my-agent:1.0 .
docker push registry.example.com/your-org/my-agent:1.0
```

Import any provider profiles and create provider instances. Replace the names
and credential keys with those declared by your profile:

```bash
openshell provider profile import --from ./providers --global
openshell provider create \
  --name my-service \
  --type my-service \
  --credential MY_SERVICE_API_KEY
```

Create the sandbox with an explicit image reference, policy, and provider. Pass
the workload's start command after `--` because OpenShell replaces the image's
default entrypoint with the sandbox supervisor:

```bash
openshell sandbox create \
  --name my-agent \
  --from registry.example.com/your-org/my-agent:1.0 \
  --policy ./policy.yaml \
  --provider my-service \
  -- my-agent
```

Use only the flags and artifacts the workload requires. A workload with no
external credentials can omit the provider steps and `--provider`; a workload
that can use OpenShell's built-in restrictive policy can omit `--policy`.

## Current documentation and support

- [OpenShell repository](https://github.com/NVIDIA/OpenShell)
- [OpenShell documentation](https://docs.nvidia.com/openshell/latest/)
- [Quickstart](https://docs.nvidia.com/openshell/latest/get-started/quickstart)
- [Bring Your Own Container example](https://github.com/NVIDIA/OpenShell/tree/main/examples/bring-your-own-container)
- [Sandbox policies](https://docs.nvidia.com/openshell/latest/sandboxes/policies)
- [Provider profiles](https://github.com/NVIDIA/OpenShell/blob/main/docs/providers/profiles.mdx)

Use the main OpenShell repository for current documentation, discussions, and
issue reporting. Do not file new issues or pull requests in this repository.

## License and security

Existing content remains available under the [Apache 2.0 License](LICENSE).
Report security vulnerabilities through the current OpenShell
[security policy](https://github.com/NVIDIA/OpenShell/blob/main/SECURITY.md), not
through a public issue.
