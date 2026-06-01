# syntax=docker/dockerfile:1.4

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# AIO Sandbox image for OpenShell
#
# Builds on the open source aio sandbox and adds sandbox user and group for openshell compatibility.
# Build:  docker build -t openshell-aio-sandbox --build-arg BASE_IMAGE=ghcr.io/agent-infra/sandbox:latest .
# Run:    openshell sandbox create --from aio-sandbox

ARG BASE_IMAGE=ghcr.io/agent-infra/sandbox:latest
FROM ${BASE_IMAGE}

USER root

# Create a sandbox user and group in the baseline aio-sandbox image 
RUN groupadd -r sandbox && \
    useradd -r -g sandbox -m -d /home/sandbox -s /bin/bash sandbox && \
    mkdir -p /workspace && \
    chown -R sandbox:sandbox /home/sandbox /workspace

USER sandbox

ENTRYPOINT ["/bin/bash"]
