#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SOURCE_PATH="${BASH_SOURCE[0]-}"
if [[ -z "$SOURCE_PATH" || "$SOURCE_PATH" == "bash" || "$SOURCE_PATH" == "-bash" ]]; then
  SCRIPT_DIR="$PWD"
else
  SCRIPT_DIR="$(cd "$(dirname "$SOURCE_PATH")" && pwd)"
fi
SCRIPT_REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT=""
WELCOME_UI_DIR=""

PORT="${PORT:-8081}"
CLI_BIN="${CLI_BIN:-}"
CLI_RELEASE_TAG="${CLI_RELEASE_TAG:-devel}"
AUTO_INSTALL_CLI="${AUTO_INSTALL_CLI:-1}"
GITHUB_TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-${GITHUB_PAT:-}}}"
COMMUNITY_REPO="${COMMUNITY_REPO:-NVIDIA/OpenShell-Community}"
COMMUNITY_REF="${COMMUNITY_REF:-${COMMUNITY_BRANCH:-}}"
CLONE_ROOT="${CLONE_ROOT:-/home/ubuntu}"
CLONE_DIR="${CLONE_DIR:-$CLONE_ROOT/OpenShell-Community}"
GATEWAY_LOG="${GATEWAY_LOG:-/tmp/openshell-gateway.log}"
WELCOME_UI_LOG="${WELCOME_UI_LOG:-/tmp/welcome-ui.log}"
LAUNCH_LOG="${LAUNCH_LOG:-/tmp/openshell-launch.log}"
WAIT_TIMEOUT_SECS="${WAIT_TIMEOUT_SECS:-30}"
CLI_RETRY_COUNT="${CLI_RETRY_COUNT:-5}"
CLI_RETRY_DELAY_SECS="${CLI_RETRY_DELAY_SECS:-3}"
GHCR_LOGIN="${GHCR_LOGIN:-auto}"
GHCR_USER="${GHCR_USER:-}"
NEMOCLAW_IMAGE="${NEMOCLAW_IMAGE:-ghcr.io/nvidia/openshell-community/sandboxes/nemoclaw:latest}"

mkdir -p "$(dirname "$LAUNCH_LOG")"
touch "$LAUNCH_LOG"
exec > >(tee -a "$LAUNCH_LOG") 2>&1

log() {
  printf '[launch.sh] %s\n' "$*"
}

require_non_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    log "Do not run the full launcher as root."
    log "Run it as the target user and let the script use sudo only where required."
    exit 1
  fi
}

step() {
  printf '\n[launch.sh] === %s ===\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "Missing required command: $1"
    exit 1
  fi
}

repo_has_welcome_ui() {
  [[ -d "$1/brev/welcome-ui" ]]
}

wait_for_tcp_port() {
  local port="$1"
  local timeout_secs="${2:-30}"
  local start_ts
  start_ts="$(date +%s)"

  while true; do
    if (echo >"/dev/tcp/127.0.0.1/$port") >/dev/null 2>&1; then
      return 0
    fi

    if (( "$(date +%s)" - start_ts >= timeout_secs )); then
      return 1
    fi

    sleep 1
  done
}

wait_for_log_pattern() {
  local logfile="$1"
  local pattern="$2"
  local timeout_secs="${3:-30}"
  local start_ts
  start_ts="$(date +%s)"

  while true; do
    if [[ -f "$logfile" ]] && grep -q "$pattern" "$logfile"; then
      return 0
    fi

    if (( "$(date +%s)" - start_ts >= timeout_secs )); then
      return 1
    fi

    sleep 1
  done
}

retry_cli() {
  local attempt=1
  local max_attempts="${CLI_RETRY_COUNT}"
  local delay_secs="${CLI_RETRY_DELAY_SECS}"

  while true; do
    if "$@"; then
      return 0
    fi

    if (( attempt >= max_attempts )); then
      return 1
    fi

    log "Command failed, retrying (${attempt}/${max_attempts}): $*"
    sleep "$delay_secs"
    attempt=$((attempt + 1))
  done
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x86_64" ;;
    aarch64|arm64) echo "aarch64" ;;
    *)
      log "Unsupported architecture: $(uname -m)"
      exit 1
      ;;
  esac
}

