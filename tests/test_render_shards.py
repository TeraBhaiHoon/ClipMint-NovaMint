"""render_clips matrix partition: each shard renders and reports ONLY its own
clips (regression for the 16/17 false-failure bug, commit e52f5eb)."""
import json
import sys

import pytest

import render_clips as rc


@pytest.fixture
def fake_render(monkeypatch):
    calls = []

    def _render_one(entry, *args, **kwargs):
        calls.append(entry["index"])
        return {"index": entry["index"], "variant": "9x16", "ok": True, "bytes": 1}

    monkeypatch.setattr(rc, "render_one", _render_one)
    monkeypatch.setattr(rc, "load_bgm_map", lambda: {})
    monkeypatch.delenv("CLIPMINT_JOB_ID", raising=False)  # no progress pings
    return calls


def _run(monkeypatch, tmp_path, n_clips, shard, count):
    clips = tmp_path / "clips"
    clips.mkdir(exist_ok=True)
    manifest = [{"index": i, "file": f"clip_{i:03d}.mp4", "duration": 30.0,
                 "has_audio": True, "start": i * 30.0, "end": i * 30.0 + 30}
                for i in range(n_clips)]
    (clips / "clips_manifest.json").write_text(json.dumps(manifest))
    report = tmp_path / f"report-{shard}.json"
    monkeypatch.setattr(sys, "argv", [
        "render_clips", "--clipsdir", str(clips), "--outdir", str(tmp_path / "out"),
        "--remotion-dir", str(tmp_path / "remotion"), "--formats", "9x16",
        "--shard-index", str(shard), "--shard-count", str(count),
        "--report", str(report), "--allow-empty", "--concurrency", "2",
    ])
    rc.main()
    return json.loads(report.read_text())


@pytest.mark.parametrize("shard,expected", [(0, [0, 3]), (1, [1, 4]), (2, [2])])
def test_each_shard_renders_only_its_round_robin_subset(
        monkeypatch, tmp_path, fake_render, shard, expected):
    report = _run(monkeypatch, tmp_path, 5, shard, 3)
    assert sorted(fake_render) == expected
    assert [r["index"] for r in report["results"]] == expected
    assert report["requested"] == len(expected)


def test_shards_together_cover_every_clip_exactly_once(monkeypatch, tmp_path, fake_render):
    seen = []
    for shard in range(4):
        seen += [r["index"] for r in _run(monkeypatch, tmp_path, 7, shard, 4)["results"]]
    assert sorted(seen) == list(range(7))


def test_single_shard_renders_everything(monkeypatch, tmp_path, fake_render):
    report = _run(monkeypatch, tmp_path, 3, 0, 1)
    assert [r["index"] for r in report["results"]] == [0, 1, 2]
