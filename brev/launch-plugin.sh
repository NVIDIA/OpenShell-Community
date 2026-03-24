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

ASSET_DIR=""

LAUNCH_LOG="${LAUNCH_LOG:-/tmp/launch-plugin.log}"
GITHUB_TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-${GITHUB_PAT:-}}}"
GHCR_USER="${GHCR_USER:-}"
GIT_HTTP_USER="${GIT_HTTP_USER:-${GHCR_USER:-x-access-token}}"
COMMUNITY_REPO="${COMMUNITY_REPO:-NVIDIA/OpenShell-Community}"
COMMUNITY_REF="${COMMUNITY_REF:-${COMMUNITY_BRANCH:-main}}"
COMMUNITY_CLONE_ROOT="${COMMUNITY_CLONE_ROOT:-}"
COMMUNITY_DIR="${COMMUNITY_DIR:-}"
PLUGIN_REPO="${PLUGIN_REPO:-NVIDIA/NemoClaw}"
PLUGIN_REF="${PLUGIN_REF:-main}"
PLUGIN_CLONE_ROOT="${PLUGIN_CLONE_ROOT:-}"
PLUGIN_DIR="${PLUGIN_DIR:-}"
CLI_BIN="${CLI_BIN:-openshell}"
CLI_RELEASE_TAG="${CLI_RELEASE_TAG:-dev}"
OPENCLAW_VERSION="${OPENCLAW_VERSION:-latest}"
CODE_SERVER_VERSION="${CODE_SERVER_VERSION:-4.89.1}"
CODE_SERVER_PORT="${CODE_SERVER_PORT:-13337}"
OPENCLAW_AUTH_MODE="${OPENCLAW_AUTH_MODE:-}"

TARGET_USER="${SUDO_USER:-$(id -un)}"
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
if [[ -z "$COMMUNITY_CLONE_ROOT" ]]; then
  COMMUNITY_CLONE_ROOT="$TARGET_HOME"
fi
if [[ -z "$PLUGIN_CLONE_ROOT" ]]; then
  PLUGIN_CLONE_ROOT="$TARGET_HOME"
fi
if [[ -z "$COMMUNITY_DIR" ]]; then
  COMMUNITY_DIR="$COMMUNITY_CLONE_ROOT/OpenShell-Community"
fi
if [[ -z "$PLUGIN_DIR" ]]; then
  PLUGIN_DIR="$PLUGIN_CLONE_ROOT/NemoClaw"
fi
NODE_BIN="${NODE_BIN:-}"
NPM_BIN="${NPM_BIN:-}"
mkdir -p "$(dirname "$LAUNCH_LOG")"
touch "$LAUNCH_LOG"
exec > >(tee -a "$LAUNCH_LOG") 2>&1

APT_UPDATED=0
PLUGIN_INSTALL_READY=0

log() {
  printf '[launch-plugin.sh] %s\n' "$*"
}

step() {
  printf '\n[launch-plugin.sh] === %s ===\n' "$*"
}

require_non_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    log "Do not run this launcher as root."
    log "Run it as the target user and let the script use sudo where required."
    exit 1
  fi
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "Missing required command: $1"
    exit 1
  fi
}

resolve_node_tooling() {
  if [[ -z "$NODE_BIN" ]]; then
    NODE_BIN="$(command -v node || true)"
  fi
  if [[ -z "$NPM_BIN" ]]; then
    NPM_BIN="$(command -v npm || true)"
  fi

  if [[ -z "$NODE_BIN" || -z "$NPM_BIN" ]]; then
    log "Unable to resolve node/npm in the current shell."
    exit 1
  fi
}

sudo_with_node_path() {
  local node_dir npm_dir path_prefix

  resolve_node_tooling
  node_dir="$(dirname "$NODE_BIN")"
  npm_dir="$(dirname "$NPM_BIN")"
  path_prefix="$node_dir"
  if [[ "$npm_dir" != "$node_dir" ]]; then
    path_prefix="${path_prefix}:$npm_dir"
  fi

  sudo env "PATH=${path_prefix}:$PATH" "$@"
}

sudo_npm() {
  resolve_node_tooling
  sudo_with_node_path "$NPM_BIN" "$@"
}

