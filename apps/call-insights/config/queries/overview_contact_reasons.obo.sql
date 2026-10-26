-- @param queue STRING
-- @param start_date STRING
-- @param end_date STRING
-- @param theme_id STRING
SELECT
  e.contact_reason,
  COUNT(*) AS interaction_count,
  ROUND(AVG(i.duration_seconds), 1) AS avg_duration_seconds,
  SUM(CASE WHEN e.sentiment_end = 'negative' THEN 1 ELSE 0 END) AS negative_count
FROM serverless_stable_prvwqx_catalog.call_insights.interaction_enrichment e
JOIN serverless_stable_prvwqx_catalog.call_insights.interactions i USING (interaction_id)
WHERE NULLIF(TRIM(e.contact_reason), '') IS NOT NULL
  AND e.error_message IS NULL
  AND (:queue = '' OR i.queue = :queue)
  AND (:start_date = '' OR i.started_at >= TRY_CAST(CONCAT(:start_date, 'T00:00:00Z') AS TIMESTAMP))
  AND (:end_date = '' OR i.started_at < TRY_CAST(CONCAT(:end_date, 'T00:00:00Z') AS TIMESTAMP) + INTERVAL 1 DAY)
  AND (:theme_id = '' OR EXISTS (SELECT 1 FROM serverless_stable_prvwqx_catalog.call_insights.theme_membership_current tm WHERE tm.interaction_id = i.interaction_id AND tm.theme_id = :theme_id))
GROUP BY e.contact_reason
ORDER BY interaction_count DESC, contact_reason
