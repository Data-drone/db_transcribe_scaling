# Intelligence: label investigation workflow

## Implemented behavior

The app is [deployed](https://call-insights-7474659004185848.aws.databricksapps.com) and its real sample/full workflow was verified on 25 October 2026 with the selected `fevm-serverless-stable-prvwqx` profile. It contains no simulated label results. See [live validation evidence](intelligence-live-validation.json) for the actual actor, label/version, cohort, job-run IDs and counts. `/labels` lists persisted analyst definitions. `/labels/:labelId` supports:

1. Create a definition with include/exclude examples, speaker focus, queue and recording dates. An edit appends an immutable revision. Earlier results retain their original version and definition hash.
2. Test up to 20 authorized calls, selected in randomized queue round-robin order. Calls enter the sample only when every transcript turn has a non-empty masked counterpart.
3. Submit a durable Lakeflow worker with the frozen revision and masked transcript snapshots. Real `ai_query` output includes a boolean decision, confidence, verbatim evidence and a reason. A conservative normalized quote check sets the timestamp from the matching source turn. Unsupported quotes remain visibly ungrounded.
4. Review matches and non-matches, open a timestamped source call, and persist correct/incorrect reviewer verdicts. Evaluation errors are separate from negative decisions. Review agreement is explicitly for the currently visible result page.
5. Preview the full cohort, token estimate and configured model prices. The preview freezes IDs and transcript hashes for 30 minutes. A full run requires a successful sample on the exact version and re-authorizes/rechecks all frozen transcripts before submission.
6. Reopen persisted run status and paginated results after closing the browser. Results show queue, agent and recording-day prevalence. Partial processing, errors and ungrounded-match counts remain visible. Successful worker batches are idempotently merged, so a platform task retry does not repeat completed inference.

Explore can start a draft at `/labels?new=1&prefill_q=...&queue=...&start=...&end=...`. Only queue and dates become SQL cohort filters; keyword and other search selections are explicitly draft hypothesis context to review before saving. A label-result source link returns to its exact label/run after call review. Saving original transcript evidence into a case happens in Call detail; no model quote is silently treated as authoritative source text.

## Integration

The server receives the approved app-state `DocumentStore` and an SDK-only job runner:

```ts
registerIntelligenceRoutes(appkit, store, createLabelJobRunner());
```

`createLabelJobRunner()` returns `(runId: string) => Promise<{jobRunId: number}>`. It submits only the business route's persisted run UUID through `job_parameters.run_id`. The generic Jobs HTTP plugin is intentionally unnecessary: its direct run/list/cancel routes would bypass document ownership checks.

Deploy `resources/label-worker.yml`, including the worker notebook in the bundle sync paths. Its job-level `run_id` flows to the task notebook. Bind `DATABRICKS_JOB_LABELS` to the resulting job ID and grant the app identity `CAN_MANAGE_RUN`. The worker run-as identity needs the per-table grants below and permission to query the selected model. It evaluates stored authorized snapshots, rather than broadening the initiating user's source cohort.

Run `resources/label-tables.sql` as the approved data owner. Analysts need SELECT on the owner-filtered `*_visible` views only, plus their own source-table grants; they should not receive base result/snapshot table grants. Result reads also join authorized source calls and require complete current masking. View ownership and grants must be tested with a second restricted identity before claiming access-control acceptance.

Minimum table permissions, in addition to `USE CATALOG` and `USE SCHEMA`:

| Table             | App service principal | Worker run-as identity |
| ----------------- | --------------------- | ---------------------- |
| `label_runs`      | `SELECT, MODIFY`      | `SELECT, MODIFY`       |
| `label_run_scope` | `SELECT, MODIFY`      | `SELECT`               |
| `label_results`   | `SELECT`              | `SELECT, MODIFY`       |
| `label_feedback`  | `SELECT, MODIFY`      | none                   |

The app identity additionally needs `CAN_USE` on the configured SQL warehouse and `CAN_MANAGE_RUN` on the label job. The live warehouse requires `SELECT` as well as `MODIFY` on `label_run_scope` for the app's `INSERT`; granting `MODIFY` alone was rejected before worker submission. This snapshot-table permission does not grant source-table access. The worker needs `CAN_QUERY` on a legacy serving endpoint, or `EXECUTE` plus required namespace privileges on a Unity Gateway model service. It needs no source-table or Lakebase grant for inference. Analysts need their own `CAN_USE` on the warehouse and only `SELECT` on `label_runs_visible`, `label_results_visible`, and `label_feedback_visible`.

Provision in this order: confirm source schema and complete masking; select and smoke-test a compatible model; create the four tables and three views; grant the identities above; deploy the worker with an explicit approved run-as identity; bind the job and endpoint into the app; then run a real sample, save verdicts, and run the same-version full cohort. `resources/label-model-smoke.sql` sends one invented conversation using the worker's exact structured-output schema. Execute it with `databricks experimental aitools tools query --file resources/label-model-smoke.sql --param endpoint=<discovered-name> --warehouse <warehouse-id> --profile fevm-serverless-stable-prvwqx`. A successful SQL statement alone is insufficient: `error_message` must be empty and `response` must parse as the expected JSON. The same query must pass under the worker identity; a data owner's successful query does not establish worker access.

Configuration:

| Environment                                  | Purpose                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `CALL_INSIGHTS_LABEL_ENDPOINT`               | Confirmed foundation-model serving endpoint; required, no fallback model              |
| `DATABRICKS_JOB_LABELS`                      | Durable worker job binding                                                            |
| `CALL_INSIGHTS_DATA_SCHEMA`                  | Trusted `catalog.schema` for mutation tables; default matches the existing app source |
| `CALL_INSIGHTS_LABEL_RUN_CAP`                | Per-run interaction cap; default 10,000, maximum 100,000                              |
| `CALL_INSIGHTS_LABEL_DAILY_TOKEN_BUDGET`     | Per-user estimated rolling 24-hour token budget; default 5,000,000                    |
| `CALL_INSIGHTS_LABEL_INPUT_USD_PER_MILLION`  | Optional verified input price for monetary preview                                    |
| `CALL_INSIGHTS_LABEL_OUTPUT_USD_PER_MILLION` | Optional verified output price for monetary preview                                   |

The read SQL and DDL currently target `serverless_stable_prvwqx_catalog.call_insights`, matching the existing app. Changing the mutation environment alone does not retarget reads; change and validate the SQL, notebook defaults and bundle parameters together for another data schema.

## Validation and remaining acceptance criteria

Local route tests cover fail-closed caller identity, canonical stored IDs, immutable revision updates with optimistic concurrency, exact-version sample prerequisite, the SDK's successful empty-result shape, empty masked cohorts, backward date ranges, persisted source snapshots before job submission, and worker submission failure. The focused route/job-runner suites pass 15 tests. These tests use controlled dependency fixtures, never deployed inference fixtures. The worker also passes Python syntax and local output-parser/grounding checks.

**Live SQL, model compatibility and the actual worker execution path passed.** Authenticated app requests created a definition, appended an immutable second version, verified the pre-sample full-run rejection, and completed a real 20-call sample with two matches. A source-reviewed positive decision and non-match were saved and verified through fresh requests. A frozen same-version full run then processed 50 unique calls, returned eight grounded matches and completed with zero inference errors or ungrounded matches. Persisted sample results, verdicts, full results, library status and queue/agent/day totals were read back through named OBO analytics. Both jobs used `databricks-claude-haiku-4-5`; the approved Lakebase store, Delta snapshots and model permissions were exercised rather than mocked.

The source population has 1,446 historical calls. After the 25 October 2026 [masking backfill](masking-backfill-validation.json), all 1,446 have complete masked transcripts and satisfy this workflow’s masking prerequisite, subject to each analyst’s source permissions and configured run budgets. The previously accepted full run remains its frozen 50-call cohort; this backfill did not run label inference or extend the 50-call AI enrichment sample. The two sample reviews checked authorized masked transcripts, including the positive customer turn at 12.67 seconds; they do not establish whole-cohort accuracy. Browser/audio/case acceptance is recorded separately in the deployment evidence. A second restricted identity and source-access revocation scenarios remain necessary before claiming permission isolation. No inference accuracy, cost or runtime target has been established. Model prices remain unset, so the preview correctly shows no monetary estimate; token estimates are advisory. The failed preliminary run remains a failed history entry with no snapshots or worker job and is not counted as a classification result.

**Automatic incremental tracking is not implemented and remains an unmet acceptance criterion.** The app does not show a functioning tracking switch or claim that new calls are processed automatically. Safe new-call tracking needs per-user scheduled execution under that user's UC permissions and an isolated result-write strategy, or an explicitly approved shared-data entitlement policy. The current service-principal worker consumes only cohorts frozen through a user-authorized request. Scheduling it to discover new calls as the SP would broaden that boundary and is not enabled.

Other remaining spec scope: incremental trends, inclusion of label-result provenance as a typed case item, and reviewing feedback before promoting a full run beyond the required successful sample. The first scoped CUJ is definition → sample → verdict → same-version full cohort → source evidence → investigation; the broader scheduled-label lifecycle is not complete.