ensure_gh() {
  if command -v gh >/dev/null 2>&1; then
    log "GitHub CLI already installed."
    return
  fi

  log "Installing GitHub CLI..."
  require_cmd sudo
  require_cmd apt-get
  sudo apt-get update
  sudo apt-get install -y gh
}

gh_auth_if_needed() {
  if ! command -v gh >/dev/null 2>&1; then
    return
  fi

  if gh auth status >/dev/null 2>&1; then
    return
  fi

  if [[ -z "$GITHUB_TOKEN" ]]; then
    log "GitHub CLI is unauthenticated. Continuing without auth."
    return
  fi

  log "Authenticating GitHub CLI from environment token..."
  if ! printf '%s\n' "$GITHUB_TOKEN" | gh auth login --with-token >/dev/null 2>&1; then
    log "GitHub authentication failed."
    exit 1
  fi
}

resolve_ghcr_user() {
  if [[ -n "$GHCR_USER" ]]; then
    return 0
  fi

  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    GHCR_USER="$(gh api user -q .login 2>/dev/null || true)"
  fi

  if [[ -z "$GHCR_USER" ]]; then
    GHCR_USER="${GITHUB_USER:-${USER:-}}"
  fi

  [[ -n "$GHCR_USER" ]]
}

docker_login_ghcr_for_user() {
  local login_user="$1"

  if [[ "$login_user" == "root" ]]; then
    log "Logging into ghcr.io as $GHCR_USER for root ..."
    if printf '%s\n' "$GITHUB_TOKEN" | sudo docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null 2>&1; then
      log "GHCR login succeeded for root."
      return 0
    fi
    log "GHCR login failed for root."
    return 1
  fi

  log "Logging into ghcr.io as $GHCR_USER for user $login_user ..."
  if [[ "$login_user" == "$(id -un)" ]]; then
    if printf '%s\n' "$GITHUB_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null 2>&1; then
      log "GHCR login succeeded for user $login_user."
      return 0
    fi
    log "GHCR login failed for user $login_user."
    return 1
  fi

  if sudo -H -u "$login_user" env GITHUB_TOKEN="$GITHUB_TOKEN" GHCR_USER="$GHCR_USER" bash -lc \
    'printf "%s\n" "$GITHUB_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null 2>&1'; then
    log "GHCR login succeeded for user $login_user."
    return 0
  fi
  log "GHCR login failed for user $login_user."
  return 1
}

docker_login_ghcr_if_needed() {
  local login_failed=0

  if [[ "$GHCR_LOGIN" == "0" || "$GHCR_LOGIN" == "false" || "$GHCR_LOGIN" == "no" ]]; then
    log "Skipping GHCR login by configuration."
    return
  fi

  if [[ -z "$GITHUB_TOKEN" ]]; then
    log "No GitHub token available; skipping GHCR login."
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    log "Docker not available; skipping GHCR login."
    return
  fi

  if ! resolve_ghcr_user; then
    log "Could not determine GHCR username; skipping GHCR login."
    return
  fi

  docker_login_ghcr_for_user "root" || login_failed=1

  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
    docker_login_ghcr_for_user "$SUDO_USER" || login_failed=1
  elif [[ "$(id -un)" != "root" ]]; then
    docker_login_ghcr_for_user "$(id -un)" || login_failed=1
  fi

  if [[ "$login_failed" -ne 0 ]]; then
    log "One or more GHCR logins failed. Continuing, but private image pulls may fail."
  fi
}

should_build_nemoclaw_image() {
  [[ -n "$COMMUNITY_REF" && "$COMMUNITY_REF" != "main" ]]
}

