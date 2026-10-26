# Call Insights

A Databricks AppKit app for exploring persisted HarperValleyBank calls, reviewing original audio and masked transcript evidence, and building shared investigations. The red/black design is implemented in this app; the separate `prototypes/call-insights` mock is not a deployment source.

## Current status

The red/black application is deployed at **[Call Insights](https://call-insights-7474659004185848.aws.databricksapps.com)** as of 25 October 2026. The user-approved Lakebase database, Genie space and label-worker job are provisioned and bound in `fevm-serverless-stable-prvwqx`, the persistent project profile.

Live API checks passed for [all 17 analytics checks](docs/live-analytics-validation.json), trusted user identity, original WAV byte ranges, denied generic file access, and a real masked excerpt saved into a durable investigation with a note, reload and HTTPS export backlink. See the [Investigations validation record](docs/live-investigations-validation.json) and [test investigation](https://call-insights-7474659004185848.aws.databricksapps.com/cases/7981f712-04b0-40ee-842d-829c739b93fa). The [Intelligence acceptance](docs/intelligence-live-validation.json) completed a real 20-call sample, two persisted source-reviewed verdicts and a same-version full 50-call run. Chrome automation was unavailable for the requested profile, and second-user permission isolation has not been tested.

Implemented flows:

- Overview and Explore query real warehouse tables, preserve queue/date/filter scope in URLs, show enrichment/masking coverage, and paginate with an exact count. Overview includes prior-period comparisons and daily coverage.
- Call detail plays original audio through a source-authorized OBO route with Range support. Transcript text is masked-only; missing masks are withheld. Turns and verified moments seek audio, and timestamp links preserve the originating view.
- Investigations persist cases, whole-turn clips, notes, named-reader sharing and Markdown briefs in an app-owned Lakebase schema. Source permission and masking are rechecked when saving, reopening, sharing or exporting. Readers cannot edit owner documents.
- Labels persist immutable definition versions, run real stratified samples and frozen full cohorts through a durable Lakeflow worker, record reviewer verdicts, and show queue/agent/day results. See [Intelligence behavior and acceptance](docs/intelligence.md).
- Ask uses the bound, reviewed Genie space through AppKit's OBO chat, exposes generated SQL and links interaction IDs to source conversations. Three workspace Genie checks matched warehouse ground truth, and the deployed app's OBO chat bridge completed with the then-current Payments counts (350 recorded, 11 completely masked). Browser interaction remains pending. See [Genie validation](docs/genie-live-validation.json).

Automatic incremental label tracking is **not implemented**. Semantic search, Themes, typed label findings attached directly to cases and measured business-impact estimates also remain outside the implemented scope. The [product specification](../../docs/call-insights-spec.md) includes requirements beyond this first complete source-evidence flow.

## Data and identity

The source schema is currently `serverless_stable_prvwqx_catalog.call_insights`. The app reads `interactions`, `interaction_metrics`, `interaction_segments` (timing/role metadata only), `interaction_segments_masked` and `interaction_enrichment`. Producer notebooks are under [notebooks/harper_valley_bank](../../notebooks/harper_valley_bank). The app does not run ingestion or enrichment on startup. From `apps/call-insights`, the masking-only backfill can be resumed with `python3 scripts/backfill-masking.py --execute --report /private/tmp/call-insights-masking-backfill.json`; omit `--execute` for read-only preflight. It uses the selected project profile, preserves valid masks, and does not generate summaries or sentiment.

Every client analytics query is a `.obo.sql` query. The bundle requests `sql`, `files` and `genie` user scopes. Each user needs warehouse access, source-table grants and original-audio volume access. App access does not grant source access. Missing production user credentials fail closed. The shared Lakebase database uses the app service principal with owner/named-reader ACLs in every document operation.

The Intelligence worker evaluates only immutable snapshots frozen through an OBO-authorized request. Analysts receive owner-filtered result views, never base snapshot/result table grants. The app identity has SELECT/MODIFY on runs, frozen scope and feedback, plus SELECT on results. The worker has its separate per-table grants and model permission. The SDK-only job runner exposes no generic Jobs HTTP controls. Read the precise grant requirements in [docs/intelligence.md](docs/intelligence.md).

Original audio remains under `/Volumes/serverless_stable_prvwqx_catalog/call_insights/hvb_raw/audio/stereo`. The dedicated audio route authorizes the interaction through OBO SQL, validates its exact file path, and downloads with the user's file permissions. The generic Files endpoints are denied by policy. No shared audio byte cache is introduced.

## Deployment acceptance

See [deployment readiness](docs/deployment-readiness.md) for completed checks and remaining acceptance. The `default` bundle target contains the approved production resources:

| Resource          | Deployed selection                                                         |
| ----------------- | -------------------------------------------------------------------------- |
| App               | `call-insights`                                                            |
| SQL warehouse     | `8d4699c5c6d30f71`                                                         |
| Lakebase branch   | `projects/call-insights/branches/production`                               |
| Lakebase database | `projects/call-insights/branches/production/databases/databricks-postgres` |
| Genie space       | `01f1d07837f9137889e98be6514466fa` — Call Insights — source evidence       |
| Label-worker job  | `17963523044750` — `call-insights-label-worker`                            |
| Model endpoint    | `databricks-claude-haiku-4-5`                                              |

The app service principal owns the dedicated `call_insights_app` Lakebase schema. The worker runs as `brian.law@databricks.com` over user-authorized frozen cohorts. The app has no source-interactions SELECT or source-volume grant. A different source schema requires updating all SQL, worker parameters and audio configuration together.

The label tables and owner-filtered views exist. Live acceptance verified immutable v1/v2 definitions, rejection of a full run before a same-version sample, a completed 20-call sample with two matches, two persisted source-reviewed verdicts and a frozen full 50-call run with eight matches. Both successful runs had zero inference errors and zero ungrounded matches; queue, agent and day breakdowns each reconcile to 50 full-run results. This is functional acceptance, not a measured classification-accuracy score. The source now contains 1,446 completely masked calls and 15,132 masked turns; all 1,446 satisfy the masking prerequisite for new source-authorized classification runs. The existing accepted full run remains its original frozen 50-call cohort. AI enrichment still covers 50 calls. See the [masking backfill evidence](docs/masking-backfill-validation.json).

With the selected project profile:

```bash
DATABRICKS_CONFIG_PROFILE=fevm-serverless-stable-prvwqx pnpm run typegen
pnpm run typecheck
pnpm run lint
pnpm test
DATABRICKS_CONFIG_PROFILE=fevm-serverless-stable-prvwqx pnpm run build
databricks bundle validate --strict -t default --profile fevm-serverless-stable-prvwqx
databricks apps validate --profile fevm-serverless-stable-prvwqx
databricks apps deploy -t default --profile fevm-serverless-stable-prvwqx
```

All 16 analytics query types were regenerated against the selected workspace. Run type generation under the deploying user's selected profile before validation; the platform build compiles those checked-in types without querying source tables as the app service principal. AppKit stays pinned at 0.84.0 and pnpm at 11.0.8.

## Local development

Install with `pnpm install --frozen-lockfile`, copy `.env.example` to `.env`, and fill resource values from the provisioned resources. Preserve the deployed app SP's ownership of the state schema. The template and local environment use `fevm-serverless-stable-prvwqx`. Keep credentials out of source. `pnpm run dev` starts the AppKit server at the configured port; its `predev` hook generates live query types and therefore requires this profile to be authenticated. Do not rely on the global `DEFAULT`.

Offline checks are `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, `pnpm run build:server` and `pnpm run build:client`. The full `pnpm run build` additionally syncs plugin metadata; live query-type generation is a separate `pnpm run typegen` step.
