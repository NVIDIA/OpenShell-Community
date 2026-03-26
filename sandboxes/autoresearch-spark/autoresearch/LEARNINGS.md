# Learnings

Platform-specific notes and experiment findings accumulated across autoresearch runs.

---

## Platform: NVIDIA GB10 (Blackwell, CUDA 12.1) — March 2026

### Environment quirks

- **`uv` is not in `$PATH`** — must invoke as `/sandbox/.local/bin/uv run train.py`
- `train.py` already sets `TRITON_PTXAS_PATH` to the system CUDA 13.0 `ptxas`, which helps Triton-compiled kernels target the GB10. PyTorch's own CUDA kernels are still limited to sm_120 and below.

### GPU compatibility issue

PyTorch (as of this run) supports CUDA capability up to 12.0. The GB10 is 12.1, so PyTorch cannot use its optimized kernels (fast matmul, FlashAttention, etc.) and falls back to slow generic paths.

**Symptoms:**
- MFU ~0.86% (vs 35–45% on a well-supported GPU like H100)
- ~15 seconds per training step (vs ~0.3s on H100)
- ~31 optimizer steps in the 5-minute budget (vs ~950 on H100)

### Key hyperparameter adaptation

The default `TOTAL_BATCH_SIZE = 2**19` (~524K tokens/step) was tuned for ~950 steps/run. With only 31 steps available, the model barely trains. The fix is to shrink the batch so you get far more gradient updates in the time budget:

| TOTAL_BATCH_SIZE | steps/run | val_bpb |
|-----------------|-----------|---------|
| 2^19 (default)  | ~31       | 1.8794  |
| 2^17            | ~89       | 1.6715  |
| 2^16            | ~164      | 1.4010  |
| 2^15            | ~360      | 1.3107  |
| **2^14**        | **~689**  | **1.3073** ← sweet spot |
| 2^13            | ~1242     | 1.3301  ↑ too noisy    |

**Also reduce `DEVICE_BATCH_SIZE` proportionally** (e.g. 8 with `TOTAL_BATCH_SIZE=2^14`) to keep `grad_accum_steps=1` — gradient accumulation hurts quality on this platform.

### Best config found (mar15 run, val_bpb 1.2265 from baseline 1.8794)

```python
ASPECT_RATIO     = 96        # model_dim = depth * ASPECT_RATIO
HEAD_DIM         = 96        # 4 attention heads
WINDOW_PATTERN   = "L"       # all full-context attention (no sliding window)
TOTAL_BATCH_SIZE = 2**14     # ~16K tokens/step
DEVICE_BATCH_SIZE = 8        # grad_accum_steps = 1
EMBEDDING_LR     = 0.35
MATRIX_LR        = 0.05
WEIGHT_DECAY     = 0.0
ADAM_BETAS       = (0.9, 0.99)
WARMDOWN_RATIO   = 0.6
FINAL_LR_FRAC    = 0.05
DEPTH            = 4
# Muon: beta2=0.90, momentum warmup 0.85->0.95 over 5000 steps
```

### Other findings (mar15, ~135 experiments)

**Helped:**
- Full-context attention (`WINDOW_PATTERN="L"`) over sliding window (`"SSSL"`)
- Larger head dim (96–128) over smaller (32–64) at this model size
- Slow Muon momentum warmup (0.85→0.95 over 5000 steps)
- No weight decay (`WEIGHT_DECAY=0.0`)
- `ADAM_BETAS=(0.9, 0.99)` — higher beta2 for small batches
- `FINAL_LR_FRAC=0.05` — don't decay LR fully to zero
- Muon `beta2=0.90` (less smoothing of second moment)

**Did not help / hurt:**
- GQA (grouped-query attention) — speed gain not worth quality loss
- SwiGLU activation — worse than ReLU²
- Gradient clipping — overhead reduces step count
- Wider MLP (4x→8x expansion) — fewer steps, worse result
- Removing value embeddings — significantly worse
- Post-norm — much worse than pre-norm
- Parallel attention+MLP (GPT-J style) — much worse
- Label smoothing — breaks train/val metric alignment
