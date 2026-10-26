# Databricks notebook source
# DBTITLE 1,HarperValleyBank Transcription Pipeline
# MAGIC %md
# MAGIC # HarperValleyBank Transcription Pipeline
# MAGIC
# MAGIC Transcribes HarperValleyBank calls with `ai_transcribe` and builds the interaction tables used by the Call Insights app (spec §9–§10).
# MAGIC
# MAGIC **Approach: transcribe each speaker turn on its own.** Speech is detected separately in the agent and caller channels of the aligned stereo file, and each burst of speech is written as a short padded clip and transcribed. The speaker role therefore comes from the channel, and timing comes from where the clip was cut. Turns are then rebuilt by joining consecutive clips from the same speaker.
# MAGIC
# MAGIC On a 20-call test this gave 7.0% word error rate overall (agent 8.8%, customer 4.2%) and the right speaker for 93.5% of reference utterances. The alternatives were worse:
# MAGIC * **Each whole channel file:** `ai_transcribe` drops most speech when the file is mostly silence (customer WER 39%).
# MAGIC * **The stereo file:** complete text, but diarization often merges agent and customer into one segment (84.8% role match, customer WER 37.5%).
# MAGIC * **Each channel with silences removed:** speech either side of a gap gets merged, so timestamps can't be mapped back (role match 47.5%).
# MAGIC
# MAGIC About 10% of clips are breaths, clicks or noise. `ai_transcribe` returns a "segmentation size 0" error for these, and re-padding doesn't help, so they are recorded as `no_speech` and not retried.
# MAGIC
# MAGIC **Prerequisites:** run **HarperValleyBank Data Loader** first. **AI Transcribe Preview** must be enabled in the workspace.
# MAGIC
# MAGIC **Outputs** (`serverless_stable_prvwqx_catalog.call_insights`):
# MAGIC | Table | Contents |
# MAGIC |---|---|
# MAGIC | `hvb_speech_chunks` | One row per speech clip: call, role, where it sits in the call, clip path. |
# MAGIC | `interaction_audio_features` | Per-channel active speech time and overtalk, measured from the audio. |
# MAGIC | `hvb_transcriptions_raw` | One `ai_transcribe` result per clip. Incremental: re-running only processes new calls. |
# MAGIC | `interaction_transcription_status` | `ok` / `empty` / `no_speech` / `error` per clip, with the error message. |
# MAGIC | `interactions` | One row per call: queue, agent, customer, audio path, transcription status. |
# MAGIC | `interaction_segments` | Speaker turns with role (`agent` / `customer`), on the stereo audio timeline. |
# MAGIC | `interaction_transcripts` | Prompt-ready transcript per call (`[mm:ss] Role: text`). |
# MAGIC | `interaction_metrics` | Talk time, talk ratio, silence, holds, overtalk, turns. |
# MAGIC | `hvb_transcription_eval` | Word error rate against the human reference, for `ai_transcribe` and the corpus's own ASR. |

# COMMAND ----------

# DBTITLE 1,Step 1: Configuration
CATALOG = "serverless_stable_prvwqx_catalog"
SCHEMA  = "call_insights"
VOLUME  = "hvb_raw"

VOLUME_PATH = f"/Volumes/{CATALOG}/{SCHEMA}/{VOLUME}"
CHUNK_DIR   = f"{VOLUME_PATH}/audio/chunks"
FQ = f"{CATALOG}.{SCHEMA}"

# Speech detection (per channel, 20 ms frames)
FRAME_SECONDS        = 0.02
ACTIVE_ABOVE_FLOOR   = 15.0   # dB above the channel's noise floor that counts as speech
MIN_ACTIVE_DBFS      = -50.0  # never treat quieter frames as speech
MERGE_GAP_SECONDS    = 0.6    # join speech bursts separated by less than this
MIN_SPEECH_SECONDS   = 0.15   # drop bursts shorter than this
EDGE_PAD_SECONDS     = 0.25   # keep this much audio either side of a burst
MIN_OVERTALK_SECONDS = 0.5    # both channels active at least this long = one overtalk event

# Clip layout
CLIP_LEAD_SECONDS = 0.5       # silence before the speech in each clip
CLIP_MIN_SECONDS  = 2.0       # clips shorter than this are padded with trailing silence

# Turn building
TURN_GAP_SECONDS = 2.0        # consecutive clips from the same speaker closer than this form one turn

