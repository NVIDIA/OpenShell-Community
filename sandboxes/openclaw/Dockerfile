# syntax=docker/dockerfile:1.4

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# OpenClaw sandbox image for OpenShell
#
# Builds on the community base sandbox and adds OpenClaw with Slack
# Socket Mode support (WebSocket proxy patch) and expanded network policies.
#
# Build:  docker build -t openshell-openclaw --build-arg BASE_IMAGE=openshell-base .
# Run:    openshell sandbox create --from openclaw

ARG BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest
FROM ${BASE_IMAGE}

USER root

# Install OpenClaw CLI
RUN npm install -g openclaw@latest

# Copy sandbox policy
COPY policy.yaml /etc/openshell/policy.yaml

# Copy the WebSocket proxy patch (required for Slack Socket Mode behind
# the OpenShell CONNECT proxy — see README.md for details)
COPY openclaw-ws-proxy-patch.js /sandbox/openclaw-ws-proxy-patch.js

# Copy the Slack app manifest for one-click app creation
COPY openclaw-slack-manifest.yaml /sandbox/openclaw-slack-manifest.yaml

# Auto-load the WS proxy patch in every Node.js process
ENV NODE_OPTIONS="--require /sandbox/openclaw-ws-proxy-patch.js"

# Copy the OpenClaw startup helper
COPY openclaw-start.sh /usr/local/bin/openclaw-start
RUN chmod +x /usr/local/bin/openclaw-start

# Create OpenClaw workspace
RUN mkdir -p /sandbox/.openclaw && \
    chown -R sandbox:sandbox /sandbox/.openclaw

USER sandbox

ENTRYPOINT ["/bin/bash"]
