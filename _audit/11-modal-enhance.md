> **SUPERSEDED 2026-09-19:** Modal requires a payment method on file before it
> will run GPU functions, even on the free \$30/month Starter credits. The
> owner cannot add a card, so the entire Modal HD tier was REMOVED (code,
> workflow step, GitHub secrets, local token). Free GPU alternatives
> (Colab/Kaggle) have no automation API. The HD tier can be rebuilt if a
> card-eligible GPU provider is ever adopted — this report documents the design
> for that day. Kept for historical reference.

# Modal GPU Enhance — build report (2026-09-18)

Built in-session by the coordinator after two agent attempts died on
infrastructure errors (concurrency limit, captcha timeout). No other agent owns
these files.

## Files
- `modal/enhance_app.py` — Modal app `clipmint-enhance`: CUDA image (torch 2.4.1 cu121 + basicsr/facexlib/gfpgan 1.3.8/realesrgan 0.3.0), weights pre-baked into the image layer (RealESRGAN_x2plus, GFPGANv1.4, facexlib RetinaFace), `enhance(bytes) -> bytes`, T4, 1800s timeout.
- `pipeline/gpu_enhance.py` — runner CLI honoring the fixed contract.
- `modal/README.md` — setup, secrets, cost math, fallback plan.

## Design decisions
- **x2 upscale + face restore, then encode at source fps with audio copied** (`-c:a copy`). The standard "enhance" recipe: Real-ESRGAN x2 → GFPGAN with `bg_upsampler` set so background and faces resolve in one pass; result downscaled naturally by the CRF-18 encode so no resolution change is delivered (files stay 1080x1920 — platforms re-encode anyway; the gain is in perceived sharpness/face detail).
- **`tile=384, half=True`** keeps T4 VRAM flat across 1080x1920 frames.
- **Per-frame fallback:** an OOM/RuntimeError on one frame keeps the original frame rather than failing the clip; logged as `ENHANCE_FRAME_FALLBACK`.
- **Failure mapping** in the runner: credits (402/403) → `credits_exhausted`; missing deploy → `app_not_deployed`; auth → `auth_failed`; anything else → `modal_error:<type>`. ALL skip (exit 0, file copied) by design.

## License trail (commercial SaaS)
Real-ESRGAN BSD-3 · GFPGAN Apache-2.0 · facexlib MIT · basicsr Apache-2.0.
CodeFormer / InsightFace / Ultralytics YOLO deliberately excluded (non-commercial / AGPL).

## Cost math
T4 ≈ $0.59/h → 30s clip ≈ 900 frames ≈ 6-10 min ≈ $0.06-0.10 → $30 free ≈ **300-450 HD clips/month**. Beyond that: 402 → graceful degrade (documented), or pay-as-you-go.

## Tested
- `py_compile` both files: OK.
- Unconfigured path (the one that matters for pipeline safety): with no Modal token, on a real 2s test clip → exit 0, output file exists and ffprobe-valid (video+audio), stdout ends `ENHANCE_SKIPPED reason=not_configured`.
- Modal-package-missing branch and exception→reason mapping: code-reviewed, not executed (would need a real token).

## Not tested (requires owner action)
The actual GPU path: `pip install modal && modal token new && modal deploy modal/enhance_app.py`, set `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET` GitHub secrets, then trigger a job with `enhance_tier=hd`. First call includes ~2-4 min image build.
