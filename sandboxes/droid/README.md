# Factory Droid Sandbox

OpenShell sandbox image pre-configured with [Factory Droid CLI](https://docs.factory.ai/) for AI-powered software engineering.

## What's Included

- **Droid CLI** (`droid@0.90.0`) — Factory's AI coding agent
- Everything from the [base sandbox](../base/README.md)

## Build

```bash
docker build -t openshell-droid .
```

To build against a specific base image:

```bash
docker build -t openshell-droid --build-arg BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest .
```

## Usage

### Create a sandbox

```bash
openshell sandbox create --from droid
```
