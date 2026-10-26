-- @param queue STRING
-- @param start_date STRING
-- @param end_date STRING
SELECT
  DATE_TRUNC('hour', i.started_at) AS hour,
  COUNT(*) AS interaction_count,
  ROUND(AVG(i.duration_seconds), 1) AS avg_duration_seconds
FROM serverless_stable_prvwqx_catalog.call_insights.interactions i
WHERE (:queue = '' OR i.queue = :queue)
  AND (:start_date = '' OR i.started_at >= TRY_CAST(CONCAT(:start_date, 'T00:00:00Z') AS TIMESTAMP))
  AND (:end_date = '' OR i.started_at < TRY_CAST(CONCAT(:end_date, 'T00:00:00Z') AS TIMESTAMP) + INTERVAL 1 DAY)
GROUP BY DATE_TRUNC('hour', i.started_at)
ORDER BY hour
