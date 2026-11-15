"""Resilience tests for pipeline/llm.py — mocked transport, mocked clock.

No real network, no real keys, no real sleeping: `requests` is stubbed with a
scripted handler and `llm.time` is replaced by a FakeTime whose monotonic()
advances only when the code under test sleeps or the test advances it.
"""
import pytest
import requests as real_requests

import llm

NIM1, NIM2, NIM3 = llm.NIM_MODELS
G1, G2, G3 = llm.GROQ_MODELS


# ── fakes ────────────────────────────────────────────────────────────────
class FakeTime:
    """Stands in for the time module inside llm. Backoff sleeps advance the
    clock (like real wall time); tests can advance it manually."""

    def __init__(self, start=1000.0):
        self.now = start
        self.sleeps = []

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds

    def advance(self, seconds):
        self.now += seconds


class _Resp:
    def __init__(self, status, body=None, text=""):
        self.status_code = status
        self._body = body
        self.text = text

    def json(self):
        return self._body


class _StubRequests:
    """Replaces llm.requests. Keeps the real exceptions module (llm catches
    requests.exceptions.Timeout / RequestException) but never touches the
    network."""

    exceptions = real_requests.exceptions

    def __init__(self, handler):
        self._handler = handler

    def post(self, url, headers=None, json=None, timeout=None):
        return self._handler(url, headers, json, timeout)


def _scripted(script, calls):
    """Each scripted outcome: (status, content) for JSON 200s, or
    (status, content, text) for non-200 bodies, or an Exception to raise."""

    def handler(url, headers, json_body, timeout):
        calls.append({
            "url": url,
            "model": json_body["model"],
            "body": json_body,
            "timeout": timeout,
            "headers": headers,
        })
        outcome = script.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        if isinstance(outcome, tuple) and len(outcome) == 3:
            status, _content, text = outcome
            return _Resp(status, text=text)
        status, content = outcome
        return _Resp(status, {"choices": [{"message": {"content": content}}]})

    return handler


def patch_llm(monkeypatch, script):
    calls = []
    monkeypatch.setattr(llm, "requests", _StubRequests(_scripted(script, calls)))
    ft = FakeTime()
    monkeypatch.setattr(llm, "time", ft)
    return calls, ft


def calls_for(calls, model):
    return [c for c in calls if c["model"] == model]


@pytest.fixture(autouse=True)
def _llm_env(monkeypatch):
    llm.reset_breakers()
    monkeypatch.setenv("NVIDIA_NIM_API_KEY", "test-nim-key")
    monkeypatch.setenv("GROQ_API_KEY", "test-groq-key")
    for var in ("CLIPMINT_LLM_MODEL", "CLIPMINT_NIM_MODEL", "CLIPMINT_LLM_TIMEOUT",
                "CLIPMINT_LLM_BUDGET", "CLIPMINT_LLM_BREAKER_COOLDOWN",
                "CLIPMINT_LLM_ORDER"):
        monkeypatch.delenv(var, raising=False)
    yield
    llm.reset_breakers()


# ── chain ordering ───────────────────────────────────────────────────────
def test_default_chain_is_groq_first():
    chain = llm._chain(None)
    assert [c[0] for c in chain] == ["groq", "nim"]


def test_order_kwarg_reorders_chain():
    assert [c[0] for c in llm._chain("nim,groq")] == ["nim", "groq"]
    assert [c[0] for c in llm._chain("groq")] == ["groq", "nim"]      # unnamed appended
    assert [c[0] for c in llm._chain("bogus,groq")] == ["groq", "nim"]  # unknown ignored


def test_order_env_var_and_kwarg_precedence(monkeypatch):
    monkeypatch.setenv("CLIPMINT_LLM_ORDER", "nim,groq")
    assert [c[0] for c in llm._chain(None)] == ["nim", "groq"]
    assert [c[0] for c in llm._chain("groq,nim")] == ["groq", "nim"]  # kwarg wins