NO_SPEECH_ERROR = "stage12 segmentation size 0"

dbutils.fs.mkdirs(CHUNK_DIR)

# COMMAND ----------

# DBTITLE 1,Step 2: Detect Speech and Cut Clips for New Calls
import os, time, wave
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import pandas as pd

spark.sql(f"""
  CREATE TABLE IF NOT EXISTS {FQ}.hvb_speech_chunks (
    chunk_id             STRING,
    sid                  STRING,
    speaker_role         STRING,
    chunk_index          INT,
    speech_start_seconds DOUBLE,
    speech_end_seconds   DOUBLE,
    clip_offset_seconds  DOUBLE,
    clip_seconds         DOUBLE,
    chunk_path           STRING
  )
  COMMENT 'Speech clips cut from each channel of the aligned stereo audio; clip_offset_seconds maps clip time to call time'
""")
spark.sql(f"""
  CREATE TABLE IF NOT EXISTS {FQ}.interaction_audio_features (
    interaction_id          STRING,
    agent_active_seconds    DOUBLE,
    customer_active_seconds DOUBLE,
    overtalk_count          INT,
    overtalk_seconds        DOUBLE
  )
  COMMENT 'Per-channel active speech and overtalk measured from the stereo audio'
""")

new_calls = spark.sql(f"""
  SELECT c.sid, c.stereo_audio_path
  FROM {FQ}.hvb_calls c
  LEFT ANTI JOIN {FQ}.interaction_audio_features f ON f.interaction_id = c.sid
""").toPandas()
print(f"Calls to cut into clips: {len(new_calls):,}")

def speech_activity(channel, sr):
    frame = int(sr * FRAME_SECONDS)
    n = len(channel) // frame
    power = (channel[: n * frame].astype(np.float32).reshape(n, frame) ** 2).mean(axis=1) + 1e-9
    db = 10 * np.log10(power / 32768.0 ** 2)
    return db > max(np.percentile(db, 10) + ACTIVE_ABOVE_FLOOR, MIN_ACTIVE_DBFS)

def runs(mask):
    edges = np.diff(np.concatenate([[0], mask.astype(int), [0]]))
    return list(zip(np.flatnonzero(edges == 1) * FRAME_SECONDS, np.flatnonzero(edges == -1) * FRAME_SECONDS))

def speech_regions(active, duration):
    merged = []
    for start, end in runs(active):
        if merged and start - merged[-1][1] < MERGE_GAP_SECONDS:
            merged[-1][1] = end
        else:
            merged.append([start, end])
    return [
        (max(0.0, s - EDGE_PAD_SECONDS), min(duration, e + EDGE_PAD_SECONDS))
        for s, e in merged if e - s >= MIN_SPEECH_SECONDS
    ]

