"""
ClipMint — Modal GPU "HD enhance" app.

Pipeline: frames → Real-ESRGAN x2 (BSD-3) → GFPGAN face restore (Apache-2.0)
→ reassemble with audio copied untouched.

Licensing notes (commercial SaaS — all verified 2026-09-18):
  * Real-ESRGAN  : BSD-3-Clause        — OK
  * GFPGAN       : Apache-2.0          — OK
  * facexlib     : MIT (GFPGAN's face detector dependency) — OK
  * CodeFormer / InsightFace / Ultralytics YOLO are deliberately NOT used
    (non-commercial / AGPL licenses).

Weights are cached in a Modal Volume so they download once:
  /models/RealESRGAN_x2plus.pth   (https://github.com/xinntao/Real-ESRGAN releases)
  /models/GFPGANv1.4.pth          (https://github.com/TencentARC/GFPGAN releases)
  /models/detection_Resnet50_Final.pth (facexlib RetinaFace, via facexlib release)

Setup (one-time):  pip install modal && modal token new && modal deploy modal/enhance_app.py
GitHub secrets:    MODAL_TOKEN_ID, MODAL_TOKEN_SECRET
"""

import modal

app = modal.App("clipmint-enhance")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0", "curl")
    .pip_install(
        "torch==2.4.1",
        "torchvision==0.19.1",
        index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install(
        "opencv-python-headless>=4.9",
        "numpy<2",
        "tqdm",
        "basicsr>=1.4.2",
        "facexlib>=0.3.0",
        "gfpgan==1.3.8",
        "realesrgan==0.3.0",
        "requests",
    )
    .run_commands(
        # Pre-fetch weights into the image layer so cold starts stay warm.
        "mkdir -p /models",
        "curl -fsSL -o /models/RealESRGAN_x2plus.pth "
        "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth",
        "curl -fsSL -o /models/GFPGANv1.4.pth "
        "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.4/GFPGANv1.4.pth",
        "curl -fsSL -o /models/detection_Resnet50_Final.pth "
        "https://github.com/xinntao/facexlib/releases/download/v0.1.0/detection_Resnet50_Final.pth",
    )
)

volume = modal.Volume.from_name("clipmint-models", create_if_missing=True)

GPU = "T4"          # cheapest tier; ~$0.59/h → a 10-min clip ≈ $0.10
TIMEOUT_S = 1800    # a 60s clip can need ~15 min on a T4


@app.function(image=image, gpu=GPU, timeout=TIMEOUT_S, volumes={"/models": volume})
def enhance(video_bytes: bytes) -> bytes:
    """Upscale + face-restore one clip. Input/output are full MP4 files."""
    import os
    import subprocess
    import tempfile
    from pathlib import Path

    work = Path(tempfile.mkdtemp())
    src = work / "in.mp4"
    src.write_bytes(video_bytes)

    frames = work / "frames"
    enhanced = work / "enhanced"
    frames.mkdir()
    enhanced.mkdir()

    # 1. Extract frames (ffmpeg copies nothing — re-encode to PNG).
    subprocess.run(
        ["ffmpeg", "-i", str(src), "-vsync", "0", str(frames / "f_%06d.png"),
         "-y", "-loglevel", "error"],
        check=True,
    )

    # 2. Load models once (weights from the pre-baked /models dir).
    from gfpgan import GFPGANer
    from realesrgan import RealESRGANer
    from basicsr.archs.rrdbnet_arch import RRDBNet

    model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23,
                    num_grow_ch=32, scale=2)
    upsampler = RealESRGANer(
        scale=2,
        model_path="/models/RealESRGAN_x2plus.pth",
        model=model,
        tile=384,       # keep VRAM flat on a T4
        tile_pad=10,
        pre_pad=0,
        half=True,      # fp16 on GPU
    )
    restorer = GFPGANer(
        model_path="/models/GFPGANv1.4.pth",
        upscale=2,
        arch="clean",
        channel_multiplier=2,
        bg_upsampler=upsampler,
    )

    import cv2

    names = sorted(p.name for p in frames.glob("f_*.png"))
    if not names:
        raise RuntimeError("no frames extracted")

    for name in names:
        img = cv2.imread(str(frames / name))
        if img is None:
            continue
        try:
            # 3a. Real-ESRGAN x2, then 3b. face restore on the result.
            _, _, restored = restorer.enhance(
                img, has_aligned=False, only_center_face=False, paste_back=True
            )
        except RuntimeError as exc:  # OOM etc. — keep the original frame
            print(f"ENHANCE_FRAME_FALLBACK {name}: {exc}")
            restored = img
        cv2.imwrite(str(enhanced / name), restored)

    # 4. Reassemble at the source fps; audio copied untouched.
    out = work / "out.mp4"
    fps = subprocess.run(
        ["ffprobe", "-v", "quiet", "-select_streams", "v:0",
         "-show_entries", "r_frame_rate", "-of", "csv=p=0", str(src)],
        capture_output=True, text=True, check=True,
    ).stdout.strip() or "30/1"

    subprocess.run(
        ["ffmpeg", "-framerate", fps, "-i", str(enhanced / "f_%06d.png"),
         "-i", str(src), "-map", "0:v:0", "-map", "1:a:0?",
         "-c:v", "libx264", "-preset", "medium", "-crf", "18",
         "-pix_fmt", "yuv420p", "-c:a", "copy",
         "-shortest", "-movflags", "+faststart", str(out),
         "-y", "-loglevel", "error"],
        check=True,
    )

    result = out.read_bytes()
    print(f"ENHANCE_INNER_OK frames={len(names)} bytes_in={len(video_bytes)} "
          f"bytes_out={len(result)}")
    return result
