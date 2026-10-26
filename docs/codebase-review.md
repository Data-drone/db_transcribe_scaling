# Codebase and structure review

Reviewed 24 October 2026 against `call-insights-spec.md` and the requested direction: transcription notebooks, deployment of a leading pretrained ASR model to Databricks Model Serving, and an app implementing the documented user journeys.

The directory reorganization and initial custom-serving code were added later on 24 October 2026. The [repository README](../README.md) records the implemented layout; this review's detailed roadmap includes future work. Runtime findings below remain open.

## Recommendation

Following the user's structure preference, organize the repository around two notebook examples (AMI and HarperValleyBank), a separate model-serving subproject, and a standalone Call Insights app. AMI remains a supported example for meeting transcription and scale testing. HarperValleyBank demonstrates call transcription and enrichment and produces the tables consumed by the app.

Use `apps/call-insights` as the app implementation to develop and treat `prototypes/call-insights/` as a UX prototype to port selectively. Give the app its own dependencies, configuration, deployment bundle and README. Its integration with HarperValleyBank should be a documented table contract, rather than a dependency on running notebooks inside the app project. Extract shared Python code only where the examples or model packaging actually reuse it.

The project has a useful data foundation and a SQL-backed app slice. Custom ASR packaging/deployment code now exists and passed a real GPU fixture check; main pipeline integration, comparative benchmarking and a complete analyst journey remain open. Stabilize data contracts and reruns before adding more screens.

## Current inventory

| Area | Present | Gap to requested outcome |
|---|---|---|
| `notebooks/ami/` | Three AMI loader/transcription/scale notebooks | Retained as a first-class AMI meeting/scale example alongside HarperValleyBank. |
| `notebooks/harper_valley_bank/` | Loader, channel alignment, speech clipping, `ai_transcribe`, segment/metric construction, WER evaluation, masking/enrichment comparison | No shared package, root dependency definition, automated pipeline job, robust invalidation, or alternate ASR backend. |
| `prototypes/call-insights/` | React UX prototype covering Overview, Explore, Ask, Themes, Calls, Labels and Cases | Mock data and in-memory state; sample/full label runs and Ask answers are simulated. |
| `apps/call-insights/` | AppKit analytics/server plugins, SQL query files, Overview, Explore, Call detail, app bundle | Labels/Cases are placeholder pages; no Ask or Themes route, audio playback, persistent user state, or label execution. |
| Model serving | Qwen3-ASR wrapper, pinned artifact logging, UC registration, deployment/query scripts, query notebook and MLflow accuracy/latency/concurrency comparison in `models/transcription/` | Real A10G packaging, matching-runtime UC version 2 deployment, endpoint contract checks and the companion serverless notebook passed. The comparison notebook uses a fixed reference manifest and includes failures; representative benchmark runs and the main pipeline adapter remain pending. |
| Deployment | App bundle plus independent model-serving SDK scripts | Preserve independent deployment; add example pipeline jobs, permissions and environment configuration as needed. |
| Documentation | Detailed requirements and wireframes | Status and next-task sections lag the code; the new serving objective is absent from the original architecture. |

At the initial review, only the AMI notebooks, `.gitignore` and `LICENSE` were tracked; the two apps, docs and HarperValleyBank notebooks were untracked. The reorganization moves those files without staging or committing them. These need to be included in version control when the user is ready; this review does not stage or commit them.

## Findings, ordered by priority

### P1 — Missing masking silently exposes raw transcripts

`apps/call-insights/config/queries/call_segments.obo.sql:8` returns `COALESCE(m.text_masked, s.text)`. `explore_interactions.obo.sql:43` searches the equivalent raw fallback. The enrichment notebook also falls back to raw text at lines 236 and 362.

Masking only processes the enrichment scope, which defaults to 50 calls. Opening another call therefore returns its raw transcript without the elevated permission required by spec CD-9 and §13. A missing/NULL mask can also flow into the supposedly masked enrichment prompt.

Serve masked text through a governed view, represent pending/failed masking explicitly, and exclude unmasked text from the default read and prompt paths. Expose raw text only through a separately authorized path. Ensure the mask policy covers the bank/account identifiers required by the spec, beyond the four entity types currently requested. Enforce any queue restrictions on every app-accessible data path, including segments, enrichment and future audio access; a row filter on `interactions` alone is insufficient for independent queries of those objects.

### P1 — A sample loader run replaces the full inventory

