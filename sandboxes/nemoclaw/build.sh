#!/usr/bin/env bash
# Sync the UI extension source and launch a NemoClaw sandbox.
#
# Usage (from repo root):
#   bash sandboxes/nemoclaw-launchable-ui/build.sh [extra nemoclaw args...]
#
# The canonical extension source lives at brev/nemoclaw-ui-extension/extension/.
# This script copies it into the sandbox directory so the Dockerfile build
# context can reach it, then delegates to `nemoclaw sandbox create`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Syncing UI extension into build context..."
rm -rf "$SCRIPT_DIR/nemoclaw-devx"
cp -r "$REPO_ROOT/brev/nemoclaw-ui-extension/extension" "$SCRIPT_DIR/nemoclaw-devx"

echo "Creating sandbox..."
exec nemoclaw sandbox create --from "$SCRIPT_DIR" "$@"
