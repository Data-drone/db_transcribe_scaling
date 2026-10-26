# Databricks notebook source
# DBTITLE 1,HarperValleyBank Enrichment
# MAGIC %md
# MAGIC # HarperValleyBank Enrichment
# MAGIC
# MAGIC Masks PII and runs one `ai_query` per interaction to produce summary, contact reason, sentiment, resolution, key moments and a topic phrase (spec §9.4).
# MAGIC
# MAGIC Masked text lives in sidecar tables so a pipeline rerun (`CREATE OR REPLACE` of segments/transcripts) does not wipe it.
# MAGIC
# MAGIC **First run:** keep `max_calls` at 50 and `models` as both Haiku and Sonnet. The notebook reuses a stratified sample, scores `contact_reason` against `hvb_calls.task_type`, grounds key-moment quotes, and writes the cheaper model into `interaction_enrichment` for the app.
# MAGIC
# MAGIC **Outputs** (`serverless_stable_prvwqx_catalog.call_insights`):
# MAGIC | Table | Contents |
# MAGIC |---|---|
# MAGIC | `interaction_enrichment_sample` | Stable sample of interaction IDs for model comparison |
# MAGIC | `interaction_segments_masked` | `ai_mask` per turn |
# MAGIC | `interaction_transcripts_masked` | Prompt-ready masked transcript |
# MAGIC | `interaction_enrichment` | Production enrichment used by the app (`write_model`) |
# MAGIC | `interaction_enrichment_compare` | One row per interaction × model for the comparison |

# COMMAND ----------

# DBTITLE 1,Step 1: Configuration
dbutils.widgets.text("max_calls", "50", "Interactions to enrich (number or 'all')")
dbutils.widgets.text(
    "models",
    "databricks-claude-haiku-4-5,databricks-claude-sonnet-4-5",
    "Comma-separated serving endpoints to compare",
)
dbutils.widgets.text(
    "write_model",
    "databricks-claude-haiku-4-5",
    "Endpoint written to interaction_enrichment for the app",
)
dbutils.widgets.text("sample_name", "dev50", "Stable sample name when max_calls is not all")

CATALOG = "serverless_stable_prvwqx_catalog"
SCHEMA = "call_insights"
FQ = f"{CATALOG}.{SCHEMA}"
PROMPT_VERSION = "v1"

CONTACT_REASONS = [
    "order checks",
    "check balance",
    "replace card",
    "reset password",
    "get branch hours",
    "pay bill",
    "schedule appointment",
    "transfer money",
    "other",
]

max_calls_arg = dbutils.widgets.get("max_calls").strip().lower()
MAX_CALLS = None if max_calls_arg == "all" else int(max_calls_arg)
MODELS = [m.strip() for m in dbutils.widgets.get("models").split(",") if m.strip()]
WRITE_MODEL = dbutils.widgets.get("write_model").strip()
SAMPLE_NAME = dbutils.widgets.get("sample_name").strip() or "dev50"
if WRITE_MODEL and WRITE_MODEL not in MODELS:
    MODELS.append(WRITE_MODEL)
for name in MODELS:
    assert name.startswith("databricks-"), f"Unexpected endpoint {name}"

PROMPT_PREFIX = """You are reviewing a Harper Valley Bank customer-service call transcript.

Return JSON only, with:
- summary: 2-3 sentences covering why they called and what happened
- contact_reason: exactly one of: """ + ", ".join(CONTACT_REASONS) + """
- sentiment_start: negative, neutral, or positive (customer at the start of the call)
- sentiment_end: negative, neutral, or positive (customer at the end of the call)
- resolution_status: resolved, unresolved, transferred, or unclear
- repeat_contact_mentioned: true if they mention a previous call, callback, or being transferred from another contact
- transfer_count: integer count of transfers mentioned or performed, else 0
- topic_phrase: a 3-8 word phrase naming the topic
- key_moments: up to 6 objects with keys label, start_seconds, quote for the most important moments. quote must be copied verbatim from the transcript. start_seconds is the [mm:ss] timestamp of that line converted to seconds.

Transcript:
"""

print(
    f"Enriching {'all remaining' if MAX_CALLS is None else MAX_CALLS} interactions; "
    f"models={MODELS}; write_model={WRITE_MODEL}; sample={SAMPLE_NAME}"
)

# COMMAND ----------

