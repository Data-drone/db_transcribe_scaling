# Databricks notebook source
# MAGIC %md
# MAGIC # ai_transcribe vs Qwen3-ASR: accuracy, latency and scaling
# MAGIC
# MAGIC A fixed, reproducible sample of human-transcribed HarperValleyBank utterances is sent
# MAGIC to both backends as **identical mono PCM16 WAV bytes**. Reference text is used only for
# MAGIC scoring. This is an oracle-segmentation ASR benchmark, not an evaluation of VAD,
# MAGIC diarization, long-call orchestration or generalization to unseen pretraining data.
# MAGIC The two earlier development-fixture calls are excluded.
# MAGIC
# MAGIC MLflow records a parent comparison run and a child for each backend/concurrency/repeat.
# MAGIC Failed requests remain in WER/CER as empty hypotheses. First-request/warmup results
# MAGIC are separate from measured rounds; they are not guaranteed cold starts.
# MAGIC
# MAGIC Use CPU/serverless compute and `../requirements-benchmark.txt` in the notebook environment.
# MAGIC Reads source Delta tables/Volumes; writes MLflow artifacts only. Default: 24 clips,
# MAGIC concurrency 1/2/4/8, two repeats = 384 measured calls + two warmup calls. These invoke
# MAGIC paid services. Increase sample size/repeats deliberately after inspecting a small run.

# COMMAND ----------

from pathlib import Path

user = spark.sql("SELECT current_user() AS user").first().user
for name, default in {
    "catalog": "serverless_stable_prvwqx_catalog", "schema": "call_insights",
    "endpoint": "brian-qwen3-transcription-dev", "expected_model_version": "2",
    "experiment_path": f"/Users/{user}/transcription-comparison",
    "serving_code_dir": str(Path.cwd().parent),
    "sample_size": "24", "sample_calls": "12", "seed": "20261024",
    "concurrency_levels": "1,2,4,8", "repeats": "2", "max_requests": "1000",
    "source_versions_json": "", "expected_manifest_sha256": "",
}.items():
    dbutils.widgets.text(name, default)

# COMMAND ----------

import base64
from collections import Counter
import hashlib
import importlib.metadata
import json
import random
import sys
import tempfile
import threading
import time
import uuid
from urllib.parse import quote

import matplotlib.pyplot as plt
import mlflow
import pandas as pd
import requests
from databricks.sdk import WorkspaceClient
from pyspark.sql import functions as F

get = dbutils.widgets.get
code_dir = Path(get("serving_code_dir"))
if not all((code_dir / name).is_file() for name in ("benchmark.py", "runtime.py")):
    raise ValueError("Set serving_code_dir to this repository's models/transcription folder in /Workspace")
sys.path.insert(0, str(code_dir))
from benchmark import NORMALIZATION, ai_result, crop_wav, paired_wer_delta, run_load, select_samples, summarize, words
from runtime import decode_request, registered_name

sample_size, sample_calls, seed, repeats = (int(get(name)) for name in ("sample_size", "sample_calls", "seed", "repeats"))
levels = sorted({int(value) for value in get("concurrency_levels").split(",")})
if not 2 <= sample_size <= 256 or not 2 <= sample_calls <= 200 or not 1 <= repeats <= 5:
    raise ValueError("Use 2–256 samples, 2–200 calls and 1–5 repeats")
if not levels or levels[0] != 1 or levels[-1] > min(16, sample_size):
    raise ValueError("Include concurrency 1; every level must be between 1 and min(16, sample_size)")
planned_requests = 2 * (sample_size * len(levels) * repeats + 1)
if not planned_requests <= int(get("max_requests")) <= 5000:
    raise ValueError(f"Planned {planned_requests} requests exceeds max_requests (hard cap 5000)")
endpoint_name, expected_version = get("endpoint"), get("expected_model_version")
if not expected_version.isdigit():
    raise ValueError("Pin a numeric expected_model_version")
if not get("experiment_path").startswith("/"):
    raise ValueError("Use an absolute experiment path whose parent folder already exists")
workspace = WorkspaceClient()  # Explicit Databricks workload identity; no local profile selection.


