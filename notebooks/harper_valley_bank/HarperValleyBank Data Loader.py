# Databricks notebook source
# DBTITLE 1,HarperValleyBank Data Loader
# MAGIC %md
# MAGIC # HarperValleyBank Data Loader
# MAGIC
# MAGIC Loads the [HarperValleyBank](https://github.com/cricketclub/gridspace-stanford-harper-valley) corpus (Gridspace / Stanford, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) into Unity Catalog. It contains 1,446 role-played consumer banking calls (23.7 hours, 8 kHz telephony audio) with human reference transcripts, caller intent, dialog acts and emotion scores.
# MAGIC
# MAGIC Each call has **separate agent and caller WAV files that do not always start at the same moment**: in about 40% of calls the agent file starts roughly 2 seconds late. The reference transcript gives every utterance's position in its own file (`start_ms`) and in the conversation (`offset_ms`); the difference is that channel's offset. This notebook records the offset per channel and writes an aligned stereo file (agent left, caller right) whose timeline matches the conversation. The stereo file is what gets transcribed (transcribing each side on its own drops most of the speech) and what the app plays back.
# MAGIC
# MAGIC **Outputs** (`serverless_stable_prvwqx_catalog.call_insights`):
# MAGIC * Volume `hvb_raw`: `audio/agent`, `audio/caller`, `audio/stereo`, `metadata`, `transcript`
# MAGIC * `hvb_calls`: one row per call with intent, speakers, quality scores, channel offsets and audio paths
# MAGIC * `hvb_reference_utterances`: human reference transcript per utterance with timing, dialog acts and emotion scores
# MAGIC
# MAGIC Set the `max_calls` widget to `all` to load the full corpus. Calls are picked in `sid` order, which is effectively random across the three recording sessions.

# COMMAND ----------

# DBTITLE 1,Step 1: Configuration
dbutils.widgets.text("max_calls", "200", "Calls to load (number or 'all')")

CATALOG = "serverless_stable_prvwqx_catalog"
SCHEMA  = "call_insights"
VOLUME  = "hvb_raw"

REPO   = "cricketclub/gridspace-stanford-harper-valley"
BRANCH = "master"

VOLUME_PATH = f"/Volumes/{CATALOG}/{SCHEMA}/{VOLUME}"
CALLS_TABLE = f"{CATALOG}.{SCHEMA}.hvb_calls"
UTTS_TABLE  = f"{CATALOG}.{SCHEMA}.hvb_reference_utterances"

max_calls_arg = dbutils.widgets.get("max_calls").strip().lower()
MAX_CALLS = None if max_calls_arg == "all" else int(max_calls_arg)
print(f"Loading {'all' if MAX_CALLS is None else MAX_CALLS} calls into {VOLUME_PATH}")

# COMMAND ----------

# DBTITLE 1,Step 2: Create Schema and Volume
spark.sql(f"""
  CREATE SCHEMA IF NOT EXISTS {CATALOG}.{SCHEMA}
  COMMENT 'Call Insights app: HarperValleyBank calls, interactions, enrichment and labels'
""")
spark.sql(f"""
  CREATE VOLUME IF NOT EXISTS {CATALOG}.{SCHEMA}.{VOLUME}
  COMMENT 'HarperValleyBank raw audio (agent, caller, aligned stereo), metadata and reference transcripts'
""")
for sub in ["audio/agent", "audio/caller", "audio/stereo", "metadata", "transcript"]:
    dbutils.fs.mkdirs(f"{VOLUME_PATH}/{sub}")

# COMMAND ----------

# DBTITLE 1,Step 3: Choose Calls
import requests

tree = requests.get(
    f"https://api.github.com/repos/{REPO}/git/trees/{BRANCH}?recursive=1", timeout=60
).json()
assert not tree.get("truncated"), "GitHub tree listing was truncated"
blobs = {t["path"] for t in tree["tree"] if t["type"] == "blob"}

def has_all_files(sid):
    return all(p in blobs for p in (
        f"data/audio/agent/{sid}.wav",
        f"data/audio/caller/{sid}.wav",
        f"data/metadata/{sid}.json",
        f"data/transcript/{sid}.json",
    ))

