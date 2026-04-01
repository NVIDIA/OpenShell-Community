#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Smoke test for the cursor-desktop sandbox.
# Run this inside a running sandbox to verify all services are healthy.
# Usage:  openshell sandbox exec cursor-desktop -- /sandbox/scripts/smoke-test.sh

set -euo pipefail

PASS=0
FAIL=0

check() {
    local label="$1"
    local cmd="$2"
    if eval "$cmd" >/dev/null 2>&1; then
        echo "  ✓  $label"
        PASS=$((PASS + 1))
    else
        echo "  ✗  $label"
        FAIL=$((FAIL + 1))
    fi
}

echo ""
echo "=== cursor-desktop smoke test ==="
echo ""

check "Xvfb responding on display :1"  "xdpyinfo -display :1"
check "x11vnc listening on port 5901"  "nc -z localhost 5901"
check "noVNC listening on port 6080"   "nc -z localhost 6080"
check "Cursor process running"         "pgrep -f 'cursor' -u sandbox"
check "Workspace directory exists"     "test -d /sandbox/workspace"
check "Policy file present"            "test -f /etc/openshell/policy.yaml"

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed."
echo ""

[ "$FAIL" -eq 0 ]