def write_clip(path, sr, samples):
    local = f"/tmp/{os.path.basename(path)}"
    with wave.open(local, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(samples.astype("<i2").tobytes())
    with open(local, "rb") as src, open(path, "wb") as dst:
        dst.write(src.read())
    os.remove(local)

def cut_call(sid, stereo_path):
    with wave.open(stereo_path, "rb") as w:
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").reshape(-1, 2)
    duration = len(x) / sr
    activity = [speech_activity(x[:, i], sr) for i in (0, 1)]
    n = min(len(a) for a in activity)
    overtalk = np.array([e - s for s, e in runs(activity[0][:n] & activity[1][:n])])
    overtalk = overtalk[overtalk >= MIN_OVERTALK_SECONDS] if len(overtalk) else overtalk

    chunks = []
    for ch, role in ((0, "agent"), (1, "customer")):
        for k, (s, e) in enumerate(speech_regions(activity[ch], duration)):
            speech = x[int(s * sr): int(e * sr), ch]
            lead = int(CLIP_LEAD_SECONDS * sr)
            clip = np.zeros(max(int(CLIP_MIN_SECONDS * sr), len(speech) + 2 * lead), dtype=np.int16)
            clip[lead: lead + len(speech)] = speech
            chunk_id = f"{sid}_{role}_{k:03d}"
            path = f"{CHUNK_DIR}/{chunk_id}.wav"
            write_clip(path, sr, clip)
            chunks.append((chunk_id, sid, role, k, round(s, 3), round(e, 3),
                           round(s - CLIP_LEAD_SECONDS, 3), round(len(clip) / sr, 3), path))
    features = (sid, round(float(activity[0].sum() * FRAME_SECONDS), 2), round(float(activity[1].sum() * FRAME_SECONDS), 2),
                int(len(overtalk)), round(float(overtalk.sum()) if len(overtalk) else 0.0, 2))
    return chunks, features

t0 = time.time()
chunk_rows, feature_rows = [], []
with ThreadPoolExecutor(max_workers=16) as pool:
    for chunks, features in pool.map(lambda r: cut_call(r.sid, r.stereo_audio_path), new_calls.itertuples()):
        chunk_rows.extend(chunks)
        feature_rows.append(features)

if chunk_rows:
    spark.createDataFrame(chunk_rows, schema=spark.table(f"{FQ}.hvb_speech_chunks").schema) \
        .write.mode("append").saveAsTable(f"{FQ}.hvb_speech_chunks")
if feature_rows:
    spark.createDataFrame(feature_rows, schema=spark.table(f"{FQ}.interaction_audio_features").schema) \
        .write.mode("append").saveAsTable(f"{FQ}.interaction_audio_features")
print(f"✓ Cut {len(chunk_rows):,} clips from {len(feature_rows):,} calls in {time.time() - t0:.0f}s")

# COMMAND ----------

# DBTITLE 1,Step 3: Transcribe New Clips
spark.sql(f"""
  CREATE TABLE IF NOT EXISTS {FQ}.hvb_transcriptions_raw (
    chunk_id       STRING,
    sid            STRING,
    audio_path     STRING,
    result         VARIANT,
    attempt        INT,
    transcribed_at TIMESTAMP
  )
  COMMENT 'Raw ai_transcribe output per speech clip'
""")

pending = spark.sql(f"""
  SELECT COUNT(*) AS n FROM {FQ}.hvb_speech_chunks k
  LEFT ANTI JOIN {FQ}.hvb_transcriptions_raw t ON t.chunk_id = k.chunk_id
""").first().n
print(f"Clips to transcribe: {pending:,}")

t0 = time.time()
spark.sql(f"""
  INSERT INTO {FQ}.hvb_transcriptions_raw
  WITH files AS (
    SELECT path, content, regexp_extract(path, '/([^/]+)[.]wav$', 1) AS chunk_id
    FROM READ_FILES('{CHUNK_DIR}/', format => 'binaryFile')
  )
  SELECT k.chunk_id, k.sid, f.path, ai_transcribe(f.content), 1, current_timestamp()
  FROM files f
  JOIN {FQ}.hvb_speech_chunks k ON k.chunk_id = f.chunk_id
  LEFT ANTI JOIN {FQ}.hvb_transcriptions_raw t ON t.chunk_id = f.chunk_id
""")
transcribe_seconds = time.time() - t0
print(f"✓ Transcribed {pending:,} clips in {transcribe_seconds:.0f}s")

# COMMAND ----------

# DBTITLE 1,Step 4: Retry Errors Once (Except No-Speech Clips)
retry_filter = f"""
  coalesce(result:error_message::STRING, '') <> ''
  AND NOT startswith(result:error_message::STRING, '{NO_SPEECH_ERROR}')
  AND attempt < 2
"""
retry = spark.sql(f"SELECT COUNT(*) AS n FROM {FQ}.hvb_transcriptions_raw WHERE {retry_filter}").first().n
print(f"Clips to retry: {retry}")

if retry:
    spark.sql(f"""
      MERGE INTO {FQ}.hvb_transcriptions_raw t
      USING (
        SELECT r.chunk_id, ai_transcribe(f.content) AS result
        FROM (SELECT * FROM {FQ}.hvb_transcriptions_raw WHERE {retry_filter}) r
        JOIN READ_FILES('{CHUNK_DIR}/', format => 'binaryFile') f ON f.path = r.audio_path
      ) s
      ON t.chunk_id = s.chunk_id
      WHEN MATCHED THEN UPDATE SET
        t.result = s.result, t.attempt = t.attempt + 1, t.transcribed_at = current_timestamp()
    """)

# COMMAND ----------

# DBTITLE 1,Step 5: Transcription Status
# MAGIC %sql
# MAGIC CREATE OR REPLACE TABLE serverless_stable_prvwqx_catalog.call_insights.interaction_transcription_status
# MAGIC COMMENT 'ai_transcribe outcome per speech clip: ok, empty, no_speech or error'
# MAGIC AS
# MAGIC SELECT
# MAGIC   r.audio_path,
# MAGIC   r.sid                                                AS interaction_id,
# MAGIC   r.chunk_id,
# MAGIC   k.speaker_role,
# MAGIC   CASE
# MAGIC     WHEN startswith(r.result:error_message::STRING, 'stage12 segmentation size 0') THEN 'no_speech'
# MAGIC     WHEN coalesce(r.result:error_message::STRING, '') <> '' THEN 'error'
# MAGIC     WHEN coalesce(array_size(CAST(r.result:response.segments AS ARRAY<VARIANT>)), 0) = 0 THEN 'empty'
# MAGIC     ELSE 'ok'
# MAGIC   END                                                  AS status,
# MAGIC   nullif(r.result:error_message::STRING, '')           AS error_message,
# MAGIC   r.result:metadata.input_duration_seconds::DOUBLE     AS input_duration_seconds,
# MAGIC   r.attempt,
# MAGIC   r.transcribed_at
# MAGIC FROM serverless_stable_prvwqx_catalog.call_insights.hvb_transcriptions_raw r
# MAGIC JOIN serverless_stable_prvwqx_catalog.call_insights.hvb_speech_chunks k USING (chunk_id);
# MAGIC
# MAGIC SELECT status, speaker_role, COUNT(*) AS clips, ROUND(SUM(input_duration_seconds) / 60, 1) AS audio_minutes,
# MAGIC        first(error_message, true) AS example_error
# MAGIC FROM serverless_stable_prvwqx_catalog.call_insights.interaction_transcription_status
# MAGIC GROUP BY ALL
# MAGIC ORDER BY status, speaker_role

# COMMAND ----------

# DBTITLE 1,Step 6: Interactions
# MAGIC %sql
# MAGIC -- HarperValleyBank has no queues; derive them from intent the way an IVR menu would route calls.
# MAGIC CREATE OR REPLACE TABLE serverless_stable_prvwqx_catalog.call_insights.interactions
# MAGIC COMMENT 'One row per conversation (domain-neutral; source = harper_valley_bank)'
# MAGIC AS
# MAGIC WITH status AS (
# MAGIC   SELECT interaction_id, COUNT_IF(status = 'ok') AS ok_clips, COUNT_IF(status = 'error') AS error_clips
# MAGIC   FROM serverless_stable_prvwqx_catalog.call_insights.interaction_transcription_status
# MAGIC   GROUP BY interaction_id
# MAGIC )
# MAGIC SELECT
# MAGIC   c.sid                                   AS interaction_id,
# MAGIC   'harper_valley_bank'                    AS source,
# MAGIC   c.call_start_ts                         AS started_at,
# MAGIC   ROUND(c.stereo_audio_seconds, 2)        AS duration_seconds,
# MAGIC   CASE
# MAGIC     WHEN c.task_type IN ('replace card', 'order checks')    THEN 'Cards and checks'
# MAGIC     WHEN c.task_type IN ('pay bill', 'transfer money')      THEN 'Payments'
# MAGIC     WHEN c.task_type IN ('check balance', 'reset password') THEN 'Account access'
# MAGIC     ELSE 'General enquiries'
# MAGIC   END                                     AS queue,
# MAGIC   c.agent_speaker_id                      AS agent_id,
# MAGIC   c.agent_name,
# MAGIC   c.caller_speaker_id                     AS customer_id,
# MAGIC   'en'                                    AS language,
# MAGIC   c.stereo_audio_path                     AS audio_path,
# MAGIC   0.0                                     AS audio_offset_seconds,
# MAGIC   CASE
# MAGIC     WHEN s.interaction_id IS NULL THEN 'pending'
# MAGIC     WHEN s.ok_clips = 0 THEN 'failed'
# MAGIC     WHEN s.error_clips > 0 THEN 'partial'
# MAGIC     ELSE 'ok'
# MAGIC   END                                     AS transcription_status
# MAGIC FROM serverless_stable_prvwqx_catalog.call_insights.hvb_calls c
# MAGIC LEFT JOIN status s ON s.interaction_id = c.sid

# COMMAND ----------

# DBTITLE 1,Step 7: Speaker Turns
# MAGIC %sql
# MAGIC -- Clip text is joined per clip, then consecutive clips from the same speaker less than 2s apart become one turn.
# MAGIC CREATE OR REPLACE TABLE serverless_stable_prvwqx_catalog.call_insights.interaction_segments
# MAGIC COMMENT 'Speaker turns per interaction; seconds on the stereo audio timeline; role from the audio channel'
# MAGIC AS
# MAGIC WITH seg AS (
# MAGIC   SELECT
# MAGIC     k.chunk_id, k.sid, k.speaker_role, s.pos,
# MAGIC     k.clip_offset_seconds + s.value:start::DOUBLE AS start_s,
# MAGIC     k.clip_offset_seconds + s.value:end::DOUBLE   AS end_s,
# MAGIC     trim(s.value:text::STRING)                    AS text
# MAGIC   FROM serverless_stable_prvwqx_catalog.call_insights.hvb_transcriptions_raw r
# MAGIC   JOIN serverless_stable_prvwqx_catalog.call_insights.hvb_speech_chunks k ON k.chunk_id = r.chunk_id,
# MAGIC   LATERAL variant_explode(r.result:response.segments) AS s
# MAGIC   WHERE coalesce(r.result:error_message::STRING, '') = ''
# MAGIC ),
# MAGIC clips AS (
# MAGIC   SELECT chunk_id, sid, speaker_role, MIN(start_s) AS start_s, MAX(end_s) AS end_s,
# MAGIC          array_join(transform(array_sort(collect_list(struct(pos, text))), x -> x.text), ' ') AS text
# MAGIC   FROM seg
# MAGIC   WHERE text IS NOT NULL AND text <> ''
# MAGIC   GROUP BY chunk_id, sid, speaker_role
# MAGIC ),
# MAGIC flagged AS (
# MAGIC   SELECT *,
# MAGIC     CASE
# MAGIC       WHEN LAG(speaker_role) OVER w IS NULL THEN 1
# MAGIC       WHEN LAG(speaker_role) OVER w <> speaker_role THEN 1
# MAGIC       WHEN start_s - LAG(end_s) OVER w > 2.0 THEN 1
# MAGIC       ELSE 0
# MAGIC     END AS new_turn
# MAGIC   FROM clips
# MAGIC   WINDOW w AS (PARTITION BY sid ORDER BY start_s, speaker_role)
# MAGIC ),
# MAGIC numbered AS (
# MAGIC   SELECT *, SUM(new_turn) OVER (PARTITION BY sid ORDER BY start_s, speaker_role ROWS UNBOUNDED PRECEDING) AS turn_no
# MAGIC   FROM flagged
# MAGIC )
# MAGIC SELECT
# MAGIC   n.sid                                                                     AS interaction_id,
# MAGIC   CAST(n.turn_no AS INT)                                                    AS segment_idx,
# MAGIC   ROUND(MIN(n.start_s), 3)                                                  AS start_seconds,
# MAGIC   ROUND(MAX(n.end_s), 3)                                                    AS end_seconds,
# MAGIC   first(IF(n.speaker_role = 'agent', c.agent_speaker_id, c.caller_speaker_id)) AS speaker_id,
# MAGIC   n.speaker_role,
# MAGIC   array_join(transform(array_sort(collect_list(struct(n.start_s, n.text))), x -> x.text), ' ') AS text,
# MAGIC   COUNT(*)                                                                  AS clip_count
# MAGIC FROM numbered n
# MAGIC JOIN serverless_stable_prvwqx_catalog.call_insights.hvb_calls c ON c.sid = n.sid
# MAGIC GROUP BY n.sid, n.turn_no, n.speaker_role

# COMMAND ----------

# DBTITLE 1,Step 8: Prompt-Ready Transcripts
# MAGIC %sql
# MAGIC CREATE OR REPLACE TABLE serverless_stable_prvwqx_catalog.call_insights.interaction_transcripts
# MAGIC COMMENT 'One transcript per interaction, formatted as [mm:ss] Role: text, for ai_query prompts'
# MAGIC AS
# MAGIC SELECT
# MAGIC   interaction_id,
# MAGIC   array_join(
# MAGIC     transform(
# MAGIC       array_sort(collect_list(struct(
# MAGIC         segment_idx,
# MAGIC         format_string('[%02d:%02d] %s: %s',
# MAGIC           CAST(floor(start_seconds / 60) AS INT),
# MAGIC           CAST(floor(start_seconds % 60) AS INT),
# MAGIC           initcap(speaker_role),
# MAGIC           text) AS line
# MAGIC       ))),
# MAGIC       x -> x.line),
# MAGIC     '\n') AS transcript_with_timestamps,
# MAGIC   COUNT(*) AS segment_count
# MAGIC FROM serverless_stable_prvwqx_catalog.call_insights.interaction_segments
# MAGIC GROUP BY interaction_id

# COMMAND ----------

# DBTITLE 1,Step 9: Conversation Metrics
# MAGIC %sql
# MAGIC -- Silence = gap > 2s since the latest end of any earlier turn; hold = gap > 30s.
# MAGIC -- Overtalk comes from the audio: both channels active for at least 0.5s.
# MAGIC CREATE OR REPLACE TABLE serverless_stable_prvwqx_catalog.call_insights.interaction_metrics
# MAGIC COMMENT 'Conversation metrics from turn timing and audio features (spec §9.3)'
# MAGIC AS
# MAGIC WITH ordered AS (
# MAGIC   SELECT *,
# MAGIC     MAX(end_seconds) OVER (PARTITION BY interaction_id ORDER BY segment_idx
# MAGIC                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max_end,
# MAGIC     LAG(speaker_role) OVER (PARTITION BY interaction_id ORDER BY segment_idx) AS prev_role
# MAGIC   FROM serverless_stable_prvwqx_catalog.call_insights.interaction_segments
# MAGIC ),
# MAGIC per_call AS (
# MAGIC   SELECT
# MAGIC     interaction_id,
# MAGIC     ROUND(MAX(end_seconds) - MIN(start_seconds), 2)                               AS duration_seconds,
# MAGIC     ROUND(SUM(IF(speaker_role = 'agent',    end_seconds - start_seconds, 0)), 2)  AS talk_seconds_agent,
# MAGIC     ROUND(SUM(IF(speaker_role = 'customer', end_seconds - start_seconds, 0)), 2)  AS talk_seconds_customer,
# MAGIC     ROUND(SUM(IF(speaker_role = 'agent', end_seconds - start_seconds, 0))
# MAGIC           / NULLIF(SUM(end_seconds - start_seconds), 0), 3)                       AS talk_ratio_agent,
# MAGIC     ROUND(SUM(IF(start_seconds - prev_max_end > 2, start_seconds - prev_max_end, 0)), 2) AS silence_seconds_total,
# MAGIC     ROUND(GREATEST(COALESCE(MAX(start_seconds - prev_max_end), 0), 0), 2)         AS longest_silence_seconds,
# MAGIC     SUM(IF(start_seconds - prev_max_end > 30, 1, 0))                              AS hold_count,
# MAGIC     SUM(IF(prev_role <> speaker_role, 1, 0))                                      AS turn_count,
# MAGIC     COUNT(*)                                                                      AS segment_count
# MAGIC   FROM ordered
# MAGIC   GROUP BY interaction_id
# MAGIC )
# MAGIC SELECT p.*, a.agent_active_seconds, a.customer_active_seconds, a.overtalk_count, a.overtalk_seconds
# MAGIC FROM per_call p
# MAGIC LEFT JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_audio_features a USING (interaction_id)

# COMMAND ----------

# DBTITLE 1,Step 10: Check Coverage and Speaker Roles Against the Reference
# MAGIC %sql
# MAGIC -- covered_pct: reference utterances overlapped by at least one turn.
# MAGIC -- role_match_pct: the turn overlapping the utterance most has the same role as the reference.
# MAGIC WITH ref AS (
# MAGIC   SELECT sid, CASE speaker_role WHEN 'caller' THEN 'customer' ELSE speaker_role END AS role, utterance_index,
# MAGIC          conversation_start_seconds AS rs, conversation_start_seconds + duration_seconds AS re
# MAGIC   FROM serverless_stable_prvwqx_catalog.call_insights.hvb_reference_utterances
# MAGIC   WHERE human_transcript NOT LIKE '[%'
# MAGIC     AND sid IN (SELECT interaction_id FROM serverless_stable_prvwqx_catalog.call_insights.interactions
# MAGIC                 WHERE transcription_status IN ('ok', 'partial'))
# MAGIC ),
# MAGIC best AS (
# MAGIC   SELECT r.sid, r.role, r.utterance_index,
# MAGIC          max_by(s.speaker_role, LEAST(r.re, s.end_seconds) - GREATEST(r.rs, s.start_seconds)) AS seg_role
# MAGIC   FROM ref r
# MAGIC   JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_segments s
# MAGIC     ON s.interaction_id = r.sid AND s.start_seconds < r.re AND s.end_seconds > r.rs
# MAGIC   GROUP BY ALL
# MAGIC )
# MAGIC SELECT
# MAGIC   r.role,
# MAGIC   COUNT(*)                                                AS reference_utterances,
# MAGIC   ROUND(100 * AVG(IF(b.seg_role IS NOT NULL, 1, 0)), 1)   AS covered_pct,
# MAGIC   ROUND(100 * AVG(IF(b.seg_role = r.role, 1, 0)), 1)      AS role_match_pct
# MAGIC FROM ref r
# MAGIC LEFT JOIN best b USING (sid, role, utterance_index)
# MAGIC GROUP BY r.role

# COMMAND ----------

# DBTITLE 1,Step 11: Transcription Accuracy (Word Error Rate)
# MAGIC %md
# MAGIC Word error rate (WER) per call against the human reference, for `ai_transcribe` and for the Gridspace ASR transcript shipped with the corpus. `all` compares the whole call regardless of speaker, so it measures recognition alone; `agent` and `customer` also depend on getting the speaker right. Text is normalised to lowercase words without punctuation or `[noise]` tags. The human reference spells numbers out ("one thirty p m") while `ai_transcribe` writes digits ("1:30 p.m."), so `ai_transcribe` WER is somewhat overstated on calls with amounts, times and account numbers.

# COMMAND ----------

# DBTITLE 1,Step 11a: Compute WER
import re

def words(text):
    text = re.sub(r"\[[^\]]*\]", " ", (text or "").lower())
    return re.sub(r"[^a-z0-9' ]+", " ", text).split()

def edit_distance(ref, hyp):
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i] + [0] * len(hyp)
        for j, h in enumerate(hyp, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h))
        prev = cur
    return prev[-1]

