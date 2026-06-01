# syntax=docker/dockerfile:1.4

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Data engineering sandbox image for OpenShell
#
# Builds on the community base sandbox and adds Python 3.12 with DuckDB,
# pandas, pyarrow, and httpx for local data processing workflows.
# Build:  docker build -t openshell-data-eng --build-arg BASE_IMAGE=openshell-base .
# Run:    openshell sandbox create --from data-eng

ARG BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest
FROM ${BASE_IMAGE}

USER root

# Install Python 3.12 via uv (base provides uv; 3.13 is already present)
RUN uv python install 3.12 && uv cache clean

# Re-create the sandbox venv with Python 3.12 and install data-engineering packages
RUN uv venv --python 3.12 --seed /sandbox/.venv && \
    uv pip install --python /sandbox/.venv/bin/python \
        cloudpickle \
        duckdb \
        pandas \
        pyarrow \
        httpx \
    && uv cache clean && \
    chown -R sandbox:sandbox /sandbox/.venv

# Copy entrypoint
COPY entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

USER sandbox

ENTRYPOINT ["/usr/local/bin/entrypoint"]
CMD ["/bin/bash", "-l"]