# DBTITLE 1,Step 2: Create Gold Tables
spark.sql(f"""
  CREATE TABLE IF NOT EXISTS {FQ}.interaction_enrichment_sample (
    interaction_id STRING,
    sample_name    STRING,
    queue          STRING,
    selected_at    TIMESTAMP
  )
  COMMENT 'Stable interaction samples for enrichment model comparison'
""")
spark.sql(f"""
  CREATE TABLE IF NOT EXISTS {FQ}.interaction_segments_masked (
    interaction_id STRING,
    segment_idx    INT,
    text_masked    STRING
  )
  COMMENT 'PII-masked speaker turns; sidecar so pipeline rebuilds do not wipe it'
""")
spark.sql(f"""
  CREATE TABLE IF NOT EXISTS {FQ}.interaction_transcripts_masked (
    interaction_id             STRING,
    transcript_masked          STRING,
    segment_count              INT
  )
  COMMENT 'Prompt-ready masked transcript per interaction'
""")
spark.sql(f"""
  CREATE TABLE IF NOT EXISTS {FQ}.interaction_enrichment (
    interaction_id             STRING,
    summary                    STRING,
    contact_reason             STRING,
    sentiment_start            STRING,
    sentiment_end              STRING,
    resolution_status          STRING,
    repeat_contact_mentioned   BOOLEAN,
    transfer_count             INT,
    topic_phrase               STRING,
    key_moments                ARRAY<STRUCT<label:STRING, start_seconds:DOUBLE, quote:STRING, grounded:BOOLEAN>>,
    ungrounded_count           INT,
    model_endpoint             STRING,
    prompt_version             STRING,
    error_message              STRING,
    processed_at               TIMESTAMP
  )
  COMMENT 'Production enrichment for the Call Insights app (spec §9.4)'
""")
spark.sql(f"""
  CREATE TABLE IF NOT EXISTS {FQ}.interaction_enrichment_compare (
    interaction_id             STRING,
    summary                    STRING,
    contact_reason             STRING,
    sentiment_start            STRING,
    sentiment_end              STRING,
    resolution_status          STRING,
    repeat_contact_mentioned   BOOLEAN,
    transfer_count             INT,
    topic_phrase               STRING,
    key_moments                ARRAY<STRUCT<label:STRING, start_seconds:DOUBLE, quote:STRING, grounded:BOOLEAN>>,
    ungrounded_count           INT,
    model_endpoint             STRING,
    prompt_version             STRING,
    error_message              STRING,
    processed_at               TIMESTAMP
  )
  COMMENT 'Per-model enrichment rows for the 50-call comparison'
""")

# COMMAND ----------

# DBTITLE 1,Step 3: Choose Interactions
import time

started = time.time()

if MAX_CALLS is None:
    spark.sql(f"""
      CREATE OR REPLACE TEMP VIEW enrich_scope AS
      SELECT i.interaction_id, i.queue
      FROM {FQ}.interactions i
      WHERE i.transcription_status IN ('ok', 'partial')
    """)
else:
    existing = spark.sql(f"""
      SELECT COUNT(*) AS n FROM {FQ}.interaction_enrichment_sample
      WHERE sample_name = '{SAMPLE_NAME}'
    """).first().n
    if existing == 0:
        spark.sql(f"""
          INSERT INTO {FQ}.interaction_enrichment_sample
          SELECT interaction_id, '{SAMPLE_NAME}' AS sample_name, queue, current_timestamp() AS selected_at
          FROM (
            SELECT i.interaction_id, i.queue,
                   ROW_NUMBER() OVER (PARTITION BY i.queue ORDER BY i.interaction_id) AS rn
            FROM {FQ}.interactions i
            WHERE i.transcription_status IN ('ok', 'partial')
          )
          WHERE rn <= {max(1, (MAX_CALLS + 3) // 4)}
          LIMIT {MAX_CALLS}
        """)
    spark.sql(f"""
      CREATE OR REPLACE TEMP VIEW enrich_scope AS
      SELECT s.interaction_id, s.queue
      FROM {FQ}.interaction_enrichment_sample s
      WHERE s.sample_name = '{SAMPLE_NAME}'
    """)

scope_count = spark.sql("SELECT COUNT(*) AS n FROM enrich_scope").first().n
print(f"Interactions in scope: {scope_count:,}")

# COMMAND ----------