`notebooks/harper_valley_bank/HarperValleyBank Data Loader.py:284–287` overwrites both source tables with only the selected calls. The default selection is 200. Failed calls are printed at lines 218–219, but successful calls are still published as the replacement inventory.

After a full load, a default run can reduce `hvb_calls` from 1,446 to 200 rows. The transcription notebook then rebuilds `interactions` from that reduced table, removing calls from the app while old chunks and derived sidecars remain. A partial download/parse failure can produce the same mismatch.

Merge selected calls by stable key, retain out-of-scope rows, and make a full replacement an explicit operation. Record load failures and avoid publishing an incomplete replacement. Keep sample selection separate from the durable call inventory.

### P1 — Transcript changes do not invalidate masks or enrichment

`HarperValleyBank Enrichment.py:204–205` identifies an existing mask by `(interaction_id, segment_idx)` only. Lines 382–385 identify existing enrichment by `(interaction_id, model_endpoint, prompt_version)` only. Neither key includes source content or transcription version.

Re-cutting clips or switching ASR models can alter text and reassign segment indexes. The notebook can then attach an old mask to a different turn and reuse summaries/evidence from the previous transcript. Lines 223–246 also replace the entire masked-transcript table with the current scope, so running a small sample after a full run removes other masked transcript rows.

Add audio/content hashes and processing versions. Tie masks and enrichment to the exact transcript revision, recompute changed inputs, and merge scoped output without dropping unrelated rows. Preserve the ASR backend/model revision in raw results and downstream provenance.

### P1 — Failed enrichment is cached permanently and can replace usable output

`HarperValleyBank Enrichment.py:379–400` skips any existing comparison row, including rows with `error_message`. Lines 464–475 merge those rows into the production table without filtering success.

A transient model error or malformed response is therefore skipped on the next run with the same prompt version. A failed new comparison can also overwrite a previously successful production row; app queries then hide it because they require a NULL error.

Separate attempt history from accepted output, retry retryable failures with bounded backoff, validate outputs before promotion, and retain the last valid production result until a valid replacement is available.

### P2 — The grounding check accepts invented evidence

`HarperValleyBank Enrichment.py:294–330` accepts a quote based on partial substring or unordered word overlap. It keeps the full model quote even when only part of it appears in the transcript.

Local reproduction: transcript `Please transfer money from my checking account.` and claimed quote `please transfer money from my checking account without asking permission` produce `grounded=True`. The invented clause materially changes what an analyst could conclude.

Require a contiguous, normalized matching span or a tightly bounded alignment. Return the actual source span, segment identity and timestamp; reject unsupported additions. For ambiguous repeated phrases, use nearby timestamp/role context. Keep this implementation shared between enrichment and the future label engine.

### P2 — Model JSON is parsed but not schema-validated

`HarperValleyBank Enrichment.py:426–445` verifies only that the top-level JSON is an object. Fields such as `key_moments`, summary, sentiment and resolution are not validated against a strict response schema.

A valid JSON object with `key_moments` as an object instead of a list raises an exception in `ground_moments`, aborting the batch before accumulated rows are written. This was reproduced locally. Other wrong types can fail `.strip()` or Spark serialization.

Use structured model output plus explicit runtime validation. Convert a bad row to a recorded validation failure, preserve completed work, and retry only those failures.

### P2 — WER excludes complete transcription failures

`HarperValleyBank Transcription Pipeline.py:476–481` includes reference calls only when status is `ok` or `partial`. Fully failed and pending calls do not affect the reported WER.

A new ASR backend could appear more accurate by failing on difficult calls. Evaluate a fixed manifest of calls for every backend, score missing hypotheses as empty transcripts where appropriate, and report completion/coverage alongside both successful-call WER and all-input WER. Keep time-alignment evaluation separate from recognition accuracy: HarperValleyBank alignment itself uses reference timing metadata.

## Structural concerns

