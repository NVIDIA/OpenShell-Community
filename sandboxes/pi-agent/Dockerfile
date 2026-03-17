# syntax=docker/dockerfile:1.4

# Pi Agent sandbox image for OpenShell
#
# Builds on the community base sandbox and adds the pi coding agent.
# Build:  docker build -t openshell-pi-agent --build-arg BASE_IMAGE=openshell-base .
# Run:    openshell sandbox create --from pi-agent

ARG BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest
FROM ${BASE_IMAGE}

USER root

# Install pi coding agent
RUN npm install -g @mariozechner/pi-coding-agent

# Copy sandbox policy
COPY policy.yaml /etc/openshell/policy.yaml

# Copy the pi-agent startup helper
COPY pi-agent-start.sh /usr/local/bin/pi-agent-start
RUN chmod +x /usr/local/bin/pi-agent-start

# Create pi config and session directories
RUN mkdir -p /sandbox/.pi/agent && \
    chown -R sandbox:sandbox /sandbox/.pi

USER sandbox

ENTRYPOINT ["/bin/bash"]
