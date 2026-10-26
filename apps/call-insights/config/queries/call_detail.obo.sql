-- @param interaction_id STRING
-- Every source authorization lookup uses the viewing user's warehouse identity.
WITH latest_enrichment AS (
  SELECT * FROM serverless_stable_prvwqx_catalog.call_insights.interaction_enrichment
  WHERE error_message IS NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY interaction_id ORDER BY processed_at DESC) = 1
)
SELECT
  i.interaction_id,
  i.started_at,
  i.duration_seconds,
  i.queue,
  i.agent_id,
  i.agent_name,
  i.customer_id,
  i.language,
  i.audio_path,
  i.transcription_status,
  m.talk_seconds_agent,
  m.talk_seconds_customer,
  m.talk_ratio_agent,
  m.silence_seconds_total,
  m.longest_silence_seconds,
  m.hold_count,
  m.turn_count,
  m.segment_count,
  m.overtalk_count,
  m.overtalk_seconds,
  e.summary,
  e.contact_reason,
  e.sentiment_start,
  e.sentiment_end,
  e.resolution_status,
  e.repeat_contact_mentioned,
  e.transfer_count,
  e.topic_phrase,
  e.ungrounded_count,
  e.model_endpoint,
  CASE WHEN e.interaction_id IS NOT NULL THEN true ELSE false END AS is_enriched
FROM serverless_stable_prvwqx_catalog.call_insights.interactions i
LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_metrics m
  USING (interaction_id)
LEFT JOIN latest_enrichment e
  ON e.interaction_id = i.interaction_id
 AND e.error_message IS NULL
WHERE i.interaction_id = :interaction_id
LIMIT 1
