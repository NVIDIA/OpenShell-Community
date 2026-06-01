<!-- SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# GPU Workload Smoke Pass

`gpu-workload-smoke-pass` validates image publishing, sandbox image
compatibility, default entrypoint execution, and success-marker assertion
plumbing.

The workload does not perform GPU-specific work. It prints
`OPENSHELL_GPU_WORKLOAD_SUCCESS` and exits `0`.

## Contract

The image installs the workload at `/usr/local/bin/openshell-gpu-workload`.
Direct container execution runs the workload as the image entrypoint. OpenShell
tests that create a sandbox from this image should run the workload path
explicitly because sandbox creation replaces the OCI entrypoint.

The workload requires no network access after the image is pulled.

## Build

```shell
docker build -t gpu-workload-smoke-pass .
```

## Run

```shell
docker run --rm gpu-workload-smoke-pass
```
