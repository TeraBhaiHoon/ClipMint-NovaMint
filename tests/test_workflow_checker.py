import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("workflow_checker", ROOT / "scripts/check_workflows.py")
CHECKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKER)


def test_status_functions_are_rejected_in_env_even_on_action_only_steps(tmp_path):
    path = tmp_path / "sample.yml"
    path.write_text("""name: test
on: workflow_dispatch
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: invalid action env
        uses: actions/checkout@v4
        env:
          RESULT: "${{ failure() && 'failed' || 'success' }}"
      - name: valid failure handler
        if: failure()
        run: printf 'failure handled'
""", encoding="utf-8")
    problems = CHECKER.check_workflow(path)
    assert len(problems) == 1
    assert "not supported in env" in problems[0]
