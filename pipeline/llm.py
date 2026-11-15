#!/usr/bin/env python3
"""
ClipMint pipeline — LLM access with an independent-provider fallback chain.

The pipeline's two LLM stages (Hinglish transliteration and viral-moment
scoring) previously called Groq directly with a Groq-only model list. When the
whole Groq account is throttled or down, both stages die and the job fails.
This module spreads the risk across two independent providers:

    Groq  →  openai/gpt-oss-120b, openai/gpt-oss-20b, qwen/qwen3.8-27b
    NIM   →  nvidia/nemotron-3-super-120b-a12b, deepseek-ai/deepseek-v4-flash-0731,
             z-ai/glm-5.3-flash

Default order is GROQ-FIRST: the transliteration post-mortem showed Groq
answering EVERY batch while the NIM head model hard-404'd and z-ai/glm-5.3-flash
timed out for 180s ×3 per batch (~97 minutes of probing for 12+ batches). The
original reason for NIM-first — Groq's 8k TPM free tier causing 429 retry
storms — is now contained by the exhaustion cooldown below, so Groq-first no
longer costs minutes; a 429 burst skips Groq for 90s and falls through to NIM.

Behaviour:
  * Every (provider, model) pair gets up to `max_attempts` (default 3) real
    attempts with exponential backoff on 429 / 5xx / network errors — the same
    policy the transcription step uses.
  * A hard 4xx (model retired, bad request) burns no retries; the chain moves
    to the next model. Dead-but-listed NIM models return 404/410, which lands
    here and is handled by the fallback list.
  * NIM is OpenAI-shaped, but not every hosted model accepts
    `response_format`; a 400 that mentions it is retried once without it —
    this shape fix does NOT consume one of the call's attempts.
  * The provider + model that actually answered is logged, so a degraded
    answer can be traced back to the model that produced it.

Outage memory (circuit breaker) — per-process, survives across batches:
  * A hard 404/410 marks the MODEL dead for the rest of the process (1h TTL):
    later `ask` calls skip it instead of re-probing it batch after batch.
  * A 401/403 marks the whole PROVIDER dead for the run — a bad key is not
    going to fix itself, and 3 models × 3 attempts of 401s waste nothing but
    time.
  * Two consecutive TIMEOUTS open a breaker on the model: it is skipped for a
    cooldown (default 300s, doubling per re-open up to 8×) and gets one fresh
    probe when the cooldown expires. A model that needs >180s for a 60-word
    batch is down, not slow.
  * A model that exhausts its attempts on 429/5xx gets a short cooldown (90s)
    so the NEXT call doesn't start by re-running the same retry storm; it is
    re-probed after the cooldown. (This is what makes Groq-first safe on the
    8k TPM free tier.)
  * Any success resets that model's breaker state.

Time budget — one `ask` call is bounded by budget_s / CLIPMINT_LLM_BUDGET
(default 300s; 0 disables). The budget is a HARD deadline: no attempt starts
after it, and per-request timeouts and retry sleeps are clamped to what is
left, so a call cannot overrun by a full request. Without it, six models ×
3 attempts × 180s timeouts can make a single transliteration batch cost
~50 minutes. When the deadline is hit, `ask` raises RuntimeError like any
other total failure (callers degrade per batch, never silently).

Call-level overrides (used by the bounded transliteration stage):
    ask(prompt, order="groq,nim", timeout_s=30, max_attempts=1, budget_s=45)
      order         provider order, e.g. "groq,nim" or "nim,groq"; providers
                    not named are appended as fallback, unknown names ignored
                    (repeats deduplicated). Default (None) = CLIPMINT_LLM_ORDER
                    env or "groq,nim".
      timeout_s     per-attempt timeout in seconds for THIS call (overrides
                    CLIPMINT_LLM_TIMEOUT / REQUEST_TIMEOUT when > 0); clamped
                    to the remaining budget.
      max_attempts  real attempts per model for THIS call (default 3; the
                    response_format shape fix is not counted as an attempt).
      budget_s      total seconds for THIS call across the whole chain
                    (overrides CLIPMINT_LLM_BUDGET when > 0; <= 0 disables
                    the cap for this call).

Environment:
    GROQ_API_KEY                   optional — Groq provider skipped when absent
    NVIDIA_NIM_API_KEY             optional — NIM provider skipped when absent
    CLIPMINT_LLM_MODEL             optional — forces the head of the Groq model list
    CLIPMINT_NIM_MODEL             optional — forces the head of the NIM model list
    CLIPMINT_LLM_ORDER             optional — default provider order (e.g. "groq,nim")
    CLIPMINT_LLM_TIMEOUT           optional — per-attempt timeout seconds (default 120)
    CLIPMINT_LLM_BUDGET            optional — total seconds per `ask` call (default 300, 0 = off)
    CLIPMINT_LLM_BREAKER_COOLDOWN  optional — seconds a timeout-broken model stays out (default 300)

If every provider is unavailable or exhausted, `ask` raises RuntimeError —
callers turn that into a named stage failure, never a silent fallback.
"""

