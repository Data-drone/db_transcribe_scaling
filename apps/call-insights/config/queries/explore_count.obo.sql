-- Masking corpus revision 2026-10-25 complete backfill refreshes cached evidence.
-- @param queue STRING
-- @param start_date STRING
-- @param end_date STRING
-- @param min_silence DOUBLE
-- @param search_text STRING
-- @param contact_reason STRING
-- @param sentiment STRING
-- @param enriched_only STRING
WITH mask_inventory AS (
  SELECT s.interaction_id,
    COUNT(DISTINCT s.segment_idx) AS segment_count,
    COUNT(DISTINCT CASE WHEN NULLIF(TRIM(sm.text_masked), '') IS NOT NULL THEN s.segment_idx END) AS masked_count
  FROM serverless_stable_prvwqx_catalog.call_insights.interaction_segments s
  LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_segments_masked sm
    ON sm.interaction_id = s.interaction_id AND sm.segment_idx = s.segment_idx
  GROUP BY s.interaction_id
), masked_previews AS (
  SELECT s.interaction_id, s.start_seconds, sm.text_masked,
    MAX(CASE WHEN CONTAINS(LOWER(sm.text_masked), LOWER(:search_text)) THEN 1 ELSE 0 END)
      OVER (PARTITION BY s.interaction_id) AS keyword_match,
    ROW_NUMBER() OVER (
      PARTITION BY s.interaction_id
      ORDER BY CASE WHEN :search_text <> '' AND CONTAINS(LOWER(sm.text_masked), LOWER(:search_text)) THEN 0 ELSE 1 END, s.segment_idx
    ) AS preview_rank
  FROM serverless_stable_prvwqx_catalog.call_insights.interaction_segments s
  JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_segments_masked sm
    ON sm.interaction_id = s.interaction_id AND sm.segment_idx = s.segment_idx
  WHERE NULLIF(TRIM(sm.text_masked), '') IS NOT NULL
), scoped AS (
  SELECT i.interaction_id, i.started_at, i.queue, i.agent_name,
    ROUND(i.duration_seconds, 1) AS duration_seconds,
    ROUND(m.longest_silence_seconds, 1) AS longest_silence_seconds,
    CASE WHEN e.error_message IS NULL THEN e.contact_reason END AS contact_reason,
    CASE WHEN e.error_message IS NULL THEN e.sentiment_end END AS sentiment_end,
    CASE WHEN e.error_message IS NULL THEN e.resolution_status END AS resolution_status,
    CASE WHEN e.interaction_id IS NOT NULL AND e.error_message IS NULL THEN true ELSE false END AS is_enriched,
    CASE WHEN e.interaction_id IS NULL THEN 'pending' WHEN e.error_message IS NOT NULL THEN 'failed' ELSE 'complete' END AS enrichment_status,
    CASE WHEN e.error_message IS NULL THEN e.processed_at END AS processed_at,
    CASE WHEN COALESCE(mi.masked_count, 0) = 0 THEN 'pending'
         WHEN mi.masked_count < mi.segment_count THEN 'partial' ELSE 'complete' END AS masking_state,
    SUBSTRING(p.text_masked, GREATEST(1, LOCATE(LOWER(:search_text), LOWER(p.text_masked)) - 80), 420) AS matched_text,
    p.start_seconds AS match_start_seconds,
    p.keyword_match
  FROM serverless_stable_prvwqx_catalog.call_insights.interactions i
  LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_metrics m USING (interaction_id)
  LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_enrichment e ON e.interaction_id = i.interaction_id
  LEFT JOIN mask_inventory mi ON mi.interaction_id = i.interaction_id
  LEFT JOIN masked_previews p ON p.interaction_id = i.interaction_id AND p.preview_rank = 1
  WHERE (:queue = '' OR i.queue = :queue)
  AND (:start_date = '' OR i.started_at >= TRY_CAST(CONCAT(:start_date, 'T00:00:00Z') AS TIMESTAMP))
  AND (:end_date = '' OR i.started_at < TRY_CAST(CONCAT(:end_date, 'T00:00:00Z') AS TIMESTAMP) + INTERVAL 1 DAY)
), filtered AS (
  SELECT * FROM scoped
  WHERE COALESCE(longest_silence_seconds, 0) >= :min_silence
    AND (:contact_reason = '' OR contact_reason = :contact_reason)
    AND (:sentiment = '' OR sentiment_end = :sentiment)
    AND (:enriched_only <> 'true' OR is_enriched)
    AND (:search_text = '' OR keyword_match = 1)
)
SELECT COUNT(*) AS total_count,
  COUNT(CASE WHEN is_enriched THEN 1 END) AS enriched_count,
  COUNT(CASE WHEN masking_state = 'complete' THEN 1 END) AS masked_complete_count,
  (SELECT COUNT(*) FROM scoped) AS scope_count,
  (SELECT COUNT(CASE WHEN is_enriched THEN 1 END) FROM scoped) AS scope_enriched_count,
  MAX(processed_at) AS latest_processed_at
FROM filtered
