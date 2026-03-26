# syntax=docker/dockerfile:1

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# autoresearch-spark sandbox image for OpenShell
#
# Autonomous LLM pretraining research on DGX Spark (GB10 / Blackwell).
# Uses CUDA 13.0 devel base for sm_121a ptxas support (Triton kernel
# compilation) and PyTorch cu128 wheels.
#
# Build:  docker build -t autoresearch-spark .

# ---------------------------------------------------------------------------
# Stage 1: System base
# ---------------------------------------------------------------------------

# This image uses its own CUDA base (not the community base) because the
# GB10 / Blackwell GPU requires CUDA 13.0 devel for sm_121a ptxas support.
# The ARG is declared so the CI sandbox-build workflow can parse it, but
# it is intentionally unused — the FROM below pins the CUDA image directly.
ARG BASE_IMAGE=nvidia/cuda:13.0.0-cudnn-devel-ubuntu24.04
FROM nvidia/cuda:13.0.0-cudnn-devel-ubuntu24.04 AS system

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /sandbox

# Core system dependencies (mirrors sandboxes/base)
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        dnsutils \
        iproute2 \
        iptables \
        iputils-ping \
        net-tools \
        netcat-openbsd \
        openssh-sftp-server \
        procps \
        traceroute \
    && rm -rf /var/lib/apt/lists/*

# Create supervisor and sandbox users/groups (same as base)
RUN groupadd -r supervisor && useradd -r -g supervisor -s /usr/sbin/nologin supervisor && \
    groupadd -r sandbox && useradd -r -g sandbox -d /sandbox -s /bin/bash sandbox

# ---------------------------------------------------------------------------
# Stage 2: Developer tools
# ---------------------------------------------------------------------------
FROM system AS devtools

# Node.js 22 + build toolchain
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends \
        build-essential \
        git \
        nodejs=22.22.1-1nodesource1 \
        vim-tiny \
        nano \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g npm@11.11.0

# Global npm packages (same versions as base)
RUN npm install -g \
        tar@7.5.11 \
        @hono/node-server@1.19.11 \
        opencode-ai@1.2.18 \
        @openai/codex@0.111.0

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && apt-get install -y --no-install-recommends gh && \
    rm -rf /var/lib/apt/lists/*

# Claude CLI (via native installer)
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && cp /root/.local/bin/claude /usr/local/bin/claude \
    && chmod 755 /usr/local/bin/claude

# uv (Python package/project manager)
COPY --from=ghcr.io/astral-sh/uv:0.10.8 /uv /usr/local/bin/uv
ENV UV_PYTHON_INSTALL_DIR="/sandbox/.uv/python"
RUN uv python install 3.13 && \
    ln -s $(uv python find 3.13) /usr/local/bin/python3 && \
    ln -s $(uv python find 3.13) /usr/local/bin/python && \
    uv cache clean

# ---------------------------------------------------------------------------
# Stage 3: Final image with autoresearch
# ---------------------------------------------------------------------------
FROM devtools AS final

# GB10 / Blackwell (sm_121a) requires CUDA 13.0's ptxas for Triton kernel
# compilation. PyTorch cu128 wheels work fine on the CUDA 13.0 runtime
# (backward compatible), but Triton needs the newer ptxas to emit sm_121a
# instructions. Without this, Triton falls back to slow generic kernels.
ENV TRITON_PTXAS_PATH="/usr/local/cuda-13.0/bin/ptxas"

# Add venvs to PATH
ENV PATH="/sandbox/.venv/bin:/usr/local/bin:/usr/bin:/bin" \
    VIRTUAL_ENV="/sandbox/.venv"

# Sandbox network / filesystem policy
COPY policy.yaml /etc/openshell/policy.yaml

# Create writable venv
RUN mkdir -p /sandbox/.claude && \
    uv venv --python 3.13 --seed /sandbox/.venv && \
    uv cache clean && \
    chown -R sandbox:sandbox /sandbox/.venv

# Copy autoresearch code
COPY autoresearch/ /sandbox/autoresearch/

# Install autoresearch Python dependencies (PyTorch cu128, kernels, etc.)
RUN uv sync --project /sandbox/autoresearch && \
    uv cache clean

# Shell init (same pattern as base)
RUN printf 'export PATH="/sandbox/.venv/bin:/usr/local/bin:/usr/bin:/bin"\nexport VIRTUAL_ENV="/sandbox/.venv"\nexport UV_PYTHON_INSTALL_DIR="/sandbox/.uv/python"\nexport TRITON_PTXAS_PATH="/usr/local/cuda-13.0/bin/ptxas"\nexport PS1="\\u@\\h:\\w\\$ "\n' \
        > /sandbox/.bashrc && \
    printf '[ -f ~/.bashrc ] && . ~/.bashrc\n' > /sandbox/.profile && \
    chown sandbox:sandbox /sandbox/.bashrc /sandbox/.profile && \
    chown -R sandbox:sandbox /sandbox

USER sandbox
WORKDIR /sandbox/autoresearch

ENTRYPOINT ["/bin/bash"]
