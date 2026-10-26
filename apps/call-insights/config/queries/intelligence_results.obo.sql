-- Masking corpus revision 2026-10-25 complete backfill refreshes cached evidence.
-- @param refresh_nonce STRING
-- @param run_id STRING
-- @param page_offset INT
WITH permitted_calls AS (
  SELECT i.interaction_id
  FROM serverless_stable_prvwqx_catalog.call_insights.interactions i
  JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_segments s USING (interaction_id)
  LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_segments_masked m
    ON m.interaction_id = s.interaction_id AND m.segment_idx = s.segment_idx
  GROUP BY i.interaction_id
  HAVING COUNT_IF(m.text_masked IS NULL OR TRIM(m.text_masked) = '') = 0
)
SELECT x.interaction_id, i.queue, i.agent_name, CAST(i.started_at AS STRING) AS started_at,
  COALESCE(x.matched, FALSE) AS matched, COALESCE(x.confidence, '') AS confidence,
  COALESCE(x.evidence_quote, '') AS evidence_quote,
  COALESCE(x.evidence_start_seconds, -1) AS evidence_start_seconds,
  COALESCE(x.grounded, FALSE) AS grounded, COALESCE(x.reason, '') AS reason,
  COALESCE(x.error_message, '') AS error_message, COALESCE(f.verdict, '') AS verdict
FROM serverless_stable_prvwqx_catalog.call_insights.label_results_visible x
JOIN serverless_stable_prvwqx_catalog.call_insights.label_runs_visible r USING (run_id)
JOIN permitted_calls p USING (interaction_id)
JOIN serverless_stable_prvwqx_catalog.call_insights.interactions i USING (interaction_id)
LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.label_feedback_visible f
  ON f.run_id = x.run_id AND f.interaction_id = x.interaction_id AND LOWER(f.reviewer_email) = LOWER(CURRENT_USER())
WHERE :refresh_nonce <> '' AND x.run_id = :run_id AND LOWER(r.owner_email) = LOWER(CURRENT_USER())
ORDER BY x.matched DESC NULLS LAST, x.interaction_id
LIMIT 50 OFFSET :page_offset
