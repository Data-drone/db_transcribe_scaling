-- Masking corpus revision 2026-10-25 complete backfill refreshes cached evidence.
-- Mutation-workflow source query. All text must have a non-empty masked counterpart.
-- @param queue STRING
-- @param start_date DATE
-- @param end_date DATE
-- @param seed STRING
-- @param row_limit INT
WITH transcripts AS (
  SELECT i.interaction_id, i.queue, i.agent_name, CAST(i.started_at AS STRING) AS started_at,
    TO_JSON(SORT_ARRAY(COLLECT_LIST(NAMED_STRUCT(
      'idx', s.segment_idx, 'start', s.start_seconds, 'end', s.end_seconds,
      'role', s.speaker_role, 'text', m.text_masked
    )))) AS segments_json,
    COUNT_IF(m.text_masked IS NULL OR TRIM(m.text_masked) = '') AS withheld_count
  FROM serverless_stable_prvwqx_catalog.call_insights.interactions i
  JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_segments s USING (interaction_id)
  LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_segments_masked m
    ON m.interaction_id = s.interaction_id AND m.segment_idx = s.segment_idx
  WHERE (:queue = '' OR i.queue = :queue)
    AND DATE(i.started_at) BETWEEN :start_date AND :end_date
  GROUP BY i.interaction_id, i.queue, i.agent_name, i.started_at
  HAVING withheld_count = 0
), ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY queue ORDER BY SHA2(CONCAT(:seed, interaction_id), 256), interaction_id) AS queue_rank
  FROM transcripts
)
SELECT interaction_id, queue, agent_name, started_at, segments_json
FROM ranked
ORDER BY queue_rank, queue, interaction_id
LIMIT :row_limit
