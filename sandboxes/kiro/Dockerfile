# syntax=docker/dockerfile:1.4

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Kiro CLI sandbox image for OpenShell
#
# Builds on the community base sandbox and adds AWS Kiro CLI.
# Build:  docker build -t openshell-kiro --build-arg BASE_IMAGE=openshell-base .
# Run:    openshell sandbox create --from kiro

ARG BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest
FROM ${BASE_IMAGE}

USER root

# Install Kiro CLI (latest via official installer)
RUN apt-get update && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://cli.kiro.dev/install | bash \
    && cp /root/.local/bin/kiro-cli /usr/local/bin/kiro \
    && chmod 755 /usr/local/bin/kiro

# Copy sandbox policy
COPY policy.yaml /etc/openshell/policy.yaml

# Create Kiro config directory
RUN mkdir -p /sandbox/.kiro && chown sandbox:sandbox /sandbox/.kiro

USER sandbox

ENTRYPOINT ["/bin/bash"]