# DBTITLE 1,Step 4: Mask PII on New Segments
mask_started = time.time()
pending_segments = spark.sql(f"""
  SELECT COUNT(*) AS n
  FROM {FQ}.interaction_segments s
  JOIN enrich_scope e USING (interaction_id)
  LEFT ANTI JOIN {FQ}.interaction_segments_masked m
    ON m.interaction_id = s.interaction_id AND m.segment_idx = s.segment_idx
""").first().n
print(f"Segments to mask: {pending_segments:,}")

if pending_segments:
    spark.sql(f"""
      INSERT INTO {FQ}.interaction_segments_masked
      SELECT
        s.interaction_id,
        s.segment_idx,
        ai_mask(s.text, ARRAY('person', 'email', 'phone', 'credit_card')) AS text_masked
      FROM {FQ}.interaction_segments s
      JOIN enrich_scope e USING (interaction_id)
      LEFT ANTI JOIN {FQ}.interaction_segments_masked m
        ON m.interaction_id = s.interaction_id AND m.segment_idx = s.segment_idx
    """)

spark.sql(f"""
  CREATE OR REPLACE TABLE {FQ}.interaction_transcripts_masked
  COMMENT 'Prompt-ready masked transcript per interaction'
  AS
  SELECT
    s.interaction_id,
    array_join(
      transform(
        array_sort(collect_list(struct(
          s.segment_idx,
          format_string('[%02d:%02d] %s: %s',
            CAST(floor(s.start_seconds / 60) AS INT),
            CAST(floor(s.start_seconds % 60) AS INT),
            initcap(s.speaker_role),
            m.text_masked) AS line
        ))),
        x -> x.line),
      '\\n') AS transcript_masked,
    COUNT(*) AS segment_count
  FROM {FQ}.interaction_segments s
  LEFT JOIN {FQ}.interaction_segments_masked m
    ON m.interaction_id = s.interaction_id AND m.segment_idx = s.segment_idx
  JOIN enrich_scope e ON e.interaction_id = s.interaction_id
  GROUP BY s.interaction_id
  HAVING COUNT_IF(m.text_masked IS NULL OR TRIM(m.text_masked) = '') = 0
""")
mask_seconds = time.time() - mask_started
print(f"Masking finished in {mask_seconds:.1f}s")

# COMMAND ----------

# DBTITLE 1,Step 5: Run ai_query Per Model
from pyspark.sql.types import (
    ArrayType, BooleanType, DoubleType, IntegerType, StringType, StructField, StructType, TimestampType,
)
import json, re
from datetime import datetime, timezone

moment_schema = ArrayType(StructType([
    StructField("label", StringType(), True),
    StructField("start_seconds", DoubleType(), True),
    StructField("quote", StringType(), True),
    StructField("grounded", BooleanType(), True),
]))
enrichment_schema = StructType([
    StructField("interaction_id", StringType(), False),
    StructField("summary", StringType(), True),
    StructField("contact_reason", StringType(), True),
    StructField("sentiment_start", StringType(), True),
    StructField("sentiment_end", StringType(), True),
    StructField("resolution_status", StringType(), True),
    StructField("repeat_contact_mentioned", BooleanType(), True),
    StructField("transfer_count", IntegerType(), True),
    StructField("topic_phrase", StringType(), True),
    StructField("key_moments", moment_schema, True),
    StructField("ungrounded_count", IntegerType(), True),
    StructField("model_endpoint", StringType(), True),
    StructField("prompt_version", StringType(), True),
    StructField("error_message", StringType(), True),
    StructField("processed_at", TimestampType(), True),
])

ALLOWED = set(CONTACT_REASONS)


def normalize_text(value):
    return re.sub(r"[^a-z0-9\s]", " ", (value or "").lower())


def word_list(value):
    return [w for w in normalize_text(value).split() if w]


