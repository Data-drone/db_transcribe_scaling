# Databricks notebook source
# DBTITLE 1,AMI Transcription Scale Testing
# MAGIC %md
# MAGIC # AMI Transcription Scale Testing
# MAGIC
# MAGIC Benchmarks `ai_transcribe` at increasing data volumes using the AMI Meeting Corpus.
# MAGIC
# MAGIC **Prerequisites:**
# MAGIC * Run the **AMI Corpus Data Loader** notebook first with the desired `MAX_SAMPLES` to populate the volume and metadata table.
# MAGIC * **AI Transcribe Preview** must be enabled by a workspace admin.
# MAGIC
# MAGIC | Tier | Segments | ∼ Audio |
# MAGIC |------|----------|--------|
# MAGIC | Quick | 100 | 3 min |
# MAGIC | Medium | 500 | 17 min |
# MAGIC | Large | 3,161 | 1.8 hr |
# MAGIC | Full test | 12,644 | 7 hr |

# COMMAND ----------

# DBTITLE 1,Step 1: Configuration
CATALOG = "serverless_stable_prvwqx_catalog"
SCHEMA  = "audio_parsing"
VOLUME  = "ami_audio"

VOLUME_PATH   = f"/Volumes/{CATALOG}/{SCHEMA}/{VOLUME}"
RAW_TABLE     = f"{CATALOG}.{SCHEMA}.ami_transcriptions_raw"
SEGMENT_TABLE = f"{CATALOG}.{SCHEMA}.ami_transcriptions"
META_TABLE    = f"{CATALOG}.{SCHEMA}.ami_meeting_audio"

# COMMAND ----------

# DBTITLE 1,Step 2: Check Current Data Volume
# MAGIC %sql
# MAGIC -- How much data is in the volume and metadata table right now?
# MAGIC SELECT
# MAGIC   (SELECT COUNT(*) FROM serverless_stable_prvwqx_catalog.audio_parsing.ami_meeting_audio) AS metadata_rows,
# MAGIC   (SELECT ROUND(SUM(end_time - begin_time) / 60, 1)
# MAGIC    FROM serverless_stable_prvwqx_catalog.audio_parsing.ami_meeting_audio) AS total_audio_min

# COMMAND ----------

# DBTITLE 1,Step 3: Timed Transcription Run
import time

CATALOG = "serverless_stable_prvwqx_catalog"
SCHEMA  = "audio_parsing"
RAW_TABLE = f"{CATALOG}.{SCHEMA}.ami_transcriptions_raw"

print("Starting ai_transcribe on all files in the volume...")
t0 = time.time()

spark.sql(f"""
  CREATE OR REPLACE TABLE {RAW_TABLE} AS
  SELECT
    path,
    ai_transcribe(content) AS result
  FROM READ_FILES(
    '/Volumes/{CATALOG}/{SCHEMA}/ami_audio/',
    format => 'binaryFile'
  )
""")

transcribe_elapsed = time.time() - t0
total_files = spark.table(RAW_TABLE).count()

print(f"\n✓ Transcription complete")
print(f"  Files processed:   {total_files}")
print(f"  Wall-clock time:   {transcribe_elapsed:.1f}s ({transcribe_elapsed/60:.1f} min)")
if total_files > 0:
    print(f"  Avg per file:      {transcribe_elapsed/total_files:.2f}s")

# COMMAND ----------

# DBTITLE 1,Step 4: Extract Segments (timed)
import time

CATALOG = "serverless_stable_prvwqx_catalog"
SCHEMA  = "audio_parsing"
RAW_TABLE     = f"{CATALOG}.{SCHEMA}.ami_transcriptions_raw"
SEGMENT_TABLE = f"{CATALOG}.{SCHEMA}.ami_transcriptions"

t0 = time.time()

spark.sql(f"""
  CREATE OR REPLACE TABLE {SEGMENT_TABLE} AS
  WITH segments AS (
    SELECT
      t.path,
      segment.value:start::DOUBLE    AS start_seconds,
      segment.value:end::DOUBLE      AS end_seconds,
      segment.value:speaker_id::STRING AS speaker_id,
      segment.value:text::STRING     AS segment_text
    FROM {RAW_TABLE} t,
         LATERAL variant_explode(t.result:response.segments) AS segment
    WHERE t.result:response IS NOT NULL
  ),
  full_texts AS (
    SELECT path, CONCAT_WS(' ', COLLECT_LIST(segment_text)) AS full_text
    FROM segments
    GROUP BY path
  )
  SELECT s.path, ft.full_text, s.start_seconds, s.end_seconds,
         s.speaker_id, s.segment_text
  FROM segments s
  JOIN full_texts ft ON s.path = ft.path
""")

