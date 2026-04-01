#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Local test script for the cursor-desktop sandbox.
# Builds the Docker image and runs it with port 6080 forwarded to localhost.
#
# Run from the repo root (use bash, not cmd):
#   bash sandboxes/cursor-desktop/scripts/local-test.sh
#
# Windows + Docker Desktop: run inside WSL (same distro that has Docker integration
# enabled in Docker Desktop → Settings → Resources → WSL integration). Running from
# Git Bash or cmd without WSL may fail to find docker or hit CRLF/shebang issues if
# scripts were checked out with Windows line endings.
#
# After the stack is up, open http://localhost:6080/index.html (or ${NOVNC_PORT}).
# Ctrl-C stops the container (--rm removes it).

set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
    echo "error: docker not found in PATH." >&2
    echo "  On WSL + Docker Desktop: enable your distro under Settings → Resources → WSL integration, then open a new shell in that WSL distro and retry." >&2
    exit 1
fi

SANDBOX_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE_NAME="openshell-cursor-desktop-test"
CONTAINER_NAME="cursor-desktop-test"
CURSOR_VERSION="${CURSOR_VERSION:-2.6}"
NOVNC_PORT="${NOVNC_PORT:-6080}"

echo ""
echo "=== cursor-desktop local test ==="
echo "  Image:          ${IMAGE_NAME}:${CURSOR_VERSION} (also tagged :latest)"
echo "  Container name: ${CONTAINER_NAME}"
echo "  Cursor version: ${CURSOR_VERSION}"
echo "  noVNC port:     ${NOVNC_PORT}"
echo ""

# ── Cleanup from a previous run ───────────────────────────────────────────────
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "[1/3] Removing existing test container..."
    docker rm -f "$CONTAINER_NAME"
fi

# ── Build ─────────────────────────────────────────────────────────────────────
echo "[1/3] Building image (this may take a few minutes on first run)..."
# --platform linux/amd64: Cursor only ships x64 Linux packages; this enables
# Rosetta 2 emulation on Apple Silicon (M-series) Macs transparently.
docker build \
    --platform linux/amd64 \
    --build-arg "CURSOR_VERSION=${CURSOR_VERSION}" \
    --tag "${IMAGE_NAME}:${CURSOR_VERSION}" \
    --tag "${IMAGE_NAME}:latest" \
    "$SANDBOX_DIR"

echo ""
echo "[2/3] Build complete. Starting container..."

# ── Run ───────────────────────────────────────────────────────────────────────
docker run \
    --platform linux/amd64 \
    --name "$CONTAINER_NAME" \
    --rm \
    --publish "${NOVNC_PORT}:${NOVNC_PORT}" \
    --shm-size 2g \
    "${IMAGE_NAME}:${CURSOR_VERSION}"

# ── The above is blocking (--rm). Ctrl-C triggers container removal. ──────────
