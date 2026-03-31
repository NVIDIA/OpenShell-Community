# syntax=docker/dockerfile:1.4

# SPDX-License-Identifier: Apache-2.0

# Factory Droid sandbox image for OpenShell
#
# Builds on the community base sandbox and adds Factory's Droid CLI.
# Build:  docker build -t openshell-droid --build-arg BASE_IMAGE=openshell-base .
# Run:    openshell sandbox create --from droid

ARG BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest
FROM ${BASE_IMAGE}

USER root

# Install Droid CLI (pinned for reproducibility)
RUN npm install -g droid@0.90.0

# Copy sandbox policy
COPY policy.yaml /etc/openshell/policy.yaml

# Create Droid config directory
RUN mkdir -p /sandbox/.factory && \
    chown sandbox:sandbox /sandbox/.factory

USER sandbox

ENTRYPOINT ["/bin/bash"]
