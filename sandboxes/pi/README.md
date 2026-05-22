# Pi Sandbox

OpenShell sandbox image pre-configured with [pi](https://github.com/earendil-works/pi) — a minimal terminal coding harness.

## What's Included

- **pi**
- Everything from the [base sandbox](../base/README.md)

## Build

```bash
docker build -t openshell-pi .
```

To build against a specific base image:

```bash
docker build -t openshell-pi --build-arg BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest .
```

## Usage

### Create a sandbox

```bash
openshell sandbox create --from pi
```

### Start pi directly

```bash
openshell sandbox create --from pi -- pi
```
