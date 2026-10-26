SELECT
  MIN(started_at) AS min_started_at,
  MAX(started_at) AS max_started_at,
  COUNT(*) AS interaction_count,
  COUNT(DISTINCT DATE(started_at)) AS recording_days
FROM serverless_stable_prvwqx_catalog.call_insights.interactions
