-- Run once as the app data owner. See docs/intelligence.md for per-table grants.
-- Grant analysts SELECT on the *_visible views only, never on snapshots/base results.
CREATE TABLE IF NOT EXISTS serverless_stable_prvwqx_catalog.call_insights.label_runs (
  run_id STRING, label_id STRING, version INT, owner_email STRING, run_type STRING,
  status STRING, interactions_in_scope BIGINT, processed_count BIGINT, matched_count BIGINT,
  error_count BIGINT, ungrounded_count BIGINT, estimated_tokens BIGINT, model_endpoint STRING,
  revision_json STRING, job_run_id STRING, error_message STRING, started_at TIMESTAMP, finished_at TIMESTAMP
) USING DELTA;
CREATE TABLE IF NOT EXISTS serverless_stable_prvwqx_catalog.call_insights.label_run_scope (
  run_id STRING, interaction_id STRING, queue STRING, agent_name STRING, started_at STRING,
  segments_json STRING, transcript_sha256 STRING
) USING DELTA;
CREATE TABLE IF NOT EXISTS serverless_stable_prvwqx_catalog.call_insights.label_results (
  run_id STRING, interaction_id STRING, matched BOOLEAN, confidence STRING,
  evidence_quote STRING, evidence_start_seconds DOUBLE, grounded BOOLEAN, reason STRING,
  error_message STRING, processed_at TIMESTAMP
) USING DELTA;
CREATE TABLE IF NOT EXISTS serverless_stable_prvwqx_catalog.call_insights.label_feedback (
  run_id STRING, interaction_id STRING, reviewer_email STRING, verdict STRING,
  note STRING, created_at TIMESTAMP
) USING DELTA;
CREATE OR REPLACE VIEW serverless_stable_prvwqx_catalog.call_insights.label_runs_visible AS
SELECT * EXCEPT (revision_json) FROM serverless_stable_prvwqx_catalog.call_insights.label_runs
WHERE LOWER(owner_email)=LOWER(CURRENT_USER());
CREATE OR REPLACE VIEW serverless_stable_prvwqx_catalog.call_insights.label_results_visible AS
SELECT x.* FROM serverless_stable_prvwqx_catalog.call_insights.label_results x
JOIN serverless_stable_prvwqx_catalog.call_insights.label_runs r USING (run_id)
WHERE LOWER(r.owner_email)=LOWER(CURRENT_USER());
CREATE OR REPLACE VIEW serverless_stable_prvwqx_catalog.call_insights.label_feedback_visible AS
SELECT * FROM serverless_stable_prvwqx_catalog.call_insights.label_feedback
WHERE LOWER(reviewer_email)=LOWER(CURRENT_USER());
