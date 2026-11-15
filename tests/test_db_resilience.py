import json
import sys
from types import SimpleNamespace

import pytest
import requests
import db


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "test-key")
    monkeypatch.setattr(db.time, "sleep", lambda _: None)


def test_network_exhaustion_has_specific_transient_error(monkeypatch):
    calls = []
    def request(*args, **kwargs):
        calls.append(kwargs)
        raise requests.ReadTimeout("temporary")
    monkeypatch.setattr(db.requests, "request", request)
    with pytest.raises(db.DatabaseUnavailable):
        db.Supabase().set_status("job", "downloading", 5)
    assert len(calls) == 3
    assert calls[0]["timeout"] == (10, 30)


def test_cli_best_effort_defers_only_transient_progress_errors(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["db", "set-status", "--job-id", "job", "--status", "downloading", "--best-effort"])
    monkeypatch.setattr(db.Supabase, "set_status", lambda *args: (_ for _ in ()).throw(db.DatabaseUnavailable("outage")))
    db.main()
    assert "STATUS_DEFERRED" in capsys.readouterr().out


def test_final_status_stays_strict_even_with_best_effort(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["db", "set-status", "--job-id", "job", "--status", "done", "--best-effort"])
    monkeypatch.setattr(db.Supabase, "set_status", lambda *args: (_ for _ in ()).throw(db.DatabaseUnavailable("outage")))
    with pytest.raises(db.DatabaseUnavailable):
        db.main()


def test_auth_error_stays_strict(monkeypatch):
    monkeypatch.setattr(db.requests, "request", lambda *args, **kwargs: SimpleNamespace(status_code=401, text="unauthorized"))
    with pytest.raises(RuntimeError, match="HTTP 401"):
        db.Supabase().set_status("job", "downloading", 5)


def test_rate_limit_retries_and_does_not_sleep_after_final_try(monkeypatch):
    sleeps = []
    monkeypatch.setattr(db.time, "sleep", sleeps.append)
    monkeypatch.setattr(db.requests, "request", lambda *args, **kwargs: SimpleNamespace(status_code=429, text="rate limited"))
    with pytest.raises(db.DatabaseUnavailable):
        db.Supabase().update_job("job", status="done")
    assert sleeps == [1, 2]
