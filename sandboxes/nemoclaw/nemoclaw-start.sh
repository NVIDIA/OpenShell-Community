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
# LiteLLM streaming inference proxy
#
# LiteLLM runs on localhost:4000 and provides streaming-capable inference
# routing.  This bypasses the sandbox proxy's inference.local interception
# path which buffers entire responses and has a 60s hard timeout.
# --------------------------------------------------------------------------
LITELLM_PORT=4000
LITELLM_CONFIG="/tmp/litellm_config.yaml"
LITELLM_LOG="/tmp/litellm.log"

NVIDIA_NIM_API_KEY="${NVIDIA_INFERENCE_API_KEY:-${NVIDIA_INTEGRATE_API_KEY:-}}"
export NVIDIA_NIM_API_KEY

# Persist the API key to a well-known file so the policy-proxy can read
# it later when regenerating the LiteLLM config (e.g. on model switch or
# late key injection from the welcome UI).
LITELLM_KEY_FILE="/tmp/litellm_api_key"
if [ -n "$NVIDIA_NIM_API_KEY" ]; then
  echo -n "$NVIDIA_NIM_API_KEY" > "$LITELLM_KEY_FILE"
  chmod 600 "$LITELLM_KEY_FILE"
fi

# Use the local bundled cost map to avoid a blocked HTTPS fetch to GitHub
# at startup (the sandbox network policy doesn't allow Python to reach
# raw.githubusercontent.com, causing a ~5s timeout on every start).
export LITELLM_LOCAL_MODEL_COST_MAP="True"

_DEFAULT_MODEL="moonshotai/kimi-k2.5"
_DEFAULT_PROVIDER="nvidia-endpoints"

generate_litellm_config() {
  local model_id="${1:-$_DEFAULT_MODEL}"
  local provider="${2:-$_DEFAULT_PROVIDER}"
  local api_base=""
  local litellm_prefix="nvidia_nim"
  local api_key="${NVIDIA_NIM_API_KEY:-}"

  # Read from persisted key file if env var is empty.
  if [ -z "$api_key" ] && [ -f "$LITELLM_KEY_FILE" ]; then
    api_key="$(cat "$LITELLM_KEY_FILE")"
  fi

  case "$provider" in
    nvidia-endpoints)
      api_base="https://integrate.api.nvidia.com/v1" ;;
    nvidia-inference)
      api_base="https://inference-api.nvidia.com/v1" ;;
    *)
      api_base="https://integrate.api.nvidia.com/v1" ;;
  esac

  # Write the actual key value into the config. Using os.environ/ references
  # is fragile inside the sandbox where env vars may not be propagated to all
  # child processes.  If no key is available yet, use a placeholder — the
  # policy-proxy will regenerate the config when the key arrives.
  local key_yaml
  if [ -n "$api_key" ]; then
    key_yaml="      api_key: \"${api_key}\""
  else
    key_yaml="      api_key: \"key-not-yet-configured\""
  fi

  cat > "$LITELLM_CONFIG" <<LITELLM_EOF
model_list:
  - model_name: "*"
    litellm_params:
      model: "${litellm_prefix}/${model_id}"
${key_yaml}
      api_base: "${api_base}"
general_settings:
  master_key: sk-nemoclaw-local
litellm_settings:
  request_timeout: 600
  drop_params: true
  num_retries: 0
LITELLM_EOF
  echo "[litellm] Config written: model=${litellm_prefix}/${model_id} api_base=${api_base} key=${api_key:+present}"
}

generate_litellm_config "$_DEFAULT_MODEL" "$_DEFAULT_PROVIDER"

LITELLM_LOCAL_MODEL_COST_MAP="True" \
  nohup litellm --config "$LITELLM_CONFIG" --port "$LITELLM_PORT" --host 127.0.0.1 \
  >> "$LITELLM_LOG" 2>&1 &
echo "[litellm] Starting on 127.0.0.1:${LITELLM_PORT} (pid $!)"

# Wait for LiteLLM to accept connections before proceeding.
# Use /health/liveliness (basic liveness, no model checks) and --noproxy
# to bypass the sandbox HTTP proxy for localhost connections.
_litellm_deadline=$(($(date +%s) + 60))
while ! curl -sf --noproxy 127.0.0.1 "http://127.0.0.1:${LITELLM_PORT}/health/liveliness" >/dev/null 2>&1; do
  if [ "$(date +%s)" -ge "$_litellm_deadline" ]; then
    echo "[litellm] WARNING: LiteLLM did not become ready within 60s. Continuing anyway."
    break
  fi
  sleep 1
done

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
  --custom-base-url "http://127.0.0.1:${LITELLM_PORT}/v1" \
  --custom-model-id "$_DEFAULT_MODEL" \
  --custom-api-key "sk-nemoclaw-local" \
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
_POLICY_SRC="/etc/openshell/policy.yaml"
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
