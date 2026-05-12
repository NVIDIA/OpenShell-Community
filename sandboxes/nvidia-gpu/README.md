<!-- SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# GPU Sandbox Image

GPU-enabled sandbox image for the OpenShell VM driver. Provides NVIDIA
userspace tooling (nvidia-smi, NVML, CUDA driver libraries) on top of a
minimal Ubuntu base. Kernel modules are injected separately by the VM
driver at sandbox creation time. The image publishes for `linux/amd64` and
`linux/arm64`.

## Architecture

The GPU sandbox splits responsibility between the container image and the
VM driver:

| Layer | Source | Contents |
|-------|--------|----------|
| **Userspace** | This Dockerfile | nvidia-smi, libcuda.so, libnvidia-ml.so, kmod, iproute2 |
| **Kernel modules** | OpenShell VM driver injection | nvidia.ko, nvidia_uvm.ko, nvidia_modeset.ko (built for guest kernel 6.12.76) |
| **GSP firmware** | `.run` installer in image OR host fallback | gsp_ga10x.bin, gsp_tu10x.bin |

The kernel modules must be compiled against the exact guest kernel version
used by libkrunfw. The VM driver injects them into each sandbox's rootfs
at creation time via `inject_gpu_modules()`.

## Prerequisites

- Linux host with an NVIDIA GPU
- IOMMU enabled (for VFIO GPU passthrough)
- Docker (for building the sandbox image)
- OpenShell core checkout for VM runtime/module tasks
- Guest kernel built with `CONFIG_MODULES=y` in the OpenShell core checkout (`mise run vm:setup`)

## Quick Start

```shell
# 1. In the OpenShell core repo: build the VM runtime
mise run vm:setup

# 2. In the OpenShell core repo: build NVIDIA modules for the guest kernel
mise run vm:nvidia-modules

# 3. Start the gateway with GPU support
sudo mise run gateway:vm -- --gpu

# 4. Create a GPU sandbox from the published community image
openshell sandbox create --gpu --from nvidia-gpu
```

## Version Coupling

The NVIDIA driver version must match across the image and the VM guest
kernel modules:

| Component | Variable | Default |
|-----------|----------|---------|
| Dockerfile userspace | `NVIDIA_DRIVER_VERSION` | `580.159.03` |
| Image version reference | `sandboxes/nvidia-gpu/versions.env` | `580.159.03` |
| OpenShell core module build | `NVIDIA_OPEN_VERSION` | `580.159.03` |

A mismatch causes `modprobe` "version magic" errors or nvidia-smi ABI
failures at sandbox boot time.

## Customization

### Changing the CUDA version

```shell
docker build \
  --platform linux/amd64 \
  --build-arg CUDA_VERSION=12.6.0 \
  --build-arg UBUNTU_VERSION=22.04 \
  -t my-gpu-sandbox:latest \
  ./sandboxes/nvidia-gpu/
```

To build an arm64 variant locally, use `--platform linux/arm64`. Published
images include both `linux/amd64` and `linux/arm64` manifests.

### Changing the NVIDIA driver version

Update the image version reference and rebuild matching VM guest modules in
the OpenShell core repo:

1. `sandboxes/nvidia-gpu/versions.env`
2. `sandboxes/nvidia-gpu/Dockerfile` ARG `NVIDIA_DRIVER_VERSION`
3. In the OpenShell core repo, rebuild kernel modules:
   `NVIDIA_OPEN_VERSION=<version> mise run vm:nvidia-modules`

### Adding packages

Add packages to the `apt-get install` line in the Dockerfile. The image
must retain `bash`, `kmod`, `iproute2`, and `busybox-static` — the VM
driver validates these at rootfs preparation time.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "No GPU kernel modules found" | Modules not built | `mise run vm:nvidia-modules` |
| "kmod not found in rootfs" | Image missing kmod package | Add `kmod` to Dockerfile `apt-get install` |
| `modprobe nvidia` fails | Kernel version mismatch | Rebuild modules after `mise run vm:setup` |
| nvidia-smi "driver/library mismatch" | Userspace/module version mismatch | Ensure Dockerfile and module versions match |
| "kernel version mismatch: expected X, got Y" | Guest kernel was rebuilt | Rebuild modules: `mise run vm:nvidia-modules` |
