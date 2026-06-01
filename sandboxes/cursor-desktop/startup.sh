#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Entrypoint for the cursor-desktop sandbox.
# Starts the full display stack (Xvfb → openbox → x11vnc → websockify + noVNC).
# Cursor itself is launched by openbox's autostart script so it inherits
# the dbus-launch session and xdg-open can spawn Chrome for auth flows.
#
# This script runs as the sandbox user (USER sandbox in Dockerfile).
# No root privileges or su wrappers are needed.

set -euo pipefail

export DISPLAY="${DISPLAY:-:1}"
# OpenShell may inject a host-derived HOME; force a Linux home so Openbox
# and Cursor resolve config paths under /sandbox correctly.
export HOME="/sandbox"
# Openbox uses XDG_CONFIG_HOME to locate its autostart script; set it
# explicitly so host-derived HOME values can't break OAuth browser spawning.
export XDG_CONFIG_HOME="/sandbox/.config"
WORKSPACE="${WORKSPACE:-/sandbox/workspace}"
VNC_PORT="${VNC_PORT:-5901}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
# After x11vnc reports LISTEN, wait this many seconds before starting websockify.
# Docker Desktop on macOS is often slower; transient TCP probes to the VNC port can
# confuse x11vnc's WebSocket detector and yield browser close code 1002 — see README.
VNC_WS_SETTLE_SEC="${VNC_WS_SETTLE_SEC:-2}"

# Electron / keyring helpers often expect a writable runtime dir (even in Xvfb).
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-sandbox}"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

# ── Workspace ──────────────────────────────────────────────────────────────────
mkdir -p "$WORKSPACE"

# ── X11 socket directory ───────────────────────────────────────────────────────
# /tmp/.X11-unix must exist before Xvfb starts. Pre-creating it in the
# Dockerfile is not reliable when /tmp is a fresh tmpfs at runtime.
mkdir -p /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix 2>/dev/null || true

# ── 1. Virtual display ─────────────────────────────────────────────────────────
echo "[cursor-desktop] Starting Xvfb on display ${DISPLAY}..."
rm -f "/tmp/.X${DISPLAY#:}-lock"
Xvfb "$DISPLAY" -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!

echo "[cursor-desktop] Waiting for Xvfb..."
for i in $(seq 1 30); do
    xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break
    if ! kill -0 "$XVFB_PID" 2>/dev/null; then
        echo "[cursor-desktop] Xvfb exited unexpectedly." >&2; exit 1
    fi
    sleep 0.5
done
echo "[cursor-desktop] Xvfb ready."

# ── 2. Window manager (openbox — minimal, no desktop environment) ──────────────
echo "[cursor-desktop] Starting openbox..."
# Force Linux-style HOME/XDG config paths for Openbox. Some hosts inject a
# non-Linux HOME (e.g. a Windows path) which prevents Openbox from finding
# /sandbox/.config/openbox/autostart, and then Cursor never launches.
HOME="/sandbox" XDG_CONFIG_HOME="/sandbox/.config" dbus-launch --exit-with-session openbox-session \
    >/tmp/openbox.log 2>&1 &
WM_PID=$!

echo "[cursor-desktop] Waiting for openbox..."
for i in $(seq 1 60); do
    pgrep -f openbox >/dev/null 2>&1 && break
    if ! kill -0 "$WM_PID" 2>/dev/null; then
        echo "[cursor-desktop] openbox exited unexpectedly. Check /tmp/openbox.log." >&2
        cat /tmp/openbox.log >&2 || true
        exit 1
    fi
    sleep 0.5
done
echo "[cursor-desktop] openbox ready."

# ── 3. VNC server ──────────────────────────────────────────────────────────────
# -localhost: bind to loopback only — only reachable through the noVNC proxy
# or an OpenShell port-forward tunnel, so no VNC password is needed.
echo "[cursor-desktop] Starting x11vnc on port ${VNC_PORT}..."
# -noxdamage: X damage tracking can miss repaints from Electron under Xvfb; force full updates.
x11vnc -display "$DISPLAY" -forever -shared -rfbport "$VNC_PORT" -nopw -localhost \
    -noxdamage \
    -logfile /tmp/x11vnc.log &
VNC_PID=$!

echo "[cursor-desktop] Waiting for x11vnc..."
# Do NOT use repeated `nc -z` here: each probe opens TCP to x11vnc, which treats
# empty connections as possible WebSocket handshakes and logs errors; racing with
# the first real websockify connection causes WebSocket close code 1002 in the browser.
_vnc_port_listening() {
    if command -v ss >/dev/null 2>&1; then
        ss -lnt 2>/dev/null | grep -qE ":${VNC_PORT}[[:space:]]"
    else
        nc -z localhost "$VNC_PORT" 2>/dev/null
    fi
}
for i in $(seq 1 30); do
    if _vnc_port_listening; then
        break
    fi
    if ! kill -0 "$VNC_PID" 2>/dev/null; then
        echo "[cursor-desktop] x11vnc exited unexpectedly. x11vnc log:" >&2
        cat /tmp/x11vnc.log >&2 || echo "(no log written)" >&2
        exit 1
    fi
    sleep 0.5