build_nemoclaw_image_if_needed() {
  local docker_cmd=()
  local image_context="$REPO_ROOT/sandboxes/nemoclaw"
  local dockerfile_path="$image_context/Dockerfile"

  if ! should_build_nemoclaw_image; then
    log "Skipping local NeMoClaw image build (COMMUNITY_REF=${COMMUNITY_REF:-<unset>})."
    return
  fi

  if [[ ! -f "$dockerfile_path" ]]; then
    log "NeMoClaw Dockerfile not found: $dockerfile_path"
    exit 1
  fi

  if command -v docker >/dev/null 2>&1; then
    docker_cmd=(docker)
  elif command -v sudo >/dev/null 2>&1; then
    docker_cmd=(sudo docker)
  else
    log "Docker is required to build the NeMoClaw sandbox image."
    exit 1
  fi

  log "Building local NeMoClaw image for non-main ref '$COMMUNITY_REF': $NEMOCLAW_IMAGE"
  if ! "${docker_cmd[@]}" build \
    --pull \
    --tag "$NEMOCLAW_IMAGE" \
    --file "$dockerfile_path" \
    "$image_context"; then
    log "Local NeMoClaw image build failed."
    exit 1
  fi

  log "Local NeMoClaw image ready: $NEMOCLAW_IMAGE"
}

checkout_repo_ref() {
  if [[ -z "$COMMUNITY_REF" ]]; then
    return
  fi

  require_cmd git
  log "Checking out OpenShell-Community ref: $COMMUNITY_REF"

  git -C "$CLONE_DIR" fetch --all --tags --prune

  if git -C "$CLONE_DIR" show-ref --verify --quiet "refs/remotes/origin/$COMMUNITY_REF"; then
    git -C "$CLONE_DIR" checkout -B "$COMMUNITY_REF" "origin/$COMMUNITY_REF"
    return
  fi

  if git -C "$CLONE_DIR" show-ref --verify --quiet "refs/tags/$COMMUNITY_REF"; then
    git -C "$CLONE_DIR" checkout --detach "refs/tags/$COMMUNITY_REF"
    return
  fi

  if git -C "$CLONE_DIR" rev-parse --verify --quiet "$COMMUNITY_REF^{commit}" >/dev/null; then
    git -C "$CLONE_DIR" checkout --detach "$COMMUNITY_REF"
    return
  fi

  git -C "$CLONE_DIR" fetch origin "$COMMUNITY_REF"
  git -C "$CLONE_DIR" checkout --detach FETCH_HEAD
}

clone_repo_if_needed() {
  if repo_has_welcome_ui "$CLONE_DIR"; then
    log "Using existing repo checkout at $CLONE_DIR"
    checkout_repo_ref
    return
  fi

  require_cmd git

  if [[ -e "$CLONE_DIR" ]]; then
    log "Clone target exists but is not a valid repo checkout: $CLONE_DIR"
    exit 1
  fi

  mkdir -p "$CLONE_ROOT"

  if [[ -n "$GITHUB_TOKEN" ]]; then
    log "Cloning ${COMMUNITY_REPO} into $CLONE_DIR with token auth..."
    if [[ -n "$COMMUNITY_REF" ]]; then
      git clone --branch "$COMMUNITY_REF" "https://${GITHUB_TOKEN}@github.com/${COMMUNITY_REPO}.git" "$CLONE_DIR" \
        || git clone "https://${GITHUB_TOKEN}@github.com/${COMMUNITY_REPO}.git" "$CLONE_DIR"
    else
      git clone "https://${GITHUB_TOKEN}@github.com/${COMMUNITY_REPO}.git" "$CLONE_DIR"
    fi
  else
    log "Cloning ${COMMUNITY_REPO} into $CLONE_DIR..."
    if [[ -n "$COMMUNITY_REF" ]]; then
      git clone --branch "$COMMUNITY_REF" "https://github.com/${COMMUNITY_REPO}.git" "$CLONE_DIR" \
        || git clone "https://github.com/${COMMUNITY_REPO}.git" "$CLONE_DIR"
    else
      git clone "https://github.com/${COMMUNITY_REPO}.git" "$CLONE_DIR"
    fi
  fi

  checkout_repo_ref
}

