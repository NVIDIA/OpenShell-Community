# cursor-desktop

<!-- SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

An OpenShell Community sandbox that runs the full [Cursor](https://cursor.com) Linux desktop
IDE inside an isolated sandbox and delivers the UI through a browser using
**Xvfb + openbox + x11vnc + websockify (noVNC)**.

Cursor is treated as an agent-capable desktop application kept inside OpenShell policy
boundaries, with file access, network egress, and credentials controlled through the
standard OpenShell policy and provider model.

## Architecture

```
Browser (http://localhost:6080/index.html)
  └─ OpenShell port-forward tunnel (or Docker -p 6080)
       └─ websockify --web /usr/share/novnc  (port 6080: HTTP + ws /websockify)
            └─ x11vnc  (port 5901, localhost-only)
                 └─ Xvfb :1 + openbox (Cursor fullscreen; Chrome/Firefox above for OAuth)
                      └─ Cursor Linux .deb
                           └─ /sandbox/workspace
```

The Openbox session is configured so the VNC view is effectively **Cursor only** (fullscreen, no window-manager decorations). Browser windows opened for sign-in are forced to the **above** layer and focused.

## Prerequisites

- [OpenShell CLI](https://github.com/NVIDIA/openshell) ≥ v0.0.16
- A running gateway (`openshell gateway start`)
- Docker (for the initial image build)
- For the full Cursor app experience: **x86-64 (amd64) host**.  
  On arm64 hosts, the display stack is still available but Cursor is skipped (see [Known limitations](#known-limitations)).

## Quick start

```bash
# From the root of your openshell-community clone:
openshell sandbox create \
    --from ./sandboxes/cursor-desktop \
    --forward 6080

# Then open http://localhost:6080/index.html in your browser.
```

Or run the example script:

```bash
bash sandboxes/cursor-desktop/examples/quickstart.sh [optional-local-project-dir]
```

### Why use OpenShell instead of plain Docker?

`bash scripts/local-test.sh` runs the image with **Docker only**. The container still **isolates** processes from your host OS, but **OpenShell’s policy engine** (Landlock filesystem rules, network allow-lists, process identity, optional provider-scoped credentials) is applied when the sandbox is created **through the OpenShell CLI and gateway**, not when you `docker run` the same image by hand.

In short:

| Path | Policy in `policy.yaml` enforced by OpenShell |
|------|-----------------------------------------------|
| `openshell sandbox create --from …` | Yes (with a running gateway) |
| `docker run` / `local-test.sh` | No — image contains `/etc/openshell/policy.yaml`, but enforcement is an OpenShell runtime concern |

Cursor still cannot read arbitrary host paths unless your runtime **bind-mounts** them into the container; OpenShell adds **extra** guardrails on top of normal container isolation.

### One-time gateway

From the same machine where you run the CLI (use **WSL** on Windows + Docker Desktop if that is where `docker` and `openshell` live):

```bash
openshell gateway start
# If the CLI cannot reach the gateway from WSL, see:
#   openshell gateway start --help
#   (--gateway-host is useful when Docker is not reachable at 127.0.0.1 from the client)
```

Check deployment:

```bash
openshell gateway info
```

### Create the sandbox with port forward (keeps it alive)

From the root of this repo:

```bash
openshell sandbox create \
    --name cursor-desktop \
    --from ./sandboxes/cursor-desktop \
    --forward 6080
```

Optional explicit policy file (overrides defaults for this create):

```bash
openshell sandbox create \
    --name cursor-desktop \
    --from ./sandboxes/cursor-desktop \
    --policy ./sandboxes/cursor-desktop/policy.yaml \
    --forward 6080
```

Then open **`http://localhost:6080/index.html`** (or **`http://127.0.0.1:6080/index.html`**).

Stream logs while tightening policy (sandbox name defaults to last-used if omitted):

```bash
openshell logs --tail cursor-desktop
```

Hot-reload policy on a live sandbox:

```bash
openshell policy set --policy ./sandboxes/cursor-desktop/policy.yaml cursor-desktop
```

**Electron / `/dev/shm`:** `local-test.sh` uses **`--shm-size 2g`**. If Cursor is unstable under OpenShell, check the core OpenShell / gateway docs for how to raise shared memory for sandbox workloads.

## Local testing (Docker)

A helper script builds and runs the sandbox with Docker directly, without requiring
a running OpenShell gateway. Useful for iterating on the image locally.

```bash
# From the root of the repo (Linux, macOS, or WSL):
bash sandboxes/cursor-desktop/scripts/local-test.sh
```

**Windows + Docker Desktop (WSL backend):** run the command above from **inside your WSL distro** (not PowerShell or Git Bash unless `docker` works there). In Docker Desktop, enable **Settings → Resources → WSL integration** for that distro, then use a new WSL terminal so `docker` is on `PATH`. Repository shell scripts under `sandboxes/cursor-desktop/` are kept with **LF** line endings (see repo-root `.gitattributes`); CRLF breaks bash shebangs and `set` on Linux.

On Apple Silicon Macs, Docker Desktop uses Rosetta 2 to emulate x86_64 transparently —
the `--platform linux/amd64` flag is set automatically by the script.

### Browser shows only black / no Cursor

You can reach noVNC (e.g. `/app/` assets load) but the remote screen stays black when **X11 is up but Cursor never paints** (crash, wrong GPU flags, or VNC damage updates). Try in order:

1. Confirm the image is **linux/amd64** (ARM builds skip installing Cursor — you get an empty desktop and a black or idle root window).
2. Run the container with enough shared memory: **`--shm-size 2g`** (already set in `local-test.sh`). Too small `/dev/shm` often breaks Electron.
3. Inspect Cursor logs inside the container (name may be `cursor-desktop-test` from `local-test.sh`):
   ```bash
   docker exec -it cursor-desktop-test tail -n 120 /tmp/cursor.log
   ```
4. See whether the process exists: `docker exec -it cursor-desktop-test pgrep -a cursor`
5. Open **`http://127.0.0.1:6080/index.html`** with plain HTTP so the noVNC client can use **`ws://`** on the same host and port. If `/` returns 404, use `/index.html`.

6. **Docker Desktop on Windows** uses a **WSL2 kernel** inside containers (`/proc/version` contains `microsoft`). Cursor may treat that like WSL and prompt **“continue anyway?”** on stdin; without a TTY it **hangs** and VNC stays black. The openbox autostart sets **`DONT_PROMPT_WSL_INSTALL=1`** (Cursor’s own bypass). If that message still appears in `/tmp/cursor.log`, rebuild the image so the latest `openbox-autostart` is included.

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
| `/tmp/novnc.log` | websockify log (HTTP + WebSocket for noVNC) |

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

The smoke test script lives in this repository at `sandboxes/cursor-desktop/scripts/smoke-test.sh`.
It is not copied into the runtime image by default. Run one of the following:

1) Verify with built-in checks from inside the sandbox:

```bash
openshell sandbox exec cursor-desktop -- /usr/local/bin/healthcheck
openshell sandbox exec cursor-desktop -- pgrep -f 'cursor' -u sandbox
```

2) Or copy and run the full smoke test script:

```bash
openshell upload ./sandboxes/cursor-desktop/scripts/smoke-test.sh /sandbox/scripts/smoke-test.sh
openshell sandbox exec cursor-desktop -- chmod +x /sandbox/scripts/smoke-test.sh
openshell sandbox exec cursor-desktop -- /sandbox/scripts/smoke-test.sh
```

3) For local Docker testing, use:

```bash
bash sandboxes/cursor-desktop/scripts/local-test.sh
```

## Security notes

- x11vnc binds to `localhost` only (`-localhost` flag). It is never reachable
  without an active OpenShell port-forward tunnel.
- Cursor auto-update is disabled via `settings.json`; upgrade by rebuilding the image.
- Credentials are attached through OpenShell providers — no API keys are baked into the image.
- The policy's `filesystem_policy` uses Landlock LSM and is locked at sandbox creation time.
- Network policies are hot-reloadable via `openshell policy set`.

## Known limitations

- **Cursor app is amd64-only** — Cursor ships x64 Linux packages exclusively.
  On arm64 hosts, the image still starts the desktop/VNC/noVNC stack for validation,
  but `/usr/bin/cursor` is not installed. For full Cursor functionality on arm64
  development machines, use Docker Desktop x86_64 emulation via
  `bash sandboxes/cursor-desktop/scripts/local-test.sh` (which uses
  `--platform linux/amd64`).
- Cursor requires `--no-sandbox` to start inside a container (passed automatically by
  the openbox autostart script). This disables Chromium's internal process sandbox, which
  is acceptable since OpenShell provides the outer isolation.
- GPU acceleration is not enabled by default. Add `--gpu` to the `openshell sandbox create`
  command and ensure the host has a supported NVIDIA driver if GPU rendering is needed.
- The network allow-list covers known Cursor endpoints as of the time of writing. Cursor
  may call additional telemetry or extension endpoints on first launch; use audit mode to
  discover them (see **Policy** section above).
