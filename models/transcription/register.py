"""Package pinned pretrained weights, validate on a GPU, then register in UC."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import importlib.metadata
import json
import os
from pathlib import Path
import tempfile

from runtime import ALIGNER_ID, MODEL_ID, immutable_revision, registered_name, request_from_file

ROOT = Path(__file__).resolve().parent


def check_prediction(response: dict, expected_text: str) -> None:
    import re
    predictions = response.get("predictions", [])
    if len(predictions) != 1 or predictions[0].get("status") != "ok":
        raise RuntimeError("Spoken fixture prediction did not return a successful transcription")
    text = json.loads(predictions[0]["result_json"])["response"]["text"]
    normalize = lambda value: " ".join(re.findall(r"\w+", value.casefold()))
    if not normalize(expected_text) or normalize(expected_text) not in normalize(text):
        raise RuntimeError("Spoken fixture transcription did not contain the expected text")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    auth = parser.add_mutually_exclusive_group(required=True)
    auth.add_argument("--profile", help="Explicit local Databricks CLI profile")
    auth.add_argument("--runtime-auth", action="store_true",
                      help="Use credentials supplied by a Databricks GPU workload (no local profile)")
    parser.add_argument("--registered-model", required=True, type=registered_name)
    parser.add_argument("--experiment", required=True, help="Existing experiment path; parent folder must exist")
    parser.add_argument("--revision", default="main", help="HF ref resolved to an immutable SHA before download")
    parser.add_argument("--aligner-revision", default="main")
    parser.add_argument("--without-timestamps", action="store_true")
    parser.add_argument("--sample-wav", required=True, type=Path, help="Known spoken mono PCM16 fixture, <=30s")
    parser.add_argument("--expected-text", required=True, help="Expected phrase in the fixture")
    parser.add_argument("--sample-language", default="English")
    parser.add_argument("--artifact-dir", type=Path, default=ROOT / "artifacts")
    parser.add_argument("--output", type=Path, default=ROOT / "registration.json")
    args = parser.parse_args()
    if args.runtime_auth and not (os.environ.get("MLFLOW_RUN_ID") or os.environ.get("DATABRICKS_RUNTIME_VERSION")):
        parser.error("--runtime-auth must run inside a Databricks workload")
    if args.profile:
        # MLflow's SDK-backed artifact repository also constructs Config() without a URI.
        os.environ["DATABRICKS_CONFIG_PROFILE"] = args.profile

    # Check the fixture before downloads or workspace mutations.
    row = request_from_file(args.sample_wav, "registration-fixture", language=args.sample_language)
    if not args.expected_text.strip():
        parser.error("--expected-text cannot be blank")
    import mlflow
    import pandas as pd
    from huggingface_hub import HfApi, snapshot_download
    from mlflow.models import ModelSignature
    from mlflow.types import ColSpec, Schema

    requirements = [line.strip() for line in (ROOT / "requirements.txt").read_text().splitlines()
                    if line.strip() and not line.lstrip().startswith("#")]
    # Fail before downloads or workspace mutations when packaging from a different environment.
    for spec in requirements:
        name, version = spec.split("==")
        if importlib.metadata.version(name) != version:
            raise RuntimeError(f"Install requirements.lock first: expected {spec}")
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError("Package on CUDA GPU compute; no weights have been downloaded or model registered")
    locked_requirements = [line.strip() for line in (ROOT / "requirements.lock").read_text().splitlines()
                           if line.strip() and not line.lstrip().startswith("#")]

    # Explicit profile for both services; do not use the default workspace registry.
    mlflow.set_tracking_uri(f"databricks://{args.profile}" if args.profile else "databricks")
    mlflow.set_registry_uri(f"databricks-uc://{args.profile}" if args.profile else "databricks-uc")
    mlflow.set_experiment(args.experiment)

    api = HfApi()
    model_revision = immutable_revision(api.model_info(MODEL_ID, revision=args.revision).sha)
    aligner_revision = ""
    artifact_map = {}
    for key, repo, revision in [("asr", MODEL_ID, model_revision)]:
        folder = args.artifact_dir / f"{key}-{revision}"
        snapshot_download(repo, revision=revision, local_dir=folder,
                          ignore_patterns=["*.bin", "*.pt", "*.pth", ".gitattributes"])
        artifact_map[key] = str(folder)
    if not args.without_timestamps:
        aligner_revision = immutable_revision(api.model_info(ALIGNER_ID, revision=args.aligner_revision).sha)
        folder = args.artifact_dir / f"aligner-{aligner_revision}"
        snapshot_download(ALIGNER_ID, revision=aligner_revision, local_dir=folder,
                          ignore_patterns=["*.bin", "*.pt", "*.pth", ".gitattributes"])
        artifact_map["aligner"] = str(folder)

    manifest = {"model_id": MODEL_ID, "model_revision": model_revision,
                "aligner_id": ALIGNER_ID if aligner_revision else "", "aligner_revision": aligner_revision,
                "created_at": datetime.now(timezone.utc).isoformat(), "direct_requirements": requirements,
                "locked_requirements": locked_requirements,
                "validation_gpu": torch.cuda.get_device_name(0), "validation_cuda": torch.version.cuda}
    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = args.artifact_dir / f"manifest-{model_revision}-{aligner_revision or 'no-aligner'}.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    artifact_map["manifest"] = str(manifest_path)
    signature = ModelSignature(inputs=Schema([
        ColSpec("string", "chunk_id"), ColSpec("string", "audio_base64"),
        ColSpec("string", "language", required=False), ColSpec("string", "speaker_role", required=False),
        ColSpec("double", "offset_seconds", required=False),
    ]), outputs=Schema([ColSpec("string", "chunk_id"), ColSpec("string", "status"),
                         ColSpec("string", "result_json")]))

    fixture = pd.DataFrame([row])
    with mlflow.start_run(run_name="qwen3-asr-package"):
        mlflow.set_tag("aidevkit_project", "db-transcribe-scaling")
        mlflow.log_params({"model_id": MODEL_ID, "model_revision": model_revision,
                           "aligner_revision": aligner_revision, "timestamp_mode": "word" if aligner_revision else "clip"})
        info = mlflow.pyfunc.log_model(name="model", python_model=str(ROOT / "model.py"),
                                       code_paths=[str(ROOT / "runtime.py")], artifacts=artifact_map,
                                       signature=signature, input_example=fixture,
                                       pip_requirements=locked_requirements)
        # Isolated pinned environment, on the operator's GPU compute. Validate BEFORE UC registration.
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "prediction.json"
            mlflow.models.predict(model_uri=info.model_uri, input_data=fixture,
                                  output_path=str(output), env_manager="uv")
            prediction = json.loads(output.read_text())
            check_prediction(prediction, args.expected_text)
            mlflow.log_dict(prediction, "fixture_prediction.json")
        version = mlflow.register_model(info.model_uri, args.registered_model)
        receipt = {"registered_model": args.registered_model, "model_version": str(version.version),
                   "model_uri": info.model_uri, "run_id": mlflow.active_run().info.run_id, **manifest}
        # Preserve receipts from ephemeral GPU compute in the tracked run as well as locally.
        mlflow.log_dict(receipt, "registration.json")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"registered_model": args.registered_model, "model_version": str(version.version),
                      "receipt": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