from __future__ import annotations

import os
import threading
import time

import requests

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions"

GROQ_MODELS = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.8-27b",
]
NIM_MODELS = [
    "nvidia/nemotron-3-super-120b-a12b",
    "deepseek-ai/deepseek-v4-flash-0731",
    "z-ai/glm-5.3-flash",
]

ATTEMPTS_PER_MODEL = 3
REQUEST_TIMEOUT = 120          # per-attempt seconds (was 180 — 180×3 per dead model is how a run lost 97 minutes)
TIMEOUT_BREAKER_THRESHOLD = 2  # consecutive timeouts before a model is breaker-opened
BREAKER_COOLDOWN = 300.0       # seconds a timeout-broken model stays out of the chain
EXHAUST_COOLDOWN = 90.0        # seconds after 429/5xx retries are exhausted
DEAD_TTL = 3600.0              # 404/410 model / 401 provider: stop re-probing for the run
BREAKER_MAX_SCALE = 8          # cooldown cap after repeated re-opens (base × 8)

# A model that 400s (context overflow, malformed prompt) is NOT breaker-marked:
# the failure is prompt-specific and the same model may be fine on the next,
# smaller prompt.

_BREAKERS: dict[tuple[str, str], "_Breaker"] = {}
_PROVIDER_DEAD: dict[str, float] = {}
_PROVIDER_NOTES: dict[str, str] = {}
_LOCK = threading.Lock()


class _Breaker:
    __slots__ = ("open_until", "timeouts", "opens", "note")

    def __init__(self) -> None:
        self.open_until = 0.0
        self.timeouts = 0   # consecutive timeouts while closed
        self.opens = 0      # how many times the breaker has opened (scales cooldown)
        self.note = ""


def reset_breakers() -> None:
    """Clear outage memory. For tests and the CLI smoke check."""
    with _LOCK:
        _BREAKERS.clear()
        _PROVIDER_DEAD.clear()
        _PROVIDER_NOTES.clear()


def _breaker(provider: str, model: str) -> _Breaker:
    key = (provider, model)
    with _LOCK:
        br = _BREAKERS.get(key)
        if br is None:
            br = _Breaker()
            _BREAKERS[key] = br
        return br


def _provider_skip(provider: str, now: float) -> str:
    """Skip reason when the provider is marked down, '' otherwise."""
    with _LOCK:
        until = _PROVIDER_DEAD.get(provider, 0.0)
        note = _PROVIDER_NOTES.get(provider, "")
    if now < until:
        return f"marked down ({note}); re-probe in {until - now:.0f}s"
    return ""