community_repo_has_assets() {
  local repo_root="$1"
  [[ -f "$repo_root/brev/nemoclaw-plugin/README.md" && -f "$repo_root/brev/nemoclaw-plugin/settings.json" ]]
}

resolve_clone_url() {
  local repo="$1"
  if [[ -n "$GITHUB_TOKEN" ]]; then
    printf 'https://%s:%s@github.com/%s.git' "$GIT_HTTP_USER" "$GITHUB_TOKEN" "$repo"
  else
    printf 'https://github.com/%s.git' "$repo"
  fi
}

resolve_public_clone_url() {
  local repo="$1"
  printf 'https://github.com/%s.git' "$repo"
}

git_fetch_with_fallback() {
  local repo_dir="$1"
  local repo_name="$2"
  local public_url

  if git -C "$repo_dir" fetch --tags --prune origin; then
    return 0
  fi

  public_url="$(resolve_public_clone_url "$repo_name")"
  log "Fetch failed for $repo_dir; retrying against public remote $public_url"
  git -C "$repo_dir" remote set-url origin "$public_url"
  git -C "$repo_dir" fetch --tags --prune origin
}

git_clone_public_then_token() {
  local repo_name="$1"
  local repo_dir="$2"
  local ref="$3"
  local public_url auth_url

  public_url="$(resolve_public_clone_url "$repo_name")"
  if [[ -n "$ref" ]]; then
    if git clone --branch "$ref" "$public_url" "$repo_dir"; then
      return 0
    fi
  else
    if git clone "$public_url" "$repo_dir"; then
      return 0
    fi
  fi

  if [[ -z "$GITHUB_TOKEN" ]]; then
    return 1
  fi

  auth_url="$(resolve_clone_url "$repo_name")"
  log "Public clone failed; retrying ${repo_name} with token auth."
  if [[ -n "$ref" ]]; then
    git clone --branch "$ref" "$auth_url" "$repo_dir"
  else
    git clone "$auth_url" "$repo_dir"
  fi
}

clone_or_refresh_community_repo() {
  mkdir -p "$(dirname "$COMMUNITY_DIR")"

  if [[ -d "$COMMUNITY_DIR/.git" ]]; then
    log "OpenShell-Community repo already exists at $COMMUNITY_DIR; refreshing checkout."
    git_fetch_with_fallback "$COMMUNITY_DIR" "$COMMUNITY_REPO"
    git -C "$COMMUNITY_DIR" checkout "$COMMUNITY_REF"
    git -C "$COMMUNITY_DIR" pull --ff-only origin "$COMMUNITY_REF"
    return
  fi

  if [[ -e "$COMMUNITY_DIR" ]]; then
    log "Community directory exists but is not a git checkout: $COMMUNITY_DIR"
    exit 1
  fi

  log "Cloning OpenShell-Community into $COMMUNITY_DIR (ref: $COMMUNITY_REF)"
  if ! git_clone_public_then_token "$COMMUNITY_REPO" "$COMMUNITY_DIR" "$COMMUNITY_REF"; then
    log "Unable to clone ${COMMUNITY_REPO}."
    exit 1
  fi
}

resolve_asset_dir() {
  if [[ -n "$ASSET_DIR" && -f "$ASSET_DIR/nv-theme-0.0.1.vsix" ]]; then
    return
  fi

  if [[ -f "$SCRIPT_DIR/nemoclaw-plugin/nv-theme-0.0.1.vsix" ]]; then
    ASSET_DIR="$SCRIPT_DIR/nemoclaw-plugin"
    return
  fi

  if community_repo_has_assets "$COMMUNITY_DIR" && [[ -f "$COMMUNITY_DIR/brev/nemoclaw-plugin/nv-theme-0.0.1.vsix" ]]; then
    ASSET_DIR="$COMMUNITY_DIR/brev/nemoclaw-plugin"
    return
  fi

  clone_or_refresh_community_repo

  if ! community_repo_has_assets "$COMMUNITY_DIR" || [[ ! -f "$COMMUNITY_DIR/brev/nemoclaw-plugin/nv-theme-0.0.1.vsix" ]]; then
    log "Unable to locate brev/nemoclaw-plugin assets in $COMMUNITY_DIR"
    exit 1
  fi

  ASSET_DIR="$COMMUNITY_DIR/brev/nemoclaw-plugin"
}