def endpoint_snapshot():
    current = workspace.serving_endpoints.get(endpoint_name).as_dict()
    config = current.get("config") or {}
    entities, routes = config.get("served_entities", []), (config.get("traffic_config") or {}).get("routes", [])
    if current.get("state") != {"config_update": "NOT_UPDATING", "ready": "READY"}:
        raise RuntimeError("Endpoint must be READY and NOT_UPDATING before/after every measurement round")
    if len(entities) != 1 or str(entities[0].get("entity_version")) != expected_version:
        raise RuntimeError("Endpoint must serve exactly the pinned model version")
    if len(routes) != 1 or routes[0].get("traffic_percentage") != 100 or routes[0].get("served_model_name") != entities[0]["name"]:
        raise RuntimeError("Endpoint must route 100% to the pinned model")
    # Preserve provenance without logging endpoint environment variables or credentials.
    return {"name": endpoint_name, "config_version": config.get("config_version"),
            "entities": [{key: entity.get(key) for key in (
                "name", "entity_name", "entity_version", "workload_type", "workload_size", "scale_to_zero_enabled")}
                for entity in entities], "routes": routes}


endpoint_before = endpoint_snapshot()
print(json.dumps({"planned_requests": planned_requests, "endpoint": endpoint_before}, indent=2))

# COMMAND ----------
# MAGIC %md
# MAGIC ## Freeze source versions and select reference crops
# MAGIC Sampling does not join prior transcription successes. Calls are seeded/hash-selected;
# MAGIC utterances are round-robin sampled across agent/customer and duration bands (≤3, ≤8, >8s).
# MAGIC Only spoken references 1–28s with valid timing are eligible. This length/annotation filter
# MAGIC defines the evaluation population; selection counts and exact inputs are logged.
# MAGIC No text normalization converts digits to spoken number words; inspect names/numbers manually.

# COMMAND ----------

catalog, schema = get("catalog"), get("schema")


def table_name(suffix):
    name = registered_name(f"{catalog}.{schema}.{suffix}")
    return ".".join(f"`{part}`" for part in name.split("."))


source_versions = {}
requested_versions = json.loads(get("source_versions_json") or "{}")
if not isinstance(requested_versions, dict) or any(
    key not in {"hvb_calls", "hvb_reference_utterances"} or type(value) is not int or value < 0
    for key, value in requested_versions.items()
):
    raise ValueError("source_versions_json must map source table suffixes to non-negative Delta versions")


def snapshot_table(suffix):
    name = table_name(suffix)
    version = requested_versions.get(suffix)
    if version is None:
        version = int(spark.sql(f"DESCRIBE HISTORY {name} LIMIT 1").first().version)
    source_versions[name] = version
    return spark.read.option("versionAsOf", version).table(name)


calls, references = snapshot_table("hvb_calls"), snapshot_table("hvb_reference_utterances")
excluded_development_calls = ["010eaccb7a23436f", "0002f70f7386445b"]
selected_calls = (calls.filter(~F.col("sid").isin(excluded_development_calls))
                  .orderBy(F.sha2(F.concat(F.lit(f"{seed}:"), F.col("sid")), 256), "sid")
                  .limit(sample_calls).select("sid", "agent_audio_path", "caller_audio_path"))
candidate_frame = (references.join(selected_calls, "sid")
    .filter(F.col("speaker_role").isin("agent", "caller", "customer"))
    .filter(F.col("duration_seconds").between(1.0, 28.0) & (F.col("channel_start_seconds") >= 0)
            & (F.col("conversation_start_seconds") >= 0) & (F.col("conversation_start_seconds") <= 86400)
            & F.col("human_transcript").isNotNull() & F.col("utterance_index").isNotNull())
    .select("sid", "speaker_role", "utterance_index", "human_transcript", "channel_start_seconds",
            "conversation_start_seconds", "duration_seconds", "agent_audio_path", "caller_audio_path"))
candidates = []
candidate_rows = candidate_frame.limit(10001).collect()
if len(candidate_rows) > 10000:
    raise ValueError("More than 10,000 reference candidates; reduce sample_calls")
for row in candidate_rows:
    data = row.asDict()
    if not words(data["human_transcript"]):
        continue
    role = "customer" if data["speaker_role"] == "caller" else data["speaker_role"]
    candidates.append({"sample_id": f"{data['sid']}_{role}_ref_{data['utterance_index']}",
        "sid": data["sid"], "speaker_role": role, "utterance_index": int(data["utterance_index"]),
        "reference_text": data["human_transcript"], "channel_start_seconds": float(data["channel_start_seconds"]),
        "conversation_start_seconds": float(data["conversation_start_seconds"]),
        "duration_seconds": float(data["duration_seconds"]),
        "source_audio_path": data["agent_audio_path"] if role == "agent" else data["caller_audio_path"]})
