# Custom transcription model serving

Package **Qwen3-ASR-1.7B + Qwen3-ForcedAligner-0.6B** as an MLflow model, register it in Unity Catalog, and deploy an explicit version to Databricks Model Serving. Real GPU packaging, managed endpoint inference and the companion notebook passed on 24 October 2026. Development endpoint `brian-qwen3-transcription-dev` serves UC version **2** with matching CUDA 11.8 GPU packages and scale-to-zero enabled.

## Model choice — 24 October 2026

For this project's transcription and timestamp-based call review, start with Qwen3-ASR-1.7B and its forced aligner. This is a recommendation to evaluate, not a claim of a universal leaderboard winner. The primary sources checked do not establish one October 2026 winner across accuracy, latency, languages and cost.

| Candidate | Why evaluate it | Tradeoff |
|---|---|---|
| [Qwen3-ASR-1.7B](https://huggingface.co/Qwen/Qwen3-ASR-1.7B) | Strong published recognition results; Apache 2.0; 30 languages and 22 Chinese dialects | Timestamps require a separate 0.6B aligner, supporting 11 languages. This subproject implements the Transformers backend. |
| [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) | Smaller model designed for throughput; native word/segment timestamps; 25 European languages | CC BY 4.0 attribution requirements; benchmark as the speed/cost alternative. Its serving adapter is not implemented here. |
| Databricks `ai_transcribe` | Existing notebook baseline and simplest managed path | Measure quality and operational cost against custom serving before switching. |

Use a fixed held-out set from HarperValleyBank and AMI plus representative noisy, accented and long recordings. Measure WER, names/numbers, timestamp errors, silence hallucinations, failed calls, p50/p95 latency, audio-hours/hour and cost/audio-hour. Count complete failures in completion metrics; the current HarperValleyBank WER calculation excludes them. Published scores on different datasets or checkpoint revisions are not directly interchangeable.

Sources: [Qwen implementation](https://github.com/QwenLM/Qwen3-ASR), [Qwen technical report](https://arxiv.org/abs/2601.21337), and the model cards above. No fine-tuning is required for this packaging flow.

## Files and boundaries

| File | Responsibility |
|---|---|
| `model.py` | MLflow Models from Code wrapper; offline CUDA loading, serial inference, per-chunk outcomes |
| `runtime.py` | Bounded PCM16 WAV contract, input hashes, timestamp normalization and response metadata |
| `register.py` | Resolve immutable model revisions, package weights/dependencies, run a spoken GPU fixture, then register in UC |
| `submit_gpu.py` | Stage a selected fixture and source files, dry-run an AI Runtime workload, and optionally launch one A10 with a timeout and idempotency key |
| `deploy.py` | Print a deployment plan or create/update an explicit model version; verify readiness, routing and a spoken fixture |
| `query.py` | Explicit-profile client and importable `query_chunks`; bounded retries on selected transient errors |
| `notebooks/01_query_endpoint.py` | CPU/serverless notebook example: read one existing HarperValleyBank chunk, query the GPU endpoint and inspect call-timeline word spans |
| `notebooks/02_compare_transcription.py` | MLflow-logged ai_transcribe/Qwen accuracy, latency and concurrency benchmark on identical human-reference audio crops |
| `benchmark.py` | Deterministic sampling, WER/CER and edit counts, bounded load generation, failure-inclusive summaries and call-paired accuracy intervals |
| `requirements.txt` / `requirements.lock` | Direct pins / resolved Linux x86_64 Python 3.12 runtime dependencies |
| `requirements-client.txt` / `requirements-dev.txt` | Lightweight deployment/query dependencies / local test dependencies |
| `requirements-benchmark.txt` | CPU/serverless comparison notebook environment; no local model weights or CUDA |
| `tests/test_serving.py` | Contract, MLflow save/load/scoring and endpoint-client tests with mocked inference |

The SDK scripts own deployment independently of the app; there is no model-serving bundle yet. Both [AMI](../../notebooks/ami/README.md) and [HarperValleyBank](../../notebooks/harper_valley_bank/README.md) still use `ai_transcribe`. Backend selection and durable batch orchestration in those notebooks remain to be implemented. The [Call Insights app](../../apps/call-insights/README.md) reads persisted tables and does not invoke this endpoint on page load.

## Runtime compatibility

Use Linux x86_64, Python 3.12 and an NVIDIA CUDA GPU for packaging and real inference. The lock pins PyTorch/torchaudio 2.7.1+cu118 and torchvision 0.22.1+cu118 using official CPython 3.12 Linux wheel URLs. The first A10G validation used PyTorch 2.10.0/CUDA 12.8 and passed, but the managed serving build subsequently installed its bundled torch/torchvision 2.7.1/0.22.1 CUDA 11.8 wheels, leaving torchaudio 2.10 incompatible. Version 2 passed GPU validation with the matching CUDA 11.8 runtime. Its wrapper checks GPU package versions and PyTorch's CUDA runtime against its packaging manifest at startup. The code uses SDPA attention, bf16 on supported GPUs and fp16 otherwise, without FlashAttention or vLLM.

**Verified development configuration:** `GPU_MEDIUM`, Small, Python 3.12, PyTorch 2.7.1+cu118 and the matching audio/vision packages in `fevm-serverless-stable-prvwqx`. Version 2 passed real endpoint inference, including its startup package/CUDA checks. The [custom endpoint documentation](https://docs.databricks.com/aws/en/machine-learning/model-serving/create-manage-serving-endpoints#gpu-workload-types) still lists older PyTorch compatibility; actual build logs were decisive here. Model Serving still manages the web-server layer (observed gunicorn 25.3.0 versus the lock's 26.2.0), so the full image is not identical to the GPU validation environment. Inspect logs and rerun the fixture after platform changes or deployment to another workspace/region.

For the initial capacity experiment, try `GPU_MEDIUM` (AWS A10G, 24 GB); `GPU_SMALL` (T4, 16 GB) is another explicit option. These are candidates, not measured capacity guarantees. One inference engine processes rows serially per loaded model instance; endpoint replicas provide additional capacity. Load-test memory, queueing and throughput before production use.

## Package and register on GPU compute

Run from this directory. Choose a Databricks profile explicitly, replace the example UC name/experiment, and supply a real spoken fixture whose expected phrase is known. The profile must be available to the packaging process and its isolated validation environment. Registration needs UC model creation/version permissions; endpoint creation needs access to the registered model and serving resources.

```bash
cd models/transcription
uv venv --python 3.12
uv pip install -r requirements.lock

.venv/bin/python register.py \
  --profile YOUR_PROFILE \
  --registered-model YOUR_CATALOG.YOUR_SCHEMA.qwen3_asr \
  --experiment /Users/YOUR_USER/qwen3-asr-package \
  --sample-wav /absolute/path/spoken-fixture.wav \
  --expected-text "the phrase in your fixture"
```

The script resolves `main` once to a full Hugging Face commit SHA, downloads ASR and aligner weights into ignored `artifacts/`, and records both revisions in a manifest. For repeatable releases, pass the recorded SHAs with `--revision` and `--aligner-revision`. Network access to the model/package registries is needed during packaging; model startup loads the packaged artifacts offline.

MLflow logs the model and runs the fixture through `mlflow.models.predict(..., env_manager="uv")` in the locked environment on your GPU. UC registration happens only after a successful transcription containing the expected phrase, ignoring case/punctuation. Use a non-sensitive fixture: its audio is stored as the model's MLflow input example. A fixture gate is a smoke check, not a benchmark.

The returned numeric UC version is written to ignored `registration.json`. No aliases are moved. `--without-timestamps` omits the aligner and produces coarse whole-clip spans; it is unsuitable for word-level evidence seeking. `--sample-language` changes the fixture language from English.

## Run registration on Databricks serverless GPU

The selected workspace is `fevm-serverless-stable-prvwqx`. Access to its existing AMI and HarperValleyBank tables has been verified. Use the AI Runtime route when your laptop has no CUDA GPU. It needs Databricks CLI 1.20+ with `databricks air` and workspace access to serverless GPU workloads.

```bash
.venv/bin/python submit_gpu.py \
  --profile fevm-serverless-stable-prvwqx \
  --registered-model serverless_stable_prvwqx_catalog.call_insights.qwen3_asr_dev \
  --experiment-directory /Workspace/Users/brian.law@databricks.com \
  --sample-wav /absolute/path/spoken-fixture.wav \
  --expected-text "harper valley national bank"
```

The default is a remote dry run. Add `--apply --idempotency-key YOUR_UNIQUE_RELEASE_KEY` to submit. Reuse the same key when recovering the result of a possibly successful submission; change it only for an intentional new run. Pass `--revision` and `--aligner-revision` with the recorded SHAs when comparing runtime changes. The helper uses one A10, environment version 6 (Python 3.12), the locked dependencies and a default 20-minute timeout with no retries. `--timeout-minutes` can change the cap. GPU tasks ignore the CPU Jobs performance target.

Only the wrapper, runtime, registration script, requirements and selected fixture are staged. Local credentials, caches and the source corpus are excluded. On GPU compute, registration uses explicit `--runtime-auth` to obtain the workload's Databricks credentials, rather than expecting your local CLI profile to exist there. The registration receipt is also logged to MLflow as `registration.json`, so it survives the ephemeral worker. Local plans and submission receipts are stored under ignored `artifacts/gpu-validation/`.

```bash
databricks air get RUN_ID --profile fevm-serverless-stable-prvwqx --output json
databricks air logs RUN_ID --profile fevm-serverless-stable-prvwqx
```

Initial GPU validation passed on 24 October 2026: [run 890148290867766](https://fevm-serverless-stable-prvwqx.cloud.databricks.com/jobs/runs/890148290867766), MLflow run `fd15676ef91a4098bbd45606faef6ecf`. Its fixture is a 5.44-second cut from public HarperValleyBank agent recording `010eaccb7a23436f`, starting 0.5 seconds before the human-referenced greeting at channel time 1.719 seconds. The fixture transcribed the expected phrase “harper valley national bank” and produced valid alignment intervals; the source tables/audio are unchanged.

Initial registered model: `serverless_stable_prvwqx_catalog.call_insights.qwen3_asr_dev`, version **1**. ASR checkpoint: `7278e1e70fe206f11671096ffdd38061171dd6e5`; aligner checkpoint: `c7cbfc2048c462b0d63a45797104fc9db3ad62b7`. The complete dependency/revision receipt is in that MLflow run's `registration.json` artifact. A successful AI Runtime run alone does not prove Model Serving image compatibility: the endpoint has a separate runtime and needs its own smoke test. This single greeting is not an accuracy or throughput benchmark.

The development endpoint `brian-qwen3-transcription-dev` reached `READY`/`NOT_UPDATING` on version 1 and passed its spoken fixture. A separate three-row request verified successful speech, digital silence (`no_speech`), and malformed WAV (`error`) without discarding the valid result. Its 42-second offset produced word spans from 42.56 to 46.96 seconds with the known agent role. [Notebook run 309257101820677](https://fevm-serverless-stable-prvwqx.cloud.databricks.com/jobs/runs/309257101820677) also succeeded on existing chunk `0002f70f7386445b_agent_000` (7.46 seconds), returning the greeting and call-timeline word spans. No source/output tables were written. Version 1 worked despite build-time package drift described above; it is not evidence that its original dependency lock was preserved.

Matching-runtime validation also passed: [A10G run 210078760234449](https://fevm-serverless-stable-prvwqx.cloud.databricks.com/jobs/runs/210078760234449), MLflow run `d0c72bd5ced14d4bb3b5bd199d19d71d`, UC version **2**, PyTorch 2.7.1+cu118/CUDA 11.8, with the same immutable ASR/aligner revisions and fixture. This run logs both `registration.json` and `fixture_prediction.json`. Version 2 then reached `READY`/`NOT_UPDATING` with its exact GPU/scale/offline settings and 100% route, passed the spoken fixture, and passed the same three-row offset/silence/error test. Its build retained the matching GPU packages. The prior version 1 configuration is saved in ignored `deployment-v2.json` for explicit rollback. [Serverless notebook run 479109701252002](https://fevm-serverless-stable-prvwqx.cloud.databricks.com/jobs/runs/479109701252002) then passed against the active version 2 endpoint on the same existing chunk.

## Plan, deploy and query

Deployment/query can run from a separate CPU laptop environment with just `requirements-client.txt`. This does not install the model weights or inference runtime:

```bash
uv venv --python 3.12
uv pip install -r requirements-client.txt

# Prints JSON only; no workspace calls. Use the version from registration.json.
.venv/bin/python deploy.py \
  --profile YOUR_PROFILE --endpoint qwen3-transcription-dev \
  --registered-model YOUR_CATALOG.YOUR_SCHEMA.qwen3_asr \
  --version 2 --workload-type GPU_MEDIUM
```

Add the following flags to the same command to create the endpoint and smoke-test it:

```text
--apply --sample-wav /absolute/path/spoken-fixture.wav --expected-text "the phrase in your fixture"
```

For an existing endpoint, also pass `--update-existing`. This replaces its served-entity list and sends 100% of traffic to the requested version; use a dedicated development endpoint first. The script waits for `READY` and `NOT_UPDATING`, verifies the exact active UC version, GPU/scale settings, offline environment and route, then queries the fixture. The default readiness timeout is 40 minutes; `--timeout-seconds` changes it. Initial development provisioning took about 27 minutes. An old version remaining ready during an update does not count as success. The fixture check occurs after routing has changed, so this is not a canary rollout or automatic promotion gate.

`deployment.json` records the previous active configuration, requested version, outcome and successful fixture prediction. Use a distinct `--output deployment-v2.json` for each rollout to retain history. If readiness times out, the remote build can still be running: use `--wait-only` in place of `--apply` with the same version/GPU/scale settings and a new receipt path to resume checks without changing the endpoint. There is no automatic rollback. For a prior single-model configuration, rerun deployment with its known numeric version, original GPU/scale settings and `--update-existing --apply`, then smoke-test it. Restore multi-model traffic/custom settings from the saved configuration using the serving API; the convenience script does not reconstruct them. A failed update can leave the previous version serving; inspect the active configuration before taking further action.

Scale-to-zero is off by default. `--scale-to-zero` opts into development cold starts. An endpoint can incur charges until you stop/delete it through Databricks.

```bash
.venv/bin/python query.py \
  --profile YOUR_PROFILE --endpoint qwen3-transcription-dev \
  --wav /absolute/path/agent-chunk.wav --chunk-id call-123-agent-001 \
  --speaker-role agent --offset-seconds 42.0 --language English
```

## Request and result contract

Send `{"dataframe_records": [row, ...]}` to the endpoint. Each row contains:

| Field | Meaning |
|---|---|
| `chunk_id` | Required stable chunk identifier, 1–200 characters |
| `audio_base64` | Required standard base64 of an uncompressed mono PCM16 WAV, including its header |
| `language` | Optional language name; default `English`; empty string requests detection |
| `speaker_role` | Optional `agent`, `customer`, `participant` or `unknown`; default `unknown` |
| `offset_seconds` | Optional chunk start on the call timeline; default 0; range -30 to 86400 |

Application limits: **30 seconds/chunk**, **3,000,000 WAV bytes/chunk**, **1–4 rows/request**, **8,000,000 JSON bytes/request**. Accepted rates: 8, 16, 22.05, 24, 44.1 and 48 kHz. Qwen handles resampling internally. These caps are stricter than [Databricks endpoint limits](https://docs.databricks.com/aws/en/machine-learning/model-serving/model-serving-limits). The server accepts audio bytes; it does not open client paths, URLs or `/Volumes/...` references.

Timestamp mode supports English, Chinese, Cantonese, French, German, Italian, Japanese, Korean, Portuguese, Russian and Spanish. Use the canonical names shown here. Auto-detected audio must also be supported by the aligner. Other ASR languages need a separately registered `--without-timestamps` model or another alignment solution. Roles come from known channels; this model does not perform speaker diarization. Split HarperValleyBank channels before submission; AMI mixed-speaker audio needs its own speaker attribution.

Results preserve row order and chunk IDs:

```json
{
  "predictions": [{
    "chunk_id": "call-123-agent-001",
    "status": "ok",
    "result_json": "{...}"
  }]
}
```

Parse `result_json` as JSON/Delta VARIANT. It contains `response.text`, `response.language`, `response.segments` (`start`, `end`, `text`, `speaker_id`), `error_message` and metadata including model/aligner revisions, input SHA-256, duration, timestamp granularity/origin and elapsed time. `status` is `ok`, `no_speech` (digital zero PCM only), `empty` (no recognized text) or `error`. Bad chunks get individual error rows; invalid batch size/schema/request limits can fail the entire invocation. Silence detection here is not a general VAD.

**Offsets are applied exactly once by this endpoint.** Segment seconds already refer to the call timeline (`timestamp_origin="call"`), with negative padding clamped to zero. The current HarperValleyBank notebook adds offsets to `ai_transcribe` clip-relative results. Its future custom-endpoint adapter must bypass that addition.

A notebook/Job should read volume files on the client, split long audio into bounded chunks, retain overlap ownership, and submit batches with limited concurrency. Persist chunk results, attempt/status, preprocessing version, timestamps and model provenance before building interaction tables; handle `empty`, no-speech and errors explicitly. `query_chunks` retries selected transient service errors, but does not provide long-call chunking, durable progress, deduplication, VAD or end-to-end benchmark orchestration.

For an interactive starting point, open [the endpoint-query notebook](notebooks/01_query_endpoint.py) from a Databricks Git folder containing this subproject. Set `serving_code_dir` to its `models/transcription` folder if the default parent directory differs. It uses the notebook's runtime identity and reads one prepared HarperValleyBank chunk without writing results. The serverless Databricks notebook passed against versions 1 and 2; [the version 2 run](https://fevm-serverless-stable-prvwqx.cloud.databricks.com/jobs/runs/479109701252002) returned the same valid greeting and call-timeline word spans.

## MLflow comparison: accuracy, latency and scaling

Open [02_compare_transcription.py](notebooks/02_compare_transcription.py) on CPU/serverless compute with [requirements-benchmark.txt](requirements-benchmark.txt) in its environment. Set `serving_code_dir` to this subproject's `/Workspace/.../models/transcription` directory. It uses the notebook's runtime identity, requires access to `ai_transcribe`, the existing HarperValleyBank tables/audio and `CAN_QUERY` on the Qwen endpoint, and writes only MLflow runs/artifacts. It does not replace transcription tables or change endpoint configuration.

Start with these widgets for a small validation run:

| Widget | Small run | Default comparison |
|---|---|---|
| `sample_size` | `4` | `24` |
| `sample_calls` | `4` | `12` |
| `concurrency_levels` | `1,2` | `1,2,4,8` |
| `repeats` | `1` | `2` |
| `max_requests` | `20` | `1000` |
| `endpoint` / `expected_model_version` | `brian-qwen3-transcription-dev` / `2` | Same |
| `experiment_path` | `/Users/<you>/transcription-comparison` | Same; parent folder must exist |

The small run issues **18 calls** including two first-request/warmup calls; the defaults issue **386**. Requests invoke paid services. Hard limits cap samples at 256, client concurrency at 16, repeats at 5 and total planned requests at 5,000. No application retries are performed, and the Qwen HTTP client disables retries by using the default `requests` adapter. Spark and the managed service may retry internally; those attempts are unobservable and included in wall time. The entire experiment also needs a Jobs/notebook execution timeout appropriate to its size.

The notebook freezes Delta versions of `hvb_calls` and `hvb_reference_utterances`, hash-selects calls with a seed, then round-robin selects human utterances across role/duration bands. It excludes the two development-fixture calls and never joins prior ASR successes. Both backends receive identical 1–28 second mono PCM16 WAV crops from original agent/customer channels, with no reference text in their requests. This measures recognition with reference-defined segmentation; it does not evaluate VAD, diarization, long-call handling or unseen-pretraining generalization. Only eligible spoken references are sampled, so the noise-only population needs a separate evaluation.

The parent MLflow run contains the input dataset/manifest and SHA256, Delta source versions, endpoint version/GPU configuration, package versions, helper source, paired accuracy, summary CSV/table and scaling plots. Every backend × concurrency × repeat has a child run with metrics, `predictions.jsonl` including raw responses/errors and `per_sample.json`. First-request results are separate children and excluded from the measured rounds; the notebook does not force or claim a cold start. Endpoint version/configuration is checked before and after each round, so a concurrent rollout invalidates the run.

| Measurement | Definition |
|---|---|
| `wer_all`, `cer_all` | Corpus edit errors / reference words or characters, including every planned sample; failed requests have empty hypotheses. Character scoring excludes normalized spaces. |
| `wer_completed_only`, `wer_agent`, `wer_customer` | Diagnostic accuracy views; keep `wer_all` and coverage as the primary comparison. |
| `latency_all_p50_seconds`, `latency_all_p95_seconds` | Caller-observed request latency, including errors; successful-only latency is also logged. Driver executor queue time is separate. |
| `request_all_rtf_p50`, `batch_wall_rtf` | Request latency / audio duration, and whole-round wall time / total audio duration. Lower is better. |
| `successful_audio_hours_per_wall_hour` | Audio duration with non-empty successful transcriptions / round wall time. Read alongside error/empty/completion rates. |
| `wer_delta_qwen_minus_ai` | Paired primary-accuracy difference from concurrency 1/repeat 0; negative favors Qwen. A 95% interval bootstraps whole calls when at least two calls are present. |

Normalization uses Unicode NFKC/case folding, strips bracketed annotations and punctuation, and retains apostrophes. Digits are not expanded to number words. WER can exceed 1 due to insertions. The baseline accuracy uses one hypothesis per clip; repeated load rounds remain separate so concurrency-induced errors and nondeterminism are visible.

Latency is **end-to-end workflow latency**: `ai_transcribe` includes Spark scheduling/action/collection, while Qwen uses HTTPS and includes forced alignment. Audio preparation and MLflow logging are outside timed rounds. Unique SQL nonces and one `collect()` per invocation avoid reusing a cached result DataFrame; service-side caching is unknown. These curves measure a bounded closed-loop client workload, not isolated model compute, native bulk Spark throughput, a guaranteed autoscaling limit or cost efficiency. No p95/SLA conclusion should be drawn from four clips. Run larger repeated samples, inspect saturation/error rates and endpoint metrics, and reconcile actual billing before choosing production capacity.

For exact data replay, set `source_versions_json` to the recorded suffix/version mapping, for example `{"hvb_calls": 0, "hvb_reference_utterances": 0}`, and set `expected_manifest_sha256` to the prior manifest hash. Reuse the same sample settings/seed; the notebook rejects changed audio/references. Delta time travel must still be retained. Qwen's UC version is pinned; `ai_transcribe`'s managed checkpoint is not exposed here, so raw metadata and the observation time in MLflow are part of its provenance.

Live notebook validation passed on 24 October 2026: [Databricks run 832673772325724](https://fevm-serverless-stable-prvwqx.cloud.databricks.com/jobs/runs/832673772325724), [MLflow comparison run](https://fevm-serverless-stable-prvwqx.cloud.databricks.com/ml/experiments/4081675263757031/runs/2add5980e62645238356e69c6e74dd94). This used four crops (50 reference words, 11.88 seconds of unique audio), two represented calls, concurrency 1/2 and one repeat. Both backends returned all measured samples successfully, with zero observed word errors in this small sample. The parent, six child runs, per-sample artifacts and plots were logged successfully. This validates the benchmark implementation; it does not establish population accuracy, a latency SLA or saturation capacity. The 24-clip/concurrency-8 default experiment has not been executed yet.

## Local verification

In a fresh Python 3.12 environment, install `requirements-dev.txt`, then run:

```bash
MLFLOW_DISABLE_AGENT_HINT=1 .venv/bin/python -m unittest discover -s tests -v
```

The 40 tests cover the serving checks above plus benchmark normalization/edit counts, failure-inclusive weighted accuracy and throughput, missing-audio handling, paired input identity/intervals, deterministic stratified sampling, exact audio crops and bounded one-attempt concurrency. They do not establish recognition accuracy, real memory use, offline loading of actual weights, CUDA compatibility or successful Databricks deployment. Those require the GPU, endpoint and benchmark validation runs.
