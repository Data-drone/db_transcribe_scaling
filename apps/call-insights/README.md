# Call Insights

A Databricks AppKit app for exploring persisted HarperValleyBank calls, reviewing original audio and masked transcript evidence, discovering themes, tracking labels and building shared investigations.

The UI is the former `prototypes/call-insights` mock, now the app's only client. The same screens run on real warehouse data (locally with `pnpm dev`, or deployed) or on fictional sample data with no workspace (`pnpm dev:sample`). There is no separate prototype to keep in step.

## Current status

The red/black application is deployed at **[Call Insights](https://call-insights-7474659004185848.aws.databricksapps.com)** as of 25 October 2026. The user-approved Lakebase database, Genie space and label-worker job are provisioned and bound in `fevm-serverless-stable-prvwqx`, the persistent project profile.

Live API checks passed for [all 17 analytics checks](docs/live-analytics-validation.json), trusted user identity, original WAV byte ranges, denied generic file access, and a real masked excerpt saved into a durable investigation with a note, reload and HTTPS export backlink. See the [Investigations validation record](docs/live-investigations-validation.json) and [test investigation](https://call-insights-7474659004185848.aws.databricksapps.com/cases/7981f712-04b0-40ee-842d-829c739b93fa). The [Intelligence acceptance](docs/intelligence-live-validation.json) completed a real 20-call sample, two persisted source-reviewed verdicts and a same-version full 50-call run. Chrome automation was unavailable for the requested profile, and second-user permission isolation has not been tested.

Implemented flows:

- Overview and Explore query real warehouse tables, preserve queue/date/filter scope in URLs, show enrichment/masking coverage, and paginate with an exact count. Overview includes prior-period comparisons and daily coverage.
- Call detail plays original audio through a source-authorized OBO route with Range support. Transcript text is masked-only; missing masks are withheld. Turns and verified moments seek audio, and timestamp links preserve the originating view.
- Investigations persist cases, whole-turn clips, notes, named-reader sharing and Markdown briefs in an app-owned Lakebase schema. Source permission and masking are rechecked when saving, reopening, sharing or exporting. Readers cannot edit owner documents.
- Labels persist immutable definition versions, run real stratified samples and frozen full cohorts through a durable Lakeflow worker, record reviewer verdicts, and show queue/agent/day results. See [Intelligence behavior and acceptance](docs/intelligence.md).
- Ask uses the bound, reviewed Genie space through AppKit's OBO chat, exposes generated SQL and links interaction IDs to source conversations. Three workspace Genie checks matched warehouse ground truth, and the deployed app's OBO chat bridge completed with the then-current Payments counts (350 recorded, 11 completely masked). Browser interaction remains pending. See [Genie validation](docs/genie-live-validation.json).

Themes, “What's changed”, daily label tracking and theme/label context items in cases are implemented as of 26 October 2026 but **not yet run against the workspace**: their tables, jobs and grants need the setup below, and live acceptance is pending. Semantic search and measured business-impact estimates remain outside the implemented scope. The [product specification](../../docs/call-insights-spec.md) includes requirements beyond this first complete source-evidence flow.

## One UI, two data modes

Every screen reads through one `DataSource` interface (`client/src/data/source.ts`):

| Mode | Where it runs | Data |
| --- | --- | --- |
| `live` | `pnpm dev` locally, and the deployed app | `/api/insights/*`, `/api/investigations/*`, `/api/intelligence/*` and Genie, all as the signed-in user |
| `fixtures` | `pnpm dev:sample` (offline, `http://127.0.0.1:5174`), or the sidebar “Switch to sample data” link | Fictional calls in `client/src/data/fixtures`; cases and labels persist in browser storage; label runs are simulated |

Both modes return the same shapes (`shared/insights.ts`), and fixture analytics are computed from the fixture calls with the same rules as the SQL (for example, period-over-period shares). `VITE_DATA_SOURCE=fixtures` builds a bundle that never calls the server (`pnpm build:sample`).

Locally, `pnpm dev` runs the real server against Databricks. AppKit 0.84's development middleware forwards your `DATABRICKS_CONFIG_PROFILE` identity on `localhost` requests, so per-user SQL, investigations and labels behave as they do when deployed, with your own permissions. Open the app on `localhost`, not a LAN address.

### Insights API

`server/insights/routes.ts` exposes read-only JSON endpoints. Each runs only fixed `config/queries/*.obo.sql` files as the requesting user and rejects requests without a trusted identity:

| Endpoint | Queries |
| --- | --- |
| `GET /api/insights/bounds` | `dataset_bounds`, `queue_stats` |
| `GET /api/insights/overview` | `overview_summary`, `overview_contact_reasons`, `daily_activity` |
| `GET /api/insights/changes` | `overview_summary`, `overview_changes` |
| `GET /api/insights/explore` | `explore_interactions`, `explore_count` (now with a theme filter) |
| `GET /api/insights/calls/:id` | `call_detail`, `call_segments`, `call_key_moments`, `call_themes` |
| `GET /api/insights/themes[/:id]` | `themes_list`, `theme_breakdown`, `theme_calls` |

Scope parameters are `queue`, `start` and `end` (`YYYY-MM-DD`). The UI's periods (latest day, 7, 30, 90 days, all) are anchored on the latest recording in the data, not today's date.

## Interaction design

- **Overview cross-filtering.** Click a day in the volume chart to focus the page on that day, compared with the day before. Click a contact reason or theme to focus every panel on it. Each focus is a URL parameter (`period=d:YYYY-MM-DD`, `focus_reason`, `focus_theme`) shown as a removable chip, with select controls as the keyboard-accessible equivalent. Grey bars show the same day in the previous equal period.
- **Call player.** The original stereo recording is decoded in the browser into a waveform per speaker; channels are matched to agent and customer by comparing energy with the transcript's turns. Key moments are markers, the AI sentiment shift is a strip beneath, and the active transcript turn shows playback progress. Shortcuts: Space, J/K, ←/→, S. Fixture calls use a waveform shaped from transcript timing.
- **Theme map** (`/themes`). Every themed call drawn at its 2-D position from the theme builder (PCA, then t-SNE over the same embeddings). The three largest themes use colours validated for colour-vision deficiency on the dark surface; the rest fold into "Other". Pick a theme in the legend to highlight it. Requires the `map_x`/`map_y` columns: re-run `resources/theme-tables.sql` (or `ALTER TABLE ... ADD COLUMNS`) and the theme builder.
- **Labels and cases.** Live run progress while the worker evaluates, a tracked-prevalence line chart that calls out day-over-day jumps, and "Play evidence" on a case, which plays each saved clip in order from the original recording.
- Charts use AppKit UI's ECharts components and load on first use. Motion is short and switches off under `prefers-reduced-motion`.

## Themes, What's changed and tracked labels

These three features are new backends. Set them up in this order with the project profile:

1. **Tables.** As the data owner, run `resources/theme-tables.sql` and `resources/label-tracking.sql`. Do this before `pnpm run typegen` or `pnpm dev`, because type generation describes queries that read these views.
2. **Enrichment coverage.** Themes and contact-reason changes use AI enrichment, which currently covers 50 calls. Run `HarperValleyBank Enrichment` with `max_calls=all` first (review its known caching issues in `docs/codebase-review.md`).
3. **Deploy jobs.** `databricks bundle deploy -t default --profile fevm-serverless-stable-prvwqx` now also creates `call-insights-theme-builder` (weekly) and `call-insights-label-tracker` (daily). Run the theme builder once by hand.
4. **Grants.** Analysts need `SELECT` on `theme_run_current`, `themes_current`, `theme_membership_current` and `label_tracking_visible`. The app service principal needs `SELECT, MODIFY` on `label_tracking`. Job run-as identities need the grants listed in each job file.

How they work:

- **Themes.** `Call Insights Theme Builder` embeds each enriched call's topic phrase and summary (`databricks-gte-large-en`), clusters with k-means (k chosen by silhouette), names clusters from their most central calls with Haiku, and keeps theme IDs stable across runs by centroid similarity. It records agreement with the reference HarperValleyBank intents as `purity`. Theme counts in the app always join `interactions` as the viewer.
- **What's changed.** `overview_changes` compares each contact reason, theme and enabled tracked label's *share of evaluated calls* with the previous equal-length period, and flags moves of at least ±25% with at least 3 current calls. It returns nothing when the previous period has no calls. With the current corpus (four recording days in 2020), choose “Latest day” to see a comparison; the planted synthetic calls from `data-generation` are needed for a realistic multi-week story.
- **Tracked labels.** An owner can track a label version after a completed full run of that version, and only after an on-behalf-of check that they can read the scope. The daily tracker freezes completely masked calls in scope that the version has not yet evaluated and runs them through the existing label worker. **It runs as the job's identity, not the label owner**; results stay owner-filtered through the `*_visible` views and are re-joined to sources as the viewer. Treat this as an approved shared entitlement before enabling tracking for other users.

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

Install with `pnpm install --frozen-lockfile`, copy `.env.example` to `.env`, and fill resource values from the provisioned resources. Preserve the deployed app SP's ownership of the state schema. The template and local environment use `fevm-serverless-stable-prvwqx`. Keep credentials out of source. Do not rely on the global `DEFAULT`.

- `pnpm dev`: the real app on real data at `http://localhost:8000`, as you. Its `predev` hook generates live query types, so the profile must be authenticated and the theme/tracking tables must exist.
- `pnpm dev:sample`: the same UI on fixtures at `http://127.0.0.1:5174`, with no server, workspace or credentials. Use it for UI work and demos.

Offline checks are `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, `pnpm run build:server`, `pnpm run build:client` and `pnpm run build:sample`. The full `pnpm run build` additionally syncs plugin metadata; live query-type generation is a separate `pnpm run typegen` step.
