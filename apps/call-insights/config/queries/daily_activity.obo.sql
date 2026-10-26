-- @param queue STRING
-- @param start_date STRING
-- @param end_date STRING
SELECT DATE_TRUNC('day', i.started_at) AS day,
  COUNT(*) AS interaction_count,
  COUNT(CASE WHEN e.sentiment_end IN ('negative', 'neutral', 'positive') THEN 1 END) AS sentiment_count,
  SUM(CASE WHEN e.sentiment_end = 'negative' THEN 1 ELSE 0 END) AS negative_count,
  ROUND(AVG(CASE WHEN e.sentiment_end NOT IN ('negative', 'neutral', 'positive') OR e.sentiment_end IS NULL THEN NULL WHEN e.sentiment_end = 'negative' THEN 1.0 ELSE 0.0 END), 3) AS negative_share
FROM serverless_stable_prvwqx_catalog.call_insights.interactions i
LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_enrichment e
  ON e.interaction_id = i.interaction_id AND e.error_message IS NULL
WHERE (:queue = '' OR i.queue = :queue)
  AND (:start_date = '' OR i.started_at >= TRY_CAST(CONCAT(:start_date, 'T00:00:00Z') AS TIMESTAMP))
  AND (:end_date = '' OR i.started_at < TRY_CAST(CONCAT(:end_date, 'T00:00:00Z') AS TIMESTAMP) + INTERVAL 1 DAY)
GROUP BY DATE_TRUNC('day', i.started_at)
ORDER BY day
