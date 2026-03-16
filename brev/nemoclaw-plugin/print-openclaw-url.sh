#!/usr/bin/env bash

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-/sandbox/.openclaw/openclaw.json}"
TMP_DIR="${TMP_DIR:-/tmp}"
CHAT_UI_URL_INPUT="${CHAT_UI_URL:-}"
SANDBOX_NAME_INPUT="${1:-${SANDBOX_NAME:-}}"

log() {
  printf '[%s] %s\n' "$SCRIPT_NAME" "$*"
}

usage() {
  cat <<EOF
Usage:
  CHAT_UI_URL=https://openclaw0-<brev-id>.brevlab.com bash $SCRIPT_NAME [sandbox-name]

Behavior:
  1. Downloads ${OPENCLAW_CONFIG_PATH} from the sandbox
  2. Extracts gateway.auth.token
  3. Prints the final OpenClaw URL

Inputs:
  sandbox-name          Optional sandbox name. If omitted, the script auto-detects
                        the first Ready sandbox whose image/runtime column is 'openshell'.
  CHAT_UI_URL           Optional base URL. If omitted, the script derives one from
                        BREV_ENV_ID or the current hostname.
  OPENCLAW_CONFIG_PATH  Optional path inside the sandbox.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "Missing required command: $1"
    exit 1
  fi
}

ensure_forward() {
  local sandbox_name="$1"
  log "Ensuring forwarder is running for sandbox '${sandbox_name}' on port 18789"
  openshell forward start 18789 "$sandbox_name" --background >/dev/null 2>&1 || true
}

derive_chat_ui_url() {
  local env_id=""
  local host_name=""

  if [[ -n "$CHAT_UI_URL_INPUT" ]]; then
    printf '%s\n' "${CHAT_UI_URL_INPUT%/}"
    return
  fi

  if [[ -n "${BREV_ENV_ID:-}" ]]; then
    printf 'https://openclaw0-%s.brevlab.com\n' "$BREV_ENV_ID"
    return
  fi

  host_name="$(hostname 2>/dev/null || true)"
  env_id="$(printf '%s\n' "$host_name" | sed -E 's/^brev-([[:alnum:]]+)$/\1/')"
  if [[ -n "$env_id" && "$env_id" != "$host_name" ]]; then
    printf 'https://openclaw0-%s.brevlab.com\n' "$env_id"
    return
  fi

  printf 'http://127.0.0.1:18789\n'
}

detect_sandbox_name() {
  python3 - <<'PY'
import re
import subprocess
import sys

def run_list(args):
    try:
        return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT)
    except Exception:
        return ""

def strip_ansi(s):
    return re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", s)

out = run_list(["openshell", "sandbox", "list", "--names"])
names = [line.strip() for line in strip_ansi(out).splitlines() if line.strip()]
if names:
    print(names[0])
    raise SystemExit(0)

try:
    out = subprocess.check_output(["openshell", "sandbox", "list"], text=True, stderr=subprocess.STDOUT)
except subprocess.CalledProcessError as exc:
    sys.stderr.write(exc.output)
    raise

out = strip_ansi(out)
fallback = ""
for line in out.splitlines():
    parts = line.split()
    if not parts:
        continue
    if parts[0].lower() in {"name", "sandbox"}:
        continue
    if not fallback:
        fallback = parts[0]
    lowered = [p.lower() for p in parts]
    if "ready" in lowered:
        print(parts[0])
        break
else:
    if fallback:
        print(fallback)
PY
}

extract_token() {
  local json_path="$1"
  python3 - "$json_path" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    cfg = json.load(f)

token = (
    cfg.get("gateway", {})
      .get("auth", {})
      .get("token", "")
)
if token:
    print(token)
PY
}

main() {
  local sandbox_name chat_ui_url download_dir downloaded_path token final_url

  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  require_cmd openshell
  require_cmd python3

  sandbox_name="$SANDBOX_NAME_INPUT"
  if [[ -z "$sandbox_name" ]]; then
    sandbox_name="$(detect_sandbox_name)"
  fi

  if [[ -z "$sandbox_name" ]]; then
    log "Unable to detect a Ready openshell sandbox. Pass the sandbox name explicitly."
    exit 1
  fi

  chat_ui_url="$(derive_chat_ui_url)"
  ensure_forward "$sandbox_name"
  download_dir="$(mktemp -d "${TMP_DIR%/}/openclaw-url.XXXXXX")"
  downloaded_path="${download_dir}/openclaw.json"

  log "Downloading ${OPENCLAW_CONFIG_PATH} from sandbox '${sandbox_name}'"
  openshell sandbox download "$sandbox_name" "$OPENCLAW_CONFIG_PATH" "$download_dir" >/dev/null

  if [[ ! -f "$downloaded_path" ]]; then
    log "Downloaded config not found at ${downloaded_path}"
    exit 1
  fi

  token="$(extract_token "$downloaded_path" || true)"
  final_url="${chat_ui_url}"
  if [[ -n "$token" ]]; then
    final_url="${chat_ui_url}#token=${token}"
  fi

  printf '\nOpenClaw connection details\n'
  printf '  Sandbox: %s\n' "$sandbox_name"
  printf '  CHAT_UI_URL: %s\n' "$chat_ui_url"
  if [[ -n "$token" ]]; then
    printf '  Token: %s\n' "$token"
    printf '  URL: %s\n' "$final_url"
  else
    printf '  Token: not present in %s\n' "$OPENCLAW_CONFIG_PATH"
    printf '  URL: %s\n' "$chat_ui_url"
  fi
  printf '\n'
}

main "$@"
