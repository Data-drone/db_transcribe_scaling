# Databricks notebook source
# DBTITLE 1,AMI Meeting Corpus - Audio Transcription Pipeline
# MAGIC %md
# MAGIC # AMI Meeting Corpus - Audio Transcription Pipeline
# MAGIC
# MAGIC This notebook transcribes audio from the [AMI Meeting Corpus](https://huggingface.co/datasets/edinburghcstr/ami) using Databricks `ai_transcribe`. The AMI corpus contains recordings of real meetings captured with individual headset microphones (IHM). 20 audio segments from the test split are stored in a Unity Catalog volume and accompanied by a metadata table with reference transcriptions.
# MAGIC
# MAGIC **Catalog:** `serverless_stable_prvwqx_catalog` | **Schema:** `audio_parsing` | **Volume:** `ami_audio`

# COMMAND ----------

# DBTITLE 1,Step 1: Explore Metadata
# MAGIC %sql
# MAGIC SELECT * FROM serverless_stable_prvwqx_catalog.audio_parsing.ami_meeting_audio LIMIT 10

# COMMAND ----------

# DBTITLE 1,Step 2: Transcribe Audio with ai_transcribe
# MAGIC %sql
# MAGIC CREATE OR REPLACE TABLE serverless_stable_prvwqx_catalog.audio_parsing.ami_transcriptions_raw AS
# MAGIC SELECT
# MAGIC   path,
# MAGIC   ai_transcribe(content) AS result
# MAGIC FROM READ_FILES(
# MAGIC   '/Volumes/serverless_stable_prvwqx_catalog/audio_parsing/ami_audio/',
# MAGIC   format => 'binaryFile'
# MAGIC )

# COMMAND ----------

# DBTITLE 1,Step 3: Extract Segments with Speaker Labels
# MAGIC %sql
# MAGIC -- Explode transcription segments; reconstruct full_text per file
# MAGIC CREATE OR REPLACE TABLE serverless_stable_prvwqx_catalog.audio_parsing.ami_transcriptions AS
# MAGIC WITH segments AS (
# MAGIC   SELECT
# MAGIC     t.path,
# MAGIC     segment.value:start::DOUBLE              AS start_seconds,
# MAGIC     segment.value:end::DOUBLE                AS end_seconds,
# MAGIC     segment.value:speaker_id::STRING         AS speaker_id,
# MAGIC     segment.value:text::STRING               AS segment_text
# MAGIC   FROM serverless_stable_prvwqx_catalog.audio_parsing.ami_transcriptions_raw t,
# MAGIC        LATERAL variant_explode(t.result:response.segments) AS segment
# MAGIC   WHERE t.result:response IS NOT NULL
# MAGIC ),
# MAGIC full_texts AS (
# MAGIC   SELECT path, CONCAT_WS(' ', COLLECT_LIST(segment_text)) AS full_text
# MAGIC   FROM segments
# MAGIC   GROUP BY path
# MAGIC )
# MAGIC SELECT
# MAGIC   s.path,
# MAGIC   ft.full_text,
# MAGIC   s.start_seconds,
# MAGIC   s.end_seconds,
# MAGIC   s.speaker_id,
# MAGIC   s.segment_text
# MAGIC FROM segments s
# MAGIC JOIN full_texts ft ON s.path = ft.path

# COMMAND ----------

# DBTITLE 1,Step 4: Compare Transcriptions to Reference Text
# MAGIC %sql
# MAGIC -- Compare ai_transcribe output to the AMI corpus reference transcription
# MAGIC SELECT
# MAGIC   m.meeting_id,
# MAGIC   m.audio_id,
# MAGIC   m.speaker_id AS ref_speaker,
# MAGIC   m.reference_text,
# MAGIC   t.full_text                                    AS transcribed_text,
# MAGIC   ai_similarity(m.reference_text, t.full_text)    AS similarity_score
# MAGIC FROM serverless_stable_prvwqx_catalog.audio_parsing.ami_meeting_audio m
# MAGIC JOIN (
# MAGIC   SELECT DISTINCT path, full_text
# MAGIC   FROM serverless_stable_prvwqx_catalog.audio_parsing.ami_transcriptions
# MAGIC ) t
# MAGIC   ON t.path LIKE CONCAT('%', m.file_name)
# MAGIC ORDER BY similarity_score DESC

# COMMAND ----------

# DBTITLE 1,Notes
# MAGIC %md
# MAGIC ## Notes
# MAGIC
# MAGIC * **`ai_transcribe` requires enablement** — a workspace admin must enable **AI Transcribe Preview** in *Admin Settings > Workspace > Previews* before Steps 2-4 will run.
# MAGIC * Supported audio formats: **WAV, MP3, FLAC, Opus, M4A** (video is not supported).
# MAGIC * Supported languages during preview: **English and Spanish**.
# MAGIC * Costs are recorded under the **AI_FUNCTIONS** product in billing.