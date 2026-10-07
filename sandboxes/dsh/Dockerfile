# syntax=docker/dockerfile:1.4

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# DeepSeek Harness (dsh) sandbox image for OpenShell
#
# Builds on the community base sandbox and adds DeepSeek Harness's headless
# profile: a one-shot CLI runner (no GUI, no server, no open port), the
# shape this repo's other sandboxes use for a CLI-driven coding agent.
# Build:  docker build -t openshell-dsh --build-arg BASE_IMAGE=openshell-base .
# Run:    openshell sandbox create --from dsh

ARG BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest
FROM ${BASE_IMAGE}

USER root

# Install DeepSeek Harness CLI (pinned for reproducibility). Developer
# preview: expect breaking changes between releases.
RUN npm install -g @deepseek-ai/dsh@0.2.0-rc.2

# Copy sandbox policy
COPY policy.yaml /etc/openshell/policy.yaml

# Harness home (DSH_HOME, default ~/.dsh): profiles, credentials, session log.
RUN mkdir -p /sandbox/.dsh && \
    chown -R sandbox:sandbox /sandbox/.dsh

USER sandbox

ENTRYPOINT ["/bin/bash"]
