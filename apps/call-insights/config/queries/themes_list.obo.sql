-- Current themes with scoped counts and the previous equal-length period.
-- Returns no rows until the theme builder has completed a run.
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
), scoped AS (
  SELECT i.interaction_id, i.queue, i.duration_seconds,
    CASE WHEN i.started_at >= p.period_start THEN 'current' ELSE 'previous' END AS period
  FROM serverless_stable_prvwqx_catalog.call_insights.interactions i CROSS JOIN periods p
  WHERE (:queue = '' OR i.queue = :queue)
    AND i.started_at >= p.previous_start AND i.started_at < p.period_end
), members AS (
  SELECT s.*, m.theme_id, e.sentiment_end, e.repeat_contact_mentioned
  FROM scoped s
  JOIN serverless_stable_prvwqx_catalog.call_insights.theme_membership_current m ON m.interaction_id = s.interaction_id
  LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_enrichment e ON e.interaction_id = s.interaction_id AND e.error_message IS NULL
), agg AS (
  SELECT theme_id,
    COUNT(DISTINCT CASE WHEN period = 'current' THEN interaction_id END) AS calls,
    COUNT(DISTINCT CASE WHEN period = 'previous' THEN interaction_id END) AS previous_calls,
    ROUND(AVG(CASE WHEN period = 'current' THEN duration_seconds END), 1) AS avg_duration_seconds,
    COUNT_IF(period = 'current' AND sentiment_end = 'negative') AS negative,
    COUNT_IF(period = 'current' AND sentiment_end IN ('negative', 'neutral', 'positive')) AS sentiment_evaluated,
    COUNT_IF(period = 'current' AND repeat_contact_mentioned) AS repeat_mentions,
    COUNT_IF(period = 'current' AND repeat_contact_mentioned IS NOT NULL) AS repeat_evaluated
  FROM members GROUP BY theme_id
), top_queue AS (
  SELECT theme_id, queue,
    ROW_NUMBER() OVER (PARTITION BY theme_id ORDER BY COUNT(*) DESC, queue) AS rk
  FROM members WHERE period = 'current' GROUP BY theme_id, queue
), coverage AS (
  SELECT COUNT(DISTINCT CASE WHEN s.period = 'current' THEN s.interaction_id END) AS calls_in_scope,
    COUNT(DISTINCT CASE WHEN s.period = 'current' AND m.interaction_id IS NOT NULL THEN s.interaction_id END) AS themed_in_scope
  FROM scoped s LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.theme_membership_current m ON m.interaction_id = s.interaction_id
)
SELECT r.run_id, CAST(r.created_at AS STRING) AS run_created_at, r.method AS run_method,
  r.calls_themed AS run_calls_themed, r.purity AS run_purity,
  c.calls_in_scope, c.themed_in_scope,
  t.theme_id, t.name, t.description,
  COALESCE(a.calls, 0) AS calls, COALESCE(a.previous_calls, 0) AS previous_calls,
  a.avg_duration_seconds, COALESCE(a.negative, 0) AS negative,
  COALESCE(a.sentiment_evaluated, 0) AS sentiment_evaluated,
  COALESCE(a.repeat_mentions, 0) AS repeat_mentions, COALESCE(a.repeat_evaluated, 0) AS repeat_evaluated,
  q.queue AS top_queue
FROM serverless_stable_prvwqx_catalog.call_insights.theme_run_current r
CROSS JOIN coverage c
JOIN serverless_stable_prvwqx_catalog.call_insights.themes_current t ON t.run_id = r.run_id
LEFT JOIN agg a ON a.theme_id = t.theme_id
LEFT JOIN top_queue q ON q.theme_id = t.theme_id AND q.rk = 1
ORDER BY calls DESC, t.name, t.theme_id
LIMIT 100
