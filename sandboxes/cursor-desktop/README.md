# cursor-desktop

<!-- SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

An OpenShell Community sandbox that runs the full [Cursor](https://cursor.com) Linux desktop
IDE inside an isolated sandbox and delivers the UI through a browser using
**Xvfb + openbox + x11vnc + noVNC**.

Cursor is treated as an agent-capable desktop application kept inside OpenShell policy
boundaries, with file access, network egress, and credentials controlled through the
standard OpenShell policy and provider model.

## Architecture

```
Browser (http://localhost:6080)
  └─ OpenShell port-forward tunnel
       └─ noVNC / websockify  (port 6080)
            └─ x11vnc          (port 5901, localhost-only)
                 └─ Xvfb :1 + openbox session
                      └─ Cursor Linux .deb
                           └─ /sandbox/workspace
```

## Prerequisites

- [OpenShell CLI](https://github.com/NVIDIA/openshell) ≥ v0.0.16
- A running gateway (`openshell gateway start`)
- Docker (for the initial image build)
- **x86-64 (amd64) host** — Cursor only ships x64 Linux packages; arm64 hosts are not supported (see [Known limitations](#known-limitations))

## Quick start

```bash
# From the root of your openshell-community clone:
openshell sandbox create \
    --from ./sandboxes/cursor-desktop \
    --forward 6080

# Then open http://localhost:6080 in your browser.
```

Or run the example script:

```bash
bash sandboxes/cursor-desktop/examples/quickstart.sh [optional-local-project-dir]
```

## Local testing (Docker)

A helper script builds and runs the sandbox with Docker directly, without requiring
a running OpenShell gateway. Useful for iterating on the image locally.

```bash
# From the root of the repo:
bash sandboxes/cursor-desktop/scripts/local-test.sh
```

On Apple Silicon Macs, Docker Desktop uses Rosetta 2 to emulate x86_64 transparently —
the `--platform linux/amd64` flag is set automatically by the script.

## Uploading a project

```bash
openshell upload ./my-project /sandbox/workspace/my-project
```

## Attaching a provider

```bash
# Create a GitHub provider (one-time setup):
openshell provider create --name my-github --type github --from-existing

# Launch with provider attached:
openshell sandbox create \
    --from ./sandboxes/cursor-desktop \
    --forward 6080 \
    --provider my-github
```

## Building the image manually

```bash
docker build \
    --platform linux/amd64 \
    --build-arg CURSOR_VERSION=2.6 \
    -t openshell-cursor-desktop \
    sandboxes/cursor-desktop/
```

To upgrade Cursor, pass a different version:

```bash
docker build --platform linux/amd64 --build-arg CURSOR_VERSION=<new-version> ...
```

## Sandbox layout

| Path | Purpose |
|---|---|
| `/sandbox/workspace` | Default project directory (opened by Cursor on start) |
| `/sandbox/.config/Cursor/` | Cursor user config (auto-update disabled) |
| `/etc/openshell/policy.yaml` | OpenShell sandbox policy |
| `/tmp/cursor.log` | Cursor stdout / stderr |
| `/tmp/openbox.log` | Desktop session log |
| `/tmp/x11vnc.log` | VNC server log |
| `/tmp/novnc.log` | noVNC web bridge log |

## Policy

The default `policy.yaml` covers the core Cursor application endpoints, GitHub git
operations (read-only by default), and the OpenShell `inference.local` provider route.

**First-run workflow** — Cursor is an Electron app and may call endpoints not yet in the
allow-list on first launch. Start in audit mode, collect denied events with
`openshell logs`, and add missing hosts before switching to enforce:

```bash
# Stream live sandbox logs to find denied network calls:
openshell logs --tail

# Hot-reload an updated policy without restarting the sandbox:
openshell policy set ./sandboxes/cursor-desktop/policy.yaml
```

To enable git push to GitHub, uncomment and scope the `git-receive-pack` rule in
`policy.yaml` to your specific repository.

## Smoke test

Run from inside a live sandbox to verify all services:

```bash
openshell sandbox exec cursor-desktop -- /sandbox/scripts/smoke-test.sh
```

## Security notes

- x11vnc binds to `localhost` only (`-localhost` flag). It is never reachable
  without an active OpenShell port-forward tunnel.
- Cursor auto-update is disabled via `settings.json`; upgrade by rebuilding the image.
- Credentials are attached through OpenShell providers — no API keys are baked into the image.
- The policy's `filesystem_policy` uses Landlock LSM and is locked at sandbox creation time.
- Network policies are hot-reloadable via `openshell policy set`.

## Known limitations

- **amd64 only** — Cursor ships x64 Linux packages exclusively. This sandbox requires an
  x86-64 host. On arm64 hosts (e.g. Apple Silicon Macs), use
  `bash sandboxes/cursor-desktop/scripts/local-test.sh` for local testing via Docker
  Desktop's Rosetta 2 emulation; the OpenShell CLI itself will fail to build the image
  on arm64 because it builds natively without x86_64 emulation.
- Cursor requires `--no-sandbox` to start inside a container (passed automatically by
  the openbox autostart script). This disables Chromium's internal process sandbox, which
  is acceptable since OpenShell provides the outer isolation.
- GPU acceleration is not enabled by default. Add `--gpu` to the `openshell sandbox create`
  command and ensure the host has a supported NVIDIA driver if GPU rendering is needed.
- The network allow-list covers known Cursor endpoints as of the time of writing. Cursor
  may call additional telemetry or extension endpoints on first launch; use audit mode to
  discover them (see **Policy** section above).
