-- @param queue STRING
-- @param start_date STRING
-- @param end_date STRING
-- @param contact_reason STRING
-- @param theme_id STRING
WITH window_bounds AS (
  SELECT
    COALESCE(CASE WHEN :start_date <> '' THEN TRY_CAST(CONCAT(:start_date, 'T00:00:00Z') AS TIMESTAMP) END, DATE_TRUNC('day', MIN(started_at))) AS period_start,
    COALESCE(CASE WHEN :end_date <> '' THEN TRY_CAST(CONCAT(:end_date, 'T00:00:00Z') AS TIMESTAMP) + INTERVAL 1 DAY END, DATE_TRUNC('day', MAX(started_at)) + INTERVAL 1 DAY) AS period_end
  FROM serverless_stable_prvwqx_catalog.call_insights.interactions
), current_period AS (
SELECT
  COUNT(*) AS interaction_count,
  COUNT(DISTINCT i.agent_id) AS agent_count,
  COUNT(m.interaction_id) AS metrics_count,
  COUNT(e.interaction_id) AS enriched_count,
  COUNT(CASE WHEN e.sentiment_end IN ('negative', 'neutral', 'positive') THEN 1 END) AS sentiment_count,
  COUNT(e.repeat_contact_mentioned) AS repeat_evaluated_count,
  ROUND(AVG(i.duration_seconds), 1) AS avg_duration_seconds,
  ROUND(AVG(m.talk_ratio_agent), 3) AS avg_agent_talk_ratio,
  ROUND(AVG(m.silence_seconds_total), 1) AS avg_silence_seconds,
  ROUND(AVG(m.longest_silence_seconds), 1) AS avg_longest_silence_seconds,
  ROUND(AVG(m.turn_count), 1) AS avg_turn_count,
  ROUND(AVG(CASE WHEN m.interaction_id IS NULL THEN NULL WHEN m.overtalk_count > 0 THEN 1.0 ELSE 0.0 END), 3) AS overtalk_call_share,
  ROUND(AVG(CASE WHEN e.sentiment_end NOT IN ('negative', 'neutral', 'positive') OR e.sentiment_end IS NULL THEN NULL WHEN e.sentiment_end = 'negative' THEN 1.0 ELSE 0.0 END), 3) AS negative_share,
  ROUND(AVG(CASE WHEN e.repeat_contact_mentioned IS NULL THEN NULL WHEN e.repeat_contact_mentioned THEN 1.0 ELSE 0.0 END), 3) AS repeat_share,
  MIN(i.started_at) AS min_started_at,
  MAX(i.started_at) AS max_started_at,
  MAX(e.processed_at) AS latest_processed_at
FROM serverless_stable_prvwqx_catalog.call_insights.interactions i
LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_metrics m USING (interaction_id)
LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_enrichment e
  ON e.interaction_id = i.interaction_id AND e.error_message IS NULL
WHERE (:queue = '' OR i.queue = :queue)
  AND (:start_date = '' OR i.started_at >= TRY_CAST(CONCAT(:start_date, 'T00:00:00Z') AS TIMESTAMP))
  AND (:end_date = '' OR i.started_at < TRY_CAST(CONCAT(:end_date, 'T00:00:00Z') AS TIMESTAMP) + INTERVAL 1 DAY)
  AND (:contact_reason = '' OR e.contact_reason = :contact_reason)
  AND (:theme_id = '' OR EXISTS (SELECT 1 FROM serverless_stable_prvwqx_catalog.call_insights.theme_membership_current tm WHERE tm.interaction_id = i.interaction_id AND tm.theme_id = :theme_id))
), previous_period AS (
  SELECT COUNT(*) AS previous_interaction_count,
    ROUND(AVG(i.duration_seconds), 1) AS previous_avg_duration_seconds,
    COUNT(CASE WHEN e.sentiment_end IN ('negative', 'neutral', 'positive') THEN 1 END) AS previous_sentiment_count,
    ROUND(AVG(CASE WHEN e.sentiment_end NOT IN ('negative', 'neutral', 'positive') OR e.sentiment_end IS NULL THEN NULL WHEN e.sentiment_end = 'negative' THEN 1.0 ELSE 0.0 END), 3) AS previous_negative_share,
    COUNT(e.repeat_contact_mentioned) AS previous_repeat_evaluated_count,
    ROUND(AVG(CASE WHEN e.repeat_contact_mentioned IS NULL THEN NULL WHEN e.repeat_contact_mentioned THEN 1.0 ELSE 0.0 END), 3) AS previous_repeat_share
  FROM serverless_stable_prvwqx_catalog.call_insights.interactions i
  LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_enrichment e
    ON e.interaction_id = i.interaction_id AND e.error_message IS NULL
  CROSS JOIN window_bounds b
  WHERE (:queue = '' OR i.queue = :queue)
    AND i.started_at >= TIMESTAMPADD(DAY, -TIMESTAMPDIFF(DAY, b.period_start, b.period_end), b.period_start)
    AND i.started_at < b.period_start
    AND (:contact_reason = '' OR e.contact_reason = :contact_reason)
    AND (:theme_id = '' OR EXISTS (SELECT 1 FROM serverless_stable_prvwqx_catalog.call_insights.theme_membership_current tm WHERE tm.interaction_id = i.interaction_id AND tm.theme_id = :theme_id))
)
SELECT c.*, p.*, b.period_start, b.period_end,
  TIMESTAMPADD(DAY, -TIMESTAMPDIFF(DAY, b.period_start, b.period_end), b.period_start) AS previous_period_start
FROM current_period c CROSS JOIN previous_period p CROSS JOIN window_bounds b