selected = select_samples(candidates, sample_size, seed)
if len(selected) != sample_size:
    raise ValueError(f"Only {len(selected)} eligible references; increase sample_calls or reduce sample_size")

samples = []
preparation_started = time.perf_counter()
for item in selected:
    prepared = {**item, "input_duration_seconds": item["duration_seconds"], "input_sha256": "",
                "input_wav_bytes": 0, "preparation_error": ""}
    try:
        audio = crop_wav(item["source_audio_path"], item["channel_start_seconds"], item["duration_seconds"])
        request = {"chunk_id": item["sample_id"], "audio_base64": base64.b64encode(audio).decode("ascii"),
                   "language": "English", "speaker_role": item["speaker_role"],
                   "offset_seconds": item["conversation_start_seconds"]}
        decoded = decode_request(request)
        prepared.update(input_duration_seconds=decoded.duration, input_sha256=decoded.sha256,
                        input_wav_bytes=len(audio), _audio=audio, _request=request)
    except Exception as exc:
        prepared["preparation_error"] = f"{type(exc).__name__}: {exc}"[:1000]
    samples.append(prepared)
preparation_seconds = time.perf_counter() - preparation_started
manifest = [{key: value for key, value in item.items() if not key.startswith("_")} for item in samples]
manifest_sha256 = hashlib.sha256(json.dumps(manifest, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
if get("expected_manifest_sha256") and manifest_sha256 != get("expected_manifest_sha256"):
    raise ValueError("Manifest/audio hashes changed; refusing to compare a different evaluation sample")
display(pd.DataFrame(manifest).drop(columns="reference_text"))

# COMMAND ----------
# MAGIC %md
# MAGIC ## Backend adapters and timing contract
# MAGIC Audio reads/cropping/base64 preparation and MLflow writes are **outside** timed rounds.
# MAGIC `ai_transcribe` latency includes a Spark SQL action, scheduling, the managed service and collection.
# MAGIC Qwen latency includes HTTPS/auth, queueing, ASR + forced alignment and response parsing.
# MAGIC These are deployment/workflow latencies, not isolated GPU compute measurements.
# MAGIC Each Qwen invocation contains one clip and uses no HTTP/application retry. Spark/the managed
# MAGIC AI service may retry internally; those attempts are not observable and their time is included.
# MAGIC Each SQL invocation has a unique nonce, is explicitly collected once, and is never persisted
# MAGIC or reused as a cached DataFrame. Provider-side caching cannot be ruled out for either backend.
# MAGIC Closed-loop workers test client concurrency, not a guaranteed autoscaling capacity or open-loop SLA.

# COMMAND ----------

local = threading.local()


def invoke_ai(item):
    raw = spark.sql(
        "SELECT :nonce AS invocation_id, to_json(ai_transcribe(:audio)) AS raw",
        args={"nonce": str(uuid.uuid4()), "audio": item["_audio"]},
    ).collect()[0].raw
    return ai_result(json.loads(raw))


def invoke_qwen(item):
    if not hasattr(local, "http"):
        local.http = requests.Session()  # Default requests adapter performs no retries.
    response = local.http.post(
        f"{workspace.config.host.rstrip('/')}/serving-endpoints/{quote(endpoint_name, safe='')}/invocations",
        headers=workspace.config.authenticate(), json={"dataframe_records": [item["_request"]]}, timeout=(10, 180),
    )
    if not response.ok:
        return {"status": "error", "text": "", "error": response.text[:1000],
                "error_code": f"HTTP_{response.status_code}"}
    raw = response.json()
    predictions = raw.get("predictions", [])
    if len(predictions) != 1 or predictions[0].get("chunk_id") != item["sample_id"]:
        raise ValueError("Qwen prediction identity/shape mismatch")
    prediction = predictions[0]
    result = json.loads(prediction["result_json"])
    return {"status": prediction["status"], "text": result["response"]["text"],
            "error": result.get("error_message", ""), "raw": raw}


backends = {"ai_transcribe": invoke_ai, "qwen3_asr": invoke_qwen}
mlflow.set_tracking_uri("databricks")
mlflow.set_experiment(get("experiment_path"))

# COMMAND ----------
# MAGIC %md
# MAGIC ## Run and log
# MAGIC Each configuration processes the **whole same manifest**, in the same seeded order for
# MAGIC both backends. Backend order alternates by repeat and concurrency level to reduce order bias.
# MAGIC Metrics include word-weighted WER/CER over all planned samples; errors receive empty hypotheses.
# MAGIC Successful-audio throughput counts only non-empty `ok` transcriptions, so fast failures do
# MAGIC not look like useful capacity. Per-role WER, coverage, errors and per-request results remain inspectable.
# MAGIC Queue time in this notebook's executor is separate from request latency; batch wall time includes
# MAGIC dispatch, requests and scoring, but excludes artifact logging and endpoint metadata checks.

# COMMAND ----------

summaries, accuracy_baseline = [], {}
with mlflow.start_run(run_name=f"hvb-asr-comparison-{seed}", nested=mlflow.active_run() is not None) as parent:
    parent_run_id = parent.info.run_id
    mlflow.set_tags({"benchmark": "hvb-asr-v1", "dataset": "HarperValleyBank CC BY 4.0 Gridspace/Stanford",
                     "latency_scope": "spark_sql_vs_https_workflow", "load_model": "closed_loop",
                     "primary_accuracy": "concurrency_1_repeat_0_all_planned_samples"})
    mlflow.log_params({"sample_size": sample_size, "sample_calls_requested": sample_calls,
        "seed": seed, "repeats": repeats, "concurrency_levels": ",".join(map(str, levels)),
        "normalization": NORMALIZATION, "language": "English", "crop_padding_seconds": 0,
        "manifest_sha256": manifest_sha256, "endpoint": endpoint_name, "model_version": expected_version,
        "planned_requests": planned_requests, "application_retries": 0, "qwen_http_timeout_seconds": 180})
    mlflow.log_dict({"source_versions": source_versions, "endpoint": endpoint_before,
        "excluded_development_calls": excluded_development_calls, "eligible_candidates": len(candidates),
        "selected_role_counts": dict(Counter(r["speaker_role"] for r in samples)),
        "packages": {name: importlib.metadata.version(name) for name in (
            "mlflow", "databricks-sdk", "pandas", "requests", "matplotlib")}}, "provenance.json")
    mlflow.log_dict({"sha256": manifest_sha256, "samples": manifest}, "manifest.json")
    mlflow.log_input(mlflow.data.from_pandas(pd.DataFrame(manifest), name="hvb-human-reference-crops",
                                           digest=manifest_sha256[:32], targets="reference_text"), context="evaluation")
    mlflow.log_metrics({"preparation_seconds": preparation_seconds,
                        "selected_calls": len({r["sid"] for r in samples}),
                        "preparation_errors": sum(bool(r["preparation_error"]) for r in samples)})
    for name in ("benchmark.py", "runtime.py"):
        mlflow.log_artifact(str(code_dir / name), artifact_path="source")

    # First request is reported separately; do not pretend it proves a cold start or warm service.
    for backend, invoke in backends.items():
        with mlflow.start_run(run_name=f"first-request-{backend}", nested=True):
            mlflow.set_tags({"backend": backend, "phase": "first_request_excluded_from_measured_rounds"})
            warmup, wall = run_load(samples[:1], invoke, 1)
            mlflow.log_dict({"rows": warmup, "wall_seconds": wall}, "first_request.json")
            mlflow.log_metrics({"wall_seconds": wall, "error": int(warmup[0]["status"] == "error")})

    for repeat in range(repeats):
        ordered = list(samples)
        random.Random(seed + repeat).shuffle(ordered)
        for level_index, concurrency in enumerate(levels):
            order = list(backends) if (repeat + level_index) % 2 == 0 else list(reversed(backends))
            for backend in order:
                if endpoint_snapshot() != endpoint_before:
                    raise RuntimeError("Endpoint configuration changed during benchmark")
                with mlflow.start_run(run_name=f"{backend}-c{concurrency}-r{repeat}", nested=True) as child:
                    mlflow.set_tags({"backend": backend, "phase": "measured", "manifest_sha256": manifest_sha256})
                    mlflow.log_params({"backend": backend, "concurrency": concurrency, "repeat": repeat,
                                       "sample_size": sample_size, "model_version": expected_version})
                    rows, wall = run_load(ordered, backends[backend], concurrency)
                    metrics = summarize(rows, wall)
                    mlflow.log_metrics(metrics)
                    mlflow.log_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows), "predictions.jsonl")
                    mlflow.log_table(pd.DataFrame([{k: v for k, v in row.items() if k != "raw"} for row in rows]),
                                     artifact_file="per_sample.json")
                    summary = {"backend": backend, "concurrency": concurrency, "repeat": repeat,
                               "child_run_id": child.info.run_id, **metrics}
                    mlflow.log_dict(summary, "summary.json")
                    if endpoint_snapshot() != endpoint_before:
                        mlflow.set_tag("endpoint_changed", "true")
                        raise RuntimeError("Endpoint configuration changed during a timed round; results are invalid")
                    summaries.append(summary)
                    if concurrency == 1 and repeat == 0:
                        accuracy_baseline[backend] = rows
                    print(json.dumps({k: summary[k] for k in (
                        "backend", "concurrency", "repeat", "wer_all", "error_rate", "wall_seconds",
                        "successful_audio_hours_per_wall_hour")}, indent=2))

    delta = paired_wer_delta(accuracy_baseline["ai_transcribe"], accuracy_baseline["qwen3_asr"], seed)
    mlflow.log_metrics(delta)
    for backend, rows in accuracy_baseline.items():
        primary = summarize(rows, next(r["wall_seconds"] for r in summaries
                                      if r["backend"] == backend and r["concurrency"] == 1 and r["repeat"] == 0))
        mlflow.log_metrics({f"{backend}_{key}": primary[key] for key in (
            "wer_all", "cer_all", "error_rate", "response_completion_rate")})
    summary_frame = pd.DataFrame(summaries)
    mlflow.log_table(summary_frame, artifact_file="comparison.json")
    mlflow.log_text(summary_frame.to_csv(index=False), "comparison.csv")
    mlflow.log_dict(delta, "paired_accuracy.json")
    figure, axes = plt.subplots(1, 3, figsize=(16, 4))
    for backend, frame in summary_frame.groupby("backend"):
        grouped = frame.groupby("concurrency").mean(numeric_only=True)
        axes[0].plot(grouped.index, grouped.wer_all, marker="o", label=backend)
        if "latency_all_p95_seconds" in grouped:
            axes[1].plot(grouped.index, grouped.latency_all_p95_seconds, marker="o", label=backend)
        axes[2].plot(grouped.index, grouped.successful_audio_hours_per_wall_hour, marker="o", label=backend)
    for axis, title, ylabel in zip(axes, ("All-input WER", "End-to-end p95 latency", "Useful audio throughput"),
                                   ("WER (lower is better)", "Seconds", "Audio hours / wall hour")):
        axis.set(title=title, xlabel="Client concurrency", ylabel=ylabel)
        axis.set_xticks(levels)
        axis.grid(alpha=.25)
        axis.legend()
    figure.suptitle("Mean across repeats; p95 points are means of per-round p95s, not pooled p95s")
    figure.tight_layout()
    mlflow.log_figure(figure, "comparison.png")
    display(figure)
    plt.close(figure)

