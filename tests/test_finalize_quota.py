import json
from types import SimpleNamespace

import pytest
import requests
import db
import save_results


@pytest.fixture(autouse=True)
def environment(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "test-key")
    monkeypatch.setattr(db.time, "sleep", lambda _: None)


def test_finalization_calls_one_atomic_rpc(monkeypatch):
    calls = []
    def request(method, url, **kwargs):
        calls.append((method, url, kwargs["json"]))
        return SimpleNamespace(status_code=200, text="2")
    monkeypatch.setattr(db.requests, "request", request)
    clips = [{"clip_index": 0}, {"clip_index": 1}]
    assert db.Supabase().finalize_job("job", clips, {"drive_folder_id": "folder"}) == 2
    assert calls == [("POST", "https://example.supabase.co/rest/v1/rpc/finalize_job_results", {
        "p_job_id": "job", "p_clips": clips, "p_meta": {"drive_folder_id": "folder"},
    })]


def test_lost_completion_response_retries_the_same_idempotent_rpc(monkeypatch):
    calls = []
    def request(method, url, **kwargs):
        calls.append((url, kwargs["json"]))
        if len(calls) == 1:
            raise requests.ReadTimeout("commit may already have succeeded")
        return SimpleNamespace(status_code=200, text="5")
    monkeypatch.setattr(db.requests, "request", request)
    assert db.Supabase().finalize_job("job", [{"clip_index": 0}], {}) == 5
    assert len(calls) == 2
    assert calls[0] == calls[1]


def test_missing_migration_fails_completion_loudly(monkeypatch):
    monkeypatch.setattr(db.requests, "request", lambda *a, **k: SimpleNamespace(status_code=404, text="function missing"))
    with pytest.raises(RuntimeError, match="not found"):
        db.Supabase().finalize_job("job", [{"clip_index": 0}], {})


def test_refund_is_job_based_not_arbitrary_user_counter(monkeypatch):
    calls = []
    monkeypatch.setattr(db.requests, "request", lambda method, url, **kwargs: (
        calls.append((url, kwargs["json"])) or SimpleNamespace(status_code=200, text="false")))
    assert db.Supabase().fail_job("job", "failed", "cancelled") is False
    assert calls == [("https://example.supabase.co/rest/v1/rpc/fail_job_quota", {
        "p_job_id": "job", "p_message": "failed", "p_status": "cancelled",
    })]


def test_result_rows_preserve_variants_and_explicit_render_failures(tmp_path):
    output, clips = tmp_path / "output", tmp_path / "clips"
    output.mkdir()
    clips.mkdir()
    (output / "upload_manifest.json").write_text(json.dumps({"clips": [
        {"name": "clip_000_captioned.mp4", "id": "master", "url": "https://drive/master"},
        {"name": "clip_000_1x1.mp4", "id": "square", "url": "https://drive/square"},
    ]}))
    (clips / "clips_manifest.json").write_text(json.dumps([{"file": "clip_000.mp4", "start": 5, "end": 25, "duration": 20}]))
    (clips / "viral_moments.json").write_text(json.dumps({"clips": [
        {"start_time": 4, "end_time": 26, "title": "Delivered"},
        {"start_time": 30, "end_time": 50, "title": "Failed"},
    ]}))
    (tmp_path / "render_report.json").write_text(json.dumps({"results": [
        {"index": 0, "variant": "9x16", "ok": True},
        {"index": 0, "variant": "1x1", "ok": True},
        {"index": 1, "variant": "9x16", "ok": False},
    ]}))
    rows, failed = save_results.build_rows("job", "user", tmp_path)
    assert [(row["clip_index"], row["variant"], row["status"]) for row in rows] == [
        (0, "9x16", "ready"), (0, "1x1", "ready"), (1, "9x16", "failed"),
    ]
    assert rows[0]["start_time"] == 5 and rows[0]["end_time"] == 25
    assert rows[2]["storage_path"] is None and rows[2]["drive_file_id"] == ""
    assert failed == ["1:9x16"]


def test_finalizer_persists_restored_language_report_and_duration(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("JOB_ID", "job")
    output = tmp_path / "workspace" / "output"
    output.mkdir(parents=True)
    (output / "upload_manifest.json").write_text(json.dumps({"folder_id": "folder"}))
    report = {"language": "hi", "source_duration": 310, "words": 25, "conversion": {"satisfied": True}}
    (output / "transcription_meta.json").write_text(json.dumps(report))
    calls = []
    class FakeDB:
        def get_job(self, job_id):
            return {"user_id": "user"}
        def finalize_job(self, job_id, clips, meta):
            calls.append(meta)
    monkeypatch.setattr(save_results, "Supabase", FakeDB)
    monkeypatch.setattr(save_results, "build_rows", lambda *a: ([{"clip_index": 0}], []))
    save_results.main()
    assert calls[0]["detected_language"] == "hi"
    assert calls[0]["transcription_report"] == report
    assert calls[0]["video_duration_seconds"] == 310

