#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

#
# install.sh — Install the NeMoClaw DevX extension into an OpenClaw UI tree.
#
# Usage:
#   bash install.sh /path/to/openclaw/ui
#   bash install.sh                        # uses ../openclaw/ui relative to repo
#
set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[0;90m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_SRC="$SCRIPT_DIR/extension"
ENV_FILE="$SCRIPT_DIR/.env"

UI_DIR="${1:-}"
if [ -z "$UI_DIR" ]; then
  # Try common sibling location
  if [ -f "$SCRIPT_DIR/../openclaw/ui/src/main.ts" ]; then
    UI_DIR="$(cd "$SCRIPT_DIR/../openclaw/ui" && pwd)"
  else
    echo -e "${RED}Error:${RESET} No UI directory specified."
    echo "  Usage: bash install.sh /path/to/openclaw/ui"
    exit 1
  fi
fi

MAIN_TS="$UI_DIR/src/main.ts"
TARGET_EXT="$UI_DIR/src/extensions/nemoclaw-devx"
IMPORT_LINE='import "./extensions/nemoclaw-devx/index.ts";'

echo -e "${GREEN}NeMoClaw DevX Extension Installer${RESET}"
echo -e "${DIM}─────────────────────────────${RESET}"

# --- Verify targets ---
if [ ! -f "$MAIN_TS" ]; then
  echo -e "${RED}Error:${RESET} Cannot find $MAIN_TS"
  echo "  Make sure the path points to the openclaw/ui directory."
  exit 1
fi

if [ ! -f "$EXT_SRC/index.ts" ]; then
  echo -e "${RED}Error:${RESET} Extension source files not found at $EXT_SRC/"
  echo "  The repo appears incomplete."
  exit 1
fi

# --- Load .env ---
if [ ! -f "$ENV_FILE" ]; then
  echo -e "${RED}Error:${RESET} .env file not found at $ENV_FILE"
  echo "  Copy .env.example to .env and fill in your API keys."
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [ -z "${NVIDIA_INFERENCE_API_KEY:-}" ] || [ "$NVIDIA_INFERENCE_API_KEY" = "your-key-here" ]; then
  echo -e "${RED}Error:${RESET} NVIDIA_INFERENCE_API_KEY is not set in .env"
  echo "  Edit $ENV_FILE and provide your inference-api.nvidia.com key."
  exit 1
fi

if [ -z "${NVIDIA_INTEGRATE_API_KEY:-}" ] || [ "$NVIDIA_INTEGRATE_API_KEY" = "your-key-here" ]; then
  echo -e "${RED}Error:${RESET} NVIDIA_INTEGRATE_API_KEY is not set in .env"
  echo "  Edit $ENV_FILE and provide your integrate.api.nvidia.com key."
  exit 1
fi

echo -e "  Repo:          ${DIM}$SCRIPT_DIR${RESET}"
echo -e "  UI directory:  ${DIM}$UI_DIR${RESET}"

# --- Copy extension files ---
mkdir -p "$TARGET_EXT"
cp "$EXT_SRC"/* "$TARGET_EXT/"

FILE_COUNT=$(find "$TARGET_EXT" -type f | wc -l | tr -d ' ')
echo -e "  Copied files:  ${GREEN}$FILE_COUNT${RESET} -> $TARGET_EXT/"

# --- Substitute API key placeholders ---
REGISTRY="$TARGET_EXT/model-registry.ts"
KEYS_INJECTED=0

if grep -q '__NVIDIA_INFERENCE_API_KEY__' "$REGISTRY" 2>/dev/null; then
  sed -i "s|__NVIDIA_INFERENCE_API_KEY__|${NVIDIA_INFERENCE_API_KEY}|g" "$REGISTRY"
  KEYS_INJECTED=$((KEYS_INJECTED + 1))
fi

if grep -q '__NVIDIA_INTEGRATE_API_KEY__' "$REGISTRY" 2>/dev/null; then
  sed -i "s|__NVIDIA_INTEGRATE_API_KEY__|${NVIDIA_INTEGRATE_API_KEY}|g" "$REGISTRY"
  KEYS_INJECTED=$((KEYS_INJECTED + 1))
fi

if [ "$KEYS_INJECTED" -gt 0 ]; then
  echo -e "  API keys:      ${GREEN}${KEYS_INJECTED} injected${RESET}"
else
  echo -e "  API keys:      ${DIM}no placeholders found (already set?)${RESET}"
fi

# --- Patch main.ts ---
if grep -qF "$IMPORT_LINE" "$MAIN_TS" 2>/dev/null; then
  echo -e "  main.ts:       ${DIM}already patched (skipping)${RESET}"
else
  echo "$IMPORT_LINE" >> "$MAIN_TS"
  echo -e "  main.ts:       ${GREEN}patched${RESET} — added import line"
fi

echo ""
echo -e "${GREEN}Done!${RESET} NeMoClaw DevX extension is installed."
echo ""
echo "  To build:     cd $UI_DIR && pnpm build"
echo "  To dev:       cd $UI_DIR && pnpm dev"
echo "  To uninstall: bash $SCRIPT_DIR/uninstall.sh $UI_DIR"
