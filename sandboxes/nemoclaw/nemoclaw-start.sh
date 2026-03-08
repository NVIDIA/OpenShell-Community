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
# Usage (env vars inlined via env command to avoid nemoclaw -e quoting bug):
#   nemoclaw sandbox create --name nemoclaw --from sandboxes/nemoclaw/ \
#     --forward 18789 \
#     -- env NVIDIA_INFERENCE_API_KEY=<key> \
#            NVIDIA_INTEGRATE_API_KEY=<key> \
#            nemoclaw-start
set -euo pipefail

# --------------------------------------------------------------------------
# Runtime API key injection
#
# The build bakes __NVIDIA_*_API_KEY__ placeholders into the bundled JS.
# Replace them with the real values supplied via environment variables.
#
# /usr is read-only under Landlock, so sed -i (which creates a temp file
# in the same directory) fails.  Instead we sed to /tmp and write back
# via shell redirection (truncate-write to the existing inode).  If even
# that is blocked, we skip gracefully — users can still enter keys via
# the API Keys page in the OpenClaw UI.
# --------------------------------------------------------------------------
BUNDLE="$(npm root -g)/openclaw/dist/control-ui/assets/nemoclaw-devx.js"

if [ -f "$BUNDLE" ]; then
  (
    set +e
    tmp="/tmp/_nemoclaw_bundle_$$"
    cp "$BUNDLE" "$tmp" 2>/dev/null
    if [ $? -ne 0 ]; then exit 0; fi
    [ -n "${NVIDIA_INFERENCE_API_KEY:-}" ] && \
      sed -i "s|__NVIDIA_INFERENCE_API_KEY__|${NVIDIA_INFERENCE_API_KEY}|g" "$tmp"
    [ -n "${NVIDIA_INTEGRATE_API_KEY:-}" ] && \
      sed -i "s|__NVIDIA_INTEGRATE_API_KEY__|${NVIDIA_INTEGRATE_API_KEY}|g" "$tmp"
    cp "$tmp" "$BUNDLE" 2>/dev/null
    rm -f "$tmp" 2>/dev/null
  ) || echo "Note: API key injection into UI bundle skipped (read-only /usr). Keys can be set via the API Keys page."
fi

# --------------------------------------------------------------------------
# Onboard and start the gateway
# --------------------------------------------------------------------------
export NVIDIA_API_KEY="${NVIDIA_INFERENCE_API_KEY:- }"
openclaw onboard \
  --non-interactive \
  --accept-risk \
  --mode local \
  --no-install-daemon \
  --skip-skills \
  --skip-health \
  --auth-choice custom-api-key \
  --custom-base-url "https://inference.local/v1" \
  --custom-model-id "aws/anthropic/bedrock-claude-opus-4-6" \
  --custom-api-key "not-used" \
  --secret-input-mode plaintext \
  --custom-compatibility openai \
  --gateway-port 18789 \
  --gateway-bind loopback

export NVIDIA_API_KEY=" "

GATEWAY_PORT=18789

# Derive the Brev environment ID so we can build the correct gateway origin.
# BREV_UI_URL (if set) points at the *welcome UI* port, not the gateway port,
# so we must always compute the gateway origin separately.
if [ -z "${BREV_ENV_ID:-}" ] && [ -n "${BREV_UI_URL:-}" ]; then
    BREV_ENV_ID=$(echo "$BREV_UI_URL" | sed -n 's|.*//[0-9]*-\([^.]*\)\.brevlab\.com.*|\1|p')
fi

if [ -n "${BREV_ENV_ID:-}" ]; then
    export OPENCLAW_ORIGIN="https://${GATEWAY_PORT}0-${BREV_ENV_ID}.brevlab.com"
else
    export OPENCLAW_ORIGIN="http://127.0.0.1:${GATEWAY_PORT}"
fi

python3 -c "
import json, os
cfg = json.load(open(os.environ['HOME'] + '/.openclaw/openclaw.json'))
cfg['gateway']['controlUi'] = {
    'allowInsecureAuth': True,
    'allowedOrigins': [os.environ['OPENCLAW_ORIGIN']]
}
json.dump(cfg, open(os.environ['HOME'] + '/.openclaw/openclaw.json', 'w'), indent=2)
"

nohup openclaw gateway > /tmp/gateway.log 2>&1 &

# Auto-approve pending device pairing requests so the browser is paired
# before the user notices the "pairing required" prompt in the Control UI.
(
  _pair_deadline=$(($(date +%s) + 300))
  while [ "$(date +%s)" -lt "$_pair_deadline" ]; do
    sleep 0.5
    if openclaw devices approve --latest --json 2>/dev/null | grep -q '"ok"'; then
      echo "[auto-pair] Approved pending device pairing request."
    fi
  done
) >> /tmp/gateway.log 2>&1 &

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
