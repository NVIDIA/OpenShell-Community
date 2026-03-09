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
# Required env vars:
#   CHAT_UI_URL                — URL where the chat UI will be accessed
#                                (e.g. http://127.0.0.1:18789 for local,
#                                 https://187890-<id>.brevlab.com for Brev)
#
# Optional env vars (for NVIDIA model endpoints):
#   NVIDIA_INFERENCE_API_KEY   — key for inference-api.nvidia.com
#   NVIDIA_INTEGRATE_API_KEY   — key for integrate.api.nvidia.com
#
# Usage (env vars inlined via env command to avoid nemoclaw -e quoting bug):
#   nemoclaw sandbox create --name nemoclaw --from sandboxes/nemoclaw/ \
#     --forward 18789 \
#     -- env CHAT_UI_URL=http://127.0.0.1:18789 \
#            NVIDIA_INFERENCE_API_KEY=<key> \
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
if [ -z "${CHAT_UI_URL:-}" ]; then
    echo "Error: CHAT_UI_URL environment variable is required." >&2
    echo "Set it to the URL where the chat UI will be accessed, e.g.:" >&2
    echo "  Local:  CHAT_UI_URL=http://127.0.0.1:18789" >&2
    echo "  Brev:   CHAT_UI_URL=https://187890-<brev-id>.brevlab.com" >&2
    exit 1
fi

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
_ONBOARD_KEY="${NVIDIA_INFERENCE_API_KEY:-not-used}"
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
  --custom-api-key "$_ONBOARD_KEY" \
  --secret-input-mode plaintext \
  --custom-compatibility openai \
  --gateway-port 18788 \
  --gateway-bind loopback

export NVIDIA_API_KEY=" "

INTERNAL_GATEWAY_PORT=18788
PUBLIC_PORT=18789

# allowedOrigins must reference the PUBLIC port (18789) since that is the
# origin the browser sends.  The proxy on 18789 forwards to 18788 internally.
python3 -c "
import json, os
from urllib.parse import urlparse
cfg = json.load(open(os.environ['HOME'] + '/.openclaw/openclaw.json'))
local = 'http://127.0.0.1:${PUBLIC_PORT}'
parsed = urlparse(os.environ['CHAT_UI_URL'])
chat_origin = f'{parsed.scheme}://{parsed.netloc}'
origins = [local]
if chat_origin != local:
    origins.append(chat_origin)
cfg['gateway']['controlUi'] = {
    'allowInsecureAuth': True,
    'allowedOrigins': origins,
}
json.dump(cfg, open(os.environ['HOME'] + '/.openclaw/openclaw.json', 'w'), indent=2)
"

nohup openclaw gateway > /tmp/gateway.log 2>&1 &

# Copy the default policy to a writable location so that policy-proxy can
# update it at runtime.  /etc is read-only under Landlock, but /sandbox is
# read-write, so we use /sandbox/.openclaw/ which is already owned by the
# sandbox user.
_POLICY_SRC="/etc/navigator/policy.yaml"
_POLICY_DST="/sandbox/.openclaw/policy.yaml"
if [ ! -f "$_POLICY_DST" ] && [ -f "$_POLICY_SRC" ]; then
  cp "$_POLICY_SRC" "$_POLICY_DST" 2>/dev/null || true
fi
_POLICY_PATH="${_POLICY_DST}"
[ -f "$_POLICY_PATH" ] || _POLICY_PATH="$_POLICY_SRC"

# Start the policy reverse proxy on the public-facing port.  It forwards all
# traffic to the OpenClaw gateway on the internal port and intercepts
# /api/policy requests to read/write the sandbox policy file.
NODE_PATH=$(npm root -g) POLICY_PATH=${_POLICY_PATH} UPSTREAM_PORT=${INTERNAL_GATEWAY_PORT} LISTEN_PORT=${PUBLIC_PORT} \
  nohup node /usr/local/lib/policy-proxy.js >> /tmp/gateway.log 2>&1 &

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

CHAT_UI_BASE="${CHAT_UI_URL%/}"
if [ -n "${token}" ]; then
    LOCAL_URL="http://127.0.0.1:18789/?token=${token}"
    CHAT_URL="${CHAT_UI_BASE}/?token=${token}"
else
    LOCAL_URL="http://127.0.0.1:18789/"
    CHAT_URL="${CHAT_UI_BASE}/"
fi

echo ""
echo "OpenClaw gateway starting in background."
echo "  Logs:  /tmp/gateway.log"
echo "  UI:    ${CHAT_URL}"
if [ "${CHAT_UI_BASE}" != "http://127.0.0.1:18789" ]; then
    echo "  Local: ${LOCAL_URL}"
fi
echo ""
