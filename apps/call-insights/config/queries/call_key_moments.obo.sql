-- Masking corpus revision 2026-10-25 complete backfill refreshes cached evidence.
-- @param interaction_id STRING
-- Reveal an AI quote only when it is present in authorized masked text.
WITH latest_enrichment AS (
  SELECT e.* FROM serverless_stable_prvwqx_catalog.call_insights.interaction_enrichment e
  JOIN serverless_stable_prvwqx_catalog.call_insights.interactions i USING (interaction_id)
  WHERE e.interaction_id = :interaction_id AND e.error_message IS NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY e.interaction_id ORDER BY e.processed_at DESC) = 1
), moments AS (
  SELECT e.interaction_id, m.* FROM latest_enrichment e
  LATERAL VIEW EXPLODE(e.key_moments) t AS m
), masked AS (
  SELECT interaction_id, text_masked
  FROM serverless_stable_prvwqx_catalog.call_insights.interaction_segments_masked
  WHERE interaction_id = :interaction_id AND TRIM(text_masked) <> ''
)
SELECT
  m.label,
  m.start_seconds,
  CASE WHEN MAX(CASE WHEN m.grounded = true AND TRIM(m.quote) <> ''
    AND CONTAINS(LOWER(s.text_masked), LOWER(m.quote)) THEN 1 ELSE 0 END) = 1
    THEN m.quote ELSE NULL END AS quote,
  MAX(CASE WHEN m.grounded = true AND TRIM(m.quote) <> ''
    AND CONTAINS(LOWER(s.text_masked), LOWER(m.quote)) THEN 1 ELSE 0 END) = 1 AS grounded
FROM moments m
LEFT JOIN masked s ON s.interaction_id = m.interaction_id
WHERE m.label IS NOT NULL
GROUP BY m.label, m.start_seconds, m.quote
ORDER BY m.start_seconds
