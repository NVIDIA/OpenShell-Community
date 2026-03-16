#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_NAME="$(basename "$0")"
PLUGIN_DIR="${PLUGIN_DIR:-$PWD}"
CHAT_UI_URL="${CHAT_UI_URL:-}"
OPENCLAW_AUTH_MODE="${OPENCLAW_AUTH_MODE:-}"
INSTALL_LOG="${INSTALL_LOG:-/tmp/nemoclaw-plugin-install.log}"
PRINT_URL_SCRIPT="${PRINT_URL_SCRIPT:-$SCRIPT_DIR/print-openclaw-url.sh}"
RUN_ONCE_MARKER="${RUN_ONCE_MARKER:-$HOME/.cache/nemoclaw-plugin/install-ran}"
PRINT_ONLY="${PRINT_ONLY:-0}"

log() {
  printf '[%s] %s\n' "$SCRIPT_NAME" "$*"
}

usage() {
  cat <<EOF
Usage:
  CHAT_UI_URL=https://openclaw0-<brev-id>.brevlab.com \\
  PLUGIN_DIR=/path/to/openshell-openclaw-plugin \\
  bash $SCRIPT_NAME

Environment:
  CHAT_UI_URL          Base browser origin for OpenClaw.
  PLUGIN_DIR           Plugin checkout directory containing install.sh.
  OPENCLAW_AUTH_MODE   Optional auth mode forwarded to install.sh.
  INSTALL_LOG          Optional install log path. Default: ${INSTALL_LOG}
  PRINT_ONLY           If set to 1, print the manual wrapper command and exit to a shell.
EOF
}

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    log "Required file not found: $path"
    exit 1
  fi
}

mark_ran() {
  mkdir -p "$(dirname "$RUN_ONCE_MARKER")"
  : > "$RUN_ONCE_MARKER"
}

print_manual_mode() {
  local manual_cmd

  manual_cmd="export CHAT_UI_URL=\"$CHAT_UI_URL\" && export INSTALL_LOG=\"$INSTALL_LOG\" && export PLUGIN_DIR=\"$PLUGIN_DIR\" && export RUN_ONCE_MARKER=\"$RUN_ONCE_MARKER\""
  if [[ -n "$OPENCLAW_AUTH_MODE" ]]; then
    manual_cmd="${manual_cmd} && export OPENCLAW_AUTH_MODE=\"$OPENCLAW_AUTH_MODE\""
  fi
  manual_cmd="${manual_cmd} && bash \"$SCRIPT_DIR/run-plugin-install.sh\""

  printf '\nPlugin checkout/install script is not available on this host.\n'
  printf 'Run this command manually after repo access is fixed:\n\n'
  printf '%s\n' "$manual_cmd"
  printf '\nA fresh login shell will open next so PATH is initialized.\n\n'
  source ~/.profile >/dev/null 2>&1 || true
  source ~/.bashrc >/dev/null 2>&1 || true
  exec bash -il
}

main() {
  local install_cmd=()
  local install_status token

  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  if [[ -z "$CHAT_UI_URL" ]]; then
    log "CHAT_UI_URL is required."
    exit 1
  fi

  if [[ "$PRINT_ONLY" == "1" ]]; then
    print_manual_mode
  fi

  if [[ -f "$RUN_ONCE_MARKER" ]]; then
    log "Install autorun already completed once; skipping rerun."
    source ~/.profile >/dev/null 2>&1 || true
    source ~/.bashrc >/dev/null 2>&1 || true
    exec bash -il
  fi

  mark_ran
  require_file "$PLUGIN_DIR/install.sh"

  cd "$PLUGIN_DIR"

  install_cmd=(bash ./install.sh)
  if [[ -n "$OPENCLAW_AUTH_MODE" ]]; then
    export OPENCLAW_AUTH_MODE
  fi
  export CHAT_UI_URL

  "${install_cmd[@]}" 2>&1 | tee "$INSTALL_LOG"
  install_status=${PIPESTATUS[0]}

  if [[ $install_status -eq 0 ]]; then
    if [[ -f "$PRINT_URL_SCRIPT" ]]; then
      CHAT_UI_URL="$CHAT_UI_URL" bash "$PRINT_URL_SCRIPT" || true
    fi
    token="$(grep -Eo 'token=[A-Za-z0-9_-]+' "$INSTALL_LOG" | tail -n 1 | cut -d= -f2 || true)"
    printf '\nNeMoClaw install finished.\n'
    printf '  CHAT_UI_URL: %s\n' "$CHAT_UI_URL"
    if [[ -n "$OPENCLAW_AUTH_MODE" ]]; then
      printf '  OpenClaw auth mode request: %s\n' "$OPENCLAW_AUTH_MODE"
    fi
    if [[ -n "$token" ]]; then
      printf '  OpenClaw token: %s\n' "$token"
      printf '  OpenClaw URL: %s#token=%s\n' "$CHAT_UI_URL" "$token"
    else
      printf '  OpenClaw token: not found in install output\n'
    fi
    printf '  PATH refresh: starting a new login shell so nemoclaw is available.\n\n'
  fi

  source ~/.profile >/dev/null 2>&1 || true
  source ~/.bashrc >/dev/null 2>&1 || true
  exec bash -il
}

main "$@"