- Configuration is embedded in Python constants, SQL magic cells, app SQL and bundle targets. Editing Python `CATALOG` does not redirect the hardcoded SQL magic cells. Parameterize the environment consistently, including query generation/configuration for the app.
- The app bundle has one workspace-specific default target and a fixed global app name. Add separate environments and developer-specific app names before multiple developers share a workspace.
- Clip rows and audio-feature completion markers are appended in separate writes (`Transcription Pipeline.py:168–173`). A failure between writes can duplicate clip records on retry. Use stable keys with idempotent merges and recoverable per-call processing state; do not imply cross-table atomicity.
- Several stages collect full scopes into driver memory (`toPandas`, `.collect`, accumulating Python lists). This is acceptable for the current small corpus but is not evidence of scalability to the larger spec targets. Partition/limit work and checkpoint progress before expanding.
- AppKit Overview and Explore keep separate local queue state and expose no global date-range state. These do not yet satisfy G-2. Call detail updates a selected timestamp but has no audio element or streaming route, so it does not yet satisfy CD-3–5.
- The spec's status, M0 milestone and next tasks still say enrichment/app work is not started. Update these to distinguish implemented code, sample execution, full-corpus execution and verified production behavior.

## Proposed target structure

The top-level directory migration is complete: examples are under `notebooks/`, the AppKit app is under `apps/`, and the mock app is under `prototypes/`. Notebook filenames and contents are preserved. The tree below remains a target design for future numbered notebooks, job bundles and serving scripts; see the root README for what exists today. Keep deployment ownership local to each subproject instead of requiring one root bundle for everything.

```text
README.md                     # repository map and how the examples/app connect
notebooks/
  ami/
    README.md                 # setup, run order, output tables, scale benchmarks
    01_load_data.py
    02_transcribe.py
    03_scale_test.py
  harper_valley_bank/
    README.md                 # setup, run order and app-facing output contract
    01_load_data.py
    02_transcribe.py           # includes current audio preparation initially
    03_enrich.py
    04_evaluate.py            # can be extracted from current transcription notebook
    databricks.yml            # example pipeline job + its environment config
models/transcription/
  databricks.yml              # model deployment resources and environment config
  model.py                    # custom MLflow PythonModel implementation
  register.py                 # pinned artifacts, signature, UC registration
  deploy.py                   # explicit model version + readiness checks
  requirements.txt            # serving-specific pinned dependency set
  README.md                   # license, runtime/GPU requirements, request limits
apps/call-insights/
  README.md                   # app setup and required data contract
  databricks.yml              # independent app/label-job deployment
  app.yaml
  package.json
  client/
  server/
  config/queries/
  workflows/                  # app-specific label jobs and processing
  tests/
src/transcription/            # optional shared audio/adapters/evaluation utilities
pyproject.toml                # add when shared Python code is extracted
prototypes/call-insights/     # current mock app, if still useful
tests/                       # shared processing and example data-contract checks
docs/                        # spec, wireframes, architecture decisions, runbook
```

Use notebooks for parameters, explanations, orchestration and inspecting outputs. Put reusable transformations and model adapters in Python modules when sharing becomes useful. Keep banking-specific enrichment with the HarperValleyBank example and app-specific label workflows with Call Insights. Neither notebook example should require installing or deploying the app.

The integration boundary is persisted data: HarperValleyBank produces versioned interaction, segment, metrics, masked-text and enrichment tables; the app consumes configured tables/views with documented columns and permissions. Another producer can supply the same contract later. The app can deploy separately once compatible data exists. Document setup order and compatibility without having app startup load the corpus or run transcription.

## Transcription and model serving design

The initial [Qwen3-ASR implementation](../models/transcription/README.md) now provides this transport/packaging boundary and exact-version deployment checks. Real-weight packaging and a spoken-fixture check have passed on A10G, with UC development version 2 deployed on matching GPU packages; endpoint contract checks and the companion serverless notebook have also passed. The remaining design below includes notebook integration and benchmarking; the SDK deployment scripts currently replace a dedicated endpoint's routing, without a canary or automatic rollback.

Keep `ai_transcribe` as one backend and add custom Model Serving as another. Both should normalize into the same result contract so the app does not depend on a particular ASR engine:

- Request/job identity: interaction ID, channel/role, chunk ID, input hash, preprocessing version, backend and model revision.
- Segments: text, language when available, start/end seconds on the agreed call timeline, and role from the known channel where applicable.
- Outcome: success/no-speech/error, error details, attempt, elapsed time and processing timestamp. Keep raw backend responses separately.

Select a current leading pretrained model by measured fit, not by calling a particular model SOTA in the deployment code. Benchmark on fixed held-out inputs against the existing `ai_transcribe` baseline. Include difficult and long recordings beyond the short, scripted HarperValleyBank corpus. Measure WER, number/account recognition, timestamp quality, supported languages, silence hallucinations, failures, latency, throughput, cost and license/runtime suitability. Do not equate transcription quality with speaker diarization or timestamp quality; these may need separate components.

