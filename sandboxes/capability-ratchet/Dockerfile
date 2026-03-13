# syntax=docker/dockerfile:1.4

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Capability Ratchet sandbox image for OpenShell
#
# Builds on the community base sandbox and adds the capability ratchet
# sidecar, which prevents AI agent data exfiltration by dynamically
# revoking capabilities when private/untrusted data enters the context.
#
# Build:  docker build -t openshell-ratchet --build-arg BASE_IMAGE=openshell-base .
# Run:    openshell sandbox create --from capability-ratchet -- ratchet-start

ARG BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest

# Stage 1: Build Rust binary
FROM rust:1.88-bookworm AS builder
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src/ src/
RUN cargo build --release

# Stage 2: Runtime
FROM ${BASE_IMAGE}

USER root

# Install bash-ast binary (prebuilt from GitHub release)
RUN ARCH=$(uname -m) && \
    curl -fsSL "https://github.com/cv/bash-ast/releases/download/v0.3.2/bash-ast-v0.3.2-${ARCH}-unknown-linux-gnu.tar.gz" \
    | tar xz -C /usr/local/bin bash-ast && \
    chmod +x /usr/local/bin/bash-ast

# Ratchet sidecar (single static binary, no runtime deps)
COPY --from=builder /build/target/release/capability-ratchet-sidecar /usr/local/bin/

# Copy OpenShell sandbox policy
COPY policy.yaml /etc/navigator/policy.yaml

# Copy ratchet-specific configs
COPY ratchet-config.yaml /app/ratchet-config.yaml
COPY ratchet-policy.yaml /app/policy.yaml

# Copy startup script and readme
COPY ratchet-start.sh /usr/local/bin/ratchet-start
COPY README.md /app/README.md
RUN chmod +x /usr/local/bin/ratchet-start

# Create workspace
RUN mkdir -p /sandbox/.ratchet && \
    chown -R sandbox:sandbox /sandbox/.ratchet

USER sandbox

ENTRYPOINT ["/bin/bash"]
