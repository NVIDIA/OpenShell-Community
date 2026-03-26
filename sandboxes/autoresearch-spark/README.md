# autoresearch-spark

Autonomous LLM pretraining research on DGX Spark (GB10 / Blackwell).

Based on [karpathy/autoresearch](https://github.com/karpathy/autoresearch),
adapted for the NVIDIA GB10 single-GPU platform.

## Quick start

```
openshell sandbox create \
  --remote my-spark \
  --gpu \
  --provider claude \
  --provider github \
  --from autoresearch-spark \
  -- claude
```

This launches an autoresearch sandbox on your DGX Spark with Claude as the
autonomous researcher. The agent will set up, run experiments, and iterate
on the model -- all while you sleep.

## Why CUDA 13.0 + cu128?

The DGX Spark has an NVIDIA GB10 GPU (Blackwell, compute capability 12.1 /
sm_121a). This creates a unique toolchain situation:

- **CUDA 13.0 devel base image**: provides `ptxas` with sm_121a support,
  which Triton needs to compile optimized GPU kernels for the GB10.
- **PyTorch cu128 wheels**: the cu130 wheels are not yet functional on this
  platform, but cu128 works correctly on the CUDA 13.0 runtime (backward
  compatible).
- **`TRITON_PTXAS_PATH`** is set globally in the container so Triton finds
  the CUDA 13.0 ptxas automatically.

## Platform notes

See [autoresearch/LEARNINGS.md](autoresearch/LEARNINGS.md) for GB10-specific
findings including hyperparameter tuning, MFU expectations, and best configs
found across ~135 experiments.

## Build

```
docker build -t autoresearch-spark .
```