For custom serving, package the pretrained weights and tokenizer/processor as pinned MLflow artifacts, use a custom PyFunc with an explicit signature and pinned dependencies, and register in Unity Catalog. Verify the selected model's inference runtime, GPU availability and supported serving configuration in the chosen workspace before promising deployment compatibility. Package loading should not depend on downloading mutable weights at endpoint startup.

Define audio transport explicitly. Do not assume a Model Serving container can open the notebook's `/Volumes/...` paths. Start with bounded audio payloads accepted by the model contract, confirming current endpoint request limits and timeout behavior. Long calls should be chunked and submitted by Jobs with bounded concurrency, throttling/backoff and durable progress. Keep HTTP inference synchronous per bounded chunk; let the job own batch completion.

Keep registration/deployment outside daily transcription runs. Deploy an explicit registered model version, check both endpoint readiness and completion of its configuration update, and query a known fixture before switching production traffic. Preserve the previous version for rollback.

## App path to the documented journeys

The first complete journey should be the spec's M2 acceptance flow: **define a label -> test a sample -> review evidence -> run across scope -> open a matching call at the evidence timestamp**. This exercises the distinguishing feature and the audio/transcript foundation together.

1. Finish Call detail: authorized audio streaming with verified HTTP Range seeking, actual playback/transcript synchronization, timestamp/source deep links and safe masked transcript reads.
2. Build the label engine in Python/notebooks: immutable definition versions, fixed run scopes, structured results, shared grounding, feedback and resumable full/incremental runs. Enforce the same-version sample prerequisite and budgets on the server/job side.
3. Add the Label UI and durable state. Lakebase is a strong candidate for definitions, cases, feedback and annotations; keep bulk label results in Delta. Confirm the state-store choice with the user before provisioning it. Retain SQL warehouse analytics for the existing read-heavy screens unless requirements justify another access pattern.
4. Add Themes and semantic search for pattern investigation, Genie-backed Ask, then Cases, sharing and brief export. These close the remaining documented journeys; they should not be counted as delivered by the mock app.
5. Add tracked-label scheduling and change detection, global date/queue filters and per-user authorization checks across reads, writes and audio. Mark synthetic/demo-adjusted data explicitly, as the spec requires.

The app remains an analysis workflow over persisted data. It need not transcribe every call again on page load, and the new ASR endpoint can be invoked by batch Jobs without making live transcription a new app requirement.

## Delivery order and acceptance checks

| Stage | Deliverable | Evidence of completion |
|---|---|---|
| 1 | Data contract, shared config, safe masking and idempotent reruns | Full load followed by sample rerun retains inventory; changed text invalidates masks/enrichment; failed rows retry; masked reads never fall back to raw. |
| 2 | Parameterized notebooks + pipeline bundle | Clean environment deployment; two consecutive runs introduce no duplicates; interrupted processing resumes; source failures remain visible. |
| 3 | ASR model benchmark, registration and deployment | Fixed held-out comparison; reproducible artifact load; endpoint fixture query; documented request limits, GPU/runtime configuration and rollback. |
| 4 | One real analyst journey in AppKit | Create/test/review/run label; close browser during full run; reopen results; follow evidence to playable audio at the correct time; state persists. |
| 5 | Remaining CUJs | Pattern/theme investigation, manager pulse check, Genie answers with sources, persistent cases and authorized shared/exported briefs. |

## Verification performed

- `prototypes/call-insights/` (then `app/`): `npm run build` passed; `npm run lint` completed with two warnings (Fast Refresh export and state update in an effect).
- `apps/call-insights/`: `pnpm run typecheck` passed; `pnpm run lint` completed with two array-index-key warnings.
- AppKit `pnpm test` exited successfully but found no tests; `vitest.config.ts` has `passWithNoTests: true`. This is not behavioral coverage.
- Parsed all six Python notebook sources with Python AST successfully. Databricks SQL magic cells and Spark/runtime behavior were not executed.
- Reproduced the unsupported grounding acceptance and malformed `key_moments` failure using the existing pure Python functions in memory.
- No Databricks workspace was queried or changed. The workspace run statistics in the spec were treated as documented historical results, not independently verified. No CLI profile was selected.
- No runtime/source implementation was changed by this review or the subsequent folder migration. Local build/check commands may refresh ignored build artifacts.