ref = spark.sql(f"""
  SELECT u.sid, CASE u.speaker_role WHEN 'caller' THEN 'customer' ELSE u.speaker_role END AS role,
         u.conversation_start_seconds AS t, u.utterance_index, u.human_transcript, u.gridspace_transcript
  FROM {FQ}.hvb_reference_utterances u
  JOIN {FQ}.interactions i ON i.interaction_id = u.sid AND i.transcription_status IN ('ok', 'partial')
""").toPandas().sort_values(["sid", "t", "utterance_index"])
hyp = spark.sql(f"""
  SELECT interaction_id AS sid, speaker_role AS role, segment_idx, text
  FROM {FQ}.interaction_segments
""").toPandas().sort_values(["sid", "segment_idx"])

def joined_text(df, keys, cols):
    return df.groupby(keys).agg(**{c: (c, lambda x: " ".join(t or "" for t in x)) for c in cols})

by_role = joined_text(ref, ["sid", "role"], ["human_transcript", "gridspace_transcript"]).join(
    joined_text(hyp, ["sid", "role"], ["text"]), how="left").reset_index()
whole = joined_text(ref, ["sid"], ["human_transcript", "gridspace_transcript"]).join(
    joined_text(hyp, ["sid"], ["text"]), how="left").reset_index().assign(role="all")

