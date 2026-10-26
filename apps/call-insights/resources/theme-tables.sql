-- Theme storage for Call Insights. Run once as the data owner before `pnpm run typegen`
-- (type generation describes queries that read these views). The theme builder notebook
-- also creates the tables if they are missing.
-- Analysts need SELECT on the *_current views only, plus their own source-table grants.
-- Theme queries join `interactions` under the viewer's identity, so counts never include
-- calls the viewer cannot read.
-- Upgrading from an earlier version: ALTER TABLE ... theme_membership ADD COLUMNS (map_x DOUBLE, map_y DOUBLE),
-- then re-run this file to refresh the views.
CREATE TABLE IF NOT EXISTS serverless_stable_prvwqx_catalog.call_insights.theme_runs (
  run_id STRING, created_at TIMESTAMP, status STRING, method STRING,
  embedding_endpoint STRING, naming_endpoint STRING, k INT, silhouette DOUBLE,
  calls_themed BIGINT, purity DOUBLE, notes STRING
) USING DELTA;
CREATE TABLE IF NOT EXISTS serverless_stable_prvwqx_catalog.call_insights.themes (
  theme_id STRING, run_id STRING, name STRING, description STRING, size BIGINT,
  centroid ARRAY<DOUBLE>, created_at TIMESTAMP
) USING DELTA;
CREATE TABLE IF NOT EXISTS serverless_stable_prvwqx_catalog.call_insights.theme_membership (
  run_id STRING, theme_id STRING, interaction_id STRING, distance DOUBLE,
  map_x DOUBLE, map_y DOUBLE
) USING DELTA;
CREATE OR REPLACE VIEW serverless_stable_prvwqx_catalog.call_insights.theme_run_current AS
SELECT * FROM serverless_stable_prvwqx_catalog.call_insights.theme_runs
WHERE status = 'completed'
QUALIFY ROW_NUMBER() OVER (ORDER BY created_at DESC, run_id) = 1;
CREATE OR REPLACE VIEW serverless_stable_prvwqx_catalog.call_insights.themes_current AS
SELECT t.theme_id, t.run_id, t.name, t.description, t.size, t.created_at
FROM serverless_stable_prvwqx_catalog.call_insights.themes t
JOIN serverless_stable_prvwqx_catalog.call_insights.theme_run_current r USING (run_id);
CREATE OR REPLACE VIEW serverless_stable_prvwqx_catalog.call_insights.theme_membership_current AS
SELECT m.run_id, m.theme_id, m.interaction_id, m.distance, m.map_x, m.map_y
FROM serverless_stable_prvwqx_catalog.call_insights.theme_membership m
JOIN serverless_stable_prvwqx_catalog.call_insights.theme_run_current r USING (run_id);
