# syntax=docker/dockerfile:1

# SPDX-FileCopyrightText: Copyright (c) 2026 agent-0x
# SPDX-License-Identifier: Apache-2.0

# OpenShell Reach sandbox
#
# Provides the reach CLI for AI-native remote server management.
# Reach replaces SSH with HTTPS+Token, purpose-built for AI agents.
#
# Build:  docker build -t openshell-reach .

FROM ghcr.io/nvidia/openshell-community/base:latest

ARG REACH_VERSION=0.2.0
ARG TARGETARCH=amd64

# Install reach binary
RUN curl -fsSL "https://github.com/agent-0x/reach/releases/download/v${REACH_VERSION}/reach_${REACH_VERSION}_linux_${TARGETARCH}.tar.gz" \
    -o /tmp/reach.tar.gz \
    && tar xzf /tmp/reach.tar.gz -C /tmp \
    && mv /tmp/reach /usr/local/bin/reach \
    && chmod +x /usr/local/bin/reach \
    && rm /tmp/reach.tar.gz

# Verify installation
RUN reach --help > /dev/null

# Create reach config directory for sandbox user
RUN mkdir -p /sandbox/.reach && chown sandbox:sandbox /sandbox/.reach

USER sandbox
WORKDIR /sandbox
