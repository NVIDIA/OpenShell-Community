<!-- SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# GPU Workload CUDA Basic

`gpu-workload-cuda-basic` validates that a GPU-enabled environment can run a
basic CUDA runtime workload. It is a single image that runs two validation
steps:

1. `deviceQuery` checks CUDA runtime, driver, and device discovery.
2. `vectorAdd` checks kernel launch, device memory allocation, host/device
   copies, synchronization, and result validation.

The image builds the samples from `NVIDIA/cuda-samples` tag `v12.8` with a CUDA
12.8 builder image, then copies only the compiled binaries into the OpenShell
community base final image. Published builds are multiarch for `linux/amd64`
and `linux/arm64`.

The workload prints `OPENSHELL_GPU_WORKLOAD_SUCCESS` only after both samples
pass. On failure it prints `OPENSHELL_GPU_WORKLOAD_FAILURE` and exits non-zero.

## Contract

The image installs the workload at `/usr/local/bin/openshell-gpu-workload`.
Direct container execution runs the workload as the image entrypoint. OpenShell
tests that create a sandbox from this image should run the workload path
explicitly because sandbox creation replaces the OCI entrypoint.

The workload requires no network access after the image is pulled. It does not
vendor GPU driver libraries such as `libcuda.so.1`; those libraries must be
provided by the host GPU runtime or CDI injection.

## Build

```shell
docker build -t gpu-workload-cuda-basic .
```

## Run

Run it directly with Docker CDI:

```shell
docker run --rm --device nvidia.com/gpu=all gpu-workload-cuda-basic
```

Use `podman run` with the same `--device nvidia.com/gpu=all` option when Podman
CDI is configured.

The CUDA samples are redistributed under the NVIDIA CUDA samples license. The
license text is copied into the image at
`/usr/local/share/doc/openshell-gpu-workload/cuda-samples.LICENSE`.
