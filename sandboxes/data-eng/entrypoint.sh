#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Entrypoint for data-eng sandbox — prints installed tool versions on start
set -euo pipefail

echo "[data-eng] Installed tool versions:"
echo "  python:  $(python --version 2>&1)"
echo "  duckdb:  $(python -c 'import duckdb; print(duckdb.__version__)')"
echo "  pandas:  $(python -c 'import pandas; print(pandas.__version__)')"
echo "  pyarrow: $(python -c 'import pyarrow; print(pyarrow.__version__)')"
echo "  httpx:   $(python -c 'import httpx; print(httpx.__version__)')"
echo ""
echo "========================================"
echo "Data engineering sandbox ready!"
echo "========================================"
echo ""

if [ $# -eq 0 ]; then
    exec /bin/bash -l
else
    exec "$@"
fi
