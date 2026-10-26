-- Queue, contact-reason and daily breakdown of one theme in the selected scope.
-- @param theme_id STRING
-- @param queue STRING
-- @param start_date STRING
-- @param end_date STRING
WITH window_bounds AS (
  SELECT
    COALESCE(CASE WHEN :start_date <> '' THEN TRY_CAST(CONCAT(:start_date, 'T00:00:00Z') AS TIMESTAMP) END, DATE_TRUNC('day', MIN(started_at))) AS period_start,
    COALESCE(CASE WHEN :end_date <> '' THEN TRY_CAST(CONCAT(:end_date, 'T00:00:00Z') AS TIMESTAMP) + INTERVAL 1 DAY END, DATE_TRUNC('day', MAX(started_at)) + INTERVAL 1 DAY) AS period_end
  FROM serverless_stable_prvwqx_catalog.call_insights.interactions
), periods AS (
  SELECT period_start, period_end,
    TIMESTAMPADD(DAY, -TIMESTAMPDIFF(DAY, period_start, period_end), period_start) AS previous_start
  FROM window_bounds
), members AS (
  SELECT i.interaction_id, i.queue, i.started_at, i.duration_seconds, e.contact_reason
  FROM serverless_stable_prvwqx_catalog.call_insights.interactions i
  CROSS JOIN periods p
  JOIN serverless_stable_prvwqx_catalog.call_insights.theme_membership_current m ON m.interaction_id = i.interaction_id
  LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_enrichment e ON e.interaction_id = i.interaction_id AND e.error_message IS NULL
  WHERE m.theme_id = :theme_id
    AND (:queue = '' OR i.queue = :queue)
    AND i.started_at >= p.period_start AND i.started_at < p.period_end
)
SELECT 'queue' AS dimension, queue AS value, COUNT(*) AS calls, ROUND(AVG(duration_seconds), 1) AS avg_duration_seconds
FROM members GROUP BY queue
UNION ALL
SELECT 'reason', COALESCE(NULLIF(TRIM(contact_reason), ''), 'Not evaluated'), COUNT(*), ROUND(AVG(duration_seconds), 1)
FROM members GROUP BY COALESCE(NULLIF(TRIM(contact_reason), ''), 'Not evaluated')
UNION ALL
SELECT 'day', CAST(DATE(started_at) AS STRING), COUNT(*), ROUND(AVG(duration_seconds), 1)
FROM members GROUP BY DATE(started_at)
ORDER BY dimension, calls DESC, value
