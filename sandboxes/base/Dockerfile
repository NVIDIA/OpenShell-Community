# syntax=docker/dockerfile:1

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# OpenShell Community base sandbox image
#
# Provides the foundational system tools, users, and developer environment
# that all other community sandbox images build on top of.
#
# Build:  docker build -t openshell-base .

# System base
FROM nvcr.io/nvidia/base/ubuntu:noble-20251013 AS system

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /sandbox

# Core system dependencies
# iproute2: network namespace management (ip netns, veth pairs)
# iptables: legacy bypass detection (kept for transition)
# nftables: bypass detection — log + reject rules for direct connection diagnostics
# dnsutils: dig, nslookup
# Python is managed entirely by uv (see devtools stage).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        dnsutils \
        iproute2 \
        iptables \
        nftables \
        iputils-ping \
        net-tools \
        netcat-openbsd \
        openssh-sftp-server \
        procps \
        traceroute \
    && rm -rf /var/lib/apt/lists/*

# Create supervisor and sandbox users/groups
RUN groupadd -r supervisor && useradd -r -g supervisor -s /usr/sbin/nologin supervisor && \
    groupadd -r sandbox && useradd -r -g sandbox -d /sandbox -s /bin/bash sandbox

# Developer tools
FROM system AS devtools

# Node.js 22 + build toolchain (needed by npm packages with native addons).
# Pin to a specific patch version for reproducible builds.
# CVE-2026-21637, CVE-2025-59466, CVE-2025-59465, CVE-2025-55131 affect
# Node.js <= 22.22.1. Update to 22.23.0+ when a patched release ships.
#
# npm is upgraded to v11 in the same layer to avoid caching the old npm.
# npm 11 ships tar@^7.5.9, fixing tar@6.2.1 vulns bundled in npm 10
# (GHSA-r6q2-hw4h-h46w, GHSA-8qq5-rm4j-mr97, GHSA-83g3-92jg-28cx,
# GHSA-34x7-hfp2-rc4v, GHSA-qffp-2rhf-9h96).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends \
        build-essential \
        git \
        nodejs=22.22.1-1nodesource1 \
        vim-tiny \
        nano \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g npm@11.11.0

# Global npm packages — pinned for reproducibility.
# tar + @hono/node-server: transitive vuln fixes
#   (GHSA-qffp-2rhf-9h96, GHSA-9ppj-qmqm-q256, GHSA-8qq5-rm4j-mr97,
#    GHSA-r6q2-hw4h-h46w, GHSA-34x7-hfp2-rc4v, GHSA-83g3-92jg-28cx,
#    GHSA-wc8c-qw6v-h7f6).
# opencode-ai + @openai/codex: agent CLIs.
RUN npm install -g \
        tar@7.5.11 \
        @hono/node-server@1.19.11 \
        opencode-ai@1.2.18 \
        @openai/codex@0.117.0 \
        @github/copilot@1.0.16

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && apt-get install -y --no-install-recommends gh && \
    rm -rf /var/lib/apt/lists/*

# Install Claude CLI via native installer (npm method is deprecated)
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && cp /root/.local/bin/claude /usr/local/bin/claude \
    && chmod 755 /usr/local/bin/claude

# uv (Python package/project manager) — pinned for reproducibility.
# uv manages the Python toolchain; no system Python packages are needed.
COPY --from=ghcr.io/astral-sh/uv:0.10.8 /uv /usr/local/bin/uv
ENV UV_PYTHON_INSTALL_DIR="/sandbox/.uv/python"
RUN uv python install 3.13 && \
    ln -s $(uv python find 3.13) /usr/local/bin/python3 && \
    ln -s $(uv python find 3.13) /usr/local/bin/python && \
    uv cache clean

# Final base image
FROM devtools AS final

# Add venvs to PATH -- /sandbox/.venv (writable, user-installed packages)
# takes priority over system paths.
# VIRTUAL_ENV and UV_PYTHON_INSTALL_DIR are also exported in .bashrc
# so that login shell sessions (interactive and exec) see them.
ENV PATH="/sandbox/.venv/bin:/usr/local/bin:/usr/bin:/bin" \
    VIRTUAL_ENV="/sandbox/.venv"

# Default sandbox network / filesystem policy
COPY policy.yaml /etc/openshell/policy.yaml

# Copy custom skills into the image.
# To add a skill, create a subdirectory under sandboxes/base/skills/
# with a SKILL.md file (and any supporting files). It will be installed into
# both ~/.claude/skills/ and ~/.agents/skills/ for agent discovery.
COPY skills/ /sandbox/.agents/skills/

# Set up sandbox user home directory
RUN mkdir -p /sandbox/.claude/skills && \
    # Create a writable venv using uv-managed Python 3.13.
    # Sandbox users can `uv pip install` (or `pip install`) into
    # this venv without touching the base image layer.
    uv venv --python 3.13 --seed /sandbox/.venv && \
    uv pip install --python /sandbox/.venv/bin/python cloudpickle && \
    uv cache clean && \
    chown -R sandbox:sandbox /sandbox/.venv && \
    # Minimal shell init files so interactive and non-interactive shells
    # get a sane PATH and prompt.  Without these, bash sources nothing
    # under /sandbox and tools like VS Code Remote-SSH may mis-detect
    # the platform.
    printf 'export PATH="/sandbox/.venv/bin:/usr/local/bin:/usr/bin:/bin"\nexport VIRTUAL_ENV="/sandbox/.venv"\nexport UV_PYTHON_INSTALL_DIR="/sandbox/.uv/python"\nexport PS1="\\u@\\h:\\w\\$ "\n' \
        > /sandbox/.bashrc && \
    printf '[ -f ~/.bashrc ] && . ~/.bashrc\n' > /sandbox/.profile && \
    chown sandbox:sandbox /sandbox/.bashrc /sandbox/.profile && \
    # Symlink skills into agent discovery directories
    for skill in /sandbox/.agents/skills/*/; do \
        [ -d "$skill" ] || continue; \
        ln -sf "$skill" "/sandbox/.claude/skills/$(basename "$skill")"; \
    done && \
    chown -R sandbox:sandbox /sandbox/.claude /sandbox/.agents /sandbox

USER sandbox

ENTRYPOINT ["/bin/bash"]