segment_elapsed = time.time() - t0
segment_count = spark.table(SEGMENT_TABLE).count()

print(f"✓ Segment extraction: {segment_count} segments in {segment_elapsed:.1f}s")

# COMMAND ----------

# DBTITLE 1,Step 5: Throughput and Error Analysis
# MAGIC %sql
# MAGIC -- Success vs error breakdown + throughput metrics
# MAGIC WITH stats AS (
# MAGIC   SELECT
# MAGIC     COUNT(*) AS total_files,
# MAGIC     SUM(CASE WHEN result:response IS NOT NULL THEN 1 ELSE 0 END) AS succeeded,
# MAGIC     SUM(CASE WHEN result:response IS NULL THEN 1 ELSE 0 END) AS errored,
# MAGIC     SUM(result:metadata.input_duration_seconds::DOUBLE) AS total_input_seconds
# MAGIC   FROM serverless_stable_prvwqx_catalog.audio_parsing.ami_transcriptions_raw
# MAGIC )
# MAGIC SELECT
# MAGIC   total_files,
# MAGIC   succeeded,
# MAGIC   errored,
# MAGIC   ROUND(100.0 * succeeded / total_files, 1) AS success_pct,
# MAGIC   ROUND(total_input_seconds, 1) AS total_input_sec,
# MAGIC   ROUND(total_input_seconds / 60, 1) AS total_input_min
# MAGIC FROM stats

# COMMAND ----------

# DBTITLE 1,Step 6: Error Details
# MAGIC %sql
# MAGIC -- What errors occurred?
# MAGIC SELECT
# MAGIC   result:error_message::STRING AS error_message,
# MAGIC   COUNT(*) AS occurrences
# MAGIC FROM serverless_stable_prvwqx_catalog.audio_parsing.ami_transcriptions_raw
# MAGIC WHERE result:response IS NULL
# MAGIC GROUP BY 1
# MAGIC ORDER BY 2 DESC

# COMMAND ----------

# DBTITLE 1,Step 7: Similarity Score Distribution
# MAGIC %sql
# MAGIC -- Compare transcriptions to reference text at scale
# MAGIC WITH compared AS (
# MAGIC   SELECT
# MAGIC     m.meeting_id,
# MAGIC     m.speaker_id,
# MAGIC     m.reference_text,
# MAGIC     t.full_text AS transcribed_text,
# MAGIC     ai_similarity(m.reference_text, t.full_text) AS similarity_score
# MAGIC   FROM serverless_stable_prvwqx_catalog.audio_parsing.ami_meeting_audio m
# MAGIC   JOIN (
# MAGIC     SELECT DISTINCT path, full_text
# MAGIC     FROM serverless_stable_prvwqx_catalog.audio_parsing.ami_transcriptions
# MAGIC   ) t ON t.path LIKE CONCAT('%', m.file_name)
# MAGIC )
# MAGIC SELECT
# MAGIC   COUNT(*) AS total_compared,
# MAGIC   ROUND(AVG(similarity_score), 4) AS avg_similarity,
# MAGIC   ROUND(PERCENTILE(similarity_score, 0.5), 4) AS median_similarity,
# MAGIC   ROUND(MIN(similarity_score), 4) AS min_similarity,
# MAGIC   ROUND(MAX(similarity_score), 4) AS max_similarity,
# MAGIC   SUM(CASE WHEN similarity_score >= 0.9 THEN 1 ELSE 0 END) AS high_quality_count,
# MAGIC   ROUND(100.0 * SUM(CASE WHEN similarity_score >= 0.9 THEN 1 ELSE 0 END) / COUNT(*), 1) AS high_quality_pct
# MAGIC FROM compared

# COMMAND ----------

# DBTITLE 1,Step 8: Full Comparison Detail
# MAGIC %sql
# MAGIC -- Detailed row-by-row comparison sorted by similarity
# MAGIC SELECT
# MAGIC   m.meeting_id,
# MAGIC   m.audio_id,
# MAGIC   m.speaker_id,
# MAGIC   ROUND(m.end_time - m.begin_time, 1) AS duration_sec,
# MAGIC   m.reference_text,
# MAGIC   t.full_text AS transcribed_text,
# MAGIC   ROUND(ai_similarity(m.reference_text, t.full_text), 4) AS similarity_score
# MAGIC FROM serverless_stable_prvwqx_catalog.audio_parsing.ami_meeting_audio m
# MAGIC JOIN (
# MAGIC   SELECT DISTINCT path, full_text
# MAGIC   FROM serverless_stable_prvwqx_catalog.audio_parsing.ami_transcriptions
# MAGIC ) t ON t.path LIKE CONCAT('%', m.file_name)
# MAGIC ORDER BY similarity_score ASC