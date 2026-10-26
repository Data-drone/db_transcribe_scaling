# Transcription on Databricks

Two notebook examples for audio transcription, custom transcription model packaging/deployment code, and a standalone Call Insights app.

## Repository layout

```text
notebooks/
  ami/                    # meeting audio: load, transcribe, benchmark scale
  harper_valley_bank/      # banking calls: load, transcribe, enrich, evaluate
models/
  transcription/          # Qwen3-ASR packaging, UC registration and GPU serving
data-generation/          # synthetic personas, TTS, interference and AIR batch launcher
apps/
  call-insights/          # Databricks AppKit app backed by persisted call data
prototypes/
  call-insights/          # mock React app covering the broader analyst UX
docs/                     # product spec, wireframes and code review
```

| Component                | Start here                                                       | Status                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AMI example              | [Notebook guide](notebooks/ami/README.md)                        | Loader, transcription and scale-testing notebooks                                                                                                               |
| HarperValleyBank example | [Notebook guide](notebooks/harper_valley_bank/README.md)         | Loader, channel-aware transcription, metrics, WER evaluation and enrichment notebooks                                                                           |
| Custom ASR serving       | [Serving guide and model choice](models/transcription/README.md) | Qwen3-ASR wrapper, GPU registration, deployment and query code; UC version 2 is live; real A10G packaging, managed endpoint and companion query notebook passed |
| Synthetic audio          | [Generation guide](data-generation/README.md)                    | Qwen persona speech, paired clean/degraded audio, conversation mixing and AIR launcher; GPU validation pending                                                  |
| Call Insights            | [App guide](apps/call-insights/README.md)                        | Deployed red/black app with SQL-backed exploration, original audio, durable investigations and a bound Genie space; see the app guide for remaining acceptance  |
| UX prototype             | [Prototype guide](prototypes/call-insights/README.md)            | Fictional local data, browser-persisted investigations and simulated Labels/Ask workflows; separate from the deployed app                                       |

## How the pieces connect

The AMI and HarperValleyBank examples can run independently of the app. Both currently use Databricks `ai_transcribe`. The separate custom-serving subproject packages Qwen3-ASR-1.7B with a forced aligner; connecting that backend to the notebooks remains future work.

HarperValleyBank writes audio to a Unity Catalog Volume and produces interaction, transcript, metrics and enrichment tables. Call Insights queries those persisted tables through a SQL warehouse. The app does not load the dataset or run transcription at startup, and AMI is not required to run it.

```text
AMI audio ------------> AMI notebooks ----------------> AMI result tables

HarperValleyBank audio -> HarperValleyBank notebooks -> interaction tables
                                                            |
                                                            v
                                                   Call Insights app
```

The [app data contract](apps/call-insights/README.md#data-contract) documents the required tables. Another producer can feed the app by supplying the same schema. Each subproject owns its configuration and deployment; there is no root deployment bundle or shared package installation requirement.

## Getting started

1. Choose a notebook example and follow its README to configure the catalog, schema and volume and run the notebooks in order. These are Databricks source-format Python notebooks, intended for Databricks compute.
2. For Call Insights, first produce compatible HarperValleyBank tables, including the enrichment tables, then follow the [app setup](apps/call-insights/README.md). Local app development still queries Databricks; it requires credentials and a SQL warehouse.
3. To explore the full mock UX without a workspace, run the [prototype](prototypes/call-insights/README.md).
4. For custom ASR, follow the [model-serving guide](models/transcription/README.md). GPU packaging, managed endpoint inference and the companion serverless query notebook passed. Use the [MLflow comparison notebook](models/transcription/notebooks/02_compare_transcription.py) to measure accuracy, latency and throughput across concurrency levels on identical reference audio. The main pipeline backend adapter and larger representative benchmark runs remain future work.
5. For synthetic evaluation fixtures, follow the [data generation guide](data-generation/README.md). It runs independently with its own dependencies and includes a model-free plumbing check. AIR is the batch generation path; real TTS and remote GPU execution still need validation.

The project default Databricks profile is `fevm-serverless-stable-prvwqx`, explicitly selected by the user, for `https://fevm-serverless-stable-prvwqx.cloud.databricks.com`. Pass `--profile fevm-serverless-stable-prvwqx` to CLI commands. AppKit and SDK processes use `DATABRICKS_CONFIG_PROFILE=fevm-serverless-stable-prvwqx`; the app's local environment and bundle are configured accordingly. This selection applies to future work in this project without reconfirmation.

Notebook and SQL identifiers currently contain this workspace's catalog/schema. Update both Python configuration and SQL cells/query files when explicitly targeting another environment; moving local folders does not move existing workspace notebooks, tables, volumes or apps.

## Local checks

Run each app's checks from its own directory:

```bash
cd apps/call-insights
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm test
```

```bash
cd prototypes/call-insights
npm ci
npm run build
npm run lint
```

The AppKit project has automated tests for cohort navigation, masked-source boundaries, case access, audio delivery and label execution prerequisites. The [deployment readiness record](apps/call-insights/docs/deployment-readiness.md) links the passed live API checks and records browser, worker and permission-isolation acceptance status. API checks do not establish browser behavior or complete product scope. The model-serving subproject has [Python checks](models/transcription/README.md#local-verification), including an MLflow roundtrip with mocked inference. Notebook execution requires Databricks runtime checks.

## Documentation and next work

- [Product specification and customer journeys](docs/call-insights-spec.md)
- [Wireframes](docs/call-insights-wireframes.html)
- [Codebase review, known issues and roadmap](docs/codebase-review.md)
- [Custom transcription model serving and model choice](models/transcription/README.md)

Next work includes safe/idempotent notebook reruns, masking and enrichment coverage, and custom ASR benchmarking/integration. The deployed app implements original-audio delivery, evidence collection and the label workflow; its remaining live acceptance and broader product gaps are tracked in [deployment readiness](apps/call-insights/docs/deployment-readiness.md) and the [app guide](apps/call-insights/README.md).
