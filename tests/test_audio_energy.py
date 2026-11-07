"""audio_energy: astats RMS parsing and the LLM-readable summary."""
from audio_energy import load_series, summarise, window_stats

ASTATS = """frame:0    pts:0       pts_time:0
lavfi.astats.Overall.RMS_level=-24.5
frame:1    pts:4800    pts_time:0.5
lavfi.astats.Overall.RMS_level=-inf
frame:2    pts:9600    pts_time:1.0
lavfi.astats.Overall.RMS_level=-12.0
frame:3    pts:14400   pts_time:1.5
lavfi.astats.Overall.RMS_level=-30.0
"""


def test_series_skips_silence_markers(tmp_path):
    f = tmp_path / "energy.txt"
    f.write_text(ASTATS)
    assert load_series(f) == [(0.0, -24.5), (1.0, -12.0), (1.5, -30.0)]
    assert load_series(tmp_path / "missing.txt") == []


def test_window_stats_and_summary(tmp_path):
    f = tmp_path / "energy.txt"
    f.write_text(ASTATS)
    series = load_series(f)
    assert window_stats(series, 5.0, 9.0) is None
    stats = window_stats(series, 0.0, 2.0)
    assert stats["samples"] == 3 and stats["peak_db"] == -12.0
    text = summarise(stats)
    assert "with loud peaks" in text            # -12 is > avg + 8 dB
    assert summarise(None).endswith("no data")
