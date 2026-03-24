# Gemini CLI Sandbox

OpenShell sandbox image pre-configured with [Gemini CLI](https://github.com/google-gemini/gemini-cli) for Google AI-powered coding assistance.

## What's Included

- **Gemini CLI** (`@google/gemini-cli@0.35.0`) — Google Gemini AI coding agent
- Everything from the [base sandbox](../base/README.md)

## Build

```bash
docker build -t openshell-gemini .
```

To build against a specific base image:

```bash
docker build -t openshell-gemini --build-arg BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest .
```

## Usage

### Create a sandbox

```bash
openshell sandbox create --from gemini
```