install_cli_from_release() {
  local arch tmpdir repo pattern archive candidate

  ensure_gh
  gh_auth_if_needed

  arch="$(detect_arch)"
  tmpdir="$(mktemp -d)"

  for candidate in openshell nemoclaw; do
    case "$candidate" in
      openshell) repo="NVIDIA/OpenShell" ;;
      nemoclaw) repo="NVIDIA/NemoClaw" ;;
    esac

    pattern="${candidate}-${arch}-unknown-linux-musl.tar.gz"
    log "Trying CLI download: ${repo} ${CLI_RELEASE_TAG} ${pattern}"
    if gh release download "$CLI_RELEASE_TAG" --repo "$repo" --pattern "$pattern" --dir "$tmpdir" >/dev/null 2>&1; then
      archive="$tmpdir/$pattern"
      tar xzf "$archive" -C "$tmpdir"
      sudo install -m 755 "$tmpdir/$candidate" "/usr/local/bin/$candidate"
      CLI_BIN="$candidate"
      log "Installed CLI from release: $CLI_BIN"
      rm -rf "$tmpdir"
      return 0
    fi
  done

  rm -rf "$tmpdir"
  log "Unable to install CLI from GitHub releases."
  exit 1
}

resolve_cli() {
  log "Checking for installed CLI binaries..."

  if [[ -n "$CLI_BIN" ]]; then
    require_cmd "$CLI_BIN"
    log "Using CLI from CLI_BIN: $CLI_BIN"
    return
  fi

  if command -v openshell >/dev/null 2>&1; then
    CLI_BIN="openshell"
    log "Detected installed CLI: $CLI_BIN"
    return
  fi

  if command -v nemoclaw >/dev/null 2>&1; then
    CLI_BIN="nemoclaw"
    log "Detected installed CLI: $CLI_BIN"
    return
  fi

  if [[ "$AUTO_INSTALL_CLI" != "1" ]]; then
    log "Neither openshell nor nemoclaw is installed."
    exit 1
  fi

  install_cli_from_release
}

ensure_cli_compat_aliases() {
  local cli_path

  cli_path="$(command -v "$CLI_BIN")"

  if [[ "$CLI_BIN" == "openshell" ]] && ! command -v nemoclaw >/dev/null 2>&1; then
    sudo ln -sf "$cli_path" /usr/local/bin/nemoclaw
    log "Created compatibility alias: nemoclaw -> openshell"
  fi

  if [[ "$CLI_BIN" == "nemoclaw" ]] && ! command -v openshell >/dev/null 2>&1; then
    sudo ln -sf "$cli_path" /usr/local/bin/openshell
    log "Created compatibility alias: openshell -> nemoclaw"
  fi
}

resolve_repo_root() {
  if repo_has_welcome_ui "$SCRIPT_REPO_ROOT"; then
    REPO_ROOT="$SCRIPT_REPO_ROOT"
  elif repo_has_welcome_ui "$PWD"; then
    REPO_ROOT="$PWD"
  else
    clone_repo_if_needed
    REPO_ROOT="$CLONE_DIR"
  fi

  WELCOME_UI_DIR="$REPO_ROOT/brev/welcome-ui"
}

ensure_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    log "Node.js already installed: $(node --version)"
    log "npm already installed: $(npm --version)"
    return
  fi

  log "Installing Node.js LTS via nvm..."
  require_cmd curl
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm install --lts
}

set_inference_route() {
  log "Configuring inference route..."

  if "$CLI_BIN" inference set --provider nvidia-endpoints --model moonshotai/kimi-k2.5 >/dev/null 2>&1; then
    log "Configured inference via '$CLI_BIN inference set'."
    return
  fi

  if "$CLI_BIN" cluster inference set --provider nvidia-endpoints --model moonshotai/kimi-k2.5 >/dev/null 2>&1; then
    log "Configured inference via legacy '$CLI_BIN cluster inference set'."
    return
  fi

  log "Unable to configure inference route with either current or legacy CLI commands."
  exit 1
}

run_provider_create_or_replace() {
  local name="$1"
  shift

  log "Configuring provider: $name"
  if retry_cli "$CLI_BIN" provider create --name "$name" "$@" >/dev/null 2>&1; then
    log "Created provider: $name"
    return
  fi

  log "Provider create failed for $name. Replacing existing provider..."
  retry_cli "$CLI_BIN" provider delete "$name" >/dev/null 2>&1 || true
  retry_cli "$CLI_BIN" provider create --name "$name" "$@"
  log "Recreated provider: $name"
}

