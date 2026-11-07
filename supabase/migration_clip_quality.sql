-- Per-clip quality instrument results (pipeline/clip_qa.py).
--
-- quality_score: 0-100, NULL = not measured (older jobs, or the QA step was
-- skipped). quality_report: the full per-check breakdown
-- {checks: [{id,label,status,value,detail}], loudness: {...}, clip: {...}} —
-- rendered by the dashboard as an explainable breakdown, not a black box.
--
-- Idempotent; safe to re-run.

alter table public.clips
    add column if not exists quality_score integer;

alter table public.clips
    add column if not exists quality_report jsonb;

-- Scores arrive only from the pipeline (service role writes the rows); no
-- CHECK constraint so a future instrument change cannot break inserts,
-- but clamp on write in the workflow.
