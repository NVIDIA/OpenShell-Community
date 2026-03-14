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
_DEFAULT_MODEL="moonshotai/kimi-k2.5"
_DEFAULT_CONTEXT_WINDOW=200000
_DEFAULT_MAX_TOKENS=8192
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
  --custom-model-id "-" \
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
for provider in cfg.get('models', {}).get('providers', {}).values():
    if not isinstance(provider, dict):
        continue
    for model in provider.get('models', []):
        if isinstance(model, dict) and model.get('id') in ('${_DEFAULT_MODEL}', '-'):
            model['contextWindow'] = ${_DEFAULT_CONTEXT_WINDOW}
            model['maxTokens'] = ${_DEFAULT_MAX_TOKENS}
json.dump(cfg, open(os.environ['HOME'] + '/.openclaw/openclaw.json', 'w'), indent=2)
"

nohup openclaw gateway > /tmp/gateway.log 2>&1 &
echo "[gateway] openclaw gateway launched (pid $!)"

# Copy the default policy to a writable location so that policy-proxy can
# update it at runtime.  /etc is read-only under Landlock, but /sandbox is
# read-write, so we use /sandbox/.openclaw/ which is already owned by the
# sandbox user.
_POLICY_SRC="/etc/openshell/policy.yaml"
_POLICY_DST="/sandbox/.openclaw/policy.yaml"
if [ ! -f "$_POLICY_DST" ] && [ -f "$_POLICY_SRC" ]; then
  cp "$_POLICY_SRC" "$_POLICY_DST" 2>/dev/null || true
fi
_POLICY_PATH="${_POLICY_DST}"
[ -f "$_POLICY_PATH" ] || _POLICY_PATH="$_POLICY_SRC"
echo "[gateway] policy path selected: ${_POLICY_PATH} (src=${_POLICY_SRC} dst=${_POLICY_DST})"

# Start the policy reverse proxy on the public-facing port.  It forwards all
# traffic to the OpenClaw gateway on the internal port and intercepts
# /api/policy requests to read/write the sandbox policy file.
NODE_PATH=$(npm root -g) POLICY_PATH=${_POLICY_PATH} UPSTREAM_PORT=${INTERNAL_GATEWAY_PORT} LISTEN_PORT=${PUBLIC_PORT} \
  nohup node /usr/local/lib/policy-proxy.js >> /tmp/gateway.log 2>&1 &
echo "[gateway] policy-proxy launched (pid $!) upstream=${INTERNAL_GATEWAY_PORT} public=${PUBLIC_PORT}"

# Auto-approve pending device pairing requests so the browser is paired
# before the user notices the "pairing required" prompt in the Control UI.
(
  echo "[auto-pair] watcher starting"
  _pair_timeout_secs="${AUTO_PAIR_TIMEOUT_SECS:-0}"
  _pair_sleep_secs="0.5"
  _pair_heartbeat_every=120
  _json_has_approval() {
    jq -e '
      .device
      | objects
      | (.approvedAtMs? // empty) or ((.tokens? // []) | length > 0)
    ' >/dev/null 2>&1
  }

  _summarize_device_list() {
    jq -r '
      def labels($entries):
        ($entries // [])
        | map(select(type == "object" and (.deviceId? // "") != "")
          | "\((.clientId // "unknown")):\((.deviceId // "")[0:12])");
      (labels(.pending)) as $pending
      | (labels(.paired)) as $paired
      | "pending=\($pending | length) [\(($pending | if length > 0 then join(", ") else "-" end))] paired=\($paired | length) [\(($paired | if length > 0 then join(", ") else "-" end))]"
    ' 2>/dev/null || echo "unparseable"
  }

  if [ "${_pair_timeout_secs}" -gt 0 ] 2>/dev/null; then
    _pair_deadline=$(($(date +%s) + _pair_timeout_secs))
    echo "[auto-pair] watcher timeout=${_pair_timeout_secs}s"
  else
    _pair_deadline=0
    echo "[auto-pair] watcher timeout=disabled"
  fi
  _pair_attempts=0
  _pair_approved=0
  _pair_errors=0
  while true; do
    if [ "${_pair_deadline}" -gt 0 ] && [ "$(date +%s)" -ge "${_pair_deadline}" ]; then
      break
    fi

    sleep "${_pair_sleep_secs}"
    _pair_attempts=$((_pair_attempts + 1))
    _approve_output="$(openclaw devices approve --latest --json 2>&1 || true)"

    if printf '%s\n' "$_approve_output" | _json_has_approval; then
      _pair_approved=$((_pair_approved + 1))
      _approved_device_id="$(printf '%s\n' "$_approve_output" | jq -r '.device.deviceId // ""' 2>/dev/null | cut -c1-12)"
      echo "[auto-pair] approved request attempts=${_pair_attempts} count=${_pair_approved} device=${_approved_device_id:-unknown}"
      continue
    fi

    if [ -n "$_approve_output" ] && ! printf '%s\n' "$_approve_output" | grep -qiE 'no pending|no device|not paired|nothing to approve'; then
      _pair_errors=$((_pair_errors + 1))
      echo "[auto-pair] approve --latest unexpected output attempts=${_pair_attempts} errors=${_pair_errors}: ${_approve_output}"
    fi

    if [ $((_pair_attempts % _pair_heartbeat_every)) -eq 0 ]; then
      _list_output="$(openclaw devices list --json 2>&1 || true)"
      _device_summary="$(printf '%s\n' "$_list_output" | _summarize_device_list)"
      echo "[auto-pair] heartbeat attempts=${_pair_attempts} approved=${_pair_approved} errors=${_pair_errors} ${_device_summary}"
    fi
  done
  echo "[auto-pair] watcher exiting attempts=${_pair_attempts} approved=${_pair_approved} errors=${_pair_errors}"
) >> /tmp/gateway.log 2>&1 &

CONFIG_FILE="${HOME}/.openclaw/openclaw.json"
token=$(grep -o '"token"\s*:\s*"[^"]*"' "${CONFIG_FILE}" 2>/dev/null | head -1 | cut -d'"' -f4 || true)

CHAT_UI_BASE="${CHAT_UI_URL%/}"
if [ -n "${token}" ]; then
    LOCAL_URL="http://127.0.0.1:18789/#token=${token}"
    CHAT_URL="${CHAT_UI_BASE}/#token=${token}"
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
