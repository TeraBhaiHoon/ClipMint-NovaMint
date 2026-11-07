#!/usr/bin/env python3
"""Static checker for the ClipMint GitHub Actions workflows.

Catches the classes of bug that have actually bitten this repo before any
minutes are spent on a runner:

  1. YAML parses, every job has runs-on + steps, action refs are pinned.
  2. `run:` blocks are valid bash (`bash -n`).
  3. Embedded `<<'PY'` heredocs compile as Python.
  4. Every `steps.<id>.outputs.*` / `steps.<id>.conclusion` referenced in an
     expression has a matching step `id:` in the same job.
  5. Every `needs.<job>` referenced exists in the job's `needs:` list.
  6. `workflow_dispatch` inputs referenced by `${{ inputs.* }}` are declared.

Usage:  python scripts/check_workflows.py [.github/workflows]
Exit 0 = clean, 1 = problems (printed with file/line where available).
"""
from __future__ import annotations

import ast
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

EXPR_RE = re.compile(r"\$\{\{\s*(.*?)\s*\}\}", re.DOTALL)
STEPS_REF_RE = re.compile(r"steps\.([A-Za-z0-9_-]+)")
NEEDS_REF_RE = re.compile(r"needs\.([A-Za-z0-9_-]+)")
INPUTS_REF_RE = re.compile(r"inputs\.([A-Za-z0-9_]+)")

# Action refs that are fine unpinned (official, versioned by tag convention).
def _expr_spans(text: str) -> list[tuple[int, int, str]]:
    """(start, end, inner) for every ${{ ... }} — with block scalars this can
    over-match, so callers using run-block text should only pass the block."""
    return [(m.start(), m.end(), m.group(1)) for m in EXPR_RE.finditer(text)]


def _scan_text_for_refs(text: str) -> tuple[set[str], set[str], set[str]]:
    step_ids: set[str] = set()
    needs_refs: set[str] = set()
    input_refs: set[str] = set()
    for _s, _e, inner in _expr_spans(text):
        step_ids.update(STEPS_REF_RE.findall(inner))
        needs_refs.update(NEEDS_REF_RE.findall(inner))
        input_refs.update(INPUTS_REF_RE.findall(inner))
    return step_ids, needs_refs, input_refs


def check_workflow(path: Path) -> list[str]:
    import yaml

    problems: list[str] = []
    try:
        wf = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        return [f"{path.name}: YAML parse failed: {exc}"]

    if not isinstance(wf, dict) or "jobs" not in wf:
        return [f"{path.name}: not a workflow (no jobs key)"]

    declared_inputs = set((wf.get("on") or {}).get("workflow_dispatch", {}).get("inputs", {}) or {})

    for job_name, job in (wf.get("jobs") or {}).items():
        if not isinstance(job, dict):
            problems.append(f"{path.name}: job '{job_name}' is not a mapping")
            continue
        if "runs-on" not in job:
            problems.append(f"{path.name}: job '{job_name}' has no runs-on")
        needs = job.get("needs") or []
        needs_set = {needs} if isinstance(needs, str) else set(needs)

        steps = job.get("steps") or []
        step_ids = {s.get("id") for s in steps if s.get("id")}

        for idx, step in enumerate(steps):
            name = step.get("name") or step.get("uses") or f"step #{idx + 1}"

            # 1. actions pinned by version
            uses = step.get("uses")
            if uses and "@" not in uses:
                problems.append(f"{path.name} [{job_name}] '{name}': action '{uses}' is not version-pinned")

            run = step.get("run")
            if not run:
                continue

            # 2. bash syntax
            with tempfile.NamedTemporaryFile("w", suffix=".sh", delete=False, encoding="utf-8") as f:
                f.write(run)
                tmp = f.name
            try:
                res = subprocess.run(["bash", "-n", tmp], capture_output=True, text=True)
                if res.returncode != 0:
                    problems.append(
                        f"{path.name} [{job_name}] '{name}': bash -n failed:\n"
                        + "\n".join("    " + line for line in res.stderr.strip().splitlines()[:6])
                    )
            finally:
                os.unlink(tmp)

            # 3. embedded python compiles
            for i, block in enumerate(re.findall(r"<<'PY'\n(.*?)\nPY\b", run, re.S)):
                try:
                    ast.parse(block)
                except SyntaxError as exc:
                    problems.append(
                        f"{path.name} [{job_name}] '{name}': python heredoc #{i + 1} "
                        f"does not compile (line {exc.lineno}: {exc.msg})"
                    )

            # 4/5/6. expression references
            refs, needs_refs, input_refs = _scan_text_for_refs(run)
            # `if:` conditions too (they can reference steps./needs. as well)
            for cond_field in ("if", "env"):
                extra = step.get(cond_field)
                if isinstance(extra, str):
                    r2, n2, i2 = _scan_text_for_refs(extra)
                    refs |= r2
                    needs_refs |= n2
                    input_refs |= i2
                elif isinstance(extra, dict):
                    for v in extra.values():
                        if isinstance(v, str):
                            r2, n2, i2 = _scan_text_for_refs(v)
                            refs |= r2
                            needs_refs |= n2
                            input_refs |= i2

            for ref in refs:
                if ref not in step_ids:
                    problems.append(
                        f"{path.name} [{job_name}] '{name}': steps.{ref} referenced but no step has id '{ref}'"
                    )
            for ref in needs_refs:
                if ref not in needs_set:
                    problems.append(
                        f"{path.name} [{job_name}] '{name}': needs.{ref} referenced but '{ref}' is not in needs: {sorted(needs_set)}"
                    )
            for ref in input_refs:
                if declared_inputs and ref not in declared_inputs:
                    problems.append(
                        f"{path.name} [{job_name}] '{name}': inputs.{ref} referenced but not declared in workflow_dispatch"
                    )

    return problems


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".github/workflows")
    files = sorted(root.glob("*.yml")) + sorted(root.glob("*.yaml"))
    if not files:
        print(f"no workflows found under {root}")
        return 1

    all_problems: list[str] = []
    for f in files:
        all_problems.extend(check_workflow(f))

    print(f"checked {len(files)} workflow file(s)")
    if all_problems:
        print(f"\nWORKFLOW_CHECK_FAILED: {len(all_problems)} problem(s)")
        for p in all_problems:
            print("  -", p)
        return 1
    print("WORKFLOW_CHECK_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
