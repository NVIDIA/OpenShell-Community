# syntax=docker/dockerfile:1.4

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# OpenClaw sandbox image for NemoClaw
#
# Extends the base NemoClaw sandbox with OpenClaw and its dependencies.
# Build:  docker build -t nemoclaw-openclaw .
# Run:    nemoclaw sandbox create --from openclaw

ARG BASE_IMAGE=nemoclaw/sandbox:latest
FROM ${BASE_IMAGE} AS base

# ── Stage 1: System dependencies ─────────────────────────────────────────────

FROM base AS system-deps

# Node.js 22 (required by OpenClaw gateway)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends \
        build-essential \
        git \
        nodejs \
        python3 \
    && rm -rf /var/lib/apt/lists/*

# ── Stage 2: OpenClaw installation ───────────────────────────────────────────

FROM system-deps AS openclaw

# Install OpenClaw CLI
RUN npm install -g openclaw

# ── Stage 3: Final image ────────────────────────────────────────────────────

FROM openclaw AS final

# Copy the OpenClaw startup helper into the image
COPY openclaw-start.sh /usr/local/bin/openclaw-start
RUN chmod +x /usr/local/bin/openclaw-start

# Create OpenClaw workspace and config directories
RUN mkdir -p /sandbox/.openclaw && \
    chown -R sandbox:sandbox /sandbox/.openclaw

ENTRYPOINT ["navigator-sandbox"]
