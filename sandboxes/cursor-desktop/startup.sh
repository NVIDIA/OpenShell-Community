#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Entrypoint for the cursor-desktop sandbox.
# Starts the full display stack (Xvfb → openbox → x11vnc → noVNC).
# Cursor itself is launched by openbox's autostart script so it inherits
# the dbus-launch session and xdg-open can spawn Chrome for auth flows.
#
# This script runs as the sandbox user (USER sandbox in Dockerfile).
# No root privileges or su wrappers are needed.

set -euo pipefail

export DISPLAY="${DISPLAY:-:1}"
WORKSPACE="${WORKSPACE:-/sandbox/workspace}"
VNC_PORT="${VNC_PORT:-5901}"
WEBSOCKIFY_PORT="${WEBSOCKIFY_PORT:-5902}"   # internal; nginx proxies /websockify here
NOVNC_PORT="${NOVNC_PORT:-6080}"

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
dbus-launch --exit-with-session openbox-session >/tmp/openbox.log 2>&1 &
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
x11vnc -display "$DISPLAY" -forever -shared -rfbport "$VNC_PORT" -nopw -localhost \
    -logfile /tmp/x11vnc.log &
VNC_PID=$!

echo "[cursor-desktop] Waiting for x11vnc..."
for i in $(seq 1 30); do
    nc -z localhost "$VNC_PORT" 2>/dev/null && break
    if ! kill -0 "$VNC_PID" 2>/dev/null; then
        echo "[cursor-desktop] x11vnc exited unexpectedly. x11vnc log:" >&2
        cat /tmp/x11vnc.log >&2 || echo "(no log written)" >&2
        exit 1
    fi
    sleep 0.5
done
# Allow x11vnc to finish processing any startup probes before websockify
# makes its first connection. Without this pause the initial browser
# connection can arrive while x11vnc is still handling a WebSocket-detection
# false-positive, causing the browser to receive close code 1002.
sleep 1
echo "[cursor-desktop] x11vnc ready."

# ── 4. WebSocket proxy (websockify, internal port) ────────────────────────────
# websockify proxies VNC frames to WebSocket clients.
# It runs on an internal port only; nginx proxies /websockify → here.
# We do NOT pass --web because nginx handles all HTTP serving.
echo "[cursor-desktop] Starting websockify on internal port ${WEBSOCKIFY_PORT}..."
websockify "$WEBSOCKIFY_PORT" "localhost:${VNC_PORT}" \
    >/tmp/novnc.log 2>&1 &
NOVNC_PID=$!

echo "[cursor-desktop] Waiting for websockify..."
for i in $(seq 1 30); do
    nc -z localhost "$WEBSOCKIFY_PORT" 2>/dev/null && break
    if ! kill -0 "$NOVNC_PID" 2>/dev/null; then
        echo "[cursor-desktop] websockify exited unexpectedly." >&2
        cat /tmp/novnc.log >&2 || true
        exit 1
    fi
    sleep 0.5
done
echo "[cursor-desktop] websockify ready."

# ── 5. nginx HTTP front-end ────────────────────────────────────────────────────
# nginx serves /usr/share/novnc/ static files and proxies /websockify to
# the internal websockify instance. This avoids websockify's Python HTTP
# handler, which returns 404 for directory paths (including bare "/").
echo "[cursor-desktop] Starting nginx on port ${NOVNC_PORT}..."
mkdir -p /tmp/nginx-client-body /tmp/nginx-proxy \
         /tmp/nginx-fastcgi /tmp/nginx-uwsgi /tmp/nginx-scgi
nginx -c /etc/nginx/novnc.conf >/tmp/nginx.log 2>&1 &
NGINX_PID=$!

echo "[cursor-desktop] Waiting for nginx..."
for i in $(seq 1 30); do
    nc -z localhost "$NOVNC_PORT" 2>/dev/null && break
    if ! kill -0 "$NGINX_PID" 2>/dev/null; then
        echo "[cursor-desktop] nginx exited unexpectedly." >&2
        cat /tmp/nginx.log >&2 || true
        cat /tmp/nginx-error.log >&2 || true
        exit 1
    fi
    sleep 0.5
done
echo "[cursor-desktop] nginx ready."

# ── 6. Cursor ──────────────────────────────────────────────────────────────────
# Cursor is launched by openbox's autostart script, which runs inside the same
# dbus-launch session as openbox. This ensures DBUS_SESSION_BUS_ADDRESS is
# inherited, making xdg-open work so Chrome opens for OAuth auth flows.
echo "[cursor-desktop] Waiting for Cursor (started via openbox autostart)..."
for i in $(seq 1 60); do
    pgrep -f "/usr/bin/cursor" >/dev/null 2>&1 && break
    sleep 0.5
done

# ── Ready banner ───────────────────────────────────────────────────────────────
echo ""
echo "========================================================"
echo "  cursor-desktop sandbox ready!"
echo "  Open in browser: http://localhost:${NOVNC_PORT}"
echo "  Workspace:       ${WORKSPACE}"
echo "  Logs:            /tmp/cursor.log  /tmp/openbox.log"
echo "========================================================"
echo ""

# ── Graceful shutdown ──────────────────────────────────────────────────────────
_shutdown() {
    echo "[cursor-desktop] Shutting down..."
    kill "$NGINX_PID" "$NOVNC_PID" "$VNC_PID" "$WM_PID" "$XVFB_PID" 2>/dev/null || true
}
trap _shutdown SIGINT SIGTERM

# Stay alive as long as any core display service is running.
wait -n "$NGINX_PID" "$NOVNC_PID" "$VNC_PID" "$WM_PID" "$XVFB_PID"
