#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Health check for the cursor-desktop sandbox.
# Verifies that the noVNC web bridge is accepting TCP connections.
# netcat-openbsd is installed in the Dockerfile for this purpose.

set -euo pipefail

NOVNC_PORT="${NOVNC_PORT:-6080}"
nc -z localhost "$NOVNC_PORT"
