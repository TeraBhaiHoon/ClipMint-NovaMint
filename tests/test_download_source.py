import json
from pathlib import Path
from types import SimpleNamespace

import pytest
import subprocess
import yaml

import download_source as downloader

ROOT = Path(__file__).resolve().parents[1]


def test_media_403_is_not_misreported_as_private_because_of_webpage():
    log = '[youtube] Downloading webpage\nERROR: unable to download video data: HTTP Error 403: Forbidden'
    assert downloader.classify_error(log) == "SOURCE_MEDIA_BLOCKED"
    assert downloader.classify_error('ERROR: Private video') == "SOURCE_ACCESS_DENIED"
    assert downloader.classify_error('ERROR: Sign in to confirm your age') == "SOURCE_ACCESS_DENIED"
    assert downloader.classify_error('ERROR: Sign in to confirm you are not a bot') == "YOUTUBE_BOT_CHECK"


def test_supported_clients_no_cookies_and_ipv4_consistency():
    for index in range(3):
        command = downloader.download_command('https://youtu.be/test', Path('out'), index)
        assert '--force-ipv4' in command
        assert '--check-formats' in command
        assert '--write-info-json' in command
        assert '--remux-video' in command
        assert 'tv_embedded' not in ' '.join(command)
        assert 'android_vr' not in ' '.join(command)
        assert '--cookies' not in command
        assert command[-1] == 'https://youtu.be/test'
    assert not downloader.is_youtube('https://notyoutube.com/video')
    assert '--force-ipv4' not in downloader.download_command('https://drive.google.com/file/d/x/view', Path('out'), 0)


def test_warp_failure_never_falls_through_to_raw_runner(tmp_path, monkeypatch):
    def warp(action):
        raise subprocess.CalledProcessError(1, 'warp')
    monkeypatch.setattr(downloader, 'warp', warp)
    with pytest.raises(RuntimeError, match='WARP_UNAVAILABLE'):
        downloader.download('https://youtu.be/test', tmp_path, run=lambda *args, **kwargs: pytest.fail('raw download must not run'))


def test_media_block_refreshes_once_uses_fresh_extraction_and_tears_down(tmp_path, monkeypatch):
    actions, calls = [], []
    monkeypatch.setattr(downloader, 'warp', actions.append)
    monkeypatch.setattr(downloader.time, 'sleep', lambda _: None)
    monkeypatch.setattr(downloader, 'valid_video', lambda path: len(calls) == 2)
    def run(command, **kwargs):
        calls.append(command)
        (tmp_path / 'source.mp4').write_bytes(b'video')
        if len(calls) == 1:
            return SimpleNamespace(returncode=1, stdout='', stderr='HTTP Error 403: Forbidden')
        return SimpleNamespace(returncode=0, stdout='[info] downloaded', stderr='')
    downloader.download('https://youtu.be/test', tmp_path, run=run)
    assert actions == ['up', 'check', 'refresh', 'check', 'down']
    assert len(calls) == 2
    assert (tmp_path / 'source.mp4').exists()


def test_private_source_stops_without_multiple_client_retries(tmp_path, monkeypatch):
    actions = []
    monkeypatch.setattr(downloader, 'warp', actions.append)
    with pytest.raises(RuntimeError, match='SOURCE_ACCESS_DENIED'):
        downloader.download('https://youtu.be/test', tmp_path, run=lambda *args, **kwargs: SimpleNamespace(returncode=1, stdout='', stderr='Private video'))
    assert actions == ['up', 'check', 'down']


def test_direct_media_bypasses_warp(tmp_path, monkeypatch):
    monkeypatch.setattr(downloader, 'warp', lambda _: pytest.fail('direct media does not need WARP'))
    monkeypatch.setattr(downloader, 'valid_video', lambda _: True)
    calls = []
    def run(command, **kwargs):
        calls.append(command)
        return SimpleNamespace(returncode=0)
    downloader.download('https://example.com/video.mp4', tmp_path, run=run)
    assert len(calls) == 1
    assert calls[0][0] == 'curl'


def test_download_deadline_clamps_subprocess_timeout(tmp_path, monkeypatch):
    monkeypatch.setattr(downloader, 'warp', lambda _: None)
    times = iter([0, 0, 7, 8])
    observed = []
    def run(command, **kwargs):
        observed.append(kwargs['timeout'])
        raise subprocess.TimeoutExpired(command, kwargs['timeout'])
    with pytest.raises(RuntimeError, match='time budget'):
        downloader.download('https://youtu.be/test', tmp_path, run=run, budget_seconds=8, clock=lambda: next(times),)
    assert observed == [1]


def test_workflow_shares_download_path_and_saves_transcript_before_optional_cleanup():
    workflow = yaml.safe_load((ROOT / '.github/workflows/process-video.yml').read_text(encoding='utf-8'))
    steps = workflow['jobs']['process']['steps']
    by_name = {step.get('name'): step for step in steps}
    assert 'download_source.py' in by_name['Download source video']['run']
    assert 'download_source.py' in by_name['Resolve checkpoint']['run']
    assert 'yt-dlp[default]' in by_name['Install system dependencies']['run']
    names = [step.get('name') for step in steps]
    assert names.index('Save raw transcription checkpoint') < names.index('Transliterate Devanagari to Hinglish')
    assert 'pipeline/transliterate.py' in by_name['Transliterate Devanagari to Hinglish']['run']
    finalize = {step.get('name'): step for step in workflow['jobs']['finalize']['steps']}
    assert finalize['Download render inputs']['if'] == "needs.process.result == 'success'"
    assert 'failure()' in finalize['Record failure']['if']
    assert 'process-diagnostics/.current_step' in finalize['Determine outcome']['run']
    assert 'CURRENT_STEP:-unknown' in finalize['Notify completion']['run']
    assert finalize['Notify completion']['env']['JOB_STATUS'] == '${{ env.OVERALL_STATUS }}'
    assert finalize['Mark finalization failure']['if'] == 'failure()'
