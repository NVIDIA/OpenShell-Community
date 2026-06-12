# syntax=docker/dockerfile:1.4

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 brikie contributors. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# brikie sandbox image for OpenShell
#
# Builds on the community base sandbox and adds brikie — a modular agent
# harness where every capability is an optional, hot-swappable Brick.
# Build:  docker build -t openshell-brikie --build-arg BASE_IMAGE=openshell-base .
# Run:    openshell sandbox create --from brikie

ARG BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest
FROM ${BASE_IMAGE}

USER root

# Install brikie from PyPI.
RUN pip install --no-cache-dir --break-system-packages brikie

# Copy sandbox policy
COPY policy.yaml /etc/openshell/policy.yaml

USER sandbox

ENTRYPOINT ["brikie"]
