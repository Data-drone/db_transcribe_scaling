# Red/black redesign deployment readiness

Status as of 25 October 2026: **[Call Insights is deployed](https://call-insights-7474659004185848.aws.databricksapps.com)**. The app, approved Lakebase database, reviewed Genie space and label-worker job are provisioned. Live analytics, real audio transport, investigation persistence/export, the deployed Genie bridge and Intelligence sample/review/full-run acceptance passed under the deployment user's trusted proxy identity. Browser interaction and second-user isolation remain pending.

## Deployed resources

The persistent project profile is `fevm-serverless-stable-prvwqx`, for `https://fevm-serverless-stable-prvwqx.cloud.databricks.com`. It is the user's explicit selection and needs no reconfirmation.

| Resource                   | Actual selection                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| App                        | `call-insights` at the URL above                                                               |
| App service principal      | `ccd5a96e-1fee-4fad-8518-94616c892919`                                                         |
| Warehouse                  | `8d4699c5c6d30f71`                                                                             |
| Lakebase branch            | `projects/call-insights/branches/production`                                                   |
| Lakebase database resource | `projects/call-insights/branches/production/databases/databricks-postgres`                     |
| Lakebase endpoint          | `projects/call-insights/branches/production/endpoints/primary` — 1 CU, 300-second idle timeout |
| App-owned state schema     | `call_insights_app`                                                                            |
| Genie                      | `01f1d07837f9137889e98be6514466fa` — Call Insights — source evidence                           |
| Label-worker job           | `17963523044750`, running as `brian.law@databricks.com`                                        |
| Model endpoint             | `databricks-claude-haiku-4-5`                                                                  |

The app SP has the documented per-table label permissions, warehouse use and job-run permission. It has no source-interactions SELECT or original-audio volume grant. Source SQL and files execute with the viewing user's permissions. The Genie space uses only `genie_calls_masked` and `genie_segments_masked` curated views.

## Local evidence

The app compiles with the installed AppKit 0.84.0 packages. All 16 analytics query types were regenerated against the live schema (14 fresh results and two cached). Type checking, tests, lint and production builds have passed. Databricks app validation and strict bundle validation also passed; rerun affected checks after subsequent changes.

Tests cover cohort navigation, fail-closed analytics filenames, source/return links, case ACLs and optimistic versions, source reauthorization, masked excerpt derivation, audio ranges/caps/policy, immutable label revisions, sample/full prerequisites and SDK-only worker submission. These tests use controlled dependencies; they do not establish deployed UI, live model or multi-user behavior.

The production client and server can be built offline via their individual build scripts. Original notebook masking code now withholds incomplete masks instead of falling back to raw transcript text; this local change has **not** been run to remask existing data.

The resolved app name is `call-insights`, and the worker notebook resolves under the bundle's `files/notebooks/harper_valley_bank` path. Production logs confirmed Lakebase initialization and the server listening on port 8000 before live acceptance.

The first remote build exposed a build-time identity issue: `prebuild` regenerated
OBO query types as the app service principal, which correctly lacks source SELECT.
Type generation now runs in the CLI validation/typegen step under the deploying
user, while the platform build compiles the checked-in generated types. The app
retains its restricted source access; no additional source grants were added.

The deployed Files plugin also requires its static `DATABRICKS_VOLUME_FILES` alias in AppKit 0.84. It is a literal path with an explicit deny-all policy. All discovered aliases are configured explicitly; only the dedicated `audio` alias can open a source-authorized user download. Both generic aliases were denied during live checks, without adding a source-volume grant to the app SP. Brief exports use the configured HTTPS `CALL_INSIGHTS_PUBLIC_URL`.

The existing `databricks-claude-haiku-4-5` endpoint passed the worker's structured-output SQL smoke test: no model error, valid expected JSON, a matched decision and the exact invented evidence quote. This establishes endpoint compatibility under the deploying user's identity; it does not establish deployed app/worker behavior or classification quality on the corpus.

## Live warehouse evidence

Read-only SQL checks ran against warehouse `8d4699c5c6d30f71` with profile `fevm-serverless-stable-prvwqx`, using the actual `serverless_stable_prvwqx_catalog.call_insights` schema. All nine `DESCRIBE QUERY` checks passed: `overview_summary`, `overview_contact_reasons`, `hourly_volume`, `daily_activity`, `explore_count`, `explore_interactions`, `call_detail`, `call_segments` and `call_key_moments`.

| Check                   | Observed result                                                                                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source population       | 1,446 interactions with metrics; 15,132 transcript turns.                                                                                                                                                                               |
| Enrichment coverage     | 50 successful calls, no recorded failures; latest processing `2026-10-22T23:50:50.754Z`.                                                                                                                                                |
| Masking coverage        | 504 masked turns across 50 completely masked calls; no partial masks; 1,396 calls await masked text.                                                                                                                                    |
| Recording dates         | Original range `2020-03-15T22:00:37.666Z`–`2020-06-02T01:31:47.869Z`; observed dates are 15 March, 30 May, 1 June and 2 June 2020, with 477, 439, 121 and 409 calls respectively. Dates without recordings are disclosed as unobserved. |
| Overview/Explore parity | All-call counts both equal 1,446. Payments for 1–2 June 2020 both equal 120, including 6 enriched/masked calls; the second results page returns 25 calls.                                                                               |
| Equal-period comparison | The preceding two-day Payments period contains 124 calls and 3 evaluated calls. Default all-history scope has no prior-period calls and shows no comparison.                                                                            |
| Masked keyword search   | `balance` returns 9 rows and exact count 9; every excerpt contains the keyword and comes from a completely masked call. First matching timestamp is 9.19 seconds.                                                                       |
| Transcript boundary     | Call `0002f70f7386445b` returns 10 masked turns with no raw fallback. Pending-mask call `076cd53656c64dc5` withholds all 14 turns with no raw fallback.                                                                                 |
| AI denominators         | Sentiment and repeat-mention shares each use the 50 evaluated calls; both observed negative share and repeat-mention share are zero. Unknown outputs remain unevaluated.                                                                |

Live execution exposed a Databricks timestamp edge case: `TRY_CAST('T00:00:00Z' AS TIMESTAMP)` resolves to the current day rather than null. `overview_summary` now guards empty date parameters before constructing timestamps, with a regression test. The rerun confirms default bounds of `2020-03-15T00:00:00Z` through `2020-06-03T00:00:00Z` exclusive, and an equal-length prior period starting 26 December 2019.

These warehouse checks validate SQL execution, real-data counts and the queried masked-text boundary. The deployed API checks below separately establish audio transport and single-user case persistence/export. Model quality, browser behavior and authorization across identities require their own acceptance.

## Passed deployed API acceptance

The [machine-readable validation record](live-investigations-validation.json), recorded at `2026-10-25T13:47:13Z`, contains exact statuses and IDs. Requests used `brian.law@databricks.com` through OAuth and the trusted Databricks Apps proxy; no forwarded identity headers were fabricated.

| Check                 | Observed result                                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trusted identity      | `/api/whoami` returned HTTP 200 with user ID and email; new case ownership matched the actor.                                                                                                   |
| Original audio        | Real call `0002f70f7386445b`, 1,635,596-byte WAV; header and suffix ranges returned 206 with correct byte counts and `Content-Range`. RIFF/WAVE signatures and private/no-store caching passed. |
| Invalid range         | An out-of-bounds audio request returned 416 and the actual total byte count.                                                                                                                    |
| Generic Files access  | Both `/api/files/audio/list` and `/api/files/files/list` returned 403.                                                                                                                          |
| Real saved evidence   | Registered OBO queries returned masked source text; the saved 3.47–10.35-second excerpt matched that independently fetched text.                                                                |
| Durable investigation | Exactly one labeled acceptance case was created, a note was saved, and a fresh read retained evidence, note and version.                                                                        |
| Brief export          | Markdown contained verified evidence, the note and selected-sample limitations; the HTTPS source link preserved `t=3.47` and the originating case.                                              |

Acceptance case: [7981f712-04b0-40ee-842d-829c739b93fa](https://call-insights-7474659004185848.aws.databricksapps.com/cases/7981f712-04b0-40ee-842d-829c739b93fa).

All 17 [deployed analytics checks](live-analytics-validation.json) passed, including population and coverage counts, date/queue comparisons, ordered pagination, masked keyword snippets, filters and empty cohorts. The production HTML and both referenced JavaScript/CSS assets returned HTTP 200.

Three [workspace Genie checks](genie-live-validation.json) also completed and matched SQL/data ground truth: exact masked transcript, filtered population/coverage and the annotated-sample sentiment denominator. The deployed app's `POST /api/genie/default/messages` OBO bridge separately completed its SSE stream without errors, returning a successful query with the correct Payments counts (350 recorded, 11 completely masked). Recorded narrative caveats remain; these API checks do not establish browser chat rendering or source-link interaction.

The final [deployment status record](deployment-live-validation.json) confirms app `RUNNING`, compute `ACTIVE`, and active deployment `SUCCEEDED`, with the approved warehouse, Lakebase, Genie and worker bindings.

The [live Intelligence record](intelligence-live-validation.json) verifies immutable definition revisions, HTTP 409 for a full run without a same-version sample, a real 20-call sample, fresh reads of two source-reviewed verdicts and a frozen full 50-call cohort using the same v2 definition. The sample processed 20/20 calls with two matches; the full run processed 50/50 unique calls with eight matches. Both had zero inference errors and zero ungrounded matches. Full-run queue, agent and recording-day breakdowns each reconcile to 50 results, and the label library retains the completed full-run summary. The worker ran as `brian.law@databricks.com` using the configured Haiku model. This verifies the workflow for one permitted identity; reviewing two decisions does not establish corpus-wide model accuracy.

One preliminary sample failed before worker dispatch when the warehouse rejected insufficient permission on the app-owned snapshot table. It remains a visible failed run, with no inference results. The narrow permission was corrected before the successful sample and full run; no source-table grant was added.

## Remaining live acceptance

- Complete signed-in browser interaction, responsive layout and keyboard checks. Chrome automation was unavailable in this session. API success does not verify original-audio playback/seeking controls, transcript interactions, browser timestamp/back navigation or in-app Genie SQL/source links.
- Test a second restricted identity for direct call access, original audio, named-reader case sharing/read-only behavior, label results and Genie. The successful single-user journey and local ACL tests do not establish live permission isolation.

## CUJ acceptance gaps

Automatic daily incremental tracking is not implemented. It needs durable scheduled execution under the initiating user's source permissions and an isolated write strategy, or a user-approved shared entitlement policy. The current app does not expose a functioning tracking switch or claim automatic processing.

The deployed API journeys from real masked source and original audio to a persisted case/export, and from an Intelligence definition through sample → source-reviewed verdict → same-version full run, passed for one identity. Live sharing and browser acceptance remain open. Themes, semantic search, richer label-result case attachments and measured business impact remain broader product work.


## Masking completion — 25 October 2026

The [masking backfill evidence](masking-backfill-validation.json) records completion
of the remaining corpus: all 1,446 calls and 15,132 transcript turns have non-empty
masked text, with 1,446 complete prompt-ready transcripts. The masking-only runner
repairs missing or empty masks in resumable batches and preserves existing valid
masks. Source, mask and prompt-transcript keys remain unique.

The accompanying SQL revision changes the query hashes for six masking-dependent
queries so the app deployment refreshes cached source evidence. SQL behavior and
the existing cache policy are unchanged; refresh an already-open browser view to
request the current results.

All calls now satisfy the masking prerequisite for new source-authorized label
runs. The accepted Intelligence run above retains its frozen 50-call cohort, and
AI summary, reason and sentiment enrichment still covers 50 calls. The historical
warehouse tables and JSON acceptance records above retain their original counts;
the linked backfill evidence records the later coverage change.
