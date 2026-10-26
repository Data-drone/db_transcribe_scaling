SELECT
  i.queue,
  COUNT(*) AS interaction_count,
  COUNT(DISTINCT i.agent_id) AS agent_count,
  ROUND(AVG(i.duration_seconds), 1) AS avg_duration_seconds,
  ROUND(AVG(m.talk_ratio_agent), 3) AS avg_agent_talk_ratio,
  ROUND(AVG(m.silence_seconds_total), 1) AS avg_silence_seconds,
  ROUND(AVG(m.turn_count), 1) AS avg_turn_count,
  ROUND(AVG(CASE WHEN m.overtalk_count > 0 THEN 1.0 ELSE 0.0 END), 3) AS overtalk_call_share
FROM serverless_stable_prvwqx_catalog.call_insights.interactions i
JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_metrics m
  USING (interaction_id)
GROUP BY i.queue
ORDER BY interaction_count DESC
