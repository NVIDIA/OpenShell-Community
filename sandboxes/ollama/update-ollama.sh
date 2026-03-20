#!/usr/bin/env bash

# SPDX-License-Identifier: Apache-2.0

# Update Ollama inside the sandbox.
# Usage: update-ollama [VERSION]
#   update-ollama          # install latest
#   update-ollama 0.18.1   # install specific version
set -euo pipefail

OLLAMA_BIN="/sandbox/bin/ollama"
VERSION="${1:-}"

ARCH=$(uname -m)
case "$ARCH" in
    x86_64)  ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    arm64)   ARCH="arm64" ;;
    *)       echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

CURRENT=$("$OLLAMA_BIN" --version 2>&1 | grep -oP 'version is \K[0-9.]+' || echo "unknown")

if [ -n "$VERSION" ]; then
    URL="https://github.com/ollama/ollama/releases/download/v${VERSION}/ollama-linux-${ARCH}.tar.zst"
    echo "Current version: ${CURRENT}"
    echo "Downloading ollama v${VERSION} for linux/${ARCH}..."
else
    URL="https://ollama.com/download/ollama-linux-${ARCH}.tar.zst"
    echo "Current version: ${CURRENT}"
    echo "Downloading latest ollama for linux/${ARCH}..."
fi

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsSL "$URL" -o "$TMPDIR/ollama.tar.zst"
tar --zstd -xf "$TMPDIR/ollama.tar.zst" -C "$TMPDIR"

mv "$TMPDIR/bin/ollama" "$OLLAMA_BIN"
chmod +x "$OLLAMA_BIN"

NEW=$("$OLLAMA_BIN" --version 2>&1 | grep -oP 'version is \K[0-9.]+' || echo "unknown")

echo "Updated: ${CURRENT} -> ${NEW}"
echo "Restart the Ollama server to use the new version:"
echo "  pkill ollama; nohup ollama serve > /tmp/ollama.log 2>&1 &"
