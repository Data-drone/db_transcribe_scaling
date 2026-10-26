-- @param refresh_nonce STRING
-- @param run_id STRING
WITH results AS (
  SELECT i.queue, COALESCE(i.agent_name, 'Unknown agent') AS agent_name, CAST(DATE(i.started_at) AS STRING) AS day,
    x.matched, x.error_message
  FROM serverless_stable_prvwqx_catalog.call_insights.label_results_visible x
  JOIN serverless_stable_prvwqx_catalog.call_insights.label_runs_visible r USING (run_id)
  JOIN serverless_stable_prvwqx_catalog.call_insights.interactions i USING (interaction_id)
  WHERE :refresh_nonce <> '' AND x.run_id=:run_id AND LOWER(r.owner_email)=LOWER(CURRENT_USER())
), dimensions AS (
  SELECT 'queue' AS dimension, queue AS value, matched, error_message FROM results
  UNION ALL SELECT 'agent', agent_name, matched, error_message FROM results
  UNION ALL SELECT 'day', day, matched, error_message FROM results
)
SELECT dimension, value, COUNT(*) AS evaluated_count, COUNT_IF(matched=TRUE) AS matched_count,
  COUNT_IF(error_message IS NOT NULL AND error_message<>'') AS error_count
FROM dimensions
GROUP BY dimension,value
ORDER BY dimension,matched_count DESC,value
LIMIT 300
