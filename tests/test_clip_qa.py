"""clip_qa scoring: caption checks + report weights (ffmpeg I/O monkeypatched)."""
import json

import pytest

from clip_qa import build_report, caption_checks
from conftest import dense_words


# ── caption_checks ───────────────────────────────────────────────────────
def test_caption_checks_dense_passes():
    caps = dense_words(0, 30)
    defects, first = caption_checks(caps, 30.0)
    assert defects == []
    assert first == pytest.approx(0.0)


def test_caption_checks_sparse_flags_coverage():
    caps = [{"text": "w", "startMs": 0, "endMs": 300}]  # 0.3s of 30s = 1%
    defects, _ = caption_checks(caps, 30.0)
    assert any("coverage" in d for d in defects)


# ── build_report (probe + analyse stubbed) ───────────────────────────────
@pytest.fixture
def stub_ffmpeg(monkeypatch):
    def _probe(path):
        return {"duration": 30.0, "bitrate": 4_000_000, "has_audio": True,
                "width": 1080, "height": 1920, "fps": 30.0, "vcodec": "h264"}

    def _analyse(path):
        return {"lufs": -14.2, "true_peak_dbfs": -1.6, "black_segments": [],
                "freeze_segments": [], "silence_segments": []}

    monkeypatch.setattr("clip_qa.probe", _probe)
    monkeypatch.setattr("clip_qa.analyse", _analyse)


def test_clean_clip_scores_high(stub_ffmpeg, tmp_path):
    clip = tmp_path / "c.mp4"
    clip.write_bytes(b"x")
    report = build_report(str(clip), None)
    assert report["score"] >= 90
    fails = [c for c in report["checks"] if c["status"] == "fail"]
    assert fails == []
    # unmeasured captions is a warn, never a fail
    caps_check = next(c for c in report["checks"] if c["id"] == "captions")
    assert caps_check["status"] == "warn"


def test_bad_clip_loses_points_per_problem(monkeypatch, tmp_path):
    monkeypatch.setattr("clip_qa.probe", lambda p: {
        "duration": 30.0, "bitrate": 300_000, "has_audio": True,
        "width": 640, "height": 360, "fps": 90.0, "vcodec": "h264"})
    monkeypatch.setattr("clip_qa.analyse", lambda p: {
        "lufs": -30.0, "true_peak_dbfs": 0.1,
        "black_segments": [{"start": 0, "end": 5, "duration": 5.0}],
        "freeze_segments": [{"start": 5, "end": 9, "duration": 4.0}],
        "silence_segments": [(26.0, 30.0)]})
    clip = tmp_path / "c.mp4"
    clip.write_bytes(b"x")
    report = build_report(str(clip), None)
    assert report["score"] < 40
    ids = {c["id"] for c in report["checks"] if c["status"] == "fail"}
    assert {"loudness", "clipping", "black", "resolution", "fps",
            "bitrate", "dead_air"} <= ids


def test_captions_file_scores_the_gate(monkeypatch, tmp_path):
    monkeypatch.setattr("clip_qa.probe", lambda p: {
        "duration": 30.0, "bitrate": 4_000_000, "has_audio": True,
        "width": 1080, "height": 1920, "fps": 30.0, "vcodec": "h264"})
    monkeypatch.setattr("clip_qa.analyse", lambda p: {
        "lufs": -14.0, "true_peak_dbfs": -2.0, "black_segments": [],
        "freeze_segments": [], "silence_segments": []})
    clip = tmp_path / "c.mp4"
    clip.write_bytes(b"x")
    caps = tmp_path / "c.json"
    caps.write_text(json.dumps(dense_words(0, 30)))
    report = build_report(str(clip), str(caps))
    caps_check = next(c for c in report["checks"] if c["id"] == "captions")
    assert caps_check["status"] == "pass"
    assert report["score"] >= 90


def test_every_check_records_value_and_label(stub_ffmpeg, tmp_path):
    clip = tmp_path / "c.mp4"
    clip.write_bytes(b"x")
    report = build_report(str(clip), None)
    for c in report["checks"]:
        assert c["label"] and c["id"] and c["status"] in ("pass", "warn", "fail")
