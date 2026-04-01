#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Install the Cursor Linux .deb package.
# Called during `docker build` with CURSOR_VERSION set as a build argument.
#
# Download URL: https://api2.cursor.sh/updates/download/golden/linux-x64-deb/cursor/<version>
#
# NOTE: Cursor only ships x64 Linux packages. Build the image with
# --platform linux/amd64 on Apple Silicon (see local-test.sh).

set -euo pipefail

: "${CURSOR_VERSION:?CURSOR_VERSION build argument must be set}"

CURSOR_DL_URL="https://api2.cursor.sh/updates/download/golden/linux-x64-deb/cursor/${CURSOR_VERSION}"
TMP_DEB="/tmp/cursor.deb"

echo "[install-cursor] Downloading Cursor ${CURSOR_VERSION}..."
echo "[install-cursor] URL: ${CURSOR_DL_URL}"
curl -fsSL -L --max-time 180 "$CURSOR_DL_URL" -o "$TMP_DEB"

# Verify the downloaded file is actually a Debian package before trying to install.
if ! file "$TMP_DEB" | grep -q "Debian binary package"; then
    echo "[install-cursor] ERROR: downloaded file is not a .deb package." >&2
    echo "[install-cursor] First 256 bytes:" >&2
    head -c 256 "$TMP_DEB" >&2
    exit 1
fi

echo "[install-cursor] Installing (apt handles dependencies automatically)..."
# apt-get install on a local path resolves and installs all dependencies in one pass.
apt-get install -y "$TMP_DEB"

rm -f "$TMP_DEB"
rm -rf /var/lib/apt/lists/*

# Verify the binary is reachable after install.
CURSOR_BIN="$(command -v cursor 2>/dev/null \
    || find /opt /usr/local/bin /usr/bin -maxdepth 3 -name cursor -type f 2>/dev/null \
    | head -1 || true)"

if [ -z "$CURSOR_BIN" ]; then
    echo "[install-cursor] ERROR: cursor binary not found after install." >&2
    echo "[install-cursor] Installed files:" >&2
    dpkg -L cursor 2>/dev/null || true
    exit 1
fi

INSTALLED_VERSION="$(dpkg-query -W -f='${Version}' cursor 2>/dev/null || echo 'unknown')"
echo "[install-cursor] Cursor ${INSTALLED_VERSION} installed at ${CURSOR_BIN}."