def ground_moments(moments, segments):
    out = []
    for moment in (moments or [])[:6]:
        quote = moment.get("quote") or ""
        label = moment.get("label") or ""
        try:
            start = float(moment.get("start_seconds") or 0)
        except (TypeError, ValueError):
            start = 0.0
        q_words = word_list(quote)
        best, best_score = None, 0.0
        nq = normalize_text(quote)
        for segment in segments:
            text = segment["text"] or ""
            nt = normalize_text(text)
            if not nq.strip() or not nt.strip():
                continue
            if nq == nt:
                score = 2.0
            elif nq in nt:
                score = 1.0 + 1.0 / max(len(nt), 1)
            elif len(nt) > 12 and nt in nq:
                score = 0.95
            elif q_words:
                tw = set(word_list(text))
                score = sum(1 for w in q_words if w in tw) / len(q_words)
            else:
                score = 0.0
            if score > best_score:
                best_score, best = score, segment
        grounded = best is not None and best_score >= 0.7
        out.append({
            "label": label,
            "start_seconds": float(best["start_seconds"]) if grounded else start,
            "quote": quote,
            "grounded": bool(grounded),
        })
    return out


def normalize_reason(value):
    raw = (value or "").strip().lower()
    return raw if raw in ALLOWED else "other"


def to_bool(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    return str(value).strip().lower() in {"true", "1", "yes"}


def to_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def strip_fences(text):
    if not text:
        return text
    return re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())


segments_by_id = {}
for row in spark.sql(f"""
  SELECT s.interaction_id, s.start_seconds, m.text_masked AS text
  FROM {FQ}.interaction_segments s
  JOIN enrich_scope e USING (interaction_id)
  LEFT JOIN {FQ}.interaction_segments_masked m
    ON m.interaction_id = s.interaction_id AND m.segment_idx = s.segment_idx
  WHERE m.text_masked IS NOT NULL AND TRIM(m.text_masked) <> ''
  ORDER BY s.interaction_id, s.segment_idx
""").collect():
    segments_by_id.setdefault(row.interaction_id, []).append(
        {"start_seconds": float(row.start_seconds), "text": row.text}
    )

spark.createDataFrame([(PROMPT_PREFIX,)], "prefix STRING").createOrReplaceTempView("prompt_prefix")
query_seconds = {}
compare_counts = {}

for model in MODELS:
    model_started = time.time()
    pending = spark.sql(f"""
      SELECT COUNT(*) AS n
      FROM enrich_scope e
      LEFT ANTI JOIN {FQ}.interaction_enrichment_compare c
        ON c.interaction_id = e.interaction_id
       AND c.model_endpoint = '{model}'
       AND c.prompt_version = '{PROMPT_VERSION}'
    """).first().n
    print(f"{model}: {pending:,} interactions to query")
    if pending:
        spark.sql(f"""
          CREATE OR REPLACE TEMP VIEW pending_enrich AS
          SELECT e.interaction_id,
                 CONCAT(p.prefix, t.transcript_masked) AS prompt
          FROM enrich_scope e
          JOIN {FQ}.interaction_transcripts_masked t USING (interaction_id)
          CROSS JOIN prompt_prefix p
          LEFT ANTI JOIN {FQ}.interaction_enrichment_compare c
            ON c.interaction_id = e.interaction_id
           AND c.model_endpoint = '{model}'
           AND c.prompt_version = '{PROMPT_VERSION}'
        """)
        raw = spark.sql(f"""
          SELECT
            interaction_id,
            CAST(ai.errorMessage AS STRING) AS error_message,
            CAST(ai.result AS STRING) AS response
          FROM (
            SELECT
              interaction_id,
              ai_query(
                '{model}',
                prompt,
                failOnError => false,
                modelParameters => named_struct('temperature', CAST(0.0 AS DOUBLE), 'max_tokens', 1200)
              ) AS ai
            FROM pending_enrich
          )
        """)
        parsed_rows = []
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        for row in raw.collect():
            error = (row.error_message or "").strip() or None
            response = row.response
            parsed = {}
            if not response and not error:
                error = "empty ai_query result"
            if response and not error:
                try:
                    parsed = json.loads(strip_fences(response))
                    if not isinstance(parsed, dict):
                        parsed, error = {}, "response was not a JSON object"
                except json.JSONDecodeError as exc:
                    parsed, error = {}, f"json: {exc}"
            moments = ground_moments(parsed.get("key_moments"), segments_by_id.get(row.interaction_id, []))
            parsed_rows.append((
                row.interaction_id,
                parsed.get("summary"),
                normalize_reason(parsed.get("contact_reason")) if parsed else None,
                (parsed.get("sentiment_start") or "").strip().lower() or None,
                (parsed.get("sentiment_end") or "").strip().lower() or None,
                (parsed.get("resolution_status") or "").strip().lower() or None,
                to_bool(parsed.get("repeat_contact_mentioned")),
                to_int(parsed.get("transfer_count")),
                parsed.get("topic_phrase"),
                moments,
                sum(1 for m in moments if not m["grounded"]),
                model,
                PROMPT_VERSION,
                error,
                now,
            ))
        spark.createDataFrame(parsed_rows, enrichment_schema).write.mode("append").saveAsTable(
            f"{FQ}.interaction_enrichment_compare"
        )
    query_seconds[model] = round(time.time() - model_started, 1)
    compare_counts[model] = spark.sql(f"""
      SELECT COUNT(*) AS n FROM {FQ}.interaction_enrichment_compare
      WHERE model_endpoint = '{model}' AND prompt_version = '{PROMPT_VERSION}'
        AND interaction_id IN (SELECT interaction_id FROM enrich_scope)
    """).first().n

