-- @param refresh_nonce STRING
-- @param label_id STRING
SELECT label_id, version, enabled, CAST(enabled_at AS STRING) AS enabled_at,
  COALESCE(CAST(last_run_at AS STRING), '') AS last_run_at
FROM serverless_stable_prvwqx_catalog.call_insights.label_tracking_visible
WHERE :refresh_nonce <> '' AND (:label_id = '' OR label_id = :label_id) AND LOWER(owner_email) = LOWER(CURRENT_USER())
ORDER BY label_id
LIMIT 200
