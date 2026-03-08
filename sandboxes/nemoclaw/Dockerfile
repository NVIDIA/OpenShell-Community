# syntax=docker/dockerfile:1.4

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# NeMoClaw sandbox image
#
# Builds on the OpenClaw sandbox and adds the NeMoClaw DevX UI extension
# (model selector, deploy modal, API keys page, nav group).
#
# Build:  docker build -t nemoclaw .
# Run:    nemoclaw sandbox create --from nemoclaw --forward 18789 -- nemoclaw-start

ARG BASE_IMAGE=ghcr.io/nvidia/nemoclaw-community/sandboxes/openclaw:latest
FROM ${BASE_IMAGE}

USER root

# Override the startup script with our version (adds runtime API key injection)
COPY nemoclaw-start.sh /usr/local/bin/nemoclaw-start
RUN chmod +x /usr/local/bin/nemoclaw-start

# Stage the NeMoClaw DevX extension source
COPY nemoclaw-ui-extension/extension/ /opt/nemoclaw-devx/

# Bundle the extension with esbuild and inject into the pre-built OpenClaw UI.
# The openclaw npm package ships a pre-built SPA at dist/control-ui/; there is
# no TypeScript source tree to patch, so we bundle the extension separately and
# add <script>/<link> tags to index.html.
# API key placeholders (__NVIDIA_*_API_KEY__) stay as literal strings in the
# bundle; they are substituted at container startup from environment variables.
RUN set -e; \
    npm install -g esbuild; \
    UI_DIR="$(npm root -g)/openclaw/dist/control-ui"; \
    esbuild /opt/nemoclaw-devx/index.ts \
      --bundle \
      --format=esm \
      --outfile="$UI_DIR/assets/nemoclaw-devx.js"; \
    HASH=$(md5sum "$UI_DIR/assets/nemoclaw-devx.js" | cut -c1-8); \
    sed -i "s|</head>|<link rel=\"stylesheet\" href=\"./assets/nemoclaw-devx.css?v=${HASH}\">\n</head>|" "$UI_DIR/index.html"; \
    sed -i "s|</head>|<script type=\"module\" src=\"./assets/nemoclaw-devx.js?v=${HASH}\"></script>\n</head>|" "$UI_DIR/index.html"; \
    npm uninstall -g esbuild

ENTRYPOINT ["/bin/bash"]
