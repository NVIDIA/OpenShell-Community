#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

#
# uninstall.sh — Remove the NeMoClaw DevX extension from an OpenClaw UI tree.
#
# Usage:
#   bash uninstall.sh /path/to/openclaw/ui
#   bash uninstall.sh                        # uses ../openclaw/ui relative to repo
#
set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[0;90m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

UI_DIR="${1:-}"
if [ -z "$UI_DIR" ]; then
  if [ -f "$SCRIPT_DIR/../openclaw/ui/src/main.ts" ]; then
    UI_DIR="$(cd "$SCRIPT_DIR/../openclaw/ui" && pwd)"
  else
    echo -e "${RED}Error:${RESET} No UI directory specified."
    echo "  Usage: bash uninstall.sh /path/to/openclaw/ui"
    exit 1
  fi
fi

MAIN_TS="$UI_DIR/src/main.ts"
TARGET_EXT="$UI_DIR/src/extensions/nemoclaw-devx"
IMPORT_LINE='import "./extensions/nemoclaw-devx/index.ts";'

echo -e "${GREEN}NeMoClaw DevX Extension Uninstaller${RESET}"
echo -e "${DIM}───────────────────────────────${RESET}"

# --- Remove extension directory ---
if [ -d "$TARGET_EXT" ]; then
  rm -rf "$TARGET_EXT"
  echo -e "  Extension dir: ${GREEN}removed${RESET}"
else
  echo -e "  Extension dir: ${DIM}not found (already removed?)${RESET}"
fi

# Clean up empty parent if it exists
EXTENSIONS_DIR="$UI_DIR/src/extensions"
if [ -d "$EXTENSIONS_DIR" ] && [ -z "$(ls -A "$EXTENSIONS_DIR" 2>/dev/null)" ]; then
  rmdir "$EXTENSIONS_DIR" 2>/dev/null || true
  echo -e "  extensions/:   ${DIM}removed empty directory${RESET}"
fi

# --- Remove import from main.ts ---
if [ -f "$MAIN_TS" ]; then
  if grep -qF "$IMPORT_LINE" "$MAIN_TS" 2>/dev/null; then
    grep -vF "$IMPORT_LINE" "$MAIN_TS" > "$MAIN_TS.tmp" && mv "$MAIN_TS.tmp" "$MAIN_TS"
    echo -e "  main.ts:       ${GREEN}cleaned${RESET} — removed import line"
  else
    echo -e "  main.ts:       ${DIM}no import line found (already clean?)${RESET}"
  fi
else
  echo -e "  main.ts:       ${DIM}not found${RESET}"
fi

echo ""
echo -e "${GREEN}Done!${RESET} NeMoClaw DevX extension has been uninstalled."
echo ""
echo "  Rebuild with:  cd $UI_DIR && pnpm build"
