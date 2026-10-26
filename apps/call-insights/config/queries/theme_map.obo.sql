-- Every themed call in scope with its 2-D map position (from the theme builder's t-SNE projection).
-- @param queue STRING
-- @param start_date STRING
-- @param end_date STRING
SELECT m.interaction_id, m.theme_id, m.map_x, m.map_y, i.queue,
  CAST(DATE(i.started_at) AS STRING) AS day, ROUND(i.duration_seconds, 1) AS duration_seconds,
  e.sentiment_end
FROM serverless_stable_prvwqx_catalog.call_insights.theme_membership_current m
JOIN serverless_stable_prvwqx_catalog.call_insights.interactions i ON i.interaction_id = m.interaction_id
LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_enrichment e
  ON e.interaction_id = i.interaction_id AND e.error_message IS NULL
WHERE m.map_x IS NOT NULL AND m.map_y IS NOT NULL
  AND (:queue = '' OR i.queue = :queue)
  AND (:start_date = '' OR i.started_at >= TRY_CAST(CONCAT(:start_date, 'T00:00:00Z') AS TIMESTAMP))
  AND (:end_date = '' OR i.started_at < TRY_CAST(CONCAT(:end_date, 'T00:00:00Z') AS TIMESTAMP) + INTERVAL 1 DAY)
ORDER BY m.theme_id, m.interaction_id
LIMIT 5000
