#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# openclaw-start — Manage the OpenClaw gateway inside an OpenShell sandbox.
#
# Usage:
#   openclaw-start              Onboard (if needed) and start the gateway
#   openclaw-start pair CODE    Approve a Slack/Telegram pairing request
#   openclaw-start stop         Stop the running gateway
#   openclaw-start status       Check whether the gateway is running
#   openclaw-start logs         Tail the gateway log
#
# The gateway runs under nohup so it survives SSH disconnects.
# Use `openclaw gateway run` (foreground), NOT `openclaw gateway start`
# which invokes launchd/systemd service managers unavailable in sandboxes.

set -euo pipefail

LOGFILE="/sandbox/.openclaw/gateway.log"
CONFIG_FILE="${HOME}/.openclaw/openclaw.json"

mkdir -p /sandbox/.openclaw

stop_gateway() {
  pkill -f "openclaw-gateway" 2>/dev/null || true
  pkill -f "openclaw gateway" 2>/dev/null || true
  sleep 1
  pkill -9 -f "openclaw-gateway" 2>/dev/null || true
}

case "${1:-start}" in
  pair)
    if [ -z "${2:-}" ]; then
      echo "Usage: openclaw-start pair <CODE>"
      exit 1
    fi
    openclaw pairing approve slack "$2"
    ;;

  stop)
    echo "Stopping openclaw gateway..."
    stop_gateway
    echo "Stopped."
    ;;

  status)
    if pgrep -f "openclaw-gateway" >/dev/null 2>&1; then
      PID=$(pgrep -f "openclaw-gateway" | head -1)
      echo "Gateway is running (PID $PID)"
      echo "Log: $LOGFILE"
      exit 0
    else
      echo "Gateway is NOT running"
      exit 1
    fi
    ;;

  logs)
    if [ -f "$LOGFILE" ]; then
      tail -f "$LOGFILE"
    else
      echo "No log file found at $LOGFILE"
      exit 1
    fi
    ;;

  start|"")
    # Run onboard wizard (generates config if missing)
    openclaw onboard

    # Stop any existing gateway first
    stop_gateway

    echo "Starting openclaw gateway..."
    nohup openclaw gateway run --allow-unconfigured > "$LOGFILE" 2>&1 &

    sleep 3

    if pgrep -f "openclaw-gateway" >/dev/null 2>&1; then
      PID=$(pgrep -f "openclaw-gateway" | head -1)
      token=$(grep -o '"token"\s*:\s*"[^"]*"' "${CONFIG_FILE}" 2>/dev/null | head -1 | cut -d'"' -f4 || true)

      echo ""
      echo "OpenClaw gateway started (PID $PID)"
      echo "  Logs: $LOGFILE"
      if [ -n "${token:-}" ]; then
        echo "  UI:   http://127.0.0.1:18789/?token=${token}"
      else
        echo "  UI:   http://127.0.0.1:18789/"
      fi
      echo ""

      # Report patch / Slack status from early log output
      if grep -q "ws-proxy-patch.*active" "$LOGFILE" 2>/dev/null; then
        echo "[OK] WebSocket proxy patch active"
      fi
      if grep -q "socket mode connected" "$LOGFILE" 2>/dev/null; then
        echo "[OK] Slack Socket Mode connected"
      fi
    else
      echo "Gateway failed to start. Log output:"
      cat "$LOGFILE" 2>/dev/null
      exit 1
    fi
    ;;

  *)
    echo "Usage: openclaw-start {start|stop|status|logs|pair <CODE>}"
    exit 1
    ;;
esac
