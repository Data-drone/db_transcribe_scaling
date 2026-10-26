# Synthetic audio for transcription testing

Generate fictional speaker personas with Qwen3-TTS, reuse their voices across scripted banking
conversations, and create paired clean/noisy recordings with explicit impairment settings.
This is an independent Python subproject; it does not change existing notebooks, ASR serving,
tables or the Call Insights app. No account, catalog, schema, volume or endpoint is selected by default.

## Compute choice: AIR for this workload

Use **Databricks AI Runtime (AIR)** for offline dataset generation: load a model once, synthesize
many lines, apply CPU audio effects, persist the dataset, and release the GPU. Start with one A10
and measure actual VRAM and throughput. VoiceDesign is unloaded before Base is loaded. The
launcher bounds the job to 60 minutes by default and disables automatic retries.

Use **Model Serving** when an app needs repeated on-demand requests, concurrent callers, an API
and endpoint operations. It requires a custom TTS model wrapper and audio response contract.
This project deliberately implements the batch path first; it makes no claim that AIR is cheaper
at a particular volume without measured runtime and billing. AIR availability, quotas, package
installation, model download egress and GPU compatibility must be checked in your chosen workspace.

The AIR config follows the installed CLI 1.21.0 schema (`databricks air run -h config`).
For an eventual endpoint, review [Model Serving limits](https://docs.databricks.com/aws/en/machine-learning/model-serving/model-serving-limits).

## Models and persona controls

- [Qwen3-TTS-12Hz-1.7B-VoiceDesign](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign)
  creates each synthetic persona from its text description and reference sentence.
- [Qwen3-TTS-12Hz-1.7B-Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base)
  builds one reusable clone prompt per synthetic reference and generates subsequent lines.
  Both models use Apache 2.0. See the [official design-then-clone workflow](https://github.com/QwenLM/Qwen3-TTS#voice-design-then-clone).

Describe age range, accent, pitch, texture and delivery in `personas[].description`. Persona
descriptions are instructions, not guaranteed acoustic attributes. The Base model has no separate
per-line emotion instruction in this path; delivery comes from the persona reference and text.
Use separate personas for different delivery styles. Listen to the generated reference clips.

The complete model snapshots (including their speech tokenizer) are resolved to immutable HF
commit SHAs before loading. `main` is convenient for an initial run; replay with the SHAs from
`provenance.json`. Seeded GPU inference is not guaranteed to reproduce bit-identical speech.
Noise transforms are deterministic given the same waveform, settings, dependency versions and seed.

## Local setup and preview

Run from `data-generation/` with Python 3.12 and [uv](https://docs.astral.sh/uv/):

```bash
uv sync --frozen
uv run audio-data-gen plan --config configs/banking-demo.json
uv run pytest
```

The sample plan has three personas, two banking conversations, eight synthesized turns,
32 utterance WAVs and eight mixed conversation WAVs. Every clean item has three degraded variants.
The second conversation includes a 250 ms interruption. The example is a small functional fixture,
not a statistically representative evaluation corpus.

For an end-to-end call, use `configs/banking-full-conversation.json`: 32 turns between two
fictional Australian speakers, covering a duplicate card payment from greeting to goodbye.
It uses conversational reference prompts, contractions, varied gaps, a screen-checking pause and
a brief interruption. Outputs include a complete clean conversation at 24 kHz and a lightly
filtered telephone version. Individual turns are still synthesized independently; this does not
provide a dialogue model's shared prosody or prove human-level naturalness. The fictional banking
script is an audio fixture, not operational banking guidance.

The full-call config completed successfully on A10G in
[AIR run 256281248408767](https://fevm-serverless-stable-prvwqx.cloud.databricks.com/jobs/runs/256281248408767).
Both complete recordings are 168.2 seconds (2 minutes 48 seconds), with 32 turns. All 66 manifest
rows passed waveform, duration, format and hash checks; this does not verify spoken wording or
perceived naturalness. Local audio and the intended script are under
`artifacts/air-full-conversation-v1/`.

Check the complete file/manifest pipeline without downloading model weights:

```bash
uv run audio-data-gen generate --config configs/banking-demo.json \
  --backend tone --output-dir output/plumbing-check
```

**The tone backend produces tones, not speech.** Its manifests explicitly mark
`contains_synthetic_speech: false`. Never use these fixtures to measure recognition quality.

For real speech on a compatible local NVIDIA GPU:

```bash
uv sync --frozen --extra tts
uv run --extra tts audio-data-gen generate --config configs/banking-demo.json \
  --output-dir output/banking-v1
```

The default is `cuda:0`, BF16 and PyTorch SDPA; FlashAttention compilation is not required.
`--device cpu` uses FP32 and is intended only for experimentation, not a throughput target.
The TTS environment is independent of `models/transcription/`, whose Transformers pin differs.
`uv.lock` locks all Python dependencies; system CUDA/driver and optional system audio tools remain
runtime prerequisites. The lock uses public PyPI artifact URLs so a workstation's private package
mirror is not required on AIR. Real Qwen inference must still be verified on the selected GPU.

## Configuring interference

Edit `configs/banking-demo.json` or supply your own config. Effects run in this fixed order:

1. Band-pass filter, then one delayed echo within the original duration.
2. Gaussian noise at the requested whole-clip RMS SNR.
3. Seeded dropout intervals, then hard clipping.
4. Peak limiting only when needed to avoid PCM overflow.

`phone` approximates narrow-band audio with light noise. `radio_poor` adds more noise, dropouts
and clipping. `room_echo` adds a single echo and noise. These are controllable approximations,
not physical RF propagation, telecom codecs, packet-loss concealment or measured room responses.
Dropout intervals may overlap and can remove reference words. Noise is added after filtering,
so the combined noise need not be confined to the speech passband. The requested SNR is measured
before dropout/clipping; later transforms can change final SNR. All settings and realized dropout
intervals are recorded. Separate clips and full conversations are degraded independently.

Each turn has a `persona`, `text`, and optional `gap_seconds` relative to the previous turn's end.
Negative gaps create overlap in the mixed mono conversation. Individual clips remain isolated.
Each synthesized turn must be finite, non-silent and at most 30 seconds; overlong output fails
rather than silently truncating reference speech. Mixed conversations are capped at ten minutes.

## Dataset outputs and evaluation caveats

```text
config.json, provenance.json, summary.json
personas.json, personas/<persona>.wav
clips.jsonl, clips/<conversation>-tNNN/{clean,phone,radio_poor,room_echo}.wav
conversations.jsonl, conversations/<conversation>/{clean,phone,radio_poor,room_echo}.wav
```

All audio is mono PCM16 WAV, resampled to the configured 16 or 24 kHz rate. JSONL rows include
relative audio paths, SHA256, clean-parent SHA256, duration, persona/role, text, split, seeds,
impairments and backend. `provenance.json` records resolved model commits and installed versions.
Conversation manifests additionally include utterance start/end placement, speaker labels and
mix gain. Those intervals include any TTS leading/trailing silence; they are **not word alignments**.

**The script is an intended transcript, not verified ground truth.** A TTS model can omit words,
change numbers or mispronounce names. All rows have `reference_status: unverified_script`.
Listen to clean outputs and correct/verify transcripts before computing WER. Do not automatically
replace references with predictions from the recognizer under test. Synthetic audio supplements
real recorded evaluation; it does not establish production accuracy or accent coverage.

Keep all impaired variants of a conversation in the same split (enforced by generation). For
speaker generalization, also reserve distinct personas for evaluation; the example intentionally
shares an agent between its two splits and does not measure unseen-speaker generalization.

The clip WAVs fit the existing custom ASR endpoint's mono PCM16/30-second input contract; the
JSONL schema is independent. An adapter is still needed to feed these references into the existing
benchmark or app tables. Full conversations need a separate long-form/diarization evaluation.

Every output directory must be new. Failures retain a `failed` summary and any completed files;
there is no implicit resume or overwrite. Choose a new directory or a new AIR run to retry.

## Run on Databricks AIR

Choose your workspace profile and MLflow experiment directory explicitly. From this directory:

```bash
uv run python submit_air.py --profile <your-profile> \
  --config configs/banking-demo.json --experiment-directory /Workspace/Users/<you> \
  --artifacts-dir artifacts/plan-v1 --plan-only
```

This writes a reviewable local plan without contacting Databricks. Remove `--plan-only` and use
a new `--artifacts-dir` to run workspace validation only. Then submit with:

```bash
uv run python submit_air.py --profile <your-profile> \
  --config configs/banking-demo.json --experiment-directory /Workspace/Users/<you> \
  --artifacts-dir artifacts/run-v1 --apply --idempotency-key persona-audio-v1
```

The launcher stages only package source, the selected config, `pyproject.toml` and `uv.lock`.
It always executes a successful workspace `--dry-run` before submitting. Local credentials,
previous datasets and cached model weights are excluded. The AIR worker creates its locked
TTS/tracking environment, resolves/downloads the models, generates audio to ephemeral local
disk, and uploads the complete output directory to the AIR run's MLflow `dataset/` artifact path
on normal success or a caught exception. A hard timeout, preemption or process kill may prevent
that final upload; split large datasets into multiple bounded runs. Model/tokenizer downloads
require Hugging Face access. No Unity Catalog dataset tables or volumes are created.

Use the run ID from `artifacts/run-v1/submission.json` to inspect progress:

```bash
databricks air get <run-id> --profile <your-profile> --output json
databricks air logs <run-id> --profile <your-profile>
```

Open the returned MLflow run link for audio and manifests. An AIR dry-run validates the workload
configuration; it does not prove Python dependency, driver, VRAM or actual synthesis compatibility.
Workspace dry-run, real TTS, MLflow upload and GPU performance require a run in your chosen workspace.

### Verified A10G run

On 2026-10-25 (Perth), profile `fevm-serverless-stable-prvwqx` completed
[AIR run 413728721791895](https://fevm-serverless-stable-prvwqx.cloud.databricks.com/jobs/runs/413728721791895)
with status `SUCCESS`. The worker reported NVIDIA A10G, 23,684,841,472 bytes of VRAM,
PyTorch 2.7.1+cu126 and CUDA 12.6. Generation took 119.7 seconds; the complete job took
423 seconds including provisioning and dependency setup. This is one small run, not a throughput benchmark.

The [MLflow dataset](https://fevm-serverless-stable-prvwqx.cloud.databricks.com/ml/experiments/4100966677379018/runs/fd6e73ebc15b44b0b18fc3b613b2d480/artifacts)
contains 32 clips, eight mixed conversations and three persona reference WAVs. Downloaded artifacts
passed SHA256, clean-parent, duration, non-silent/finite waveform and mono PCM16/16 kHz checks.
Transcripts remain unverified scripts. SoX and FlashAttention were absent; this path completed
using the configured PyTorch SDPA implementation.

The first attempt failed during dependency installation because the workstation package mirror
returned 404 for Triton on AIR. The successful retry used public PyPI artifact URLs with the same
locked versions and hashes. Local receipts and downloaded audio are under
`artifacts/air-a10-20261025-v2/` (ignored by Git).
