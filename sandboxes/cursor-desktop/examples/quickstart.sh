#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Quick-start example for the cursor-desktop sandbox.
# Run this from the root of your openshell-community clone.
#
# Prerequisites:
#   - openshell CLI installed and a gateway running (openshell gateway start)
#   - Docker available locally (for the initial image build)
#
# Usage:
#   bash sandboxes/cursor-desktop/examples/quickstart.sh [local-project-dir]

set -euo pipefail

SANDBOX_NAME="cursor-desktop"
NOVNC_PORT=6080
PROJECT_DIR="${1:-}"

echo ""
echo "=== cursor-desktop quick start ==="
echo ""

# ── 1. Create the sandbox with the noVNC port forwarded ───────────────────────
echo "[1/3] Creating sandbox '${SANDBOX_NAME}' with port ${NOVNC_PORT} forwarded..."
openshell sandbox create \
    --from "./sandboxes/${SANDBOX_NAME}" \
    --forward "${NOVNC_PORT}"

# ── 2. (Optional) Upload a local project into the workspace ───────────────────
if [ -n "$PROJECT_DIR" ]; then
    PROJECT_NAME="$(basename "$PROJECT_DIR")"
    echo "[2/3] Uploading '${PROJECT_DIR}' to /sandbox/workspace/${PROJECT_NAME}..."
    openshell upload "$PROJECT_DIR" "/sandbox/workspace/${PROJECT_NAME}"
else
    echo "[2/3] No local project specified — Cursor will open an empty workspace."
    echo "      To upload a project later:"
    echo "        openshell upload ./my-project /sandbox/workspace/my-project"
fi

# ── 3. Open the browser ───────────────────────────────────────────────────────
echo "[3/3] Sandbox ready!"
echo ""
echo "  Open your browser at: http://localhost:${NOVNC_PORT}/index.html"
echo ""
echo "  Useful commands:"
echo "    openshell logs --tail              # stream sandbox logs"
echo "    openshell policy set ./sandboxes/${SANDBOX_NAME}/policy.yaml  # hot-reload policy"
echo ""