done
# Let x11vnc settle after the listener appears (especially on macOS / emulated amd64).
sleep "$VNC_WS_SETTLE_SEC"
echo "[cursor-desktop] x11vnc ready."

# ── 4. websockify: HTTP (noVNC static files) + WebSocket (/websockify) on one port ─
# No nginx: a single websockify process serves /usr/share/novnc and proxies VNC.
echo "[cursor-desktop] Starting websockify (noVNC + WebSocket) on port ${NOVNC_PORT}..."
websockify --web /usr/share/novnc "${NOVNC_PORT}" "localhost:${VNC_PORT}" \
    >/tmp/novnc.log 2>&1 &
NOVNC_PID=$!

echo "[cursor-desktop] Waiting for websockify..."
for i in $(seq 1 30); do
    nc -z localhost "$NOVNC_PORT" 2>/dev/null && break
    if ! kill -0 "$NOVNC_PID" 2>/dev/null; then
        echo "[cursor-desktop] websockify exited unexpectedly." >&2
        cat /tmp/novnc.log >&2 || true
        exit 1
    fi
    sleep 0.5
done
echo "[cursor-desktop] websockify ready."

# ── 5. Cursor ──────────────────────────────────────────────────────────────────
# Cursor is launched by openbox's autostart script, which runs inside the same
# dbus-launch session as openbox. This ensures DBUS_SESSION_BUS_ADDRESS is
# inherited, making xdg-open work so Chrome opens for OAuth auth flows.
echo "[cursor-desktop] Waiting for Cursor (started via openbox autostart)..."

_cursor_is_running() {
    # Match packaged path, symlink, or nested electron binary in /usr/share.
    pgrep -x cursor >/dev/null 2>&1 \
        || pgrep -f '/usr/bin/cursor' >/dev/null 2>&1 \
        || pgrep -f '/usr/share/cursor' >/dev/null 2>&1 \
        || pgrep -f '/opt/Cursor/cursor' >/dev/null 2>&1
}

CURSOR_OK=0
for i in $(seq 1 300); do
    if _cursor_is_running; then
        CURSOR_OK=1
        break
    fi
    sleep 0.5
done
if [ "$CURSOR_OK" -ne 1 ] && [ -x /usr/bin/cursor ]; then
    echo "[cursor-desktop] WARNING: Cursor did not join the session within the startup window." >&2
    echo "[cursor-desktop] Last lines of /tmp/cursor.log:" >&2
    tail -n 40 /tmp/cursor.log >&2 || echo "(no /tmp/cursor.log yet)" >&2
fi

# ── Ready banner ───────────────────────────────────────────────────────────────
echo ""
echo "========================================================"
echo "  cursor-desktop sandbox ready!"
echo "  Open in browser: http://localhost:${NOVNC_PORT}/index.html"
echo "  (or http://localhost:${NOVNC_PORT}/ if your websockify build serves index for /)"
echo "  Workspace:       ${WORKSPACE}"
echo "  Logs:            /tmp/cursor.log  /tmp/openbox.log"
echo "========================================================"
echo ""

# ── Graceful shutdown ──────────────────────────────────────────────────────────
_shutdown() {
    echo "[cursor-desktop] Shutting down..."
    kill "$NOVNC_PID" "$VNC_PID" "$WM_PID" "$XVFB_PID" 2>/dev/null || true
    pkill -x openbox 2>/dev/null || true
}
trap '_shutdown; exit 0' SIGINT SIGTERM

# dbus-launch may exit/reparent while openbox keeps running; never treat WM_PID as
# the long-lived session anchor. Supervise Xvfb, VNC bridge, and openbox instead.
while true; do
    if ! kill -0 "$XVFB_PID" 2>/dev/null; then
        echo "[cursor-desktop] Xvfb (pid ${XVFB_PID}) exited; stopping." >&2
        break
    fi
    if ! kill -0 "$VNC_PID" 2>/dev/null; then
        echo "[cursor-desktop] x11vnc (pid ${VNC_PID}) exited; stopping." >&2
        break
    fi
    if ! kill -0 "$NOVNC_PID" 2>/dev/null; then
        echo "[cursor-desktop] websockify (pid ${NOVNC_PID}) exited; stopping." >&2
        break
    fi
    if ! pgrep -x openbox >/dev/null 2>&1; then
        echo "[cursor-desktop] openbox is no longer running; stopping." >&2
        break
    fi
    sleep 10
done
_shutdown
exit 1