def _model_skip(provider: str, model: str, now: float) -> str:
    """Skip reason when provider or model is breaker-opened, '' otherwise."""
    reason = _provider_skip(provider, now)
    if reason:
        return reason
    br = _BREAKERS.get((provider, model))
    if br is not None and now < br.open_until:
        return f"breaker open ({br.note}); re-probe in {br.open_until - now:.0f}s"
    return ""


def _record_success(provider: str, model: str) -> None:
    br = _breaker(provider, model)
    with _LOCK:
        br.open_until = 0.0
        br.timeouts = 0
        br.note = ""


def _record_timeout(provider: str, model: str) -> None:
    """One timeout attempt. After TIMEOUT_BREAKER_THRESHOLD consecutive
    timeouts the model is opened for a cooldown that doubles per re-open."""
    br = _breaker(provider, model)
    opened = False
    cooldown = 0.0
    with _LOCK:
        br.timeouts += 1
        if br.timeouts >= TIMEOUT_BREAKER_THRESHOLD:
            br.opens += 1
            scale = min(BREAKER_MAX_SCALE, 2 ** (br.opens - 1))
            cooldown = _cooldown() * scale
            br.open_until = time.monotonic() + cooldown
            br.timeouts = 0
            br.note = f"{TIMEOUT_BREAKER_THRESHOLD} consecutive timeouts"
            opened = True
    if opened:
        print(f"  breaker: {provider}/{model} open for {cooldown:.0f}s ({br.note})")


def _record_dead(provider: str, model: str, ttl: float, note: str) -> None:
    br = _breaker(provider, model)
    with _LOCK:
        br.open_until = time.monotonic() + ttl
        br.note = note


def _record_exhausted(provider: str, model: str, cooldown: float) -> None:
    br = _breaker(provider, model)
    with _LOCK:
        br.open_until = max(br.open_until, time.monotonic() + cooldown)
        br.note = br.note or "retries exhausted"


def _mark_provider_dead(provider: str, ttl: float, note: str) -> None:
    with _LOCK:
        _PROVIDER_DEAD[provider] = time.monotonic() + ttl
        _PROVIDER_NOTES[provider] = note


