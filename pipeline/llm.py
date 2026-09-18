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

Behaviour:
  * Every (provider, model) pair gets 3 attempts with exponential backoff on
    429 / 5xx / network errors — the same policy the transcription step uses.
  * A hard 4xx (model retired, bad request) burns no retries; the chain moves
    to the next model. Dead-but-listed NIM models return 404/410, which lands
    here and is handled by the fallback list.
  * NIM is OpenAI-shaped, but not every hosted model accepts
    `response_format`; a 400 that mentions it is retried once without it
    instead of losing the whole provider.
  * The provider + model that actually answered is logged, so a degraded
    answer can be traced back to the model that produced it.

Environment:
    GROQ_API_KEY         optional — Groq provider skipped when absent
    NVIDIA_NIM_API_KEY   optional — NIM provider skipped when absent
    CLIPMINT_LLM_MODEL   optional — forces the head of the Groq model list

If every provider is unavailable or exhausted, `ask` raises RuntimeError —
callers turn that into a named stage failure, never a silent fallback.
"""

from __future__ import annotations

import os
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
REQUEST_TIMEOUT = 180


def _dedup(models: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for m in models:
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out


def _providers() -> list[tuple[str, str, str, list[str]]]:
    """(provider_name, url, api_key, models) in fallback order."""
    chain: list[tuple[str, str, str, list[str]]] = []
    groq_key = os.environ.get("GROQ_API_KEY", "").strip()
    if groq_key:
        override = os.environ.get("CLIPMINT_LLM_MODEL", "").strip()
        chain.append(("groq", GROQ_URL, groq_key, _dedup(([override] if override else []) + GROQ_MODELS)))
    nim_key = os.environ.get("NVIDIA_NIM_API_KEY", "").strip()
    if nim_key:
        chain.append(("nim", NIM_URL, nim_key, list(NIM_MODELS)))
    return chain


def _post(
    url: str,
    api_key: str,
    model: str,
    system: str,
    prompt: str,
    is_json: bool,
    max_tokens: int,
    use_response_format: bool,
) -> tuple[int, str, str]:
    """One chat completion. Returns (status, content_or_empty, error_body)."""
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
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as exc:
        return 0, "", f"network error: {exc}"

    if resp.status_code != 200:
        return resp.status_code, "", resp.text[:300]

    try:
        content = resp.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError) as exc:
        return 0, "", f"malformed response: {exc}"
    return 200, content or "", ""


def ask(prompt: str, system: str = "", is_json: bool = False, max_tokens: int = 4096) -> str:
    """Ask the first available LLM and return the message content.

    Raises RuntimeError when no provider can answer — callers are expected to
    let that fail their named stage rather than degrade silently.
    """
    chain = _providers()
    if not chain:
        raise RuntimeError(
            "no LLM provider configured: set GROQ_API_KEY and/or NVIDIA_NIM_API_KEY"
        )

    last_error = ""
    for provider, url, api_key, models in chain:
        for model in models:
            use_rf = True
            for attempt in range(ATTEMPTS_PER_MODEL):
                status, content, err = _post(
                    url, api_key, model, system, prompt, is_json, max_tokens, use_rf
                )
                if status == 200:
                    print(f"  LLM_OK provider={provider} model={model}")
                    return content

                # Not every OpenAI-shaped model accepts response_format: strip
                # it once and retry instead of dropping the provider.
                if status == 400 and use_rf and "response_format" in err:
                    print(f"  {provider}/{model}: response_format rejected; retrying without it")
                    use_rf = False
                    continue

                last_error = f"{provider}/{model} HTTP {status}: {err[:200]}" if status else f"{provider}/{model} {err[:200]}"
                retriable = status in (0, 429, 500, 502, 503)
                if not retriable:
                    print(f"  {provider}/{model} hard failure: {last_error}")
                    break
                wait = 2**attempt * 5
                print(f"  {provider}/{model} attempt {attempt + 1} failed ({last_error}); retry in {wait}s")
                time.sleep(wait)
            else:
                print(f"  {provider}/{model} exhausted: {last_error}")

        print(f"  provider {provider} exhausted: {last_error}")

    raise RuntimeError(f"all LLM providers failed: {last_error}")


# ---------------------------------------------------------------------------
# CLI smoke check:  python3 pipeline/llm.py "Say OK"
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import sys

    _prompt = sys.argv[1] if len(sys.argv) > 1 else "Reply with the single word OK."
    print(ask(_prompt, system="You are a helpful assistant.", is_json=False, max_tokens=32))
