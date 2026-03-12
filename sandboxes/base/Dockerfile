# syntax=docker/dockerfile:1.4

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
# python3.13 + pip: agent scripting and SDK usage (deadsnakes PPA for Noble)
# iproute2: network namespace management (ip netns, veth pairs)
# dnsutils: dig, nslookup
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        dnsutils \
        iproute2 \
        iputils-ping \
        net-tools \
        netcat-openbsd \
        openssh-sftp-server \
        procps \
        software-properties-common \
        traceroute \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        python3.13 \
        python3.13-venv \
    && curl -sS https://bootstrap.pypa.io/get-pip.py | python3.13 \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.13 1 \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.13 1 \
    && rm -rf /var/lib/apt/lists/*

# Create supervisor and sandbox users/groups
RUN groupadd -r supervisor && useradd -r -g supervisor -s /usr/sbin/nologin supervisor && \
    groupadd -r sandbox && useradd -r -g sandbox -d /sandbox -s /bin/bash sandbox

# Developer tools
FROM system AS devtools

# Node.js 22 + build toolchain (needed by npm packages with native addons)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends \
        build-essential \
        git \
        nodejs \
        vim-tiny \
        nano \
    && rm -rf /var/lib/apt/lists/*

# Fix transitive tar vulnerabilities (GHSA-qffp-2rhf-9h96,
# GHSA-9ppj-qmqm-q256, GHSA-8qq5-rm4j-mr97, GHSA-r6q2-hw4h-h46w,
# GHSA-34x7-hfp2-rc4v, GHSA-83g3-92jg-28cx).
RUN npm install -g tar@7.5.11

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && apt-get install -y --no-install-recommends gh && \
    rm -rf /var/lib/apt/lists/*

# uv (Python package manager)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Final base image
FROM devtools AS final

# Ensure policy directory exists
RUN mkdir -p /etc/navigator

# Set up sandbox user home directory
RUN mkdir -p /sandbox/.agents/skills && \
    printf 'export PS1="\\u@\\h:\\w\\$ "\n' > /sandbox/.bashrc && \
    printf '[ -f ~/.bashrc ] && . ~/.bashrc\n' > /sandbox/.profile && \
    chown -R sandbox:sandbox /sandbox

USER sandbox

ENTRYPOINT ["/bin/bash"]
