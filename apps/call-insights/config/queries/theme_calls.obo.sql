-- Representative calls for a theme (closest to its centroid) with a masked excerpt.
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
  SELECT i.interaction_id, i.started_at, i.queue, i.duration_seconds, m.distance
  FROM serverless_stable_prvwqx_catalog.call_insights.interactions i
  CROSS JOIN periods p
  JOIN serverless_stable_prvwqx_catalog.call_insights.theme_membership_current m ON m.interaction_id = i.interaction_id
  WHERE m.theme_id = :theme_id
    AND (:queue = '' OR i.queue = :queue)
    AND i.started_at >= p.period_start AND i.started_at < p.period_end
), nearest AS (
  SELECT * FROM members ORDER BY distance ASC NULLS LAST, interaction_id LIMIT 12
), excerpts AS (
  SELECT s.interaction_id, s.start_seconds, sm.text_masked,
    ROW_NUMBER() OVER (
      PARTITION BY s.interaction_id
      ORDER BY CASE WHEN s.speaker_role = 'customer' AND LENGTH(sm.text_masked) > 40 THEN 0 ELSE 1 END, s.segment_idx
    ) AS rk
  FROM nearest n
  JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_segments s ON s.interaction_id = n.interaction_id
  JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_segments_masked sm ON sm.interaction_id = s.interaction_id AND sm.segment_idx = s.segment_idx
  WHERE NULLIF(TRIM(sm.text_masked), '') IS NOT NULL
)
SELECT n.interaction_id, CAST(n.started_at AS STRING) AS started_at, n.queue,
  ROUND(n.duration_seconds, 1) AS duration_seconds,
  e.sentiment_end, x.text_masked AS excerpt, x.start_seconds AS excerpt_start
FROM nearest n
LEFT JOIN excerpts x ON x.interaction_id = n.interaction_id AND x.rk = 1
LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_enrichment e ON e.interaction_id = n.interaction_id AND e.error_message IS NULL
ORDER BY n.distance ASC NULLS LAST, n.interaction_id
