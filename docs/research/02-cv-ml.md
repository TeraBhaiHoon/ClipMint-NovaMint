# ClipMint — Computer Vision & ML Model Research (`02-cv-ml.md`)

**Scope:** face detection & tracking · active speaker detection (ASD) · segmentation & matting · restoration & upscaling · scene/shot & content analysis.
**Purpose:** make ClipMint's video understanding *enterprise-grade* while respecting a hard constraint: **GitHub Actions standard runners are CPU-only** (typically 2–4 vCPU / 7–16 GB RAM, no GPU, ~6 h max job).
**Status:** research only, no code shipped.

> **How to read this doc.** Every tool lists **name · GitHub URL · licence · runtime (CPU/GPU) · model size · where it runs** (GitHub-Actions-CPU / Modal-free-GPU / local-GPU). Licence red flags are marked 🔴 (copyleft / non-commercial / unclear) and green ✅ (permissive). Licences were verified against the upstream repo/HF card at time of writing (see **Sources**).

---

## 0. Executive summary (60-second version)

1. **Face detection/tracking on a CPU runner:** **OpenCV YuNet** (`cv.FaceDetectorYN`, MIT, ~0.23 MB) wins — millisecond inference, ships inside `opencv-python`, zero extra deps. Pair with **Norfair** (BSD-3, pure NumPy) or **ByteTrack** (MIT). Keep InsightFace SCRFD/ArcFace for *offline* identity clustering; **never ship its pretrained weights commercially** (non-commercial only).
2. **Active speaker detection is the single biggest quality upgrade for panels/interviews.** **Light-ASD** (MIT, CVPR 2023) is ~1 M params and CPU-feasible; **TalkNet-ASD** (MIT) is the accuracy benchmark. Use **pyannote** (MIT code / CC-BY-4.0 `community-1` weights) or **WhisperX** (BSD-2) for *who-spoke-when* and fuse with face tracks.
3. **Segmentation/matting:** **MediaPipe Selfie Segmentation** (Apache-2.0) for cheap CPU cutouts; **MODNet** (Apache-2.0) and **BiRefNet** (MIT) for portrait matting; **SAM 2.1 / MobileSAM / EfficientSAM** (Apache-2.0) for prompt-based isolation. **Avoid Robust Video Matting — GPL-3.0.**
4. **Restoration/upscaling:** **Real-ESRGAN** (BSD-3) + **GFPGAN** (Apache-2.0) are the safest commercial combo but **GPU-bound → Modal free GPU**. **CodeFormer is S-Lab non-commercial.** Add **DeepFilterNet** (MIT/Apache-2.0, CPU) and **SCUNet** (Apache-2.0).
5. **Scene/content:** **PySceneDetect** (BSD-3) on CPU; **TransNetV2** (MIT) for gradual transitions; **CLIP/X-CLIP** (MIT) + **LAION aesthetic predictor** (MIT) for scoring; **Depth Anything V2-Small** (Apache-2.0; *Base/Large/Giant are CC-BY-NC*) for 2.5D parallax; **GroundingDINO/OWL-ViT** (Apache-2.0) for b-roll matching.
6. **The AGPL landmine:** **Ultralytics YOLO = AGPL-3.0** and **YOLO-World = GPL-3.0**. For a network service or distributed binary you must open-source or buy a commercial licence. **#1 licensing decision.**

**Recommended default pipeline (CPU-first, GPU-on-demand):**

