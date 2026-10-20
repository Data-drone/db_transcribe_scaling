# Databricks notebook source
# DBTITLE 1,AMI Corpus Data Loader
# MAGIC %md
# MAGIC # AMI Corpus Data Loader
# MAGIC
# MAGIC Downloads audio segments from the [AMI Meeting Corpus](https://huggingface.co/datasets/edinburghcstr/ami) (HuggingFace `edinburghcstr/ami`) and loads them into Unity Catalog as WAV files in a volume plus a metadata Delta table.
# MAGIC
# MAGIC **Source:** IHM (Individual Headset Microphone) config — close-talk recordings of real meetings.
# MAGIC
# MAGIC Adjust `MAX_SAMPLES` in Step 1 to control how many segments are loaded. Set to `None` to load an entire parquet shard (~3,161 segments).

# COMMAND ----------

# DBTITLE 1,Step 1: Configuration
# ---- Configuration ----
CATALOG  = "serverless_stable_prvwqx_catalog"
SCHEMA   = "audio_parsing"
VOLUME   = "ami_audio"

# Number of audio segments to download.
# Set to None to load the entire parquet shard (~3,161 segments).
MAX_SAMPLES = 20

# Which parquet shard to download (IHM test split)
SHARD_FILE = "ihm/test-00000-of-00004.parquet"

# ---- Derived paths ----
VOLUME_PATH = f"/Volumes/{CATALOG}/{SCHEMA}/{VOLUME}"
FULL_TABLE  = f"{CATALOG}.{SCHEMA}.ami_meeting_audio"

# COMMAND ----------

# DBTITLE 1,Step 2: Create Schema and Volume
# MAGIC %sql
# MAGIC CREATE SCHEMA IF NOT EXISTS serverless_stable_prvwqx_catalog.audio_parsing
# MAGIC   COMMENT 'AMI Meeting Corpus audio parsing project';
# MAGIC
# MAGIC CREATE VOLUME IF NOT EXISTS serverless_stable_prvwqx_catalog.audio_parsing.ami_audio
# MAGIC   COMMENT 'Raw WAV audio files from the AMI Meeting Corpus';

# COMMAND ----------

# DBTITLE 1,Step 3: Install Dependencies
# MAGIC %pip install huggingface_hub -q
# MAGIC dbutils.library.restartPython()

# COMMAND ----------

# DBTITLE 1,Step 4: Download and Extract Audio
from huggingface_hub import hf_hub_download
import pyarrow.parquet as pq
import pandas as pd
import os, time

# Re-read config after kernel restart
CATALOG     = "serverless_stable_prvwqx_catalog"
SCHEMA      = "audio_parsing"
VOLUME      = "ami_audio"
MAX_SAMPLES = 20          # <-- change this to scale up
SHARD_FILE  = "ihm/test-00000-of-00004.parquet"
VOLUME_PATH = f"/Volumes/{CATALOG}/{SCHEMA}/{VOLUME}"
FULL_TABLE  = f"{CATALOG}.{SCHEMA}.ami_meeting_audio"

# --- Download parquet shard from HuggingFace ---
print(f"Downloading {SHARD_FILE} from edinburghcstr/ami ...")
t0 = time.time()
local_path = hf_hub_download(
    repo_id="edinburghcstr/ami",
    filename=SHARD_FILE,
    repo_type="dataset",
    cache_dir="/tmp/ami_cache",
)
print(f"Downloaded {os.path.getsize(local_path)/1024/1024:.1f} MB in {time.time()-t0:.1f}s")

# --- Read parquet and extract audio ---
df = pd.read_parquet(local_path)
total_available = len(df)
if MAX_SAMPLES is not None:
    df = df.head(MAX_SAMPLES)
print(f"\nShard contains {total_available:,} segments total")
print(f"Extracting {len(df)} segments to {VOLUME_PATH} ...")

t0 = time.time()
metadata_rows = []
for idx, row in df.iterrows():
    audio_bytes = row["audio"]["bytes"]
    safe_name = (
        f"{row['meeting_id']}_{row['audio_id']}_{row['speaker_id']}.wav"
        .replace("/", "_")
    )
    filepath = os.path.join(VOLUME_PATH, safe_name)

    with open(filepath, "wb") as f:
        f.write(audio_bytes)

    metadata_rows.append((
        safe_name, filepath, row["meeting_id"], row["audio_id"],
        row["speaker_id"], row["microphone_id"],
        float(row["begin_time"]), float(row["end_time"]), row["text"],
    ))

elapsed = time.time() - t0
print(f"\n✓ Wrote {len(metadata_rows)} WAV files in {elapsed:.1f}s")
print(f"  Volume: {VOLUME_PATH}")
for m in metadata_rows[:3]:
    print(f"  {m[0]}  ({m[7]-m[6]:.1f}s)  {m[8][:60]}")

# COMMAND ----------

# DBTITLE 1,Step 5: Create Metadata Delta Table
from pyspark.sql.types import StructType, StructField, StringType, FloatType

schema = StructType([
    StructField("file_name",      StringType()),
    StructField("file_path",      StringType()),
    StructField("meeting_id",     StringType()),
    StructField("audio_id",       StringType()),
    StructField("speaker_id",     StringType()),
    StructField("microphone_id",  StringType()),
    StructField("begin_time",     FloatType()),
    StructField("end_time",       FloatType()),
    StructField("reference_text", StringType()),
])

CATALOG = "serverless_stable_prvwqx_catalog"
SCHEMA  = "audio_parsing"
FULL_TABLE = f"{CATALOG}.{SCHEMA}.ami_meeting_audio"

metadata_df = spark.createDataFrame(metadata_rows, schema=schema)
metadata_df.write.mode("overwrite").saveAsTable(FULL_TABLE)

print(f"✓ Table created: {FULL_TABLE}")
print(f"  Row count: {spark.table(FULL_TABLE).count():,}")
display(spark.table(FULL_TABLE).limit(10))

# COMMAND ----------

# DBTITLE 1,Step 6: Verify Data
# MAGIC %sql
# MAGIC -- Quick verification: count, distinct meetings, speakers, avg duration
# MAGIC SELECT
# MAGIC   COUNT(*)                                       AS total_segments,
# MAGIC   COUNT(DISTINCT meeting_id)                     AS distinct_meetings,
# MAGIC   COUNT(DISTINCT speaker_id)                     AS distinct_speakers,
# MAGIC   ROUND(AVG(end_time - begin_time), 2)           AS avg_duration_sec,
# MAGIC   ROUND(SUM(end_time - begin_time) / 60, 1)      AS total_audio_min
# MAGIC FROM serverless_stable_prvwqx_catalog.audio_parsing.ami_meeting_audio