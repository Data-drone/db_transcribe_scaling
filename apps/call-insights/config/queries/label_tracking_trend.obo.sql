-- Daily prevalence of a tracked label across its full and tracking runs (latest verdict per call).
-- @param refresh_nonce STRING
-- @param label_id STRING
WITH tracking AS (
  SELECT label_id, version FROM serverless_stable_prvwqx_catalog.call_insights.label_tracking_visible
  WHERE :refresh_nonce <> '' AND label_id = :label_id AND LOWER(owner_email) = LOWER(CURRENT_USER())
), latest AS (
  SELECT x.interaction_id, x.matched,
    ROW_NUMBER() OVER (PARTITION BY x.interaction_id ORDER BY x.processed_at DESC) AS rn
  FROM tracking t
  JOIN serverless_stable_prvwqx_catalog.call_insights.label_runs_visible r ON r.label_id = t.label_id AND r.version = t.version
  JOIN serverless_stable_prvwqx_catalog.call_insights.label_results_visible x ON x.run_id = r.run_id
  WHERE r.run_type IN ('full', 'tracking') AND r.status IN ('completed', 'partial')
    AND x.error_message IS NULL AND x.matched IS NOT NULL
)
SELECT CAST(DATE(i.started_at) AS STRING) AS day, COUNT(*) AS evaluated, COUNT_IF(l.matched) AS matched
FROM latest l
JOIN serverless_stable_prvwqx_catalog.call_insights.interactions i ON i.interaction_id = l.interaction_id
WHERE l.rn = 1
GROUP BY DATE(i.started_at)
ORDER BY day
