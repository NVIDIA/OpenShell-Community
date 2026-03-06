#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# openclaw-start — Configure OpenClaw, inject NeMoClaw DevX API keys, and
# start the gateway.
#
# The NeMoClaw DevX extension is bundled into the UI at image build time with
# placeholder API keys.  At startup this script substitutes the real keys from
# environment variables into the bundled JS, then launches the gateway.
#
# Required env vars (for NVIDIA model endpoints):
#   NVIDIA_INFERENCE_API_KEY   — key for inference-api.nvidia.com
#   NVIDIA_INTEGRATE_API_KEY   — key for integrate.api.nvidia.com
#
# Usage:
#   nemoclaw sandbox create --from nemoclaw-launchable-ui \
#     --forward 18789 \
#     -e NVIDIA_INFERENCE_API_KEY=<key> \
#     -e NVIDIA_INTEGRATE_API_KEY=<key> \
#     -- openclaw-start
set -euo pipefail

# --------------------------------------------------------------------------
# Runtime API key injection
#
# The build bakes __NVIDIA_*_API_KEY__ placeholders into the bundled JS.
# Replace them with the real values supplied via environment variables.
# --------------------------------------------------------------------------
BUNDLE="$(npm root -g)/openclaw/dist/control-ui/assets/nemoclaw-devx.js"

if [ -f "$BUNDLE" ]; then
  [ -n "${NVIDIA_INFERENCE_API_KEY:-}" ] && \
    sed -i "s|__NVIDIA_INFERENCE_API_KEY__|${NVIDIA_INFERENCE_API_KEY}|g" "$BUNDLE"
  [ -n "${NVIDIA_INTEGRATE_API_KEY:-}" ] && \
    sed -i "s|__NVIDIA_INTEGRATE_API_KEY__|${NVIDIA_INTEGRATE_API_KEY}|g" "$BUNDLE"
fi

# --------------------------------------------------------------------------
# Onboard and start the gateway
# --------------------------------------------------------------------------
openclaw onboard

nohup openclaw gateway run > /tmp/gateway.log 2>&1 &

CONFIG_FILE="${HOME}/.openclaw/openclaw.json"
token=$(grep -o '"token"\s*:\s*"[^"]*"' "${CONFIG_FILE}" 2>/dev/null | head -1 | cut -d'"' -f4 || true)

echo ""
echo "OpenClaw gateway starting in background."
echo "  Logs: /tmp/gateway.log"
if [ -n "${token}" ]; then
    echo "  UI:   http://127.0.0.1:18789/?token=${token}"
else
    echo "  UI:   http://127.0.0.1:18789/"
fi
echo ""
