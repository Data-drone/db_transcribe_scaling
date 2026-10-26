"""Stage a bounded source snapshot, validate it, and optionally submit one AIR GPU run."""

from __future__ import annotations

import argparse
import json
import re
import shlex
import shutil
import subprocess
import tempfile
from pathlib import Path

from audio_data_gen.config import identifier, load, plan

ROOT = Path(__file__).resolve().parent


def workload(
    stage: Path,
    *,
    experiment: str,
    experiment_directory: str,
    timeout: int,
    design_revision: str,
    base_revision: str,
) -> dict:
    command = shlex.join(
        [
            "uv",
            "run",
            "--frozen",
            "--no-dev",
            "--extra",
            "tts",
            "--extra",
            "tracking",
            "python",
            "-m",
            "audio_data_gen",
            "generate",
            "--config",
            "config.json",
            "--output-dir",
            "output",
            "--design-revision",
            design_revision,
            "--base-revision",
            base_revision,
            "--log-mlflow",
        ]
    )
    return {
        "experiment_name": experiment,
        "mlflow_experiment_directory": experiment_directory,
        "compute": {"num_accelerators": 1, "accelerator_type": "GPU_1xA10"},
        "environment": {"version": "6", "dependencies": ["uv==0.11.23"]},
        "code_source": {
            "root_path": str(stage),
            "include_paths": [
                "audio_data_gen",
                "config.json",
                "pyproject.toml",
                "uv.lock",
            ],
        },
        "command": 'cd "$CODE_SOURCE_PATH"\n' + command,
        "env_variables": {
            "MLFLOW_DISABLE_AGENT_HINT": "1",
            "TOKENIZERS_PARALLELISM": "false",
            "PYTHONUNBUFFERED": "1",
        },
        "max_retries": 0,
        "timeout_minutes": timeout,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True, help="Explicit user-chosen Databricks profile")
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument(
        "--experiment-directory", required=True, help="/Workspace/... MLflow directory"
    )
    parser.add_argument("--experiment-name", default="synthetic-persona-audio")
    parser.add_argument("--timeout-minutes", type=int, default=60)
    parser.add_argument("--design-revision", default="main")
    parser.add_argument("--base-revision", default="main")
    parser.add_argument(
        "--artifacts-dir",
        type=Path,
        required=True,
        help="New local directory for the reviewed plan and CLI results",
    )
    parser.add_argument(
        "--plan-only", action="store_true", help="Prepare plan without contacting Databricks"
    )
    parser.add_argument(
        "--apply", action="store_true", help="Submit after workspace dry-run succeeds"
    )
    parser.add_argument(
        "--idempotency-key", help="Required with --apply; reuse to avoid duplicate runs"
    )
    args = parser.parse_args()
    identifier(args.experiment_name)
    if not args.profile.strip():
        parser.error("--profile must be nonempty")
    if not args.experiment_directory.startswith("/Workspace/"):
        parser.error("--experiment-directory must start with /Workspace/")
    if not 1 <= args.timeout_minutes <= 240:
        parser.error("--timeout-minutes must be between 1 and 240")
    for ref in (args.design_revision, args.base_revision):
        if not re.fullmatch(r"[A-Za-z0-9_./-]{1,160}", ref):
            parser.error("Model revision must be a Hugging Face commit SHA, tag or branch")
    if args.apply and (not args.idempotency_key or args.plan_only):
        parser.error("--apply requires --idempotency-key and cannot combine with --plan-only")
    config = load(args.config)
    if not (ROOT / "uv.lock").is_file():
        parser.error("Missing uv.lock; run uv lock before preparing an AIR workload")
    args.artifacts_dir.mkdir(parents=True, exist_ok=False)
    # Snapshot only intended sources, never .venv, cached weights, output or local credentials.
    with tempfile.TemporaryDirectory(prefix="audio-data-gen-") as temp:
        stage = Path(temp)
        shutil.copytree(
            ROOT / "audio_data_gen",
            stage / "audio_data_gen",
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
        for name in ("pyproject.toml", "uv.lock"):
            shutil.copyfile(ROOT / name, stage / name)
        (stage / "config.json").write_text(json.dumps(config, indent=2) + "\n")
        spec = workload(
            stage,
            experiment=args.experiment_name,
            experiment_directory=args.experiment_directory,
            timeout=args.timeout_minutes,
            design_revision=args.design_revision,
            base_revision=args.base_revision,
        )
        spec_path = stage / "workload.json"
        spec_path.write_text(json.dumps(spec, indent=2) + "\n")
        (args.artifacts_dir / "plan.json").write_text(
            json.dumps(
                {
                    "profile": args.profile,
                    "dataset": plan(config),
                    "workload": spec,
                    "note": "Staging is temporary; rerun this launcher to validate or submit.",
                },
                indent=2,
            )
            + "\n"
        )
        if args.plan_only:
            print(json.dumps(plan(config), indent=2))
            return
        command = [
            "databricks",
            "air",
            "run",
            "--file",
            str(spec_path),
            "--profile",
            args.profile,
            "--output",
            "json",
        ]
        for label, flags in (
            ("validation", ["--dry-run"]),
            ("submission", ["--idempotency-key", args.idempotency_key]),
        ):
            if label == "submission" and not args.apply:
                break
            result = subprocess.run([*command, *flags], text=True, capture_output=True)
            (args.artifacts_dir / f"{label}.json").write_text(result.stdout)
            (args.artifacts_dir / f"{label}.log").write_text(result.stderr)
            print(result.stdout or result.stderr)
            if result.returncode:
                raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
