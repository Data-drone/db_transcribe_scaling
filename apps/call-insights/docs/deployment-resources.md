# Deployment resources

Workspace: `https://fevm-serverless-stable-prvwqx.cloud.databricks.com`.
Authenticated deployment identity: `brian.law@databricks.com`.

Before provisioning on 25 October 2026, live inventory found no Apps, Lakebase projects, or Genie spaces.
The existing warehouse `8d4699c5c6d30f71` and source schema
`serverless_stable_prvwqx_catalog.call_insights` have been verified.

## Approved Lakebase selection

Created dedicated project `call-insights`, display name **Call Insights**, using
[the create request](../resources/lakebase-project.json). Selected its `production`
branch and default `databricks_postgres` database, resolving their exact resource
names from the service response. The platform's initial endpoint uses 1 CU with
scale-to-zero. This creates billable compute and storage.

Bound that database only to the Call Insights app with `CAN_CONNECT_AND_CREATE`.
The deployed app service principal initializes and owns `call_insights_app` and
its documents table. App requests enforce owner/named-reader permissions; source
transcripts and original audio are reauthorized with the requesting user's
Databricks permissions. Do not initialize this schema using local user credentials.

## App and worker

Deployed app `call-insights` and job `call-insights-label-worker` from the bundle.
The worker runs as the deploying data owner `brian.law@databricks.com` and consumes
only persisted cohorts that were authorized and frozen by the requesting analyst.
It does not discover new calls on a schedule.

The four label tables and three owner-filtered views have already been created
under the authorized full-deployment request. The app receives only the per-table
permissions listed in [Intelligence](intelligence.md), plus warehouse use and job
run permissions. No raw transcript or source-volume grants are added to the app.
The verified model is `databricks-claude-haiku-4-5`; its structured-output smoke
test passed. All 16 query types were regenerated from the warehouse (14 live
descriptions, two unchanged cached descriptions).

Full app validation passed, including live type generation, production builds and all tests. Strict
bundle validation passed with the actual approved Lakebase and Genie bindings.

## Approved Genie selection

The full proposed configuration, governed source definitions, examples and
validation are in [the Genie proposal](genie-proposal.md). The user explicitly approved the complete configuration and curated source views.
Genie space `01f1d07837f9137889e98be6514466fa` and both views are now created.

## Acceptance limits

The source has 1,446 completely masked calls, covering all 15,132 transcript turns
and 1,446 prompt-ready transcripts after the 25 October 2026 [masking backfill](masking-backfill-validation.json).
All calls satisfy the masking prerequisite for new source-authorized classification
runs; the prior accepted full run retains its frozen 50-call scope. AI summaries
and other enrichment still cover 50 calls. Automatic incremental tracking is not implemented. Live Investigations, audio, all 17 analytics checks and the deployed Genie bridge passed. Intelligence acceptance completed a 20-call sample, two persisted source-reviewed verdicts and a same-version frozen full 50-call run (eight matches, zero inference errors, zero ungrounded matches). Browser automation is unavailable for the
requested Chrome profile, so browser acceptance remains pending. Second-user isolation cannot be
established by a single administrator identity.

## Provisioned identities

- App origin: `https://call-insights-7474659004185848.aws.databricksapps.com`.
- App SP client ID: `ccd5a96e-1fee-4fad-8518-94616c892919`.
- Label worker job: `17963523044750`, running as `brian.law@databricks.com`.
- Lakebase endpoint: `projects/call-insights/branches/production/endpoints/primary`; verified 1 CU and `300s` idle timeout.
- App SP receives only the documented label-table grants; it has no source interactions SELECT or source-volume grant. Effective label snapshot grants contain no broad SELECT entitlement.

Provisioning, deployment and the single-user API/worker acceptance are complete. See [deployment status](deployment-live-validation.json), [Investigations](live-investigations-validation.json), [analytics](live-analytics-validation.json), [Genie](genie-live-validation.json) and [Intelligence](intelligence-live-validation.json) for recorded evidence. Browser and second-user acceptance remain open.

The app also requires SELECT on `label_run_scope` for the warehouse INSERT SELECT operation, as established by live testing. This grant is confined to app-owned frozen masked snapshots; no source SELECT or broad reader entitlement was added.