# ── outage memory: hard 404 ─────────────────────────────────────────────
def test_hard_404_model_is_probed_once_then_skipped(monkeypatch):
    script = [(404, ""), (200, "ok1"), (200, "ok2")]
    calls, _ = patch_llm(monkeypatch, script)

    assert llm.ask("p", order="nim,groq") == "ok1"
    assert llm.ask("p", order="nim,groq") == "ok2"
    # The dead model was probed exactly once across BOTH ask() calls instead
    # of once per call (the 97-minute transliteration burn).
    assert len(calls_for(calls, NIM1)) == 1
    assert [c["model"] for c in calls] == [NIM1, NIM2, NIM2]


def test_410_also_marks_model_dead(monkeypatch):
    script = [(410, ""), (200, "ok")]
    calls, _ = patch_llm(monkeypatch, script)
    assert llm.ask("p", order="nim,groq") == "ok"
    assert len(calls_for(calls, NIM1)) == 1


# ── timeout breaker ──────────────────────────────────────────────────────
def test_two_consecutive_timeouts_open_breaker_and_skip_model(monkeypatch):
    timeout = real_requests.exceptions.ReadTimeout("read timed out")
    script = [
        (404, ""),                # NIM1 dead
        (404, ""),                # NIM2 dead
        timeout, timeout,         # NIM3: 2 consecutive timeouts -> breaker opens
        (200, "via-groq1"),       # Groq answers
        (200, "via-groq2"),       # next ask(): all NIM skipped, Groq again
    ]
    calls, ft = patch_llm(monkeypatch, script)

    assert llm.ask("p", order="nim,groq") == "via-groq1"
    assert llm.ask("p", order="nim,groq") == "via-groq2"

    # Only 2 glm attempts ever (not 3 per call, not 3 per call forever).
    assert len(calls_for(calls, NIM3)) == 2
    assert len(calls_for(calls, G1)) == 2
    # The mid-call breaker open cut the retry storm short.
    assert ft.sleeps == [5, 10]


def test_single_timeout_does_not_open_breaker(monkeypatch):
    timeout = real_requests.exceptions.ReadTimeout("read timed out")
    script = [timeout, (200, "recovered"), (200, "again")]
    calls, _ = patch_llm(monkeypatch, script)

    assert llm.ask("p", order="nim,groq") == "recovered"
    assert llm.ask("p", order="nim,groq") == "again"
    assert len(calls_for(calls, NIM1)) == 3  # probed every time, no breaker


def test_breaker_reopens_with_scaled_cooldown_after_expired_probe(monkeypatch):
    monkeypatch.setenv("CLIPMINT_LLM_BREAKER_COOLDOWN", "100")
    timeout = real_requests.exceptions.ReadTimeout("read timed out")
    script = [
        (404, ""), (404, ""), timeout, timeout, (200, "g1"),   # open 100s
        timeout, timeout, (200, "g2"),                          # probe re-opens 200s
        (200, "g3"),                                            # still skipped
    ]
    calls, ft = patch_llm(monkeypatch, script)

    assert llm.ask("p", order="nim,groq") == "g1"
    assert llm._BREAKERS[("nim", NIM3)].opens == 1

    ft.advance(100)  # cooldown expired -> half-open probe allowed
    assert llm.ask("p", order="nim,groq") == "g2"
    assert len(calls_for(calls, NIM3)) == 4          # exactly one probe attempt-pair
    assert llm._BREAKERS[("nim", NIM3)].opens == 2
    # 2x scale (200s), minus the 10s backoff sleep that advanced the clock.
    assert llm._BREAKERS[("nim", NIM3)].open_until - ft.now >= 190

    assert llm.ask("p", order="nim,groq") == "g3"
    assert len(calls_for(calls, NIM3)) == 4          # not re-probed early


