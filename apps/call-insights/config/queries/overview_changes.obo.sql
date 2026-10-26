-- What's changed: share of evaluated calls for each contact reason, current theme and
-- enabled tracked label, compared with the previous equal-length period.
-- Shares (not raw counts) are compared so that volume and coverage changes are not
-- mistaken for a shift in what customers call about.
-- @param queue STRING
-- @param start_date STRING
-- @param end_date STRING
-- @param min_calls INT = 3
-- @param threshold DOUBLE = 0.25
WITH window_bounds AS (
  SELECT
    COALESCE(CASE WHEN :start_date <> '' THEN TRY_CAST(CONCAT(:start_date, 'T00:00:00Z') AS TIMESTAMP) END, DATE_TRUNC('day', MIN(started_at))) AS period_start,
    COALESCE(CASE WHEN :end_date <> '' THEN TRY_CAST(CONCAT(:end_date, 'T00:00:00Z') AS TIMESTAMP) + INTERVAL 1 DAY END, DATE_TRUNC('day', MAX(started_at)) + INTERVAL 1 DAY) AS period_end
  FROM serverless_stable_prvwqx_catalog.call_insights.interactions
), periods AS (
  SELECT period_start, period_end,
    TIMESTAMPADD(DAY, -TIMESTAMPDIFF(DAY, period_start, period_end), period_start) AS previous_start
  FROM window_bounds
), calls AS (
  SELECT i.interaction_id, i.queue, i.duration_seconds,
    CASE WHEN i.started_at >= p.period_start THEN 'current' ELSE 'previous' END AS period
  FROM serverless_stable_prvwqx_catalog.call_insights.interactions i CROSS JOIN periods p
  WHERE (:queue = '' OR i.queue = :queue)
    AND i.started_at >= p.previous_start AND i.started_at < p.period_end
), enriched AS (
  SELECT c.*, e.contact_reason FROM calls c
  JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_enrichment e ON e.interaction_id = c.interaction_id AND e.error_message IS NULL
), themed AS (
  SELECT c.*, m.theme_id, t.name AS theme_name FROM calls c
  JOIN serverless_stable_prvwqx_catalog.call_insights.theme_membership_current m ON m.interaction_id = c.interaction_id
  JOIN serverless_stable_prvwqx_catalog.call_insights.themes_current t ON t.theme_id = m.theme_id
), label_latest AS (
  SELECT t.label_id, t.label_name, x.interaction_id, x.matched,
    ROW_NUMBER() OVER (PARTITION BY t.label_id, x.interaction_id ORDER BY x.processed_at DESC) AS rn
  FROM serverless_stable_prvwqx_catalog.call_insights.label_tracking_visible t
  JOIN serverless_stable_prvwqx_catalog.call_insights.label_runs_visible r ON r.label_id = t.label_id AND r.version = t.version
  JOIN serverless_stable_prvwqx_catalog.call_insights.label_results_visible x ON x.run_id = r.run_id
  WHERE t.enabled AND r.run_type IN ('full', 'tracking') AND r.status IN ('completed', 'partial')
    AND x.error_message IS NULL AND x.matched IS NOT NULL
), label_evaluated AS (
  SELECT c.*, l.label_id, l.label_name, l.matched FROM calls c
  JOIN label_latest l ON l.interaction_id = c.interaction_id AND l.rn = 1
), items AS (
  SELECT 'reason' AS kind, contact_reason AS id, contact_reason AS name, interaction_id, queue, duration_seconds, period, TRUE AS hit
  FROM enriched WHERE NULLIF(TRIM(contact_reason), '') IS NOT NULL
  UNION ALL
  SELECT 'theme', theme_id, theme_name, interaction_id, queue, duration_seconds, period, TRUE FROM themed
  UNION ALL
  SELECT 'label', label_id, label_name, interaction_id, queue, duration_seconds, period, matched FROM label_evaluated
), denominators AS (
  SELECT 'reason' AS kind, CAST(NULL AS STRING) AS id, period, COUNT(DISTINCT interaction_id) AS evaluated FROM enriched GROUP BY period
  UNION ALL SELECT 'theme', CAST(NULL AS STRING), period, COUNT(DISTINCT interaction_id) FROM themed GROUP BY period
  UNION ALL SELECT 'label', label_id, period, COUNT(DISTINCT interaction_id) FROM label_evaluated GROUP BY label_id, period
), agg AS (
  SELECT kind, id, MAX(name) AS name,
    COUNT(DISTINCT CASE WHEN period = 'current' AND hit THEN interaction_id END) AS current_count,
    COUNT(DISTINCT CASE WHEN period = 'previous' AND hit THEN interaction_id END) AS previous_count,
    AVG(CASE WHEN period = 'current' AND hit THEN duration_seconds END) AS current_avg,
    AVG(CASE WHEN period = 'previous' AND hit THEN duration_seconds END) AS previous_avg
  FROM items GROUP BY kind, id
), shares AS (
  SELECT a.*,
    a.current_count / NULLIF(dc.evaluated, 0) AS current_share,
    a.previous_count / NULLIF(dp.evaluated, 0) AS previous_share
  FROM agg a
  LEFT JOIN denominators dc ON dc.kind = a.kind AND dc.period = 'current' AND (dc.id IS NULL OR dc.id = a.id)
  LEFT JOIN denominators dp ON dp.kind = a.kind AND dp.period = 'previous' AND (dp.id IS NULL OR dp.id = a.id)
), queue_mix AS (
  SELECT kind, id, queue, COUNT(DISTINCT interaction_id) AS n,
    ROW_NUMBER() OVER (PARTITION BY kind, id ORDER BY COUNT(DISTINCT interaction_id) DESC, queue) AS rk
  FROM items WHERE period = 'current' AND hit GROUP BY kind, id, queue
)
SELECT s.kind, s.id, s.name, s.current_count, s.previous_count,
  ROUND(s.current_share, 4) AS current_share, ROUND(s.previous_share, 4) AS previous_share,
  ROUND((s.current_share - s.previous_share) / s.previous_share, 4) AS change_pct,
  ROUND(s.current_avg, 1) AS current_avg_duration_seconds,
  ROUND(s.previous_avg, 1) AS previous_avg_duration_seconds,
  q.queue AS top_queue, ROUND(q.n / s.current_count, 3) AS top_queue_share
FROM shares s
LEFT JOIN queue_mix q ON q.kind = s.kind AND q.id = s.id AND q.rk = 1
WHERE s.previous_share > 0 AND s.current_count >= :min_calls
  AND ABS((s.current_share - s.previous_share) / s.previous_share) >= :threshold
ORDER BY ABS((s.current_share - s.previous_share) / s.previous_share) * s.current_count DESC, s.kind, s.id
LIMIT 12
