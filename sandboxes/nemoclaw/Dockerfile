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

ARG BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/openclaw:latest
FROM ${BASE_IMAGE}

USER root

# Override the startup script with our version (adds runtime API key injection)
COPY nemoclaw-start.sh /usr/local/bin/nemoclaw-start
RUN chmod +x /usr/local/bin/nemoclaw-start

# Install the policy reverse proxy (sits in front of the OpenClaw gateway,
# intercepts /api/policy to read/write the sandbox policy file) and its
# runtime dependencies for gRPC gateway sync.
COPY policy-proxy.js /usr/local/lib/policy-proxy.js
COPY proto/ /usr/local/lib/nemoclaw-proto/
RUN npm install -g @grpc/grpc-js @grpc/proto-loader js-yaml

# Allow the sandbox user to read the default policy (the startup script
# copies it to a writable location; this chown covers non-Landlock envs)
RUN chown -R sandbox:sandbox /etc/navigator

# Stage the NeMoClaw DevX extension source
COPY nemoclaw-ui-extension/extension/ /opt/nemoclaw-devx/

# Bundle the extension with esbuild and inject into the pre-built OpenClaw UI.
# The openclaw npm package ships a pre-built SPA at dist/control-ui/; there is
# no TypeScript source tree to patch, so we bundle the extension separately and
# add <script>/<link> tags to index.html.
# API key placeholders (__NVIDIA_*_API_KEY__) stay as literal strings in the
# bundle; they are substituted at container startup from environment variables.
# js-yaml is installed locally so esbuild can bundle it for browser-side YAML
# parsing in the policy page; the node_modules are removed after bundling.
RUN set -e; \
    npm install -g esbuild; \
    cd /opt/nemoclaw-devx && npm install --production; \
    UI_DIR="$(npm root -g)/openclaw/dist/control-ui"; \
    esbuild /opt/nemoclaw-devx/index.ts \
      --bundle \
      --format=esm \
      --outfile="$UI_DIR/assets/nemoclaw-devx.js"; \
    HASH=$(md5sum "$UI_DIR/assets/nemoclaw-devx.js" | cut -c1-8); \
    sed -i "s|</head>|<link rel=\"stylesheet\" href=\"./assets/nemoclaw-devx.css?v=${HASH}\">\n</head>|" "$UI_DIR/index.html"; \
    sed -i "s|</head>|<script type=\"module\" src=\"./assets/nemoclaw-devx.js?v=${HASH}\"></script>\n</head>|" "$UI_DIR/index.html"; \
    npm uninstall -g esbuild; \
    rm -rf /opt/nemoclaw-devx/node_modules

ENTRYPOINT ["/bin/bash"]
