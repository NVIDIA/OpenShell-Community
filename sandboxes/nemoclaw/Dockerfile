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

ENV NO_PROXY=127.0.0.1,localhost,::1
ENV no_proxy=127.0.0.1,localhost,::1

RUN apt-get update && \
    apt-get install -y --no-install-recommends jq && \
    rm -rf /var/lib/apt/lists/*

# Override the startup script with our version (adds runtime API key injection)
COPY nemoclaw-start.sh /usr/local/bin/nemoclaw-start
RUN chmod +x /usr/local/bin/nemoclaw-start

# Install the policy reverse proxy (sits in front of the OpenClaw gateway,
# intercepts /api/policy to read/write the sandbox policy file) and its
# runtime dependencies for gRPC gateway sync.
COPY policy-proxy.js /usr/local/lib/policy-proxy.js
COPY proto/ /usr/local/lib/nemoclaw-proto/
RUN npm install -g @grpc/grpc-js @grpc/proto-loader js-yaml

# Install LiteLLM proxy for streaming-capable local LLM inference routing.
# LiteLLM handles SSE streaming natively, bypassing the sandbox proxy's
# inference interception path which buffers responses and times out.
RUN python3 -m pip install --no-cache-dir --break-system-packages 'litellm[proxy]'

# Fix @hono/node-server authorization bypass (GHSA-wc8c-qw6v-h7f6)
RUN npm install -g @hono/node-server@1.19.11

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

# Fix transitive tar vulnerabilities (GHSA-qffp-2rhf-9h96,
# GHSA-9ppj-qmqm-q256, GHSA-8qq5-rm4j-mr97, GHSA-r6q2-hw4h-h46w,
# GHSA-34x7-hfp2-rc4v, GHSA-83g3-92jg-28cx).
# The base image pins tar@7.5.11 globally, but openclaw ships older nested
# copies; force-upgrade them. (npm's own bundled tar is not updatable via
# --prefix without pulling missing internal deps like @npmcli/docs.)
RUN npm install -g tar@7.5.11 && \
    npm --prefix "$(npm root -g)/openclaw" update tar

ENTRYPOINT ["/bin/bash"]