```
GitHub Actions CPU runner (per clip):
  ffmpeg decode → PySceneDetect shot cuts
  → OpenCV YuNet faces (every Nth frame) → ByteTrack/Norfair face tracks
  → pyannote/WhisperX speaker segments (audio → who spoke when)
  → fuse: assign each face track a speaker id (audio-visual heuristic)
  → MediaPipe Selfie Seg or MODNet alpha for vertical crop/matte
  → CLIP + LAION aesthetic score to rank candidate moments
Modal free GPU (batch, optional):
  → Real-ESRGAN + GFPGAN upscale/enhance final export
  ---

## 1. Face detection & tracking

### 1.1 Detectors

| Model | Repo | Licence | Runtime | Size | Runs on |
|---|---|---|---|---|---|
| **OpenCV YuNet** | [opencv/opencv_zoo · face_detection_yunet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) | ✅ **MIT** | CPU ✅ ms-level; GPU optional | ~0.23 MB fp32; int8 & block-quant variants | GitHub-Actions-CPU |
| **MediaPipe Face Detector** (BlazeFace short-range) | [google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe) | ✅ **Apache-2.0** | CPU ✅ / mobile GPU | ~0.2 MB tflite | GitHub-Actions-CPU |
| **MediaPipe Face Landmarker** (FaceMesh-V2, **478 3-D landmarks + 52 blendshapes**) | [Face landmarker guide](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) | ✅ **Apache-2.0** | CPU ✅ ~few ms/face | FaceDet 192² + FaceMesh 256² + blendshape bundle (one `.task`) | GitHub-Actions-CPU |
| **InsightFace SCRFD** | [deepinsight/insightface · model_zoo](https://github.com/deepinsight/insightface/tree/master/model_zoo) | 🔴 **code MIT, pretrained weights non-commercial research only** | CPU ✅ (500M), GPU fast | 0.57 M (500M) → 9.8 M (34G) | GPU preferred; CPU OK for 500M |
| **InsightFace RetinaFace-R50** | same | 🔴 non-commercial weights | GPU | ~27 M | GPU |
| **Ultralytics YOLOv8/v11-face** | [ultralytics/ultralytics](https://github.com/ultralytics/ultralytics) | 🔴 **AGPL-3.0** (Enterprise licence available) | CPU ✅ / GPU | 3–68 M (n→x) | Either (licence risk) |
| **MTCNN** | [ipazc/mtcnn](https://github.com/ipazc/mtcnn) | ✅ **MIT** | CPU ✅ | ~1–2 M PNet/RNet/ONet | GitHub-Actions-CPU |
| **S³FD** | [sfzhang15/SFD](https://github.com/sfzhang15/SFD) | ⚠️ **no explicit licence** (Caffe/SSD research code) | GPU (Caffe) | ~20 M | Legacy; avoid |

**Recommendation.** **YuNet** as the always-on detector (WIDER FACE AP easy/medium/hard **0.88 / 0.87 / 0.75**; 2026 int8/block-quant variants lose <0.3 AP). Add **MediaPipe Face Landmarker** when you need eye/mouth geometry (auto-reframe, mouth-open signals for ASD, smile-gated thumbnails, face-centre for vertical crop). Use **SCRFD** only in a GPU-side identity-clustering job for non-commercial/dev use.

### 1.2 Trackers

| Tracker | Repo | Licence | Runtime | Notes |
|---|---|---|---|---|
| **ByteTrack** | [FoundationVision/ByteTrack](https://github.com/FoundationVision/ByteTrack) | ✅ **MIT** | CPU ✅ (association cheap; detector dominates) | Associates *every* box (incl. low-score) → fewer ID switches; 76.6 MOTA MOT17. |
| **BoT-SORT / -ReID** | [NirAharon/BoT-SORT](https://github.com/NirAharon/BoT-SORT) | ✅ **MIT** | CPU ✅ (ReID adds cost) | Camera-motion compensation + better Kalman; SOTA MOT17/20. GMC via OpenCV `videostab` (C++ binding only); Python `--cmc-method orb|ecc|files`. |
| **Norfair** | [tryolabs/norfair](https://github.com/tryolabs/norfair) | ✅ **BSD-3-Clause** | CPU ✅ (pure Python/NumPy) | Works with **any** detector (boxes/keypoints/2-D points), custom distance fn, moving camera + ReID. **Best fit for face/landmark tracks.** |
| **DeepSORT (original)** | nwojke/deep_sort | 🔴 **GPL-3.0** | CPU ✅ | Original is GPL → avoid in proprietary code. |
| **DeepSORT (PyTorch)** | [ZQPei/deep_sort_pytorch](https://github.com/ZQPei/deep_sort_pytorch) | ✅ **MIT** | CPU ✅ | MIT re-implementation; usable. |

**Recommendation.** **Norfair** for face/landmark tracks (licence-clean, detector-agnostic, camera-motion aware) or **ByteTrack** if you already emit YOLO/SCRFD boxes. Add **Kalman/EMA** smoothing + bbox interpolation for smooth auto-reframe; use optical flow for sub-frame drift.

### 1.3 Optical flow & stabilisation

| Tool | Repo | Licence | Runtime | Use |
|---|---|---|---|---|
| **Farnebäck / DIS (OpenCV)** | opencv | ✅ Apache-2.0 | CPU ✅ fast | Frame-to-frame motion for smoothing & shot-change hints. |
| **RAFT** | [princeton-vl/RAFT](https://github.com/princeton-vl/RAFT) | ✅ **BSD-3-Clause** | **GPU preferred** (CUDA ext) | High-quality flow for warping / 2.5D parallax. |
| **python_video_stab (vidstab)** | [AdamSpannbauer/python_video_stab](https://github.com/AdamSpannbauer/python_video_stab) | ✅ **MIT** | CPU ✅ | Nghia-Ho 2-D stabilisation (dx,dy,angle); frame layering; CSV transforms. |
| **Gyroflow** | [gyroflow/gyroflow](https://github.com/gyroflow/gyroflow) | 🔴 **GPL-3.0** (App-Store exception; links closed `mdk-sdk`) | GPU render | Only if source has gyro metadata (GoPro/Sony/Insta360). **GPL → don't link into proprietary pipeline.** |

### 1.4 CPU vs GPU verdict — faces
- **GitHub Actions CPU runner:** YuNet (+ MediaPipe landmarks) + Norfair/ByteTrack, sampling every 3rd–5th frame, **is feasible** for a 10-min 1080p video in a few minutes.
- **Modal free GPU:** SCRFD-10G, YOLO-face, RAFT and per-frame ASD → 10–50× CPU throughput.
- **Local GPU:** every-frame, full-resolution budgets; best for hero/export clips.