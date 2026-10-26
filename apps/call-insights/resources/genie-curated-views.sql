-- LOCAL PROPOSAL ONLY. Create these views only after approval of the Genie proposal.
-- Grant named pilot analysts SELECT on these views, never the raw transcript tables
-- merely to enable Genie. View access is an explicit governed data entitlement.
CREATE OR REPLACE VIEW serverless_stable_prvwqx_catalog.call_insights.genie_calls_masked
COMMENT 'One row per recorded call. Metadata covers the corpus; generated annotations are available only for completely masked successful calls. No customer identity, raw transcript or audio path. Recording dates are original 2020 dates, not ingestion time.'
AS
WITH masking AS (
  SELECT s.interaction_id, COUNT(*) AS segment_count,
    COUNT_IF(NULLIF(TRIM(m.text_masked), '') IS NOT NULL) AS masked_segment_count
  FROM serverless_stable_prvwqx_catalog.call_insights.interaction_segments s
  LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_segments_masked m
    ON m.interaction_id=s.interaction_id AND m.segment_idx=s.segment_idx
  GROUP BY s.interaction_id
), latest_enrichment AS (
  SELECT e.* FROM serverless_stable_prvwqx_catalog.call_insights.interaction_enrichment e
  WHERE e.error_message IS NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY e.interaction_id ORDER BY e.processed_at DESC) = 1
)
SELECT i.interaction_id, i.started_at, i.queue, i.duration_seconds,
  COALESCE(k.segment_count, 0) AS segment_count,
  COALESCE(k.masked_segment_count, 0) AS masked_segment_count,
  CASE WHEN COALESCE(k.masked_segment_count, 0)=0 THEN 'pending'
       WHEN k.masked_segment_count<k.segment_count THEN 'partial' ELSE 'complete' END AS masking_state,
  COALESCE(k.segment_count>0 AND k.masked_segment_count=k.segment_count AND e.interaction_id IS NOT NULL, FALSE) AS is_enriched,
  CASE WHEN k.masked_segment_count=k.segment_count THEN e.summary END AS ai_summary,
  CASE WHEN k.masked_segment_count=k.segment_count THEN e.contact_reason END AS ai_contact_reason,
  CASE WHEN k.masked_segment_count=k.segment_count THEN e.sentiment_start END AS ai_sentiment_start,
  CASE WHEN k.masked_segment_count=k.segment_count THEN e.sentiment_end END AS ai_sentiment_end,
  CASE WHEN k.masked_segment_count=k.segment_count THEN e.resolution_status END AS ai_resolution_status,
  CASE WHEN k.masked_segment_count=k.segment_count THEN e.repeat_contact_mentioned END AS ai_repeat_contact_mentioned,
  CASE WHEN k.masked_segment_count=k.segment_count THEN e.processed_at END AS enriched_at,
  t.longest_silence_seconds, t.silence_seconds_total
FROM serverless_stable_prvwqx_catalog.call_insights.interactions i
LEFT JOIN masking k ON k.interaction_id=i.interaction_id
LEFT JOIN latest_enrichment e ON e.interaction_id=i.interaction_id
LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_metrics t ON t.interaction_id=i.interaction_id;

CREATE OR REPLACE VIEW serverless_stable_prvwqx_catalog.call_insights.genie_segments_masked
COMMENT 'One row per original timed speaker turn of a completely masked call. text_masked is the only transcript text exposed; timestamps use the original stereo audio timeline. Transcript remains machine recognition, not a verified quotation of the recording.'
AS
WITH complete_calls AS (
  SELECT s.interaction_id
  FROM serverless_stable_prvwqx_catalog.call_insights.interaction_segments s
  LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_segments_masked m
    ON m.interaction_id=s.interaction_id AND m.segment_idx=s.segment_idx
  GROUP BY s.interaction_id
  HAVING COUNT_IF(NULLIF(TRIM(m.text_masked), '') IS NULL)=0
)
SELECT s.interaction_id, s.segment_idx, s.start_seconds, s.end_seconds,
  s.speaker_role, m.text_masked
FROM serverless_stable_prvwqx_catalog.call_insights.interaction_segments s
JOIN complete_calls c ON c.interaction_id=s.interaction_id
JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_segments_masked m
  ON m.interaction_id=s.interaction_id AND m.segment_idx=s.segment_idx
WHERE NULLIF(TRIM(m.text_masked), '') IS NOT NULL;
