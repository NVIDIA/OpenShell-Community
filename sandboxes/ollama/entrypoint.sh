#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Entrypoint for Ollama sandbox — auto-starts Ollama server
set -euo pipefail

# Export OLLAMA_HOST for OpenShell provider discovery
export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"

# Update Ollama if requested
if [ "${OLLAMA_UPDATE:-0}" = "1" ]; then
    echo "[ollama] Updating to latest version..."
    update-ollama
fi

# Start Ollama server in background
echo "[ollama] Starting Ollama server..."
nohup ollama serve > /tmp/ollama.log 2>&1 &
OLLAMA_PID=$!

# Wait for server to be ready
echo "[ollama] Waiting for server to be ready..."
for i in {1..60}; do
    if curl -fsSL http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
        echo "[ollama] Server ready at http://127.0.0.1:11434"
        break
    fi
    if ! kill -0 $OLLAMA_PID 2>/dev/null; then
        echo "[ollama] Server failed to start. Check /tmp/ollama.log"
        exit 1
    fi
    sleep 1
done

# Pull default model if specified and not already present
if [ -n "${OLLAMA_DEFAULT_MODEL:-}" ]; then
    if ! ollama list | grep -q "^${OLLAMA_DEFAULT_MODEL}"; then
        echo "[ollama] Pulling model: ${OLLAMA_DEFAULT_MODEL}"
        ollama pull "${OLLAMA_DEFAULT_MODEL}"
        echo "[ollama] Model ${OLLAMA_DEFAULT_MODEL} ready"
    fi
fi

# Print connection info
echo ""
echo "========================================"
echo "Ollama sandbox ready!"
echo "  API:   http://127.0.0.1:11434"
echo "  Logs:  /tmp/ollama.log"
echo "  PID:   ${OLLAMA_PID}"
if [ -n "${OLLAMA_DEFAULT_MODEL:-}" ]; then
    echo "  Model: ${OLLAMA_DEFAULT_MODEL}"
fi
echo "========================================"
echo ""

# Execute the provided command or start an interactive shell
if [ $# -eq 0 ]; then
    exec /bin/bash -l
else
    exec "$@"
fi
