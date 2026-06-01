# AIO Sandbox Integration with OpenShell

OpenShell sandbox image pre-configured with [AIO Sandbox](https://github.com/agent-infra/sandbox) for AIO-Sandbox powered rich built-in agent capabilities such as browser automation, shell access, file operations, VS Code Server, and MCP integration.

## What's Included

- Everything from the [aio sandbox](https://github.com/agent-infra/sandbox/blob/main/README.md)

## Build

```bash
docker build -t openshell-aio-sandbox .
```

To build against a specific base image:

```bash
docker build -t openshell-aio-sandbox --build-arg BASE_IMAGE=ghcr.io/agent-infra/sandbox:latest .
```

## Usage

### Create a sandbox

```bash
openshell sandbox create --from aio-sandbox
```