all_sids = sorted(
    p.rsplit("/", 1)[-1][:-len(".json")]
    for p in blobs if p.startswith("data/metadata/") and p.endswith(".json")
)
complete_sids = [s for s in all_sids if has_all_files(s)]
selected = set(complete_sids if MAX_CALLS is None else complete_sids[:MAX_CALLS])

print(f"Corpus calls: {len(all_sids):,}  with all four files: {len(complete_sids):,}  selected: {len(selected):,}")

# COMMAND ----------

# DBTITLE 1,Step 4: Download and Extract Selected Calls
import os, shutil, tarfile, time

url = f"https://codeload.github.com/{REPO}/tar.gz/refs/heads/{BRANCH}"
print(f"Streaming {url} ...")
t0 = time.time()
written = 0

with requests.get(url, stream=True, timeout=600) as resp:
    resp.raise_for_status()
    with tarfile.open(fileobj=resp.raw, mode="r|gz") as tar:
        for member in tar:
            if not member.isfile():
                continue
            parts = member.name.split("/", 1)
            if len(parts) < 2 or not parts[1].startswith("data/"):
                continue
            rel = parts[1][len("data/"):]
            sid = os.path.splitext(os.path.basename(rel))[0]
            if sid not in selected:
                continue
            dest = f"{VOLUME_PATH}/{rel}"
            with tar.extractfile(member) as src, open(dest, "wb") as out:
                shutil.copyfileobj(src, out, length=1 << 20)
            written += 1

print(f"✓ Wrote {written:,} files in {time.time() - t0:.0f}s (expected {4 * len(selected):,})")

# COMMAND ----------

# DBTITLE 1,Step 5: Parse Calls, Compute Channel Offsets, Write Aligned Stereo
import json, statistics, wave
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import numpy as np

LOCAL_TMP = "/tmp/hvb_stereo"
os.makedirs(LOCAL_TMP, exist_ok=True)

def ms_to_ts(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc) if ms is not None else None

def read_wav(path):
    with wave.open(path, "rb") as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise ValueError(f"{path}: expected 16-bit mono")
        return w.getframerate(), np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")

def channel_offset(utterances, role):
    diffs = [
        u["offset_ms"] - u["start_ms"] for u in utterances
        if u.get("speaker_role") == role and u.get("offset_ms") is not None and u.get("start_ms") is not None
    ]
    if not diffs:
        return None, None
    return statistics.median(diffs) / 1000.0, max(diffs) - min(diffs)

def place(samples, offset_seconds, sr):
    pad = int(round(offset_seconds * sr))
    return (samples[-pad:], 0) if pad < 0 else (samples, pad)

