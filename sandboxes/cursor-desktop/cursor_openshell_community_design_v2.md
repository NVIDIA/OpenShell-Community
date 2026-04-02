# Cursor inside NVIDIA OpenShell Community Edition

> Community sandbox for [openshell-community](https://github.com/NVIDIA/openshell-community).
> Contribution path: `sandboxes/cursor-desktop/`

---

## Goal

Build a contributed OpenShell Community sandbox that runs the Linux version of Cursor inside an
isolated OpenShell sandbox and exposes the UI through a browser using Xvfb + openbox + x11vnc +
noVNC. The design treats Cursor as an agent-capable desktop application while keeping file access,
network egress, credentials, and optional inference routing inside OpenShell policy boundaries.

**Desired end-state:**
- Container starts → Cursor UI is visible at `http://localhost:6080` (fullscreen, no desktop chrome visible)
- Clicking the Login button in Cursor opens a browser window (Chrome/Firefox) on top of the Cursor window for OAuth
- No spurious WebSocket disconnect errors in the browser

---

## Design conclusion

The supported and stable way to run Cursor inside OpenShell Community is not raw host X11
passthrough. The correct pattern is a contributed community sandbox package under
`sandboxes/cursor-desktop/` containing:

- NVIDIA-pinned Ubuntu 24.04 base image (`nvcr.io/nvidia/base/ubuntu:noble-20251013`)
- Cursor Linux `.deb` package (version-pinned via `CURSOR_VERSION` build arg)
- **openbox** minimal window manager (replaces XFCE4 from the original design — lighter weight, no desktop chrome)
- Xvfb virtual display server
- x11vnc + noVNC browser UI bridge
- OpenShell policy using the `version: 1` `network_policies` schema
- Custom noVNC `index.html` that auto-connects and fills the browser window

---

## High-level architecture

```text
Operator Browser
    │
    │  http://localhost:6080
    ▼
OpenShell Port Forward (--forward 6080)  ← or docker run -p 6080:6080 for local testing
    │
    ▼
OpenShell Sandbox: cursor-desktop
    ├── Ubuntu 24.04 base (NVIDIA)
    ├── Xvfb :1  (virtual display, 1920x1080x24)
    ├── openbox session (minimal WM, dbus-launch)
    │   └── openbox-autostart
    │       ├── xsetroot (black background)
    │       └── Cursor Linux .deb (maximized, via xdg-open for auth)
    ├── x11vnc on 5901  (VNC server, localhost-only)
    ├── noVNC + websockify on 6080  (browser bridge, custom auto-connect UI)
    ├── Google Chrome (amd64) / Firefox (arm64)  for OAuth flows
    ├── /sandbox/workspace  (project mount or upload target)
    └── OpenShell policy enforcement
          ├── filesystem_policy  (Landlock LSM, static)
          ├── network_policies   (hot-reloadable, per-binary)
          ├── process            (user: sandbox)
          └── providers / inference.local
```

---

## Repo structure

```text
sandboxes/cursor-desktop/
├── Dockerfile
├── README.md
├── policy.yaml
├── startup.sh
├── healthcheck.sh
├── scripts/
│   ├── install-cursor.sh
│   ├── openbox-autostart
│   ├── openbox-rc.xml
│   ├── novnc-index.html
│   ├── local-test.sh
│   └── smoke-test.sh
├── examples/
│   └── quickstart.sh
└── skills/
    └── cursor-desktop/
        └── SKILL.md
```

---

## Build decisions

### Base image

Uses `nvcr.io/nvidia/base/ubuntu:noble-20251013` (Ubuntu 24.04), not plain `ubuntu:24.04`. The
NVIDIA base only enables Ubuntu `main` by default; `universe` must be added explicitly for some
packages (e.g. `fonts-liberation`).

### Window manager: openbox (not XFCE4)

The original design called for XFCE4. The actual implementation uses **openbox** — it is
substantially lighter, starts faster, and produces no visible desktop chrome. Cursor is launched
maximized into a black background, so the user only sees the Cursor window.

### Architecture handling

Cursor ships amd64-only packages. On amd64 hosts Chrome is installed; on arm64 (Apple Silicon)
Firefox is installed instead. On Apple Silicon with Docker Desktop, add `--platform linux/amd64`
to `docker build` and `docker run` to use Rosetta 2 / QEMU x86_64 emulation.

### noVNC installation path

When installed via `apt` on Ubuntu 24.04, noVNC lands at `/usr/share/novnc/`. Do **not** use
`/opt/novnc/`.

### Cursor launch via openbox autostart (not startup.sh directly)

Cursor is launched by `openbox-session` via `~/.config/openbox/autostart` (not directly from
`startup.sh`). This ensures Cursor inherits `DBUS_SESSION_BUS_ADDRESS`, which is required for
`xdg-open` to spawn the configured browser for OAuth login flows.

---

## Key packages (Dockerfile apt-get install)

| Package | Purpose |
|---|---|
| `xvfb` | Virtual framebuffer |
| `openbox wmctrl xterm` | Minimal window manager |
| `dbus-x11` | D-Bus session support |
| `x11vnc` | VNC server |
| `novnc websockify` | Browser WebSocket bridge |
| `x11-utils` | `xdpyinfo` (display readiness probe) |
| `x11-xserver-utils` | `xsetroot` (desktop background colour) |
| `netcat-openbsd` | Port readiness probes and healthcheck |
| `python3-xdg` | Required by `openbox-xdg-autostart` |
| `libgtk-3-0 libnss3 …` | Electron runtime dependencies for Cursor |
| `google-chrome-stable` | OAuth browser (amd64 only) |
| `firefox` | OAuth browser (arm64 only) |

---

## Known issues and fixes applied

### 1. `/tmp/.X11-unix` not created (Xvfb fails as non-root)

**Symptom:** `_XSERVTransmkdir: ERROR: euid != 0, directory /tmp/.X11-unix will not be created`

**Fix:** Pre-create in Dockerfile (as root) AND in `startup.sh` (belt-and-suspenders for tmpfs
environments):

```dockerfile
RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix
```

```bash
# startup.sh, before Xvfb starts:
mkdir -p /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix 2>/dev/null || true
```

### 2. Missing packages: `xsetroot` and PyXDG

**Symptom:** `openbox.log` shows `xsetroot: not found` and `openbox-xdg-autostart requires PyXDG`

**Fix:** Add to Dockerfile apt-get install:
```
x11-xserver-utils   # provides xsetroot
python3-xdg         # provides PyXDG for openbox-xdg-autostart
```

### 3. WebSocket close code 1002 in browser ("window terminated unexpectedly")

**Root cause:** `nc -z localhost 5901` readiness probes in `startup.sh` connect to x11vnc and
immediately close with no data. x11vnc's built-in WebSocket detector reads the empty connection,
fails, and logs `webSocketsHandshake: unknown connection error`. If the browser connects via
websockify at the same moment as a probe, websockify's first backend TCP connection is rejected,
and the browser receives WebSocket close code 1002.

**Fix 1 (startup.sh):** Add a settle delay after x11vnc is declared ready (default **2s** via
`VNC_WS_SETTLE_SEC`) so the first websockify connection does not race x11vnc's WebSocket detector.

**Fix 1b (startup.sh, preferred):** Avoid repeated **`nc -z`** probes against the VNC port while
waiting for x11vnc — each probe opens TCP and can trigger the same false-positive path. Use
**`ss -lnt`** (or equivalent) to detect **LISTEN** without connecting.

**Fix 2 (novnc-index.html):** The custom noVNC page reconnects silently after disconnect and
defers the **first** connect by ~600ms to reduce races on slow hosts (e.g. Docker Desktop on macOS).
It only shows "Reconnecting…" if the session was previously established and then dropped.

**What NOT to do:** Adding `-noweb` to x11vnc flags causes x11vnc 0.9.16 to exit immediately
(unknown flag). Do not use it.

### 4. openbox autostart missing shebang

**Fix:** Added `#!/bin/sh` as first line of `scripts/openbox-autostart`.

### 5. Docker socket non-standard path (Mac)

Docker Desktop on macOS uses a non-standard socket path. Export before running openshell:

```bash
export DOCKER_HOST=unix:///Users/<username>/.docker/run/docker.sock
# Make permanent:
echo 'export DOCKER_HOST=unix:///Users/<username>/.docker/run/docker.sock' >> ~/.zshrc
```

### 6. k3s CrashLoopBackOff (unresolved)

**Symptom:** When launching via `openshell sandbox create`, the `agent` container in the pod
enters `CrashLoopBackOff` (exit code 1) immediately.

**Root cause (suspected):** The `openshell-sandbox` binary is injected into the pod via a
HostPath volume mount from `/opt/openshell/bin` on the k3s node (the Linux VM inside the
OpenShell Docker container). If this binary is missing or is the wrong architecture, the
container exits immediately.

**Workaround:** Use local Docker testing (`local-test.sh`) until the gateway binary issue is
resolved.

---

## Startup sequence (`startup.sh`)

```bash
#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:1}"
WORKSPACE="${WORKSPACE:-/sandbox/workspace}"
VNC_PORT="${VNC_PORT:-5901}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
NOVNC_PROXY="/usr/share/novnc/utils/novnc_proxy"

mkdir -p "$WORKSPACE"

# Pre-create X11 socket dir (needed when /tmp is fresh tmpfs)
mkdir -p /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix 2>/dev/null || true

# 1. Xvfb
rm -f "/tmp/.X${DISPLAY#:}-lock"
Xvfb "$DISPLAY" -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!
for i in $(seq 1 30); do
    xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break
    kill -0 "$XVFB_PID" 2>/dev/null || { echo "Xvfb exited" >&2; exit 1; }
    sleep 0.5
done

# 2. openbox (via dbus-launch so Cursor inherits DBUS_SESSION_BUS_ADDRESS)
dbus-launch --exit-with-session openbox-session >/tmp/openbox.log 2>&1 &
WM_PID=$!
for i in $(seq 1 60); do
    pgrep -f openbox >/dev/null 2>&1 && break
    kill -0 "$WM_PID" 2>/dev/null || { cat /tmp/openbox.log >&2; exit 1; }
    sleep 0.5
done

# 3. x11vnc (localhost-only, no password)
x11vnc -display "$DISPLAY" -forever -shared -rfbport "$VNC_PORT" -nopw -localhost \
    -logfile /tmp/x11vnc.log &
VNC_PID=$!
for i in $(seq 1 30); do
    nc -z localhost "$VNC_PORT" 2>/dev/null && break
    kill -0 "$VNC_PID" 2>/dev/null || { cat /tmp/x11vnc.log >&2; exit 1; }
    sleep 0.5
done
# Wait 1 second for x11vnc to settle after startup probes before websockify connects
sleep 1

# 4. noVNC
"$NOVNC_PROXY" --vnc "localhost:${VNC_PORT}" --listen "$NOVNC_PORT" \
    >/tmp/novnc.log 2>&1 &
NOVNC_PID=$!
for i in $(seq 1 30); do
    nc -z localhost "$NOVNC_PORT" 2>/dev/null && break
    kill -0 "$NOVNC_PID" 2>/dev/null || { cat /tmp/novnc.log >&2; exit 1; }
    sleep 0.5
done

# 5. Cursor — launched via openbox autostart, wait for it to appear
for i in $(seq 1 60); do
    pgrep -f "/usr/bin/cursor" >/dev/null 2>&1 && break
    sleep 0.5
done

echo "cursor-desktop ready — open http://localhost:${NOVNC_PORT}"

trap 'kill "$NOVNC_PID" "$VNC_PID" "$WM_PID" "$XVFB_PID" 2>/dev/null || true' SIGINT SIGTERM
wait -n "$NOVNC_PID" "$VNC_PID" "$WM_PID" "$XVFB_PID"
```

---

## openbox autostart (`scripts/openbox-autostart`)

Cursor is launched here (not from `startup.sh`) so it inherits `DBUS_SESSION_BUS_ADDRESS`
for `xdg-open` → browser OAuth flows.

```bash
#!/bin/sh
export XDG_SESSION_TYPE=x11
export XDG_CURRENT_DESKTOP=openbox

# Set browser for xdg-open OAuth flows
if [ -x /usr/bin/google-chrome-stable ]; then
    export BROWSER=/usr/bin/google-chrome-stable
elif [ -x /usr/bin/firefox ]; then
    export BROWSER=/usr/bin/firefox
fi

# Black desktop background
xsetroot -solid "#1e1e1e" &

# Launch Cursor (amd64 only; arm64 skips but display stack still starts)
if [ -x /usr/bin/cursor ]; then
    LIBGL_ALWAYS_SOFTWARE=1 \
    /usr/bin/cursor \
        --no-sandbox \
        --disable-gpu \
        --disable-dev-shm-usage \
        --disable-gpu-sandbox \
        --use-gl=swiftshader \
        --start-maximized \
        /sandbox/workspace \
        >/tmp/cursor.log 2>&1 &
fi
```

---

## openbox window config (`scripts/openbox-rc.xml`)

Key settings for the desired UX:
- Cursor starts maximised, no decorations
- Chrome/Firefox (OAuth popup) always raises above Cursor
- No right-click desktop menu, no taskbar

---

## noVNC custom page (`scripts/novnc-index.html`)

Replaces the default noVNC UI with a minimal auto-connecting page:
- Cursor fills the entire browser window (`scaleViewport = true`, `resizeSession = false`)
- Reconnects silently in 1 second on disconnect
- Only shows "Reconnecting…" status if the session was previously established (not on transient startup blips)
- No toolbar, no connection dialog

---

## Local test flow

```bash
# Build and run (from repo root):
bash sandboxes/cursor-desktop/scripts/local-test.sh

# Force clean rebuild (after Dockerfile changes):
docker build --no-cache \
  --platform linux/amd64 \
  --build-arg CURSOR_VERSION=2.6 \
  -t openshell-cursor-desktop-test:latest \
  sandboxes/cursor-desktop

docker run --rm --platform linux/amd64 \
  --name cursor-desktop-test \
  -p 6080:6080 \
  --shm-size 2g \
  openshell-cursor-desktop-test:latest

# Open browser at:
open http://localhost:6080
```

**Note on Apple Silicon (ARM64):** Every process runs under QEMU x86_64 emulation. Cursor takes
2–5 minutes to fully load on first launch. This is expected. Use `docker exec cursor-desktop-test
wmctrl -l` to confirm Cursor windows are open while waiting.

---

## Via OpenShell gateway

```bash
openshell sandbox create \
  --from ./sandboxes/cursor-desktop \
  --forward 6080
```

Then open `http://localhost:6080`. Note: the gateway deployment has an unresolved
`CrashLoopBackOff` issue (see Known Issues §6). Use local Docker testing in the interim.

---

## Smoke test

Run inside a running sandbox to verify all services:

```bash
openshell sandbox exec cursor-desktop -- /sandbox/scripts/smoke-test.sh
```

Checks: Xvfb, x11vnc, noVNC, Cursor process, workspace directory, policy file.

---

## Health check (`healthcheck.sh`)

```bash
#!/usr/bin/env bash
nc -z localhost "${NOVNC_PORT:-6080}"
```

Runs every 15 seconds, 60-second start period, 5 retries.

---

## OpenShell policy (`policy.yaml`)

Uses `version: 1` schema. Key network policies:
- `cursor_app`: Cursor auth and AI endpoints (api2.cursor.sh, cursor.com, etc.)
- `github_ssh_over_https`: Git read operations (clone, fetch, pull) over HTTPS
- `github_rest_api`: GitHub REST API read-only
- `nvidia_inference`: NVIDIA NIM endpoints
- `inference_local`: OpenShell provider-managed inference routing
- `vscode` / `cursor`: Extension and update CDN endpoints

Run with `enforcement: audit` initially, collect denied events via `openshell logs`, then promote
to `enforce`.

---

## Security model

- Cursor is isolated from the host OS via OpenShell's Landlock LSM and seccomp enforcement
- Filesystem access is restricted to `/sandbox`, `/tmp`, and read-only system paths
- Network egress is allow-listed per binary in named network policies
- Credentials are attached through OpenShell providers, not baked into the image
- The UI is exposed through a forwarded port, never direct host display access
- x11vnc binds to `localhost` only — only reachable through the noVNC proxy or OpenShell tunnel
- Cursor auto-update is disabled (`"update.mode": "none"` baked into settings.json)
- No VNC password needed (the OpenShell tunnel provides the security boundary)

---

## Community contribution checklist

Before opening a pull request to [openshell-community](https://github.com/NVIDIA/openshell-community):

- [ ] Sandbox lives under `sandboxes/cursor-desktop/`
- [ ] `Dockerfile` builds cleanly on `amd64` (arm64 skips Cursor but display stack still starts)
- [ ] `policy.yaml` uses the `version: 1` schema
- [ ] `README.md` covers prerequisites, quick-start, and known limitations
- [ ] `skills/cursor-desktop/SKILL.md` describes the sandbox to agents
- [ ] All commits are signed off (`git commit -s`) per the DCO requirement
- [ ] `scripts/smoke-test.sh` passes in a local sandbox before submitting
- [ ] `scripts/local-test.sh` confirms port 6080 works end-to-end locally
