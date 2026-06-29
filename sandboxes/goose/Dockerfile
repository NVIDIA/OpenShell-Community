# syntax=docker/dockerfile:1.4

# SPDX-FileCopyrightText: Copyright (c) 2026 canardleteer
# SPDX-License-Identifier: Apache-2.0

# Goose AI agent sandbox image for OpenShell
#
# Builds on the community base sandbox and adds the Goose CLI.
# Build:  docker build -t openshell-goose --build-arg BASE_IMAGE=openshell-base .
# Run:    openshell sandbox create --from goose

ARG BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest
FROM ${BASE_IMAGE}

USER root

# Install Goose CLI. Default tracks AAIF stable; pin with --build-arg GOOSE_VERSION=v1.39.0
ARG GOOSE_VERSION=stable
RUN curl -fsSL "https://github.com/aaif-goose/goose/releases/download/${GOOSE_VERSION}/download_cli.sh" \
        -o /tmp/download_cli.sh \
    && if [ "${GOOSE_VERSION}" = "stable" ]; then \
         CONFIGURE=false GOOSE_BIN_DIR=/usr/local/bin env -u GOOSE_VERSION bash /tmp/download_cli.sh; \
       else \
         CONFIGURE=false GOOSE_BIN_DIR=/usr/local/bin GOOSE_VERSION="${GOOSE_VERSION}" bash /tmp/download_cli.sh; \
       fi \
    && rm -f /tmp/download_cli.sh \
    && if [ -f /root/.local/bin/goose ]; then \
         mv /root/.local/bin/goose /usr/local/bin/goose; \
       fi \
    && chmod +x /usr/local/bin/goose \
    && goose --version

# Copy sandbox policy, Goose skills, and global hints (~/.config/goose/.goosehints)
COPY policy.yaml /etc/openshell/policy.yaml
COPY skills/ /tmp/goose-skills/
COPY .goosehints /sandbox/.config/goose/.goosehints
COPY config.yaml /sandbox/.config/goose/config.yaml

# Create Goose config directories and install goose-specific skills
RUN mkdir -p /sandbox/.config/goose /sandbox/.local/share/goose && \
    cp -r /tmp/goose-skills/* /sandbox/.agents/skills/ && \
    rm -rf /tmp/goose-skills && \
    chown -R sandbox:sandbox /sandbox/.config /sandbox/.local \
        /sandbox/.agents/skills/epinettes

USER sandbox

ENTRYPOINT ["/bin/bash"]