wait_for_gateway_cli() {
  log "Waiting for gateway CLI operations to stabilize..."
  if retry_cli "$CLI_BIN" provider list --names >/dev/null 2>&1; then
    log "Gateway CLI is responsive."
    return
  fi

  log "Gateway CLI did not stabilize. Last gateway log lines:"
  tail -n 50 "$GATEWAY_LOG" || true
  exit 1
}

start_gateway() {
  : > "$GATEWAY_LOG"
  log "Resetting gateway state if it already exists..."
  log "Gateway log: $GATEWAY_LOG"

  if "$CLI_BIN" gateway destroy >> "$GATEWAY_LOG" 2>&1; then
    log "Existing gateway destroyed."
  else
    log "Gateway destroy returned non-zero. Continuing with fresh start."
  fi

  log "Starting gateway..."
  if ! "$CLI_BIN" gateway start 2>&1 | tee -a "$GATEWAY_LOG"; then
    log "Gateway start failed. Last log lines:"
    tail -n 50 "$GATEWAY_LOG" || true
    exit 1
  fi

  if ! wait_for_log_pattern "$GATEWAY_LOG" "Gateway .* ready\\|Active gateway set" "$WAIT_TIMEOUT_SECS"; then
    log "Gateway did not become ready within ${WAIT_TIMEOUT_SECS}s. Last log lines:"
    tail -n 50 "$GATEWAY_LOG" || true
    exit 1
  fi

  log "Gateway reported ready."
  wait_for_gateway_cli
}

install_ui_deps() {
  require_cmd npm
  cd "$WELCOME_UI_DIR"

  log "Installing welcome UI dependencies in $WELCOME_UI_DIR"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
}

start_welcome_ui() {
  cd "$WELCOME_UI_DIR"

  : > "$WELCOME_UI_LOG"
  log "Starting welcome UI in background..."
  log "Welcome UI log: $WELCOME_UI_LOG"

  nohup env \
    PORT="$PORT" \
    REPO_ROOT="$REPO_ROOT" \
    CLI_BIN="$CLI_BIN" \
    NEMOCLAW_IMAGE="$NEMOCLAW_IMAGE" \
    node server.js >> "$WELCOME_UI_LOG" 2>&1 &
  WELCOME_UI_PID=$!
  export WELCOME_UI_PID
  log "Welcome UI PID: $WELCOME_UI_PID"

  if ! wait_for_tcp_port "$PORT" "$WAIT_TIMEOUT_SECS"; then
    log "Welcome UI did not open port $PORT within ${WAIT_TIMEOUT_SECS}s. Last log lines:"
    tail -n 100 "$WELCOME_UI_LOG" || true
    exit 1
  fi

  log "Welcome UI started at http://localhost:${PORT}"
}

main() {
  require_non_root
  require_cmd tar
  require_cmd sudo

  step "Resolving repo"
  resolve_repo_root
  step "Resolving CLI"
  resolve_cli
  ensure_cli_compat_aliases
  step "Authenticating registries"
  docker_login_ghcr_if_needed
  step "Preparing NeMoClaw image"
  build_nemoclaw_image_if_needed
  step "Ensuring Node.js"
  ensure_node

  log "Using repo root: $REPO_ROOT"
  if [[ -n "$COMMUNITY_REF" ]]; then
    log "Using community ref: $COMMUNITY_REF"
  fi
  log "Using CLI: $CLI_BIN"

  step "Starting gateway"
  start_gateway

  step "Configuring providers"
  run_provider_create_or_replace \
    nvidia-inference \
    --type openai \
    --credential OPENAI_API_KEY=unused \
    --config OPENAI_BASE_URL=https://inference-api.nvidia.com/v1

  run_provider_create_or_replace \
    nvidia-endpoints \
    --type nvidia \
    --credential NVIDIA_API_KEY=unused \
    --config NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1

  set_inference_route

  step "Installing welcome UI dependencies"
  install_ui_deps
  step "Starting welcome UI"
  start_welcome_ui

  step "Ready"
  log "Gateway log: $GATEWAY_LOG"
  log "Welcome UI log: $WELCOME_UI_LOG"
  log "Open http://localhost:${PORT}"
}

main "$@"