def test_success_resets_breaker_state(monkeypatch):
    timeout = real_requests.exceptions.ReadTimeout("read timed out")
    script = [timeout, (200, "ok1"), (200, "ok2")]
    calls, _ = patch_llm(monkeypatch, script)

    assert llm.ask("p", order="nim,groq") == "ok1"
    br = llm._BREAKERS[("nim", NIM1)]
    assert br.timeouts == 0
    assert br.open_until == 0.0
    assert llm.ask("p", order="nim,groq") == "ok2"
    assert len(calls_for(calls, NIM1)) == 3


# ── provider-level outage memory ────────────────────────────────────────
def test_401_marks_whole_provider_down(monkeypatch):
    script = [(401, ""), (200, "g1"), (200, "g2")]
    calls, _ = patch_llm(monkeypatch, script)

    assert llm.ask("p", order="nim,groq") == "g1"
    assert llm.ask("p", order="nim,groq") == "g2"
    # One 401 killed the provider for the run: no per-model retry storm.
    assert len(calls_for(calls, NIM1)) == 1
    assert len(calls_for(calls, NIM2)) == 0
    assert len(calls_for(calls, NIM3)) == 0
    assert len(calls_for(calls, G1)) == 2


# ── retriable exhaustion cooldown ───────────────────────────────────────
def test_exhausted_retries_get_short_cooldown_then_reprobe(monkeypatch):
    script = [
        (429, ""), (429, ""), (429, ""),   # NIM1 exhausted -> 90s cooldown
        (200, "ok1"),
        (200, "ok2"),                      # NIM1 skipped, NIM2 answers
        (200, "reprobed"),                 # after cooldown, NIM1 probed again
    ]
    calls, ft = patch_llm(monkeypatch, script)

    assert llm.ask("p", order="nim,groq") == "ok1"
    assert llm.ask("p", order="nim,groq") == "ok2"
    assert len(calls_for(calls, NIM1)) == 3

    ft.advance(90.1)
    assert llm.ask("p", order="nim,groq") == "reprobed"
    assert len(calls_for(calls, NIM1)) == 4


def test_groq_429_burst_falls_through_to_nim_without_a_storm(monkeypatch):
    # Default groq-first chain: a Groq 429 burst exhausts its 3 attempts, then
    # the 90s cooldown keeps later calls off Groq while the TPM window refills.
    script = [
        (429, ""), (429, ""), (429, ""),   # G1 exhausted
        (429, ""), (429, ""), (429, ""),   # G2 exhausted
        (429, ""), (429, ""), (429, ""),   # G3 exhausted
        (200, "nim-rescued"),
        (200, "nim-again"),                # Groq cooldown-skipped on call 2
    ]
    calls, _ = patch_llm(monkeypatch, script)

    assert llm.ask("p") == "nim-rescued"
    assert llm.ask("p") == "nim-again"
    assert len(calls_for(calls, G1)) == 3  # no second storm on call 2
    assert len(calls) == 11               # 9 groq + 1 nim + 1 nim (call 2)


# ── time budget ──────────────────────────────────────────────────────────
def test_budget_bounds_a_stuck_call(monkeypatch):
    monkeypatch.setenv("CLIPMINT_LLM_BUDGET", "8")
    timeout = real_requests.exceptions.ReadTimeout("read timed out")
    script = [timeout, timeout]  # 5s + 10s backoff blows the 8s budget
    calls, _ = patch_llm(monkeypatch, script)

    with pytest.raises(RuntimeError, match="budget"):
        llm.ask("p")
    # No further provider/model attempts after the budget ran out.
    assert len(calls) == 2


def test_budget_zero_disables_the_limit(monkeypatch):
    monkeypatch.setenv("CLIPMINT_LLM_BUDGET", "0")
    script = [(429, ""), (429, ""), (429, ""), (429, ""), (429, ""), (429, ""), (200, "late")]
    calls, _ = patch_llm(monkeypatch, script)
    # Two exhausted Groq models' worth of retries still completes.
    assert llm.ask("p") == "late"
    assert len(calls) == 7


