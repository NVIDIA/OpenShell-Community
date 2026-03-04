#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# ratchet-start — Start the capability ratchet sidecar.
# Designed for NemoClaw sandboxes.
#
# Usage:
#   nemoclaw sandbox create --from capability-ratchet -- ratchet-start
set -euo pipefail

# Start bash-ast server in background (provides AST parsing over Unix socket)
bash-ast --server /tmp/bash-ast.sock &
BASH_AST_PID=$!

# Give bash-ast a moment to start
sleep 0.2

# Start ratchet sidecar
capability-ratchet-sidecar --config /app/ratchet-config.yaml &
SIDECAR_PID=$!

# Wait for sidecar to be ready
echo "Waiting for capability ratchet sidecar to start..."
for i in $(seq 1 50); do
    if curl -sf http://127.0.0.1:4001/health > /dev/null 2>&1; then
        break
    fi
    sleep 0.1
done

if curl -sf http://127.0.0.1:4001/health > /dev/null 2>&1; then
    echo ""
    echo "Capability Ratchet sidecar is running."
    echo "  Endpoint: http://127.0.0.1:4001/v1/chat/completions"
    echo "  Health:   http://127.0.0.1:4001/health"
    echo "  PIDs:     bash-ast=${BASH_AST_PID} sidecar=${SIDECAR_PID}"
    echo ""
else
    echo "Warning: sidecar health check failed after 5s" >&2
fi
