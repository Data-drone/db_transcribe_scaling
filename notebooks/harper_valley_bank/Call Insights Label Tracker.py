# Databricks notebook source
# MAGIC %md
# MAGIC # Call Insights label tracker
# MAGIC Daily incremental evaluation of tracked labels.
# MAGIC
# MAGIC For each enabled row in `label_tracking`, this notebook freezes the completely masked calls in the label's queue
# MAGIC scope that the same label version has **not** yet evaluated (by a full or tracking run), records a `tracking` run,
# MAGIC and evaluates it with the existing `Call Insights Label Worker` notebook. Results therefore use the same structured
# MAGIC output, grounding check and error handling as analyst-started runs.
# MAGIC
# MAGIC **Identity:** this job runs as its configured run-as identity, not as the label owner. The app only lets an owner
# MAGIC enable tracking after a completed full run and an on-behalf-of check that they can read the scope. Owners only see
# MAGIC results through the owner-filtered `*_visible` views, and result pages re-join the source calls under the viewer's
# MAGIC own permissions. Treat the run-as identity's source access as an approved shared entitlement.

# COMMAND ----------
import hashlib
import json
import re
import uuid

for name, default in [
    ("catalog", "serverless_stable_prvwqx_catalog"),
    ("schema", "call_insights"),
    ("max_per_label", "2000"),
    ("daily_token_budget", "5000000"),
    ("worker_notebook", "./Call Insights Label Worker"),
]:
    dbutils.widgets.text(name, default)

catalog = dbutils.widgets.get("catalog").strip()
schema = dbutils.widgets.get("schema").strip()
assert re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", catalog) and re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", schema)
fq = f"`{catalog}`.`{schema}`"
MAX_PER_LABEL = max(1, min(100000, int(dbutils.widgets.get("max_per_label"))))
BUDGET = int(dbutils.widgets.get("daily_token_budget"))
WORKER = dbutils.widgets.get("worker_notebook").strip()

spark.sql(f"""CREATE TABLE IF NOT EXISTS {fq}.label_tracking (
  label_id STRING, owner_email STRING, label_name STRING, version INT, enabled BOOLEAN,
  queue STRING, start_date DATE, revision_json STRING, model_endpoint STRING,
  enabled_at TIMESTAMP, updated_at TIMESTAMP, last_run_id STRING, last_run_at TIMESTAMP) USING DELTA""")

# COMMAND ----------
CANDIDATES = f"""
WITH evaluated AS (
  SELECT DISTINCT x.interaction_id
  FROM {fq}.label_runs r JOIN {fq}.label_results x USING (run_id)
  WHERE r.label_id = :label AND r.version = :version AND r.owner_email = :owner
    AND r.run_type IN ('full', 'tracking') AND x.error_message IS NULL
), in_flight AS (
  SELECT DISTINCT s.interaction_id
  FROM {fq}.label_runs r JOIN {fq}.label_run_scope s USING (run_id)
  WHERE r.label_id = :label AND r.version = :version AND r.owner_email = :owner
    AND r.status IN ('pending', 'running')
), transcripts AS (
  SELECT i.interaction_id, i.queue, i.agent_name, CAST(i.started_at AS STRING) AS started_at, i.started_at AS started_ts,
    TO_JSON(SORT_ARRAY(COLLECT_LIST(NAMED_STRUCT(
      'idx', s.segment_idx, 'start', s.start_seconds, 'end', s.end_seconds,
      'role', s.speaker_role, 'text', m.text_masked)))) AS segments_json,
    COUNT_IF(m.text_masked IS NULL OR TRIM(m.text_masked) = '') AS withheld_count
  FROM {fq}.interactions i
  JOIN {fq}.interaction_segments s USING (interaction_id)
  LEFT JOIN {fq}.interaction_segments_masked m ON m.interaction_id = s.interaction_id AND m.segment_idx = s.segment_idx
  WHERE (:queue = '' OR i.queue = :queue) AND DATE(i.started_at) >= :start_date
  GROUP BY i.interaction_id, i.queue, i.agent_name, i.started_at
  HAVING withheld_count = 0
)
SELECT t.interaction_id, t.queue, t.agent_name, t.started_at, t.segments_json
FROM transcripts t
LEFT ANTI JOIN evaluated e ON e.interaction_id = t.interaction_id
LEFT ANTI JOIN in_flight f ON f.interaction_id = t.interaction_id
ORDER BY t.started_ts, t.interaction_id
LIMIT {MAX_PER_LABEL}
"""

summary = []
for t in spark.sql(f"SELECT * FROM {fq}.label_tracking WHERE enabled").collect():
    label = t.asDict()
    args = {"label": label["label_id"], "version": label["version"], "owner": label["owner_email"],
            "queue": label["queue"] or "", "start_date": label["start_date"] or "1900-01-01"}
    candidates = spark.sql(CANDIDATES, args=args).collect()
    if not candidates:
        spark.sql(f"UPDATE {fq}.label_tracking SET last_run_at = current_timestamp() WHERE label_id = :label AND owner_email = :owner", args=args)
        summary.append({"label_id": label["label_id"], "new_calls": 0})
        continue
    revision = label["revision_json"]
    estimated = sum((len(c.segments_json) + len(revision)) // 4 + 300 for c in candidates)
    used = spark.sql(f"""SELECT COALESCE(SUM(estimated_tokens), 0) AS tokens FROM {fq}.label_runs
      WHERE owner_email = :owner AND started_at >= current_timestamp() - INTERVAL 1 DAY""", args=args).first().tokens
    if used + estimated > BUDGET:
        summary.append({"label_id": label["label_id"], "skipped": "daily token budget", "new_calls": len(candidates)})
        continue
    run_id = str(uuid.uuid4())
    spark.sql(f"""INSERT INTO {fq}.label_runs (run_id, label_id, version, owner_email, run_type, status, interactions_in_scope,
        processed_count, matched_count, error_count, ungrounded_count, estimated_tokens, model_endpoint, revision_json, started_at)
      VALUES (:run, :label, :version, :owner, 'tracking', 'pending', :count, 0, 0, 0, 0, :tokens, :model, :revision, current_timestamp())""",
              args={**args, "run": run_id, "count": len(candidates), "tokens": estimated, "model": label["model_endpoint"], "revision": revision})
    rows = [(run_id, c.interaction_id, c.queue, c.agent_name, c.started_at, c.segments_json,
             hashlib.sha256(c.segments_json.encode()).hexdigest()) for c in candidates]
    spark.createDataFrame(rows, spark.table(f"{fq}.label_run_scope").schema).write.mode("append").saveAsTable(f"{fq}.label_run_scope")
    try:
        dbutils.notebook.run(WORKER, 7200, {"run_id": run_id, "catalog": catalog, "schema": schema, "execution_id": f"tracker-{run_id}"})
    except Exception as exc:  # The worker records its own failure; keep tracking other labels.
        summary.append({"label_id": label["label_id"], "run_id": run_id, "error": str(exc)[:300]})
    spark.sql(f"""UPDATE {fq}.label_tracking SET last_run_id = :run, last_run_at = current_timestamp()
      WHERE label_id = :label AND owner_email = :owner""", args={**args, "run": run_id})
    summary.append({"label_id": label["label_id"], "run_id": run_id, "new_calls": len(candidates)})

print(json.dumps(summary, indent=2))
dbutils.notebook.exit(json.dumps({"labels": len(summary), "runs": sum(1 for s in summary if s.get("run_id"))}))
