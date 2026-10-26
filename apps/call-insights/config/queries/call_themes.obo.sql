-- @param interaction_id STRING
SELECT t.theme_id, t.name
FROM serverless_stable_prvwqx_catalog.call_insights.theme_membership_current m
JOIN serverless_stable_prvwqx_catalog.call_insights.themes_current t ON t.theme_id = m.theme_id
JOIN serverless_stable_prvwqx_catalog.call_insights.interactions i ON i.interaction_id = m.interaction_id
WHERE m.interaction_id = :interaction_id
ORDER BY m.distance ASC NULLS LAST, t.theme_id