def process_call(sid):
    meta = json.load(open(f"{VOLUME_PATH}/metadata/{sid}.json"))
    utts = json.load(open(f"{VOLUME_PATH}/transcript/{sid}.json"))
    agent_path, caller_path = f"{VOLUME_PATH}/audio/agent/{sid}.wav", f"{VOLUME_PATH}/audio/caller/{sid}.wav"

    sr_a, agent = read_wav(agent_path)
    sr_c, caller = read_wav(caller_path)
    if sr_a != sr_c:
        raise ValueError(f"{sid}: agent {sr_a} Hz vs caller {sr_c} Hz")

    a_off, a_spread = channel_offset(utts, "agent")
    c_off, c_spread = channel_offset(utts, "caller")
    offset_source = "transcript" if a_off is not None and c_off is not None else "default"
    a_off, c_off = a_off or 0.0, c_off or 0.0

    a_samples, a_pad = place(agent, a_off, sr_a)
    c_samples, c_pad = place(caller, c_off, sr_c)
    n = max(a_pad + len(a_samples), c_pad + len(c_samples))
    stereo = np.zeros((n, 2), dtype="<i2")
    stereo[a_pad:a_pad + len(a_samples), 0] = a_samples
    stereo[c_pad:c_pad + len(c_samples), 1] = c_samples

    local = f"{LOCAL_TMP}/{sid}.wav"
    with wave.open(local, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr_a)
        w.writeframes(stereo.tobytes())
    stereo_path = f"{VOLUME_PATH}/audio/stereo/{sid}.wav"
    shutil.copyfile(local, stereo_path)
    os.remove(local)

    task = (meta.get("tasks") or [{}])[0]
    agent_meta, caller_meta, labels = meta.get("agent", {}), meta.get("caller", {}), meta.get("labels", {})
    call = (
        sid, meta.get("session"),
        ms_to_ts(meta.get("start_time_ms")), ms_to_ts(meta.get("end_time_ms")),
        (meta["end_time_ms"] - meta["start_time_ms"]) / 1000.0 if meta.get("end_time_ms") and meta.get("start_time_ms") else None,
        task.get("task_type"), json.dumps({k: v for k, v in task.items() if k != "task_type"}),
        str(agent_meta.get("speaker_id")) if agent_meta.get("speaker_id") is not None else None,
        (agent_meta.get("metadata") or {}).get("agent_name"),
        str(caller_meta.get("speaker_id")) if caller_meta.get("speaker_id") is not None else None,
        (caller_meta.get("metadata") or {}).get("first and last name"),
        labels.get("lhvb_script"), labels.get("agent_mos"), labels.get("caller_mos"),
        float(a_off), float(c_off), offset_source,
        float(max(a_spread or 0, c_spread or 0)),
        sr_a, len(agent) / sr_a, len(caller) / sr_c, n / sr_a,
        agent_path, caller_path, stereo_path,
    )
    utterances = [
        (
            sid, u.get("index"), u.get("speaker_role"), u.get("channel_index"),
            u["offset_ms"] / 1000.0 if u.get("offset_ms") is not None else None,
            u["start_ms"] / 1000.0 if u.get("start_ms") is not None else None,
            u["duration_ms"] / 1000.0 if u.get("duration_ms") is not None else None,
            u.get("human_transcript"), u.get("transcript"),
            list(u.get("dialog_acts") or []),
            (u.get("emotion") or {}).get("negative"),
            (u.get("emotion") or {}).get("neutral"),
            (u.get("emotion") or {}).get("positive"),
        )
        for u in utts
    ]
    return call, utterances

t0 = time.time()
call_rows, utt_rows, failures = [], [], []
with ThreadPoolExecutor(max_workers=16) as pool:
    futures = {sid: pool.submit(process_call, sid) for sid in sorted(selected)}
    for sid, fut in futures.items():
        try:
            call, utts = fut.result()
            call_rows.append(call)
            utt_rows.extend(utts)
        except Exception as e:
            failures.append((sid, str(e)))

print(f"✓ Processed {len(call_rows):,} calls, {len(utt_rows):,} reference utterances in {time.time() - t0:.0f}s")
if failures:
    print(f"✗ {len(failures)} calls failed, e.g. {failures[:3]}")

# COMMAND ----------

# DBTITLE 1,Step 6: Write Delta Tables
from pyspark.sql.types import (
    StructType, StructField, StringType, TimestampType, DoubleType, IntegerType, LongType, ArrayType
)

calls_schema = StructType([
    StructField("sid", StringType()),
    StructField("session", StringType()),
    StructField("call_start_ts", TimestampType()),
    StructField("call_end_ts", TimestampType()),
    StructField("call_duration_seconds", DoubleType()),
    StructField("task_type", StringType()),
    StructField("task_slots_json", StringType()),
    StructField("agent_speaker_id", StringType()),
    StructField("agent_name", StringType()),
    StructField("caller_speaker_id", StringType()),
    StructField("caller_name", StringType()),
    StructField("script_adherence_score", DoubleType()),
    StructField("agent_mos", DoubleType()),
    StructField("caller_mos", DoubleType()),
    StructField("agent_offset_seconds", DoubleType()),
    StructField("caller_offset_seconds", DoubleType()),
    StructField("offset_source", StringType()),
    StructField("offset_spread_ms", DoubleType()),
    StructField("sample_rate_hz", IntegerType()),
    StructField("agent_audio_seconds", DoubleType()),
    StructField("caller_audio_seconds", DoubleType()),
    StructField("stereo_audio_seconds", DoubleType()),
    StructField("agent_audio_path", StringType()),
    StructField("caller_audio_path", StringType()),
    StructField("stereo_audio_path", StringType()),
])