rows = []
for r in pd.concat([by_role, whole]).itertuples():
    ref_w = words(r.human_transcript)
    if ref_w:
        rows.append((r.sid, r.role, len(ref_w),
                     edit_distance(ref_w, words(r.text if isinstance(r.text, str) else "")),
                     edit_distance(ref_w, words(r.gridspace_transcript))))

eval_df = pd.DataFrame(rows, columns=["sid", "speaker_role", "reference_words", "errors_ai_transcribe", "errors_gridspace"])
eval_df["wer_ai_transcribe"] = (eval_df.errors_ai_transcribe / eval_df.reference_words).round(4)
eval_df["wer_gridspace"] = (eval_df.errors_gridspace / eval_df.reference_words).round(4)

(spark.createDataFrame(eval_df)
    .write.mode("overwrite").option("overwriteSchema", "true")
    .saveAsTable(f"{FQ}.hvb_transcription_eval"))

corpus_wer = {
    role: {
        "calls": int(len(g)),
        "wer_ai_transcribe": round(float(g.errors_ai_transcribe.sum() / g.reference_words.sum()), 4),
        "wer_gridspace": round(float(g.errors_gridspace.sum() / g.reference_words.sum()), 4),
    }
    for role, g in eval_df.groupby("speaker_role")
}
corpus_wer

