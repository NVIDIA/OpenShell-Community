# syntax=docker/dockerfile:1.4

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# OMP Coding Agent sandbox image for OpenShell
#
# Builds on the community base sandbox and adds OMP with Bun.
# Build:  docker build -t openshell-omp:latest --build-arg BASE_IMAGE=openshell-base .
# Run locally:  openshell sandbox create --from openshell-omp:latest

ARG BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest
FROM ${BASE_IMAGE}

ARG BUN_VERSION=1.3.14
ARG OMP_VERSION=17.4.0

ENV BUN_INSTALL=/opt/bun \
    PATH="/opt/bun/bin:${PATH}"

USER root

# Install Bun and its unzip dependency.
RUN apt-get update && apt-get install -y --no-install-recommends \
        unzip \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" \
    && test "$(/opt/bun/bin/bun --version)" = "${BUN_VERSION}"

# Install the published OMP package in a controlled application directory.
RUN mkdir -p /opt/omp \
    && printf '{\n  "private": true,\n  "dependencies": {\n    "@oh-my-pi/pi-coding-agent": "%s"\n  }\n}\n' "${OMP_VERSION}" > /opt/omp/package.json \
    && cd /opt/omp \
    && /opt/bun/bin/bun install --production --linker hoisted \
    && test -f /opt/omp/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js

# Keep the runtime and package paths explicit for the sandbox policy.
RUN printf '#!/bin/sh\nexport HOME=/sandbox\nexec /opt/bun/bin/bun /opt/omp/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js "$@"\n' \
        > /usr/local/bin/omp \
    && chown root:root /usr/local/bin/omp \
    && chmod 755 /usr/local/bin/omp

# Keep Bun on PATH for login shells as well as the container environment.
RUN printf 'export PATH="/opt/bun/bin:/sandbox/.venv/bin:/usr/local/bin:/usr/bin:/bin"\n' \
        >> /sandbox/.bashrc

# Copy the complete OMP-specific sandbox policy.
COPY policy.yaml /etc/openshell/policy.yaml

USER sandbox

ENTRYPOINT ["/bin/bash"]
