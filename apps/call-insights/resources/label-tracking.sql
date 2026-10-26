-- Tracked labels. Run once as the data owner after resources/label-tables.sql.
-- The app service principal writes subscriptions (SELECT, MODIFY on label_tracking);
-- the tracker job identity reads them and records last_run_* (SELECT, MODIFY).
-- Analysts need SELECT on label_tracking_visible only.
CREATE TABLE IF NOT EXISTS serverless_stable_prvwqx_catalog.call_insights.label_tracking (
  label_id STRING, owner_email STRING, label_name STRING, version INT, enabled BOOLEAN,
  queue STRING, start_date DATE, revision_json STRING, model_endpoint STRING,
  enabled_at TIMESTAMP, updated_at TIMESTAMP, last_run_id STRING, last_run_at TIMESTAMP
) USING DELTA;
CREATE OR REPLACE VIEW serverless_stable_prvwqx_catalog.call_insights.label_tracking_visible AS
SELECT * EXCEPT (revision_json) FROM serverless_stable_prvwqx_catalog.call_insights.label_tracking
WHERE LOWER(owner_email) = LOWER(CURRENT_USER());
