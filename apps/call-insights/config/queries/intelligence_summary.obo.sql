-- @param refresh_nonce STRING
WITH ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY label_id ORDER BY started_at DESC, run_id) AS rank
  FROM serverless_stable_prvwqx_catalog.call_insights.label_runs_visible
  WHERE :refresh_nonce <> '' AND LOWER(owner_email)=LOWER(CURRENT_USER())
), feedback AS (
  SELECT run_id, COUNT(*) AS reviewed_count, COUNT_IF(verdict='correct') AS correct_count
  FROM serverless_stable_prvwqx_catalog.call_insights.label_feedback_visible
  GROUP BY run_id
)
SELECT r.label_id, r.version, r.run_type, r.status, CAST(r.started_at AS STRING) AS started_at,
  r.interactions_in_scope, r.matched_count,
  COALESCE(f.reviewed_count,0) AS reviewed_count, COALESCE(f.correct_count,0) AS correct_count
FROM ranked r LEFT JOIN feedback f USING (run_id)
WHERE r.rank=1
ORDER BY r.started_at DESC
LIMIT 200
