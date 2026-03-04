# syntax=docker/dockerfile:1.4

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# OpenClaw sandbox image for NemoClaw
#
# Self-contained image with OpenClaw and all sandbox dependencies.
# Build:  docker build -t nemoclaw-openclaw .
# Run:    nemoclaw sandbox create --from openclaw

# ── Stage 1: Base system ─────────────────────────────────────────────────────

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /sandbox

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        dnsutils \
        iproute2 \
        iputils-ping \
        net-tools \
        netcat-openbsd \
        traceroute \
    && rm -rf /var/lib/apt/lists/*

# Create supervisor and sandbox users
RUN groupadd -r supervisor && useradd -r -g supervisor -s /usr/sbin/nologin supervisor && \
    groupadd -r sandbox && useradd -r -g sandbox -d /sandbox -s /bin/bash sandbox

# ── Stage 2: Node.js + OpenClaw ──────────────────────────────────────────────

FROM base AS openclaw

# Node.js 22 (required by OpenClaw gateway) + dev tools
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends \
        build-essential \
        git \
        nodejs \
        vim-tiny \
        nano \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && apt-get install -y --no-install-recommends gh && \
    rm -rf /var/lib/apt/lists/*

# Install OpenClaw CLI
RUN npm install -g openclaw

# ── Stage 3: Final image ────────────────────────────────────────────────────

FROM openclaw AS final

# Copy sandbox policy
COPY policy.yaml /etc/navigator/policy.yaml

# Copy the OpenClaw startup helper
COPY openclaw-start.sh /usr/local/bin/openclaw-start
RUN chmod +x /usr/local/bin/openclaw-start

# Set up sandbox user home
RUN mkdir -p /sandbox/.openclaw /sandbox/.claude/skills /sandbox/.agents/skills && \
    printf 'export PS1="\\u@\\h:\\w\\$ "\n' > /sandbox/.bashrc && \
    printf '[ -f ~/.bashrc ] && . ~/.bashrc\n' > /sandbox/.profile && \
    chown -R sandbox:sandbox /sandbox

USER sandbox

ENTRYPOINT ["/bin/bash"]