# ── total failure contract ───────────────────────────────────────────────
def test_all_providers_failed_still_raises_runtimeerror(monkeypatch):
    timeout = real_requests.exceptions.ReadTimeout("read timed out")
    script = [
        (429, ""), (429, ""), (429, ""),   # Groq: 3 models x 3 attempts
        (429, ""), (429, ""), (429, ""),
        (429, ""), (429, ""), (429, ""),
        (404, ""), (404, ""), timeout, timeout,   # NIM: dead + breaker
    ]
    calls, ft = patch_llm(monkeypatch, script)

    with pytest.raises(RuntimeError, match="all LLM providers failed"):
        llm.ask("p")
    assert len(calls) == 13
    assert len(ft.sleeps) == 8  # backoffs happened, but never for real


def test_no_keys_raises_before_any_request(monkeypatch):
    monkeypatch.delenv("NVIDIA_NIM_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    calls, _ = patch_llm(monkeypatch, [])
    with pytest.raises(RuntimeError, match="no LLM provider configured"):
        llm.ask("p")
    assert calls == []


# ── response_format compat ───────────────────────────────────────────────
def test_response_format_rejection_retries_once_without_it(monkeypatch):
    script = [
        (400, "", "Error: 'response_format' is not supported for this model"),
        (200, "no-rf-ok"),
    ]
    calls, _ = patch_llm(monkeypatch, script)

    assert llm.ask("p", is_json=True) == "no-rf-ok"
    assert "response_format" in calls[0]["body"]
    assert "response_format" not in calls[1]["body"]


def test_response_format_fix_does_not_consume_max_attempts(monkeypatch):
    # With max_attempts=1 the shape fix must still get its retry.
    script = [
        (400, "", "response_format unsupported"),
        (200, "no-rf-ok"),
    ]
    calls, _ = patch_llm(monkeypatch, script)
    assert llm.ask("p", is_json=True, order="groq,nim", max_attempts=1) == "no-rf-ok"
    assert "response_format" not in calls[1]["body"]


def test_malformed_200_is_retried_in_place(monkeypatch):
    calls = []
    shapes = iter([{"error": "no choices here"},
                   {"choices": [{"message": {"content": "good"}}]}])

    def handler(url, headers, json_body, timeout):
        calls.append({"model": json_body["model"]})
        return _Resp(200, shapes.__next__())

    monkeypatch.setattr(llm, "requests", _StubRequests(handler))
    ft = FakeTime()
    monkeypatch.setattr(llm, "time", ft)

    assert llm.ask("p") == "good"
    assert len(calls) == 2


# ── time budget: budget_s kwarg + hard deadline clamping ────────────────
def test_budget_s_clamps_request_timeout_and_sleeps(monkeypatch):
    # budget_s=8 with the 120s default per-attempt timeout: the request
    # timeout is clamped to the remaining budget and the retry sleep is
    # clamped too — the call cannot overshoot by a full request or a full
    # backoff, and no attempt starts after the deadline.
    timeout = real_requests.exceptions.ReadTimeout("read timed out")
    script = [timeout, (429, "")]
    calls, ft = patch_llm(monkeypatch, script)

    with pytest.raises(RuntimeError, match="budget"):
        llm.ask("p", budget_s=8)
    assert [c["timeout"] for c in calls] == [8.0, 3.0]  # 120 -> 8, then 120 -> 3
    assert ft.sleeps == [5, 3]                          # 5 fits, 10 clamped to 3
    assert len(calls) == 2                              # no third attempt past deadline


def test_budget_s_zero_disables_the_cap(monkeypatch):
    script = [(429, ""), (429, ""), (429, ""), (429, ""), (429, ""), (429, ""), (200, "late")]
    calls, _ = patch_llm(monkeypatch, script)
    assert llm.ask("p", budget_s=0) == "late"
    assert len(calls) == 7


def test_budget_s_overrides_env_budget(monkeypatch):
    monkeypatch.setenv("CLIPMINT_LLM_BUDGET", "999")
    timeout = real_requests.exceptions.ReadTimeout("read timed out")
    script = [timeout, timeout]
    calls, _ = patch_llm(monkeypatch, script)

    with pytest.raises(RuntimeError, match="budget"):
        llm.ask("p", budget_s=8)
    assert [c["timeout"] for c in calls] == [8.0, 3.0]  # env 999 ignored, 8 wins


def test_no_sleep_after_the_final_attempt_of_a_model(monkeypatch):
    script = [(429, ""), (429, ""), (429, ""), (200, "next-model")]
    calls, ft = patch_llm(monkeypatch, script)
    assert llm.ask("p") == "next-model"
    assert ft.sleeps == [5, 10]  # between attempts only — never after the last one


# ── chain dedup ──────────────────────────────────────────────────────────
def test_chain_dedups_repeated_order_names():
    assert [c[0] for c in llm._chain("groq,groq")] == ["groq", "nim"]
    assert [c[0] for c in llm._chain("nim,nim,groq")] == ["nim", "groq"]


def test_repeated_order_names_do_not_retry_a_provider_twice(monkeypatch):
    script = [(404, ""), (404, ""), (404, ""), (200, "nim-ok")]
    calls, _ = patch_llm(monkeypatch, script)
    assert llm.ask("p", order="groq,groq") == "nim-ok"
    assert [c["model"] for c in calls] == [G1, G2, G3, NIM1]  # Groq once, not twice


# ── malformed 200 validation ─────────────────────────────────────────────
def test_malformed_shapes_do_not_crash_or_falsely_succeed(monkeypatch):
    bodies = iter([
        ["not", "a", "dict"],                                       # non-dict payload (used to TypeError-crash)
        {"choices": [{"message": {"content": None}}]},              # None content (used to "succeed" empty)
        {"choices": [{"message": {"content": "   "}}]},             # whitespace-only content
        {"choices": [{"message": {"content": {"bad": "shape"}}}]},  # non-string content
        {"choices": [{"message": {"content": "good"}}]},            # finally valid
    ])
    calls = []

    def handler(url, headers, json_body, timeout):
        calls.append({"model": json_body["model"]})
        return _Resp(200, bodies.__next__())

    monkeypatch.setattr(llm, "requests", _StubRequests(handler))
    ft = FakeTime()
    monkeypatch.setattr(llm, "time", ft)

    assert llm.ask("p") == "good"
    assert len(calls) == 5            # G1 exhausted on 3 malformed, G2 recovers
    assert ft.sleeps == [5, 10, 5]    # retried in place, never "succeeded" empty


# ── per-call kwargs (bounded transliteration contract) ───────────────────
def test_bounded_transliteration_call_shape(monkeypatch):
    # The parent's bounded transliteration module calls:
    #   ask(prompt, system=..., is_json=True, max_tokens=3000,
    #       order="groq,nim", timeout_s=min(30, remaining),
    #       max_attempts=1, budget_s=min(45, remaining))
    # One shot per model, 30s ceiling, 45s total deadline, no backoff sleeps.
    timeout = real_requests.exceptions.ReadTimeout("read timed out")
    script = [
        timeout,      # G1: single attempt, no retry
        (429, ""),    # G2: single attempt
        (429, ""),    # G3: single attempt
        (200, "nim-answer"),
    ]
    calls, ft = patch_llm(monkeypatch, script)

    out = llm.ask("p", system="sys", is_json=True, max_tokens=3000,
                  order="groq,nim", timeout_s=30, max_attempts=1, budget_s=45)
    assert out == "nim-answer"
    assert len(calls) == 4
    assert ft.sleeps == []                       # max_attempts=1 -> no backoff
    assert all(c["timeout"] == 30.0 for c in calls)   # min(30, ~45 remaining)
    assert [c["model"] for c in calls] == [G1, G2, G3, NIM1]
    assert calls[0]["body"]["max_tokens"] == 3000
    assert calls[0]["body"]["response_format"] == {"type": "json_object"}


def test_bounded_call_deadline_stops_mid_chain(monkeypatch):
    # budget_s=1 caps the WHOLE call: the request timeout is clamped to the
    # remaining budget, the request consumes its full (clamped) duration, and
    # the next model is refused at the post-deadline check — not attempted.
    calls = []
    ft = FakeTime()

    def handler(url, headers, json_body, timeout):
        calls.append({"model": json_body["model"], "timeout": timeout})
        ft.now += timeout  # a real timed-out request consumes its full duration
        raise real_requests.exceptions.ReadTimeout("read timed out")

    monkeypatch.setattr(llm, "requests", _StubRequests(handler))
    monkeypatch.setattr(llm, "time", ft)

    with pytest.raises(RuntimeError, match="budget"):
        llm.ask("p", order="groq,nim", timeout_s=30, max_attempts=1, budget_s=1)
    assert len(calls) == 1
    assert calls[0]["timeout"] == 1.0    # clamped to budget, not timeout_s
    assert ft.sleeps == []               # no sleep past the deadline


def test_bounded_call_still_succeeds_first_try_when_groq_healthy(monkeypatch):
    script = [(200, "groq-answer")]
    calls, ft = patch_llm(monkeypatch, script)
    out = llm.ask("p", is_json=True, order="groq,nim", timeout_s=30, max_attempts=1)
    assert out == "groq-answer"
    assert len(calls) == 1
    assert ft.sleeps == []


def test_legacy_calls_untouched_by_new_kwargs(monkeypatch):
    # Existing workflow/briefing call shapes keep working unchanged.
    script = [(200, "legacy")]
    calls, _ = patch_llm(monkeypatch, script)
    out = llm.ask("p", system="sys", is_json=True, max_tokens=3000)
    assert out == "legacy"
    assert calls[0]["timeout"] == llm.REQUEST_TIMEOUT  # default, not 30


# ── env overrides ────────────────────────────────────────────────────────
def test_timeout_env_override_reaches_the_request(monkeypatch):
    monkeypatch.setenv("CLIPMINT_LLM_TIMEOUT", "7")
    script = [(200, "ok")]
    calls, _ = patch_llm(monkeypatch, script)

    llm.ask("p")
    assert calls[0]["timeout"] == 7.0


def test_timeout_env_falls_back_to_default_on_garbage(monkeypatch):
    monkeypatch.setenv("CLIPMINT_LLM_TIMEOUT", "abc")
    script = [(200, "ok")]
    calls, _ = patch_llm(monkeypatch, script)

    llm.ask("p")
    assert calls[0]["timeout"] == llm.REQUEST_TIMEOUT


def test_timeout_s_kwarg_wins_over_env(monkeypatch):
    monkeypatch.setenv("CLIPMINT_LLM_TIMEOUT", "999")
    script = [(200, "ok")]
    calls, _ = patch_llm(monkeypatch, script)

    llm.ask("p", timeout_s=30)
    assert calls[0]["timeout"] == 30.0


def test_nim_model_override_forces_head_of_nim_list(monkeypatch):
    monkeypatch.setenv("CLIPMINT_NIM_MODEL", NIM3)
    chain = llm._providers()
    nim_models = chain[1][3]
    assert nim_models[0] == NIM3
    assert len(nim_models) == len(set(nim_models))

    script = [(404, ""), (404, ""), (404, ""), (200, "via-nim3")]
    calls, _ = patch_llm(monkeypatch, script)
    assert llm.ask("p") == "via-nim3"
    assert calls[3]["model"] == NIM3


def test_groq_and_nim_overrides_coexist(monkeypatch):
    monkeypatch.setenv("CLIPMINT_NIM_MODEL", NIM2)
    monkeypatch.setenv("CLIPMINT_LLM_MODEL", G2)
    chain = llm._providers()
    assert [c[0] for c in chain] == ["groq", "nim"]
    assert chain[0][3][0] == G2
    assert chain[1][3][0] == NIM2


# ── per-attempt timeout default tightened ───────────────────────────────
def test_default_attempt_timeout_is_tightened():
    assert llm.REQUEST_TIMEOUT == 120
    assert llm.REQUEST_TIMEOUT < 180
