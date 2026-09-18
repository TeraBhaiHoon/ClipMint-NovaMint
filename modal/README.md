# Modal GPU Enhance — "HD" tier

Optional pass that upscales and face-restores finished clips using Real-ESRGAN
(BSD-3) + GFPGAN (Apache-2.0) on Modal's free $30/month compute. Never a
dependency: when Modal isn't configured or credits run out, clips ship in
standard quality and the pipeline logs `ENHANCE_SKIPPED reason=...`.

## One-time setup

```bash
pip install modal
modal token new          # opens browser; creates ~/.modal.toml
cd modal && modal deploy enhance_app.py
```

For GitHub Actions instead of a local token file, set repo secrets:
- `MODAL_TOKEN_ID`
- `MODAL_TOKEN_SECRET`

The runner (`pipeline/gpu_enhance.py`) picks up either source automatically.

## What the deploy does

`enhance_app.py` builds a CUDA image (torch cu121 + basicsr/facexlib/gfpgan/
realesrgan), pre-downloads the three model weights into the image layer
(RealESRGAN_x2plus, GFPGANv1.4, facexlib RetinaFace), and publishes the
function `clipmint-enhance.enhance`. First call compiles the image (~2-4 min);
later calls start in seconds.

## Cost math

T4 ≈ $0.59/h (check modal.com/pricing for the current number). A 30s 1080x1920
clip ≈ 900 frames ≈ 6-10 min on T4 ≈ $0.06-0.10. The $30 free monthly credit ≈
**300-450 enhanced clips/month**. When credits exhaust, Modal returns 402/403;
the runner maps that to `ENHANCE_SKIPPED reason=credits_exhausted` and the job
continues. You'd see the reason in the Actions log.

GPU settings live in `modal/enhance_app.py`: `GPU = "T4"`, `TIMEOUT_S = 1800`.

## Workflow wiring (done by the pipeline owner)

The workflow takes an `enhance_tier` input (`standard` | `hd`, default
`standard`). For `hd` it runs, per clip:

```
python3 pipeline/gpu_enhance.py --input clip_XXX.mp4 --output clip_XXX_hd.mp4
```

and uploads whichever file exists (hd on success, standard on skip).

## Fallback plan when Modal credits run out

1. **Degrade gracefully (default).** No HD clips that month; everything else
   works. This is the designed behavior.
2. **Colab / Kaggle manual fallback.** These have no automation API suitable
   for production (Colab's ToS forbids media serving; Kaggle quotas are
   undocumented). The realistic manual path: open the Colab notebook below,
   upload the clip, run the cell, download the result. Fine for a handful of
   premium clips; not a pipeline stage.
3. **Future options:** Modal pay-as-you-go beyond $30, or an Oracle Cloud
   Always-Free ARM box running Real-ESRGAN on CPU (slow but free).

<details>
<summary>Manual Colab notebook cell (fallback 2)</summary>

```python
!pip install -q realesrgan gfpgan basicsr facexlib
!curl -fsSL -o GFPGANv1.4.pth https://github.com/TencentARC/GFPGAN/releases/download/v1.3.4/GFPGANv1.4.pth
# then use GFPGANer as in modal/enhance_app.py, uploading your clip first
```
</details>

## What could not be tested locally

The GPU path itself needs the owner's Modal token and one `modal deploy`.
Everything else (unconfigured skip path, timeout handling, output validation)
is tested; see `_audit/11-modal-enhance.md`.
