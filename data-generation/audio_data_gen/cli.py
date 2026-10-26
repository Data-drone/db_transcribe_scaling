from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from .config import load, plan
from .generate import generate
from .tts import QwenBackend, ToneBackend


def main():
    parser = argparse.ArgumentParser(
        description="Persona speech and controlled interference datasets"
    )
    sub = parser.add_subparsers(dest="command", required=True)
    preview = sub.add_parser(
        "plan", help="Validate config and count outputs without any model access"
    )
    preview.add_argument("--config", required=True, type=Path)
    run = sub.add_parser("generate")
    run.add_argument("--config", required=True, type=Path)
    run.add_argument("--output-dir", required=True, type=Path)
    run.add_argument("--backend", choices=["qwen", "tone"], default="qwen")
    run.add_argument("--design-revision", default="main", help="HF ref; resolved SHA is recorded")
    run.add_argument("--base-revision", default="main", help="HF ref; use recorded SHAs for replay")
    run.add_argument("--device", default="cuda:0")
    run.add_argument("--log-mlflow", action="store_true", help="Attach dataset to AIR's MLflow run")
    args = parser.parse_args()
    config = load(args.config)
    if args.command == "plan":
        print(json.dumps(plan(config), indent=2))
        return
    if args.output_dir.exists():
        parser.error("--output-dir must not exist; choose a new directory for each run")
    if args.log_mlflow and not os.environ.get("MLFLOW_RUN_ID"):
        parser.error("--log-mlflow requires AIR's MLFLOW_RUN_ID; use local output otherwise")
    backend = (
        ToneBackend()
        if args.backend == "tone"
        else QwenBackend(
            design_revision=args.design_revision,
            base_revision=args.base_revision,
            device=args.device,
        )
    )
    # Initialise tracking before synthesis so authentication errors fail before GPU work.
    if args.log_mlflow:
        import mlflow

        mlflow.set_tracking_uri("databricks")
        mlflow.start_run(run_id=os.environ["MLFLOW_RUN_ID"])
        mlflow.set_tags(
            {
                "dataset.name": config["name"],
                "dataset.backend": args.backend,
                "dataset.reference_status": "unverified_script",
            }
        )
    success = False
    try:
        summary = generate(config, args.output_dir, backend)
        success = True
        print(json.dumps(summary, indent=2))
    finally:
        if args.log_mlflow:
            tracking_status = "FAILED"
            try:
                if args.output_dir.exists():
                    mlflow.log_artifacts(str(args.output_dir), artifact_path="dataset")
                mlflow.set_tag("dataset.status", "complete" if success else "failed")
                tracking_status = "FINISHED" if success else "FAILED"
            finally:
                mlflow.end_run(status=tracking_status)