# COMMAND ----------

# DBTITLE 1,Step 12: Example Conversations
# MAGIC %sql
# MAGIC SELECT i.interaction_id, i.queue, i.agent_name, i.duration_seconds,
# MAGIC        m.talk_ratio_agent, m.longest_silence_seconds, m.overtalk_count, m.turn_count,
# MAGIC        t.transcript_with_timestamps
# MAGIC FROM serverless_stable_prvwqx_catalog.call_insights.interactions i
# MAGIC JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_transcripts t USING (interaction_id)
# MAGIC JOIN serverless_stable_prvwqx_catalog.call_insights.interaction_metrics m USING (interaction_id)
# MAGIC WHERE i.transcription_status IN ('ok', 'partial')
# MAGIC ORDER BY i.interaction_id
# MAGIC LIMIT 5

# COMMAND ----------

# DBTITLE 1,Return Summary for Job Runs
import json

clip_status = {f"{r.status}/{r.speaker_role}": r.n for r in spark.sql(f"""
  SELECT status, speaker_role, COUNT(*) AS n FROM {FQ}.interaction_transcription_status GROUP BY ALL
""").collect()}
call_status = {r.transcription_status: r.n for r in spark.sql(f"""
  SELECT transcription_status, COUNT(*) AS n FROM {FQ}.interactions GROUP BY ALL
""").collect()}
errors = [r.error_message for r in spark.sql(f"""
  SELECT DISTINCT error_message FROM {FQ}.interaction_transcription_status WHERE status = 'error' LIMIT 5
""").collect()]
metrics = spark.sql(f"""
  SELECT ROUND(AVG(talk_ratio_agent), 3) AS avg_talk_ratio_agent,
         ROUND(AVG(longest_silence_seconds), 1) AS avg_longest_silence_s,
         SUM(hold_count) AS holds, SUM(overtalk_count) AS overtalks, ROUND(AVG(turn_count), 1) AS avg_turns
  FROM {FQ}.interaction_metrics
""").first().asDict()
coverage = [r.asDict() for r in spark.sql(f"""
  WITH ref AS (
    SELECT sid, CASE speaker_role WHEN 'caller' THEN 'customer' ELSE speaker_role END AS role, utterance_index,
           conversation_start_seconds AS rs, conversation_start_seconds + duration_seconds AS re
    FROM {FQ}.hvb_reference_utterances
    WHERE human_transcript NOT LIKE '[%'
      AND sid IN (SELECT interaction_id FROM {FQ}.interactions WHERE transcription_status IN ('ok', 'partial'))
  ),
  best AS (
    SELECT r.sid, r.role, r.utterance_index,
           max_by(s.speaker_role, LEAST(r.re, s.end_seconds) - GREATEST(r.rs, s.start_seconds)) AS seg_role
    FROM ref r
    JOIN {FQ}.interaction_segments s ON s.interaction_id = r.sid AND s.start_seconds < r.re AND s.end_seconds > r.rs
    GROUP BY ALL
  )
  SELECT r.role, COUNT(*) AS reference_utterances,
         ROUND(100 * AVG(IF(b.seg_role IS NOT NULL, 1, 0)), 1) AS covered_pct,
         ROUND(100 * AVG(IF(b.seg_role = r.role, 1, 0)), 1) AS role_match_pct
  FROM ref r LEFT JOIN best b USING (sid, role, utterance_index)
  GROUP BY r.role
""").collect()]
example = spark.sql(
    f"SELECT transcript_with_timestamps FROM {FQ}.interaction_transcripts ORDER BY interaction_id LIMIT 1").first()

dbutils.notebook.exit(json.dumps({
    "clips_transcribed_this_run": pending,
    "transcribe_seconds": round(transcribe_seconds),
    "clip_status": clip_status,
    "call_status": call_status,
    "errors": errors,
    "metrics": metrics,
    "coverage": coverage,
    "corpus_wer": corpus_wer,
    "example_transcript": example.transcript_with_timestamps if example else None,
}, default=str))