def _dedup(models: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for m in models:
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out


def _providers() -> list[tuple[str, str, str, list[str]]]:
    """(provider_name, url, api_key, models) in default fallback order."""
    # GROQ FIRST: the transliteration post-mortem showed Groq answering every
    # batch while the NIM head model 404'd and glm-5.3-flash timed out. The
    # old NIM-first rationale (Groq 8k TPM 429 storms) is contained by the
    # 90s exhaustion cooldown, so Groq-first is now both faster and healthier.
    chain: list[tuple[str, str, str, list[str]]] = []
    groq_key = os.environ.get("GROQ_API_KEY", "").strip()
    if groq_key:
        override = os.environ.get("CLIPMINT_LLM_MODEL", "").strip()
        chain.append(("groq", GROQ_URL, groq_key, _dedup(([override] if override else []) + GROQ_MODELS)))
    nim_key = os.environ.get("NVIDIA_NIM_API_KEY", "").strip()
    if nim_key:
        override = os.environ.get("CLIPMINT_NIM_MODEL", "").strip()
        chain.append(("nim", NIM_URL, nim_key, _dedup(([override] if override else []) + NIM_MODELS)))
    return chain


def _chain(order: str | None) -> list[tuple[str, str, str, list[str]]]:
    """Provider chain honouring a per-call (or env) order preference.

    Named providers come first in the given order; providers that exist but
    were not named are appended as fallback (never silently dropped), and
    unknown names are ignored.
    """
    chain = _providers()
    wanted = order if order else os.environ.get("CLIPMINT_LLM_ORDER", "")
    names: list[str] = []
    for part in str(wanted or "").replace(" ", ",").split(","):
        n = part.strip().lower()
        if n and n not in names:
            names.append(n)
    if not names:
        return chain
    by_name = {c[0]: c for c in chain}
    ordered = [by_name[n] for n in names if n in by_name]
    ordered += [c for c in chain if c[0] not in set(names)]
    return ordered


def _env_seconds(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        print(f"  llm: ignoring non-numeric {name}={raw!r}")
        return default


def _attempt_timeout() -> float:
    return max(5.0, _env_seconds("CLIPMINT_LLM_TIMEOUT", REQUEST_TIMEOUT))


def _budget() -> float:
    """Total seconds one ask() call may spend across the chain. 0 disables."""
    return _env_seconds("CLIPMINT_LLM_BUDGET", 300.0)


def _cooldown() -> float:
    return max(1.0, _env_seconds("CLIPMINT_LLM_BREAKER_COOLDOWN", BREAKER_COOLDOWN))


def _post(
    url: str,
    api_key: str,
    model: str,
    system: str,
    prompt: str,
    is_json: bool,
    max_tokens: int,
    use_response_format: bool,
    timeout: float | None = None,
) -> tuple[int, str, str]:
    """One chat completion. Returns (status, content_or_empty, error_body).

    Network failures return status 0; timeouts prefix the error with
    "timeout:" so the retry loop can feed the timeout breaker without
    string-matching provider bodies.
    """
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    body: dict = {
        "model": model,
        "messages": messages,
        "temperature": 0.6,
        "max_tokens": max_tokens,
    }
    if is_json and use_response_format:
        body["response_format"] = {"type": "json_object"}

    try:
        resp = requests.post(
            url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=body,
            timeout=timeout if timeout and timeout > 0 else _attempt_timeout(),
        )
    except requests.exceptions.Timeout as exc:
        return 0, "", f"timeout: {exc}"
    except requests.RequestException as exc:
        return 0, "", f"network error: {exc}"

    if resp.status_code != 200:
        return resp.status_code, "", resp.text[:300]

    # Validate the body shape before trusting it: a non-dict payload used to
    # raise TypeError out of here, and a 200 with missing/None/empty content
    # used to "succeed" with "" and push the failure into the caller's parser.
    try:
        payload = resp.json()
    except ValueError as exc:
        return 0, "", f"malformed response: invalid JSON ({exc})"
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        return 0, "", f"malformed response: missing content ({exc})"
    if not isinstance(content, str) or not content.strip():
        return 0, "", "malformed response: empty or non-string content"
    return 200, content, ""


def ask(
    prompt: str,
    system: str = "",
    is_json: bool = False,
    max_tokens: int = 4096,
    order: str | None = None,
    timeout_s: float | None = None,
    max_attempts: int | None = None,
    budget_s: float | None = None,
) -> str:
    """Ask the first available LLM and return the message content.

    Raises RuntimeError when no provider can answer — callers are expected to
    let that fail their named stage rather than degrade silently.

    `order` / `timeout_s` / `max_attempts` / `budget_s` are per-call overrides
    (see module docstring); every existing call keeps its previous behaviour
    when they are omitted.
    """
    chain = _chain(order)
    if not chain:
        raise RuntimeError(
            "no LLM provider configured: set GROQ_API_KEY and/or NVIDIA_NIM_API_KEY"
        )

    attempts = ATTEMPTS_PER_MODEL if max_attempts is None else max(1, int(max_attempts))
    timeout = float(timeout_s) if timeout_s and float(timeout_s) > 0 else None
    if budget_s is None:
        budget = _budget()
    else:
        budget = float(budget_s) if budget_s and float(budget_s) > 0 else 0.0

    started = time.monotonic()
    deadline = started + budget if budget and budget > 0 else None
    last_error = ""
    for provider, url, api_key, models in chain:
        reason = _provider_skip(provider, time.monotonic())
        if reason:
            print(f"  provider {provider} skipped: {reason}")
            if not last_error:
                last_error = f"{provider} {reason}"
            continue
        for model in models:
            reason = _model_skip(provider, model, time.monotonic())
            if reason:
                print(f"  skip {provider}/{model}: {reason}")
                if not last_error:
                    last_error = f"{provider}/{model} {reason}"
                continue
            use_rf = True
            left = attempts
            while left > 0:
                # Hard deadline: no attempt may START after it, and the
                # request timeout and retry sleeps below are clamped to it —
                # the old pre-check-only budget let one full request (up to
                # 180s) overshoot the cap.
                remaining = (deadline - time.monotonic()) if deadline is not None else None
                if remaining is not None and remaining <= 0:
                    raise RuntimeError(
                        f"LLM time budget {budget:.0f}s exhausted: "
                        f"{last_error or 'no attempt completed'}"
                    )
                if left < attempts:
                    # Breaker opened mid-call (e.g. 2nd consecutive timeout):
                    # stop burning attempts on a model that is now marked out.
                    reason = _model_skip(provider, model, time.monotonic())
                    if reason:
                        print(f"  skip {provider}/{model} mid-call: {reason}")
                        break
                effective = timeout if timeout else _attempt_timeout()
                if remaining is not None:
                    effective = min(effective, remaining)
                status, content, err = _post(
                    url, api_key, model, system, prompt, is_json, max_tokens, use_rf, effective
                )
                if status == 200:
                    _record_success(provider, model)
                    print(f"  LLM_OK provider={provider} model={model}")
                    return content

                # Not every OpenAI-shaped model accepts response_format: strip
                # it once and retry. This is a request-shape fix, not a failed
                # attempt — it must not consume one of `max_attempts`.
                if status == 400 and use_rf and "response_format" in err:
                    print(f"  {provider}/{model}: response_format rejected; retrying without it")
                    use_rf = False
                    continue

                last_error = f"{provider}/{model} HTTP {status}: {err[:200]}" if status else f"{provider}/{model} {err[:200]}"

                if status in (404, 410):
                    # Retired/unlisted model: dead for the run, never re-probed
                    # batch after batch (the 97-minute transliteration burn).
                    _record_dead(provider, model, DEAD_TTL, f"HTTP {status}")
                    print(f"  {provider}/{model} hard failure: {last_error} — marked dead for this run")
                    break
                if status in (401, 403):
                    # Bad key / forbidden: every model of this provider would
                    # fail the same way. Kill the provider, not model by model.
                    _mark_provider_dead(provider, DEAD_TTL, f"HTTP {status}")
                    print(f"  provider {provider} marked down for this run: {last_error}")
                    break

                retriable = status in (0, 429, 500, 502, 503)
                if not retriable:
                    print(f"  {provider}/{model} hard failure: {last_error}")
                    break

                if err.startswith("timeout:"):
                    _record_timeout(provider, model)
                left -= 1
                if left > 0:
                    wait = 2 ** (attempts - left - 1) * 5
                    if remaining is not None:
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            continue  # loop top raises the budget error — never sleep past the deadline
                        wait = min(wait, remaining)
                    print(f"  {provider}/{model} attempt {attempts - left} failed ({last_error}); retry in {wait:.0f}s")
                    time.sleep(wait)
            else:
                # All attempts spent on retriable failures: short cooldown so
                # the next call skips the retry storm, but the model is
                # re-probed once the cooldown passes (unlike a hard 404).
                _record_exhausted(provider, model, EXHAUST_COOLDOWN)
                print(f"  {provider}/{model} exhausted: {last_error}")

        print(f"  provider {provider} exhausted: {last_error}")

    raise RuntimeError(f"all LLM providers failed: {last_error}")


# ---------------------------------------------------------------------------
# CLI smoke check:  python3 pipeline/llm.py "Say OK"
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import sys

    _prompt = sys.argv[1] if len(sys.argv) > 1 else "Reply with the single word OK."
    reset_breakers()
    print(ask(_prompt, system="You are a helpful assistant.", is_json=False, max_tokens=32))
