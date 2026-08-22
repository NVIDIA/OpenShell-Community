# syntax=docker/dockerfile:1.4

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Xquik Skill sandbox image for OpenShell.
#
# Build: docker build -t openshell-xquik --build-arg BASE_IMAGE=openshell-base .
# Run: openshell sandbox create --from xquik --provider xquik -- claude

ARG BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest
FROM ${BASE_IMAGE}

USER root

# Pin the public Skill source for a reproducible and reviewable image.
ARG XQUIK_SKILL_COMMIT=5f2a6d1251dbf9bc5a1211a085d6cac2f2f689af
RUN set -eux; \
    git init /tmp/x-twitter-scraper; \
    git -C /tmp/x-twitter-scraper remote add origin https://github.com/Xquik-dev/x-twitter-scraper.git; \
    git -C /tmp/x-twitter-scraper fetch --depth=1 origin "${XQUIK_SKILL_COMMIT}"; \
    git -C /tmp/x-twitter-scraper checkout --detach FETCH_HEAD; \
    test "$(git -C /tmp/x-twitter-scraper rev-parse HEAD)" = "${XQUIK_SKILL_COMMIT}"; \
    cp -a /tmp/x-twitter-scraper/skills/x-twitter-scraper /sandbox/.agents/skills/; \
    install -Dm644 /tmp/x-twitter-scraper/LICENSE /usr/share/licenses/x-twitter-scraper/LICENSE; \
    ln -sfn /sandbox/.agents/skills/x-twitter-scraper /sandbox/.claude/skills/x-twitter-scraper; \
    chown -R sandbox:sandbox /sandbox/.agents/skills/x-twitter-scraper; \
    test -f /sandbox/.agents/skills/x-twitter-scraper/SKILL.md; \
    test -f /sandbox/.agents/skills/x-twitter-scraper/references/security.md; \
    rm -rf /tmp/x-twitter-scraper

COPY provider-profile.yaml /usr/share/openshell/provider-profiles/xquik-read-only.yaml

USER sandbox

ENTRYPOINT ["/bin/bash"]
