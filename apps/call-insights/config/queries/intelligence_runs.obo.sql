-- @param refresh_nonce STRING
-- @param label_id STRING
SELECT r.run_id, r.label_id, r.version, r.run_type, r.status, r.interactions_in_scope,
  r.processed_count, r.matched_count, r.error_count, r.ungrounded_count, r.estimated_tokens,
  CAST(r.started_at AS STRING) AS started_at, COALESCE(CAST(r.finished_at AS STRING), '') AS finished_at,
  r.model_endpoint, COALESCE(r.error_message, '') AS error_message, COALESCE(r.job_run_id, '') AS job_run_id
FROM serverless_stable_prvwqx_catalog.call_insights.label_runs_visible r
WHERE :refresh_nonce <> '' AND r.label_id = :label_id AND LOWER(r.owner_email) = LOWER(CURRENT_USER())
ORDER BY r.started_at DESC, r.run_id
LIMIT 100
