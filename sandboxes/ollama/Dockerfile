# syntax=docker/dockerfile:1.4

# SPDX-License-Identifier: Apache-2.0

# Ollama sandbox image for OpenShell
#
# Builds on the community base sandbox (has Node.js, Claude, Codex pre-installed).
# Build:  docker build -t openshell-ollama --build-arg BASE_IMAGE=openshell-base .
# Run:    openshell sandbox create --from ollama --forward 11434

ARG BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest
FROM ${BASE_IMAGE}

USER root

# Install zstd (required by Ollama install script)
RUN apt-get update && apt-get install -y --no-install-recommends zstd \
    && rm -rf /var/lib/apt/lists/*

# Install Ollama
RUN curl -fsSL https://ollama.com/install.sh | sh

# Copy sandbox policy
COPY policy.yaml /etc/openshell/policy.yaml

# Copy entrypoint script
COPY entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

# Set environment variables for OpenShell provider discovery
ENV OLLAMA_HOST=http://127.0.0.1:11434 \
    NPM_CONFIG_PREFIX=/sandbox/.npm-global \
    PATH="/sandbox/.npm-global/bin:/sandbox/.venv/bin:/usr/local/bin:/usr/bin:/bin"

# Configure npm to install globals into a writable directory
# (the sandbox policy makes /usr read-only, so the default /usr/lib/node_modules fails)
RUN mkdir -p /sandbox/.npm-global && \
    chown sandbox:sandbox /sandbox/.npm-global

# Add environment variables to .bashrc for interactive shells
RUN echo 'export OLLAMA_HOST=http://127.0.0.1:11434' >> /sandbox/.bashrc && \
    echo 'export NPM_CONFIG_PREFIX=/sandbox/.npm-global' >> /sandbox/.bashrc && \
    echo 'export PATH="/sandbox/.npm-global/bin:$PATH"' >> /sandbox/.bashrc && \
    chown sandbox:sandbox /sandbox/.bashrc

USER sandbox

ENTRYPOINT ["/usr/local/bin/entrypoint"]
CMD ["/bin/bash", "-l"]
