# syntax=docker/dockerfile:1.4

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# OpenClaw sandbox image for OpenShell
#
# Builds on the community base sandbox and adds OpenClaw.
# Build:  docker build -t openshell-openclaw --build-arg BASE_IMAGE=openshell-base .
# Run:    openshell sandbox create --from openclaw

ARG BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest
FROM ${BASE_IMAGE}

USER root

# Install OpenClaw CLI
RUN npm install -g openclaw

# Copy sandbox policy
COPY policy.yaml /etc/navigator/policy.yaml

# Copy the OpenClaw startup helper
COPY openclaw-start.sh /usr/local/bin/openclaw-start
RUN chmod +x /usr/local/bin/openclaw-start

# Create OpenClaw workspace
RUN mkdir -p /sandbox/.openclaw && \
    chown -R sandbox:sandbox /sandbox/.openclaw

USER sandbox

ENTRYPOINT ["/bin/bash"]
