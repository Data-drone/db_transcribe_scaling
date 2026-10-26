# Databricks notebook source
# MAGIC %md
# MAGIC # Transcribe one HarperValleyBank chunk through Model Serving
# MAGIC Open this notebook from a Databricks Git folder containing this subproject.
# MAGIC Use CPU/serverless notebook compute with `databricks-sdk==0.97.0` in its environment.
# MAGIC The model runs on the endpoint's GPU. This notebook reads one existing chunk and displays
# MAGIC the result; it does not write or replace any source or transcription tables.

# COMMAND ----------

from pathlib import Path

dbutils.widgets.text("endpoint", "brian-qwen3-transcription-dev")
dbutils.widgets.text("catalog", "serverless_stable_prvwqx_catalog")
dbutils.widgets.text("schema", "call_insights")
dbutils.widgets.text("serving_code_dir", str(Path.cwd().parent))

# COMMAND ----------

import json
import sys

from databricks.sdk import WorkspaceClient
from pyspark.sql import functions as F

code_dir = Path(dbutils.widgets.get("serving_code_dir"))
if not all((code_dir / name).is_file() for name in ("runtime.py", "query.py")):
    raise ValueError("Set serving_code_dir to this repository's models/transcription directory in /Workspace")
sys.path.insert(0, str(code_dir))

from query import query_chunks
from runtime import registered_name, request_from_file

table = registered_name(f"{dbutils.widgets.get('catalog')}.{dbutils.widgets.get('schema')}.hvb_speech_chunks")
chunk = (
    spark.table(table)
    .filter((F.col("clip_seconds").between(2.0, 15.0)) & (F.col("speaker_role") == "agent"))
    .select("chunk_id", "chunk_path", "speaker_role", "clip_offset_seconds")
    .orderBy("chunk_id")
    .first()
)
if chunk is None:
    raise ValueError("No eligible short agent chunks found; run the HarperValleyBank preparation notebook first")

# COMMAND ----------

request = request_from_file(
    chunk.chunk_path,
    chunk.chunk_id,
    speaker_role=chunk.speaker_role,
    offset_seconds=float(chunk.clip_offset_seconds),
)
prediction = query_chunks(WorkspaceClient(), dbutils.widgets.get("endpoint"), [request])[0]
result = json.loads(prediction["result_json"])
print(json.dumps({"chunk_id": prediction["chunk_id"], "status": prediction["status"], **result}, indent=2))
if prediction["status"] == "error":
    raise RuntimeError(result["error_message"])

# COMMAND ----------

# MAGIC %md
# MAGIC Segment times already include `clip_offset_seconds` and refer to the call timeline.
# MAGIC Do not add the offset again when writing downstream tables. Known channel roles are
# MAGIC carried through to `speaker_id`; this endpoint does not infer speaker identity.
# MAGIC Batch scheduling, durable results and the alternate backend in the main pipeline
# MAGIC remain separate integration work.

# COMMAND ----------

segments = result["response"]["segments"]
if segments:
    display(spark.createDataFrame(segments))

# COMMAND ----------

dbutils.notebook.exit(json.dumps({"chunk_id": prediction["chunk_id"], "status": prediction["status"],
                                 "result": result}))
