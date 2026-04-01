#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Local test script for the cursor-desktop sandbox.
# Builds the Docker image and runs it with port 6080 forwarded to localhost.
# Run this from the root of the openshell-community repo:
#
#   bash sandboxes/cursor-desktop/scripts/local-test.sh
#
# After ~30 seconds, open http://localhost:6080 in your browser.
# Ctrl-C to stop and clean up.

set -euo pipefail

SANDBOX_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE_NAME="openshell-cursor-desktop-test"
CONTAINER_NAME="cursor-desktop-test"
CURSOR_VERSION="${CURSOR_VERSION:-2.6}"
NOVNC_PORT="${NOVNC_PORT:-6080}"

echo ""
echo "=== cursor-desktop local test ==="
echo "  Image:          ${IMAGE_NAME}"
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
    "${IMAGE_NAME}:latest"

# ── The above is blocking (--rm). Ctrl-C triggers container removal. ──────────