apt_update_once() {
  if [[ "$APT_UPDATED" -eq 0 ]]; then
    sudo apt-get update
    APT_UPDATED=1
  fi
}

apt_install() {
  apt_update_once
  sudo apt-get install -y "$@"
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

detect_deb_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    *)
      log "Unsupported architecture: $(uname -m)"
      exit 1
      ;;
  esac
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

derive_chat_ui_url() {
  local env_id=""
  local host_name=""

  if [[ -n "${CHAT_UI_URL:-}" ]]; then
    printf '%s\n' "$CHAT_UI_URL"
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

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

ensure_base_packages() {
  local packages=()
  for pkg in ca-certificates curl git gpg iproute2 sudo tar; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
      packages+=("$pkg")
    fi
  done

  if (( ${#packages[@]} > 0 )); then
    log "Installing base packages: ${packages[*]}"
    apt_install "${packages[@]}"
  fi
}

ensure_gh() {
  if command -v gh >/dev/null 2>&1; then
    return
  fi

  log "Installing GitHub CLI..."
  apt_install gh
}

gh_auth_if_needed() {
  if ! command -v gh >/dev/null 2>&1; then
    return
  fi

  if GH_TOKEN="${GITHUB_TOKEN:-}" gh auth status >/dev/null 2>&1; then
    return
  fi

  if [[ -z "$GITHUB_TOKEN" ]]; then
    log "No GitHub token provided; skipping gh auth login."
    return
  fi

  log "Authenticating GitHub CLI from environment token..."
  if ! printf '%s\n' "$GITHUB_TOKEN" | gh auth login --hostname github.com --with-token >/dev/null 2>&1; then
    log "gh auth login failed; continuing with direct HTTPS token auth for git operations."
    return
  fi

  if ! GH_TOKEN="$GITHUB_TOKEN" gh auth status >/dev/null 2>&1; then
    log "gh auth status still reports unauthenticated; continuing with direct HTTPS token auth for git operations."
  fi
}

resolve_ghcr_user() {
  if [[ -n "$GHCR_USER" ]]; then
    return 0
  fi

  if command -v gh >/dev/null 2>&1 && GH_TOKEN="${GITHUB_TOKEN:-}" gh auth status >/dev/null 2>&1; then
    GHCR_USER="$(GH_TOKEN="${GITHUB_TOKEN:-}" gh api user -q .login 2>/dev/null || true)"
  fi

  if [[ -z "$GHCR_USER" ]]; then
    GHCR_USER="${USER:-}"
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

  if [[ -z "$GITHUB_TOKEN" ]]; then
    log "No GitHub token provided; skipping GHCR login."
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    log "Docker not available yet; skipping GHCR login."
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

ensure_node() {
  local node_major=""

  if command -v node >/dev/null 2>&1; then
    node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
  fi

  if command -v npm >/dev/null 2>&1 && [[ -n "$node_major" ]] && (( node_major >= 20 )); then
    log "Node.js already installed: $(node --version)"
    log "npm already installed: $(npm --version)"
    resolve_node_tooling
    return
  fi

  log "Installing Node.js 22..."
  require_cmd curl
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  apt_install nodejs
  resolve_node_tooling
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1; then
    log "Docker already installed."
  else
    log "Installing Docker..."
    apt_install docker.io
  fi

  sudo systemctl enable --now docker
  sudo usermod -aG docker "$TARGET_USER" || true
}

install_cli_from_release() {
  local arch tmpdir repo pattern archive url download_tag

  arch="$(detect_arch)"
  repo="NVIDIA/OpenShell"
  download_tag="$CLI_RELEASE_TAG"
  if [[ "$download_tag" == "devel" ]]; then
    download_tag="dev"
  fi
  pattern="openshell-${arch}-unknown-linux-musl.tar.gz"
  tmpdir="$(mktemp -d)"
  archive="$tmpdir/$pattern"

  if command -v gh >/dev/null 2>&1; then
    if gh release download "$download_tag" --repo "$repo" --pattern "$pattern" --dir "$tmpdir" >/dev/null 2>&1; then
      tar xzf "$archive" -C "$tmpdir"
      sudo install -m 755 "$tmpdir/openshell" /usr/local/bin/openshell
      CLI_BIN="openshell"
      rm -rf "$tmpdir"
      return 0
    fi
  fi

  url="https://github.com/NVIDIA/OpenShell/releases/download/${download_tag}/${pattern}"
  log "Falling back to direct OpenShell release download..."
  if curl -fsSL "$url" -o "$archive"; then
    tar xzf "$archive" -C "$tmpdir"
    sudo install -m 755 "$tmpdir/openshell" /usr/local/bin/openshell
    CLI_BIN="openshell"
    rm -rf "$tmpdir"
    return 0
  fi

  log "Direct asset download failed for tag ${download_tag}; falling back to the official installer script."
  if curl -fsSL https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh -o "$tmpdir/install-openshell.sh"; then
    chmod +x "$tmpdir/install-openshell.sh"
    OPENSHELL_VERSION="$download_tag" OPENSHELL_INSTALL_DIR="$tmpdir/bin" "$tmpdir/install-openshell.sh" >/dev/null 2>&1

    if [[ -x "$tmpdir/bin/openshell" ]]; then
      sudo install -m 755 "$tmpdir/bin/openshell" /usr/local/bin/openshell
      CLI_BIN="openshell"
      rm -rf "$tmpdir"
      return 0
    fi
  fi

  rm -rf "$tmpdir"
  log "Unable to install OpenShell CLI from GitHub releases."
  exit 1
}

ensure_cli() {
  if command -v openshell >/dev/null 2>&1; then
    CLI_BIN="openshell"
    log "Using existing OpenShell CLI: $(command -v openshell)"
    return
  fi

  ensure_gh
  gh_auth_if_needed
  install_cli_from_release
}

clone_plugin_repo() {
  mkdir -p "$(dirname "$PLUGIN_DIR")"

  if [[ -d "$PLUGIN_DIR/.git" ]]; then
    log "Plugin repo already exists at $PLUGIN_DIR; refreshing checkout."
    if ! git_fetch_with_fallback "$PLUGIN_DIR" "$PLUGIN_REPO"; then
      log "Unable to refresh ${PLUGIN_REPO}."
      return 1
    fi
    git -C "$PLUGIN_DIR" checkout "$PLUGIN_REF"
    git -C "$PLUGIN_DIR" pull --ff-only origin "$PLUGIN_REF"
    return 0
  fi

  if [[ -e "$PLUGIN_DIR" ]]; then
    log "Plugin directory exists but is not a git checkout: $PLUGIN_DIR"
    return 1
  fi

  log "Cloning plugin repo into $PLUGIN_DIR"
  if ! git_clone_public_then_token "$PLUGIN_REPO" "$PLUGIN_DIR" "$PLUGIN_REF"; then
    log "Unable to clone ${PLUGIN_REPO}."
    return 1
  fi
  return 0
}

patch_plugin_chat_ui_url() {
  local chat_ui_url dockerfile_path

  dockerfile_path="$PLUGIN_DIR/Dockerfile"
  if [[ ! -f "$dockerfile_path" ]]; then
    log "Plugin Dockerfile not found; skipping CHAT_UI_URL patch: $dockerfile_path"
    return 0
  fi

  chat_ui_url="$(derive_chat_ui_url)"
  if [[ -z "$chat_ui_url" ]]; then
    log "Derived CHAT_UI_URL is empty; skipping plugin Dockerfile patch."
    return 0
  fi

  if ! python3 - "$dockerfile_path" "$chat_ui_url" <<'PY'
import pathlib
import re
import sys

dockerfile = pathlib.Path(sys.argv[1])
chat_ui_url = sys.argv[2]
content = dockerfile.read_text(encoding="utf-8")
updated, count = re.subn(
    r"^ARG CHAT_UI_URL=.*$",
    f"ARG CHAT_UI_URL={chat_ui_url}",
    content,
    count=1,
    flags=re.MULTILINE,
)
if count == 0:
    raise SystemExit(1)
if updated != content:
    dockerfile.write_text(updated, encoding="utf-8")
PY
  then
    log "Failed to patch plugin Dockerfile CHAT_UI_URL in $dockerfile_path"
    return 1
  fi

  log "Patched plugin Dockerfile CHAT_UI_URL to ${chat_ui_url}"
  return 0
}

run_plugin_install_script() {
  if [[ ! -f "$PLUGIN_DIR/install.sh" ]]; then
    log "Plugin install script not found: $PLUGIN_DIR/install.sh"
    return 1
  fi

  log "Plugin installer available at $PLUGIN_DIR/install.sh"
  return 0
}

install_code_server() {
  local deb_arch tmp_deb url

  if command -v code-server >/dev/null 2>&1; then
    log "code-server already installed: $(code-server --version | head -n 1)"
    return
  fi

  deb_arch="$(detect_deb_arch)"
  tmp_deb="$(mktemp /tmp/code-server.XXXXXX.deb)"
  url="https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server_${CODE_SERVER_VERSION}_${deb_arch}.deb"

  log "Installing code-server ${CODE_SERVER_VERSION}..."
  curl -fsSL "$url" -o "$tmp_deb"
  sudo apt-get install -y "$tmp_deb"
  rm -f "$tmp_deb"
}

configure_code_server() {
  local config_dir settings_dir settings_user_dir workspaces_dir workspace_path home_workspace_path
  local terminals_target
  local chat_ui_url install_cmd auth_export terminal_name terminal_desc
  local wrapper_cmd fallback_cmd run_once_marker wrapper_script

  config_dir="$TARGET_HOME/.config/code-server"
  settings_dir="$TARGET_HOME/.local/share/code-server"
  settings_user_dir="$settings_dir/User"
  workspaces_dir="$settings_user_dir/Workspaces"
  workspace_path="$workspaces_dir/nemoclaw-plugin.code-workspace"
  home_workspace_path="$TARGET_HOME/nemoclaw-plugin.code-workspace"
  terminals_target="$TARGET_HOME/.vscode/terminals.json"
  chat_ui_url="$(derive_chat_ui_url)"
  run_once_marker="$TARGET_HOME/.cache/nemoclaw-plugin/install-ran"
  wrapper_script="${ASSET_DIR}/run-plugin-install.sh"
  auth_export=""
  if [[ -n "$OPENCLAW_AUTH_MODE" ]]; then
    auth_export=" export OPENCLAW_AUTH_MODE=\"${OPENCLAW_AUTH_MODE}\" &&"
  fi
  wrapper_cmd="mkdir -p \"${TARGET_HOME}/.cache/nemoclaw-plugin\" && if [[ -f \"${run_once_marker}\" ]]; then printf 'NeMoClaw install autorun already ran. Opening a fresh login shell.\\n\\n'; source ~/.profile >/dev/null 2>&1 || true; source ~/.bashrc >/dev/null 2>&1 || true; exec bash -il; fi; cd ${PLUGIN_DIR} && export CHAT_UI_URL=\"${chat_ui_url}\" && export PLUGIN_DIR=\"${PLUGIN_DIR}\" && export RUN_ONCE_MARKER=\"${run_once_marker}\" &&${auth_export} bash \"${wrapper_script}\""
  install_cmd="${wrapper_cmd}"
  terminal_name="nemoclaw-install"
  terminal_desc="NemoClaw install"
  if [[ "$PLUGIN_INSTALL_READY" != "1" ]]; then
    terminal_name="nemoclaw-install-manual"
    terminal_desc="NemoClaw install command"
    fallback_cmd="export CHAT_UI_URL=\"${chat_ui_url}\" && export PLUGIN_DIR=\"${PLUGIN_DIR}\" && export RUN_ONCE_MARKER=\"${run_once_marker}\" && export PRINT_ONLY=1 &&${auth_export} bash \"${wrapper_script}\""
    install_cmd="${fallback_cmd}"
  fi

  sudo -u "$TARGET_USER" mkdir -p "$config_dir" "$settings_user_dir" "$workspaces_dir" "$TARGET_HOME/.vscode"

  sudo -u "$TARGET_USER" install -m 644 "$ASSET_DIR/nv-theme-0.0.1.vsix" "$config_dir/nv-theme-0.0.1.vsix"
  sudo -u "$TARGET_USER" install -m 644 "$ASSET_DIR/settings.json" "$settings_user_dir/settings.json"
  sudo -u "$TARGET_USER" install -m 644 "$ASSET_DIR/README.md" "$TARGET_HOME/README.md"

  sudo -u "$TARGET_USER" tee "$terminals_target" >/dev/null <<EOF
{
  "autorun": true,
  "terminals": [
    {
      "name": "$(json_escape "$terminal_name")",
      "description": "$(json_escape "$terminal_desc")",
      "open": true,
      "focus": true,
      "commands": [
        "$(json_escape "$install_cmd")"
      ]
    }
  ]
}
EOF

  sudo -u "$TARGET_USER" tee "$config_dir/config.yaml" >/dev/null <<EOF
bind-addr: 0.0.0.0:${CODE_SERVER_PORT}
auth: none
disable-workspace-trust: true
disable-telemetry: true
disable-update-check: true
welcome-text: "Welcome to NeMoClaw Plugin"
app-name: "NeMoClaw Plugin Developer Sandbox"
EOF

  sudo -u "$TARGET_USER" tee "$settings_dir/coder.json" >/dev/null <<EOF
{
  "query": {
    "folder": "${TARGET_HOME}"
  },
  "lastVisited": {
    "url": "${workspace_path}",
    "workspace": true
  }
}
EOF

  sudo -u "$TARGET_USER" tee "$workspace_path" >/dev/null <<EOF
{
  "folders": [
    {
      "name": "Home",
      "path": "${TARGET_HOME}"
    }
  ]
}
EOF

  sudo -u "$TARGET_USER" install -m 644 "$workspace_path" "$home_workspace_path"

  sudo -H -u "$TARGET_USER" env HOME="$TARGET_HOME" code-server --install-extension "$config_dir/nv-theme-0.0.1.vsix" --force >/dev/null
  sudo -H -u "$TARGET_USER" env HOME="$TARGET_HOME" code-server --install-extension fabiospampinato.vscode-terminals --force >/dev/null
}

enable_code_server_service() {
  sudo systemctl daemon-reload
  sudo systemctl enable "code-server@${TARGET_USER}"
  sudo systemctl restart "code-server@${TARGET_USER}"

  if ! wait_for_tcp_port "$CODE_SERVER_PORT" 30; then
    log "code-server did not open port ${CODE_SERVER_PORT} within 30 seconds."
    sudo systemctl status "code-server@${TARGET_USER}" --no-pager || true
    exit 1
  fi
}

print_next_steps() {
  log "Launch log: $LAUNCH_LOG"
  log "Plugin repo: $PLUGIN_DIR"
  log "OpenClaw UI origin: $(derive_chat_ui_url)"
  log "code-server URL: http://$(hostname -f 2>/dev/null || hostname):${CODE_SERVER_PORT}"
  log "code-server service: journalctl -u code-server@${TARGET_USER} -f"
  if [[ "$PLUGIN_INSTALL_READY" == "1" ]]; then
    log "Next step: open code-server and complete the interactive install in the auto-opened terminal"
  else
    log "Next step: open code-server and use the auto-opened terminal command once plugin repo access is fixed"
  fi
}

main() {
  require_non_root
  require_cmd getent
  require_cmd id
  require_cmd sudo

  step "Installing base dependencies"
  ensure_base_packages

  step "Installing runtime prerequisites"
  ensure_docker
  ensure_gh
  gh_auth_if_needed
  docker_login_ghcr_if_needed

  step "Installing OpenShell CLI"
  ensure_cli

  step "Resolving launch assets"
  resolve_asset_dir

  step "Cloning plugin repo"
  if ! clone_plugin_repo; then
    log "Plugin repository is unavailable. Continuing in manual-command mode."
  elif ! patch_plugin_chat_ui_url; then
    log "Unable to patch plugin Dockerfile CHAT_UI_URL. Continuing with the repo default."
  fi

  step "Preparing plugin installer"
  if run_plugin_install_script; then
    PLUGIN_INSTALL_READY=1
  else
    log "Plugin installer is unavailable. The terminal will print the intended install command instead of running it."
  fi

  step "Installing code-server"
  install_code_server
  configure_code_server
  enable_code_server_service

  step "Ready"
  print_next_steps
}

main "$@"
