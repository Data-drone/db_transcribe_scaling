# HarperValleyBank call transcription example

A standalone notebook workflow for the [HarperValleyBank corpus](https://github.com/cricketclub/gridspace-stanford-harper-valley): separate agent/customer recordings, aligned playback audio, channel-aware transcription, conversation metrics, reference evaluation and AI enrichment. Corpus attribution: Gridspace/Stanford, CC BY 4.0.

This example produces the persisted data consumed by the [Call Insights app](../../apps/call-insights/README.md). Running the notebooks does not require installing or deploying the app.

## Prerequisites

- Databricks compute with Unity Catalog Volume access, `ai_transcribe`, and the SQL/VARIANT functions used in the notebooks.
- `ai_mask` and access to the configured model endpoints for enrichment with `ai_query`.
- Permission to create/use the schema, volume and output tables. The current code uses pandas, NumPy and requests; provision these in the notebook environment as needed.
- Outbound access to GitHub for the corpus loader.

The [product spec's implementation guide](../../docs/call-insights-spec.md#19-implementation-guide) records the original serverless environment and historical runs. Choose the workspace/profile you intend to use; a local folder move does not redeploy those resources.

## Run order

Import the `.py` files as Databricks source notebooks and run:

1. [HarperValleyBank Data Loader](HarperValleyBank%20Data%20Loader.py): downloads selected calls, calculates channel offsets, writes aligned stereo audio and creates call/reference tables. Widget `max_calls` defaults to `200`; use `all` for the full corpus.
2. [HarperValleyBank Transcription Pipeline](HarperValleyBank%20Transcription%20Pipeline.py): detects speech per channel, writes clips, transcribes pending clips, builds interactions/segments/transcripts/metrics, and evaluates WER and speaker-role coverage. Evaluation remains inside this notebook.
3. [HarperValleyBank Enrichment](HarperValleyBank%20Enrichment.py): masks transcript segments, compares configured LLM endpoints, grounds key moments and publishes enrichment. Widgets: `max_calls` (default `50`, or `all`), `models`, `write_model`, and `sample_name`. Confirm the configured endpoint names exist and are available in your workspace before running.

## Configuration and outputs

Current defaults: catalog `serverless_stable_prvwqx_catalog`, schema `call_insights`, volume `hvb_raw`. Configuration is embedded in Python **and** SQL magic cells; update both when using another environment.

| Stage | Main outputs |
|---|---|
| Load | `hvb_calls`, `hvb_reference_utterances`; original and aligned stereo audio in `hvb_raw` |
| Transcribe | `hvb_speech_chunks`, `hvb_transcriptions_raw`, `interaction_transcription_status`, `interaction_audio_features` |
| Normalize/evaluate | `interactions`, `interaction_segments`, `interaction_transcripts`, `interaction_metrics`, `hvb_transcription_eval` |
| Enrich | `interaction_segments_masked`, `interaction_transcripts_masked`, `interaction_enrichment`, plus comparison/sample tables |

All tables live in `<catalog>.call_insights` with the current defaults. The app consumes the [documented subset](../../apps/call-insights/README.md#data-contract); reference transcripts are for evaluation, not app display. Generated transcription is supplied by `ai_transcribe` today. The separate [Qwen model-serving code](../../models/transcription/README.md) has passed real A10G packaging, development endpoint inference on UC version 2 and its companion read-only query notebook. Integration into this pipeline remains pending; its output already includes call-timeline offsets, which must not be added a second time.

For a fresh, MLflow-logged comparison of `ai_transcribe` and Qwen on identical human-reference audio crops, use the separate [accuracy/latency/scaling notebook](../../models/transcription/notebooks/02_compare_transcription.py) and its [benchmark guide](../../models/transcription/README.md#mlflow-comparison-accuracy-latency-and-scaling). It includes failures in accuracy and measures throughput across client concurrency levels without changing this pipeline's tables.

## Reruns and current limitations

- The loader **overwrites** call/reference tables with the selected calls. A default 200-call run after a full load shrinks the inventory; failed calls are omitted from that replacement. Use an isolated schema for sample experiments.
- Clip preparation/transcription is partly incremental; downstream silver tables and metrics are rebuilt. Changing speech detection or source audio does not automatically invalidate old clips/results.
- Enrichment defaults to a 50-call sample. The app withholds turns without non-empty masked text. The standalone [masking backfill runner](../../apps/call-insights/scripts/backfill-masking.py) completed masking for all 1,446 calls and 15,132 turns; see the [validation evidence](../../apps/call-insights/docs/masking-backfill-validation.json). From `apps/call-insights`, run `python3 scripts/backfill-masking.py --execute --report /private/tmp/call-insights-masking-backfill.json` to resume masking-only work, or omit `--execute` for read-only preflight.
- Later enrichment samples reuse existing keyed masks; they do not automatically detect or remask changed source text. The enrichment notebook also replaces the prompt-ready transcript table with its selected scope. The standalone runner preserves valid masks and rebuilds complete prompt-ready transcripts across the corpus. Masking/enrichment invalidation still needs improvement.
- WER evaluation currently excludes completely failed/pending calls; report completion alongside WER when comparing transcription systems.

The [codebase review](../../docs/codebase-review.md) documents these issues and proposed fixes. This reorganization does not alter runtime behavior. There is not yet a deployment bundle for this notebook workflow; the app's bundle deploys the app only.

These files moved from the root `harper_valley_bank/` directory, keeping their filenames and source contents. Existing workspace imports and Unity Catalog objects are unchanged.
