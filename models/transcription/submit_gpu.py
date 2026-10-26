"""Stage and validate/register on one serverless A10 using an explicit workspace profile."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile

from runtime import registered_name, request_from_file

ROOT = Path(__file__).resolve().parent


def workload(stage: Path, *, model: str, experiment: str, directory: str,
             expected_text: str, dependencies: list[str], timeout: int,
             revision: str = "main", aligner_revision: str = "main") -> dict:
    return {
        "experiment_name": experiment,
        "mlflow_experiment_directory": directory,
        "compute": {"num_accelerators": 1, "accelerator_type": "GPU_1xA10"},
        # AIR's inline installer splits whitespace; compact valid PEP 508 URL requirements.
        "environment": {"version": "6", "dependencies": [
            spec.replace(" @ ", "@") for spec in dependencies] + ["uv==0.11.23"]},
        "code_source": {"root_path": str(stage), "include_paths": [
            "model.py", "runtime.py", "register.py", "requirements.txt", "requirements.lock", "fixture.wav"]},
        "command": 'cd "$CODE_SOURCE_PATH"\n' + shlex.join([
            "python", "register.py", "--runtime-auth", "--registered-model", model,
            "--experiment", f"{directory.rstrip('/')}/{experiment}",
            "--sample-wav", "fixture.wav", "--expected-text", expected_text,
            "--revision", revision, "--aligner-revision", aligner_revision]),
        "env_variables": {"MLFLOW_DISABLE_AGENT_HINT": "1"},
        "max_retries": 0,
        "timeout_minutes": timeout,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--registered-model", required=True, type=registered_name)
    parser.add_argument("--experiment-name", default="qwen3-asr-validation")
    parser.add_argument("--experiment-directory", required=True)
    parser.add_argument("--sample-wav", required=True, type=Path)
    parser.add_argument("--expected-text", required=True)
    parser.add_argument("--revision", default="main", help="HF ASR ref; use a recorded SHA for runtime comparisons")
    parser.add_argument("--aligner-revision", default="main", help="HF aligner ref; use a recorded SHA for runtime comparisons")
    parser.add_argument("--timeout-minutes", type=int, default=20)
    parser.add_argument("--apply", action="store_true", help="Launch after validation; default is dry run only")
    parser.add_argument("--idempotency-key", help="Required with --apply; reuse to prevent duplicate submissions")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "artifacts" / "gpu-validation")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.experiment_name):
        parser.error("Use an alphanumeric experiment name with underscores/hyphens")
    if not args.experiment_directory.startswith("/Workspace/"):
        parser.error("--experiment-directory must start with /Workspace/")
    if not args.expected_text.strip() or not 1 <= args.timeout_minutes <= 60:
        parser.error("Provide expected text and a timeout between 1 and 60 minutes")
    if args.apply and not args.idempotency_key:
        parser.error("--apply requires --idempotency-key")
    request_from_file(args.sample_wav, "gpu-fixture")
    dependencies = [line.strip() for line in (ROOT / "requirements.lock").read_text().splitlines()
                    if line.strip() and not line.lstrip().startswith("#")]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    # Outside the repository so ignored fixture audio is included intentionally, and no caches/credentials ship.
    with tempfile.TemporaryDirectory(prefix="qwen-gpu-validation-") as temp:
        stage = Path(temp)
        for name in ("model.py", "runtime.py", "register.py", "requirements.txt", "requirements.lock"):
            shutil.copyfile(ROOT / name, stage / name)
        shutil.copyfile(args.sample_wav, stage / "fixture.wav")
        config = workload(stage, model=args.registered_model, experiment=args.experiment_name,
                          directory=args.experiment_directory, expected_text=args.expected_text,
                          dependencies=dependencies, timeout=args.timeout_minutes,
                          revision=args.revision, aligner_revision=args.aligner_revision)
        config_path = stage / "workload.json"
        config_path.write_text(json.dumps(config, indent=2) + "\n")
        (args.output_dir / "plan.json").write_text(json.dumps(config, indent=2) + "\n")
        command = ["databricks", "air", "run", "--file", str(config_path),
                   "--profile", args.profile, "--output", "json"]
        # Always validate the complete staged workload before allocating GPU compute.
        validated = subprocess.run([*command, "--dry-run"], text=True, capture_output=True)
        (args.output_dir / "validation.json").write_text(validated.stdout)
        if validated.returncode:
            print(validated.stderr or validated.stdout)
            raise SystemExit(validated.returncode)
        if not args.apply:
            print(validated.stdout)
            return
        result = subprocess.run([*command, "--idempotency-key", args.idempotency_key],
                                text=True, capture_output=True)
        (args.output_dir / "submission.json").write_text(result.stdout)
        (args.output_dir / "submission.log").write_text(result.stderr)
        print(result.stdout)
        if result.returncode:
            print(result.stderr)
            raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