# COMMAND ----------
# MAGIC %md
# MAGIC ## Interpret results
# MAGIC Compare primary accuracy from concurrency 1 / repeat 0 (one prediction per unique clip).
# MAGIC The paired WER delta is **Qwen minus ai_transcribe**; negative favors Qwen. The 95% interval
# MAGIC resamples whole calls because utterances from one call are correlated. A small role-played
# MAGIC banking sample cannot establish a universal model winner. P95 from a few requests is unstable.
# MAGIC For scaling, look for throughput gains together with p95 latency and error/completion rates.
# MAGIC Fixed client concurrency does not control serverless Spark resources or endpoint replicas;
# MAGIC inspect endpoint metrics and billing separately before claiming GPU autoscaling or cost efficiency.
# MAGIC ai_transcribe's managed checkpoint is not exposed/pinned here; its observation date and raw
# MAGIC response metadata are retained. No timestamp-accuracy score is inferred from the oracle crops.

# COMMAND ----------

display(summary_frame)
print(json.dumps(delta, indent=2))
experiment_id = parent.info.experiment_id
run_url = f"{workspace.config.host.rstrip('/')}/ml/experiments/{experiment_id}/runs/{parent_run_id}"
dbutils.notebook.exit(json.dumps({"mlflow_run_id": parent_run_id, "mlflow_url": run_url,
    "manifest_sha256": manifest_sha256, "sample_size": sample_size, "model_version": expected_version,
    "paired_accuracy": delta, "summaries": summaries}))
