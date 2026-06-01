<!-- SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# GPU Workload Smoke Fail

`gpu-workload-smoke-fail` validates negative-path diagnostics in e2e test
plumbing.

The workload does not perform GPU-specific work. It prints
`OPENSHELL_GPU_WORKLOAD_FAILURE`, emits a stable diagnostic, and exits with
status `42`.

## Contract

The image installs the workload at `/usr/local/bin/openshell-gpu-workload`.
Direct container execution runs the workload as the image entrypoint. OpenShell
tests that create a sandbox from this image should run the workload path
explicitly because sandbox creation replaces the OCI entrypoint.

The workload requires no network access after the image is pulled.

## Build

```shell
docker build -t gpu-workload-smoke-fail .
```

## Run

```shell
docker run --rm gpu-workload-smoke-fail
```

The direct run should fail.