utts_schema = StructType([
    StructField("sid", StringType()),
    StructField("utterance_index", LongType()),
    StructField("speaker_role", StringType()),
    StructField("channel_index", LongType()),
    StructField("conversation_start_seconds", DoubleType()),
    StructField("channel_start_seconds", DoubleType()),
    StructField("duration_seconds", DoubleType()),
    StructField("human_transcript", StringType()),
    StructField("gridspace_transcript", StringType()),
    StructField("dialog_acts", ArrayType(StringType())),
    StructField("emotion_negative", DoubleType()),
    StructField("emotion_neutral", DoubleType()),
    StructField("emotion_positive", DoubleType()),
])

def to_float(v):
    return float(v) if v is not None else None

call_rows = [
    tuple(to_float(v) if calls_schema[i].dataType == DoubleType() else v for i, v in enumerate(r))
    for r in call_rows
]
utt_rows = [
    tuple(to_float(v) if utts_schema[i].dataType == DoubleType() else v for i, v in enumerate(r))
    for r in utt_rows
]

(spark.createDataFrame(call_rows, schema=calls_schema)
    .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(CALLS_TABLE))
(spark.createDataFrame(utt_rows, schema=utts_schema)
    .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(UTTS_TABLE))

spark.sql(f"COMMENT ON TABLE {CALLS_TABLE} IS 'HarperValleyBank calls (CC BY 4.0, Gridspace/Stanford): intent, speakers, quality labels, channel offsets, audio paths'")
spark.sql(f"COMMENT ON TABLE {UTTS_TABLE} IS 'HarperValleyBank human reference utterances with timing, dialog acts and emotion scores (ground truth for evaluation)'")

print(f"✓ {CALLS_TABLE}: {spark.table(CALLS_TABLE).count():,} rows")
print(f"✓ {UTTS_TABLE}: {spark.table(UTTS_TABLE).count():,} rows")

# COMMAND ----------

# DBTITLE 1,Step 7: Verify Data
# MAGIC %sql
# MAGIC -- Calls, audio volume, intents and channel offsets
# MAGIC SELECT
# MAGIC   COUNT(*)                                              AS calls,
# MAGIC   COUNT(DISTINCT task_type)                             AS intents,
# MAGIC   COUNT(DISTINCT agent_speaker_id)                      AS distinct_agents,
# MAGIC   ROUND(SUM(stereo_audio_seconds) / 3600, 2)            AS stereo_audio_hours,
# MAGIC   ROUND(AVG(stereo_audio_seconds), 1)                   AS avg_call_seconds,
# MAGIC   ROUND(PERCENTILE(agent_offset_seconds, 0.5), 2)       AS median_agent_offset_s,
# MAGIC   ROUND(PERCENTILE(caller_offset_seconds, 0.5), 2)      AS median_caller_offset_s,
# MAGIC   SUM(CASE WHEN offset_source = 'default' THEN 1 END)   AS calls_with_default_offset,
# MAGIC   MAX(offset_spread_ms)                                 AS max_offset_spread_ms
# MAGIC FROM serverless_stable_prvwqx_catalog.call_insights.hvb_calls

# COMMAND ----------

# DBTITLE 1,Step 8: Intent Distribution
# MAGIC %sql
# MAGIC SELECT task_type, COUNT(*) AS calls, ROUND(AVG(stereo_audio_seconds), 1) AS avg_seconds
# MAGIC FROM serverless_stable_prvwqx_catalog.call_insights.hvb_calls
# MAGIC GROUP BY task_type
# MAGIC ORDER BY calls DESC

# COMMAND ----------

# DBTITLE 1,Return Summary for Job Runs
summary = spark.sql(f"""
  SELECT COUNT(*) AS calls,
         ROUND(SUM(stereo_audio_seconds) / 3600, 2) AS stereo_audio_hours,
         ROUND(PERCENTILE(agent_offset_seconds, 0.5), 2) AS median_agent_offset_s,
         ROUND(PERCENTILE(caller_offset_seconds, 0.5), 2) AS median_caller_offset_s,
         SUM(CASE WHEN offset_source = 'default' THEN 1 ELSE 0 END) AS calls_with_default_offset,
         MAX(offset_spread_ms) AS max_offset_spread_ms
  FROM {CALLS_TABLE}
""").first().asDict()
summary.update(utterances=spark.table(UTTS_TABLE).count(), failures=failures[:10], files_written=written)
dbutils.notebook.exit(json.dumps(summary, default=str))
