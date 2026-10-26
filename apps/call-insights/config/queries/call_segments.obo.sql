-- Masking corpus revision 2026-10-25 complete backfill refreshes cached evidence.
-- @param interaction_id STRING
SELECT
  s.segment_idx,
  s.start_seconds,
  s.end_seconds,
  s.speaker_id,
  s.speaker_role,
  CASE WHEN TRIM(m.text_masked) <> '' THEN m.text_masked ELSE NULL END AS text,
  CASE WHEN TRIM(m.text_masked) <> '' THEN true ELSE false END AS is_masked,
  s.clip_count
FROM serverless_stable_prvwqx_catalog.call_insights.interaction_segments s
JOIN serverless_stable_prvwqx_catalog.call_insights.interactions i
  ON i.interaction_id = s.interaction_id
LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_segments_masked m
  ON m.interaction_id = s.interaction_id AND m.segment_idx = s.segment_idx
WHERE s.interaction_id = :interaction_id
ORDER BY s.segment_idx