# COMMAND ----------

# DBTITLE 1,Step 6: Write Production Enrichment and Score
spark.sql(f"""
  MERGE INTO {FQ}.interaction_enrichment AS t
  USING (
    SELECT * FROM {FQ}.interaction_enrichment_compare
    WHERE model_endpoint = '{WRITE_MODEL}'
      AND prompt_version = '{PROMPT_VERSION}'
      AND interaction_id IN (SELECT interaction_id FROM enrich_scope)
  ) AS s
  ON t.interaction_id = s.interaction_id
  WHEN MATCHED THEN UPDATE SET *
  WHEN NOT MATCHED THEN INSERT *
""")

scores = [
    r.asDict()
    for r in spark.sql(f"""
      SELECT
        c.model_endpoint,
        COUNT(*) AS n,
        ROUND(AVG(IF(c.error_message IS NULL, 1, 0)), 3) AS parse_ok_rate,
        ROUND(AVG(IF(lower(c.contact_reason) = lower(h.task_type), 1, 0)), 3) AS contact_reason_accuracy,
        ROUND(AVG(IF(c.ungrounded_count = 0, 1, 0)), 3) AS fully_grounded_rate,
        ROUND(AVG(c.ungrounded_count), 2) AS avg_ungrounded_moments,
        ROUND(AVG(size(c.key_moments)), 2) AS avg_key_moments
      FROM {FQ}.interaction_enrichment_compare c
      JOIN {FQ}.hvb_calls h ON h.sid = c.interaction_id
      WHERE c.prompt_version = '{PROMPT_VERSION}'
        AND c.interaction_id IN (SELECT interaction_id FROM enrich_scope)
      GROUP BY c.model_endpoint
      ORDER BY contact_reason_accuracy DESC
    """).collect()
]

confusion = [
    r.asDict()
    for r in spark.sql(f"""
      SELECT lower(h.task_type) AS task_type, c.contact_reason, COUNT(*) AS n
      FROM {FQ}.interaction_enrichment_compare c
      JOIN {FQ}.hvb_calls h ON h.sid = c.interaction_id
      WHERE c.model_endpoint = '{WRITE_MODEL}'
        AND c.prompt_version = '{PROMPT_VERSION}'
        AND c.interaction_id IN (SELECT interaction_id FROM enrich_scope)
      GROUP BY ALL
      ORDER BY n DESC
      LIMIT 20
    """).collect()
]

example = spark.sql(f"""
  SELECT interaction_id, contact_reason, sentiment_end, topic_phrase, summary
  FROM {FQ}.interaction_enrichment
  WHERE summary IS NOT NULL
  ORDER BY interaction_id
  LIMIT 1
""").first()

prod_count = spark.sql(f"SELECT COUNT(*) AS n FROM {FQ}.interaction_enrichment").first().n
masked_segments = spark.sql(f"SELECT COUNT(*) AS n FROM {FQ}.interaction_segments_masked").first().n

dbutils.notebook.exit(json.dumps({
    "scope_count": int(scope_count),
    "pending_segments_masked_this_run": int(pending_segments),
    "masked_segments_total": int(masked_segments),
    "mask_seconds": round(mask_seconds),
    "query_seconds": query_seconds,
    "compare_counts": compare_counts,
    "write_model": WRITE_MODEL,
    "production_rows": int(prod_count),
    "scores": scores,
    "write_model_confusion": confusion,
    "example": example.asDict() if example else None,
    "elapsed_seconds": round(time.time() - started),
}, default=str))
