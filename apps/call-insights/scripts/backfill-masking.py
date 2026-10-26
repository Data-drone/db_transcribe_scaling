#!/usr/bin/env python3
"""Resume the existing corpus's PII masking without running AI enrichment.

Without --execute, only read-only preflight queries run. Reports contain counts,
statement IDs, and existing-mask keys/hashes; no transcript text or credentials.
Use normal CLI authentication for the fixed project-selected profile.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

PROFILE = "fevm-serverless-stable-prvwqx"
SCHEMA = "serverless_stable_prvwqx_catalog.call_insights"
WAREHOUSE = "8d4699c5c6d30f71"
LABELS = "ARRAY('person', 'email', 'phone', 'credit_card')"


def now():
    return datetime.now(timezone.utc).isoformat()


def mask_digest(rows):
    canonical = sorted((str(r["interaction_id"]), int(r["segment_idx"]), r["mask_sha256"]) for r in rows)
    return hashlib.sha256(json.dumps(canonical, separators=(",", ":")).encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Authorize writes to the two existing masking tables")
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--report", type=Path, default=Path("/private/tmp/call-insights-masking-backfill.json"))
    args = parser.parse_args()
    if not 1 <= args.batch_size <= 10000:
        parser.error("--batch-size must be between 1 and 10000")
    if os.environ.get("DATABRICKS_CONFIG_PROFILE", PROFILE) != PROFILE:
        parser.error("DATABRICKS_CONFIG_PROFILE must match the project-selected profile")
    config = {"profile": PROFILE, "schema": SCHEMA, "warehouse_id": WAREHOUSE}
    if args.report.exists():
        report = json.loads(args.report.read_text())
        if report.get("configuration") != config:
            parser.error("Existing report belongs to different resources; choose a new --report path")
    else:
        report = {"configuration": config, "started_at": now(), "statements": [], "batches": []}

    def save():
        args.report.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.report.with_name(args.report.name + ".tmp")
        temporary.write_text(json.dumps(report, indent=2) + "\n")
        temporary.replace(args.report)

    def query(stage, statement):
        entry = {"stage": stage, "started_at": now(), "state": "SUBMITTING"}
        report["statements"].append(entry)
        save()
        process = subprocess.run(
            ["databricks", "experimental", "aitools", "tools", "query", "--warehouse", WAREHOUSE,
             "--profile", PROFILE, "--output", "json", "--concurrency", "1",
             statement, "SELECT 1 AS backfill_transport_probe"],
            capture_output=True, text=True,
            env={**os.environ, "DATABRICKS_CONFIG_PROFILE": PROFILE},
        )
        entry.update(finished_at=now(), return_code=process.returncode)
        try:
            # Single-query CLI output contains rows only. A harmless second
            # query forces envelopes containing statement IDs and SQL states.
            envelope = json.loads(process.stdout)
            if not isinstance(envelope, list) or len(envelope) != 2:
                raise ValueError("Expected two statement envelopes")
            result, probe = envelope
            entry.update(statement_id=result.get("statement_id"), state=result.get("state", "UNKNOWN"),
                         elapsed_ms=result.get("elapsed_ms"), probe_statement_id=probe.get("statement_id"),
                         probe_state=probe.get("state", "UNKNOWN"))
        except (ValueError, TypeError, AttributeError):
            entry["state"] = "UNKNOWN"
            save()
            raise RuntimeError(f"{stage}: CLI did not return a statement result; output omitted for privacy") from None
        save()
        print(json.dumps({"stage": stage, "statement_id": entry.get("statement_id"), "state": entry["state"]}), flush=True)
        if (process.returncode or entry["state"] != "SUCCEEDED" or result.get("error")
                or probe.get("state") != "SUCCEEDED" or probe.get("error")):
            raise RuntimeError(f"{stage}: SQL did not succeed; inspect its statement ID in the workspace")
        columns = [c if isinstance(c, str) else c["name"] for c in result.get("columns", [])]
        return [r if isinstance(r, dict) else dict(zip(columns, r)) for r in result.get("rows", [])]

    def counts(stage):
        rows = query(stage, f"""
WITH source_duplicates AS (
  SELECT interaction_id, segment_idx FROM {SCHEMA}.interaction_segments
  GROUP BY interaction_id, segment_idx HAVING COUNT(*) > 1
), mask_duplicates AS (
  SELECT interaction_id, segment_idx FROM {SCHEMA}.interaction_segments_masked
  GROUP BY interaction_id, segment_idx HAVING COUNT(*) > 1
), transcript_duplicates AS (
  SELECT interaction_id FROM {SCHEMA}.interaction_transcripts_masked
  GROUP BY interaction_id HAVING COUNT(*) > 1
), coverage AS (
  SELECT i.interaction_id, COUNT(s.segment_idx) AS turns,
    COUNT_IF(NULLIF(TRIM(m.text_masked), '') IS NOT NULL) AS masked_turns
  FROM {SCHEMA}.interactions i
  LEFT JOIN {SCHEMA}.interaction_segments s ON s.interaction_id=i.interaction_id
  LEFT JOIN {SCHEMA}.interaction_segments_masked m
    ON m.interaction_id=s.interaction_id AND m.segment_idx=s.segment_idx
  GROUP BY i.interaction_id
)
SELECT COUNT(*) AS total_calls,
  COUNT_IF(turns > 0 AND turns=masked_turns) AS complete_calls,
  COUNT_IF(turns=0) AS calls_without_turns,
  COALESCE(SUM(turns),0) AS source_turns, COALESCE(SUM(masked_turns),0) AS masked_turns,
  (SELECT COUNT(*) FROM source_duplicates) AS duplicate_source_keys,
  (SELECT COUNT(*) FROM mask_duplicates) AS duplicate_mask_keys,
  (SELECT COUNT(*) FROM transcript_duplicates) AS duplicate_transcript_keys,
  (SELECT COUNT(*) FROM {SCHEMA}.interaction_segments
   WHERE interaction_id IS NULL OR segment_idx IS NULL) AS null_source_keys,
  (SELECT COUNT(*) FROM {SCHEMA}.interaction_segments
   WHERE NULLIF(TRIM(text), '') IS NULL) AS blank_source_turns,
  (SELECT COUNT(*) FROM {SCHEMA}.interaction_segments_masked
   WHERE NULLIF(TRIM(text_masked), '') IS NULL) AS blank_mask_rows,
  (SELECT COUNT(*) FROM {SCHEMA}.interaction_segments s
   LEFT ANTI JOIN {SCHEMA}.interactions i ON i.interaction_id=s.interaction_id) AS orphan_source_turns,
  (SELECT COUNT(*) FROM {SCHEMA}.interaction_transcripts_masked) AS prompt_transcripts
FROM coverage
""")
        if len(rows) != 1:
            raise RuntimeError("Coverage query returned an unexpected result")
        return {key: int(value) for key, value in rows[0].items()}

    def pending(stage):
        rows = query(stage, f"""
SELECT COUNT(*) AS pending_turns FROM {SCHEMA}.interaction_segments s
LEFT JOIN {SCHEMA}.interaction_segments_masked m
  ON m.interaction_id=s.interaction_id AND m.segment_idx=s.segment_idx
WHERE NULLIF(TRIM(m.text_masked), '') IS NULL
""")
        return int(rows[0]["pending_turns"])

    def masks(stage):
        return query(stage, f"""
SELECT interaction_id, segment_idx, sha2(text_masked,256) AS mask_sha256
FROM {SCHEMA}.interaction_segments_masked WHERE NULLIF(TRIM(text_masked), '') IS NOT NULL
ORDER BY interaction_id, segment_idx
""")

    def verify_original(current):
        original = report["original_masks"]
        index = {(str(r["interaction_id"]), int(r["segment_idx"])): r["mask_sha256"] for r in current}
        selected = []
        for row in original:
            digest = index.get((str(row["interaction_id"]), int(row["segment_idx"])))
            if digest != row["mask_sha256"]:
                raise RuntimeError("An original valid mask changed or disappeared")
            selected.append({**row, "mask_sha256": digest})
        if mask_digest(selected) != report["original_masks_digest"]:
            raise RuntimeError("Original-mask aggregate digest mismatch")
        report["original_masks_unchanged"] = True

    try:
        if "failure" in report:
            report.setdefault("previous_failures", []).append(
                {"finished_at": report.get("finished_at"), **report.pop("failure")}
            )
        report.pop("finished_at", None)
        report.update(status="preflight", last_started_at=now(), execute=args.execute, batch_size=args.batch_size)
        save()
        before = counts("preflight_coverage")
        report["latest_preflight"] = before
        report.setdefault("before", before)
        invalid = [k for k in ("duplicate_source_keys", "duplicate_mask_keys", "duplicate_transcript_keys",
                              "null_source_keys", "blank_source_turns", "orphan_source_turns", "calls_without_turns") if before[k]]
        if invalid:
            raise RuntimeError("Preflight requires source repair: " + ", ".join(invalid))
        original = masks("preflight_mask_hashes")
        if "original_masks" not in report:
            report["original_masks"] = original
            report["original_masks_digest"] = mask_digest(original)
        verify_original(original)
        remaining = pending("preflight_pending")
        report["pending_turns"] = remaining
        save()
        print(json.dumps({"preflight": before, "pending_turns": remaining, "execute": args.execute}), flush=True)
        if not args.execute:
            report.update(status="preflight_passed", finished_at=now())
            save()
            return 0
        report["status"] = "masking"
        save()
        while remaining:
            batch_number = len(report["batches"]) + 1
            query(f"mask_batch_{batch_number}", f"""
MERGE INTO {SCHEMA}.interaction_segments_masked t
USING (
  SELECT s.interaction_id, s.segment_idx, s.text
  FROM {SCHEMA}.interaction_segments s
  LEFT JOIN {SCHEMA}.interaction_segments_masked existing
    ON existing.interaction_id=s.interaction_id AND existing.segment_idx=s.segment_idx
  WHERE NULLIF(TRIM(existing.text_masked), '') IS NULL
  ORDER BY s.interaction_id, s.segment_idx
  LIMIT {args.batch_size}
) s ON t.interaction_id=s.interaction_id AND t.segment_idx=s.segment_idx
WHEN MATCHED AND NULLIF(TRIM(t.text_masked), '') IS NULL THEN
  UPDATE SET text_masked=ai_mask(s.text,{LABELS})
WHEN NOT MATCHED THEN INSERT (interaction_id,segment_idx,text_masked)
  VALUES (s.interaction_id,s.segment_idx,ai_mask(s.text,{LABELS}))
""")
            after_pending = pending(f"pending_after_batch_{batch_number}")
            report["batches"].append({"batch": batch_number, "pending_before": remaining,
                                      "pending_after": after_pending, "finished_at": now()})
            report["pending_turns"] = after_pending
            save()
            print(json.dumps({"batch": batch_number, "pending_turns": after_pending}), flush=True)
            if after_pending >= remaining:
                # Reuse only an unambiguous, already-masked output for exactly
                # the same UTF-8 input bytes. Empty model responses never fall
                # back to raw source text or an invented placeholder.
                query(f"reuse_identical_input_after_batch_{batch_number}", f"""
MERGE INTO {SCHEMA}.interaction_segments_masked t
USING (
  WITH pending_inputs AS (
    SELECT s.interaction_id, s.segment_idx, encode(s.text,'UTF-8') AS source_bytes
    FROM {SCHEMA}.interaction_segments s
    LEFT JOIN {SCHEMA}.interaction_segments_masked existing
      ON existing.interaction_id=s.interaction_id AND existing.segment_idx=s.segment_idx
    WHERE NULLIF(TRIM(existing.text_masked), '') IS NULL
  ), consistent_outputs AS (
    SELECT encode(s.text,'UTF-8') AS source_bytes, MIN(m.text_masked) AS text_masked
    FROM {SCHEMA}.interaction_segments s
    JOIN {SCHEMA}.interaction_segments_masked m
      ON m.interaction_id=s.interaction_id AND m.segment_idx=s.segment_idx
    WHERE NULLIF(TRIM(m.text_masked), '') IS NOT NULL
      AND encode(s.text,'UTF-8') IN (SELECT source_bytes FROM pending_inputs)
    GROUP BY encode(s.text,'UTF-8')
    HAVING COUNT(DISTINCT encode(m.text_masked,'UTF-8'))=1
  )
  SELECT p.interaction_id, p.segment_idx, c.text_masked
  FROM pending_inputs p JOIN consistent_outputs c ON p.source_bytes=c.source_bytes
) s ON t.interaction_id=s.interaction_id AND t.segment_idx=s.segment_idx
WHEN MATCHED AND NULLIF(TRIM(t.text_masked), '') IS NULL THEN
  UPDATE SET text_masked=s.text_masked
WHEN NOT MATCHED THEN INSERT (interaction_id,segment_idx,text_masked)
  VALUES(s.interaction_id,s.segment_idx,s.text_masked)
""")
                recovered_pending = pending(f"pending_after_identical_input_reuse_{batch_number}")
                recovery = {"after_batch": batch_number, "pending_before": after_pending,
                            "pending_after": recovered_pending, "finished_at": now()}
                report.setdefault("identical_input_recovery", []).append(recovery)
                report["pending_turns"] = recovered_pending
                save()
                print(json.dumps({"recovery": "consistent_identical_input", **recovery}), flush=True)
                if recovered_pending >= after_pending:
                    raise RuntimeError("Masking and exact-input reuse made no progress; inspect the last statements")
                after_pending = recovered_pending
            remaining = after_pending
        report["status"] = "rebuilding_prompt_transcripts"
        save()
        query("merge_prompt_transcripts", f"""
MERGE INTO {SCHEMA}.interaction_transcripts_masked t
USING (
  SELECT s.interaction_id,
    array_join(transform(array_sort(collect_list(struct(s.segment_idx,
      format_string('[%02d:%02d] %s: %s', CAST(floor(s.start_seconds/60) AS INT),
        CAST(floor(s.start_seconds%60) AS INT), initcap(s.speaker_role), m.text_masked) AS line))),
      x -> x.line),chr(10)) AS transcript_masked,
    CAST(COUNT(*) AS INT) AS segment_count
  FROM {SCHEMA}.interaction_segments s
  LEFT JOIN {SCHEMA}.interaction_segments_masked m
    ON m.interaction_id=s.interaction_id AND m.segment_idx=s.segment_idx
  GROUP BY s.interaction_id
  HAVING COUNT_IF(NULLIF(TRIM(m.text_masked), '') IS NULL)=0
) s ON t.interaction_id=s.interaction_id
WHEN MATCHED THEN UPDATE SET transcript_masked=s.transcript_masked,segment_count=s.segment_count
WHEN NOT MATCHED THEN INSERT (interaction_id,transcript_masked,segment_count)
  VALUES(s.interaction_id,s.transcript_masked,s.segment_count)
""")
        report["status"] = "validating"
        save()
        final = counts("final_coverage")
        report["after"] = final
        verify_original(masks("final_mask_hashes"))
        for key in ("duplicate_source_keys", "duplicate_mask_keys", "duplicate_transcript_keys",
                    "null_source_keys", "blank_source_turns", "blank_mask_rows", "orphan_source_turns", "calls_without_turns"):
            if final[key]:
                raise RuntimeError("Final validation failed: " + key)
        if final["complete_calls"] != final["total_calls"] or final["masked_turns"] != final["source_turns"]:
            raise RuntimeError("Final coverage is incomplete")
        if final["prompt_transcripts"] != final["total_calls"]:
            raise RuntimeError("Prompt-transcript coverage does not match the corpus")
        report.update(status="complete", finished_at=now())
        save()
        print(json.dumps({"status": "complete", "coverage": final, "original_masks_unchanged": True,
                          "report": str(args.report.resolve())}), flush=True)
        return 0
    except BaseException as error:
        report.update(status="interrupted" if isinstance(error, KeyboardInterrupt) else "failed", finished_at=now(),
                      failure={"type": type(error).__name__, "message": str(error) if isinstance(error, RuntimeError) else "Execution stopped; inspect statement status before retrying"})
        save()
        print(json.dumps({"status": report["status"], "failure": report["failure"], "report": str(args.report.resolve())}), file=sys.stderr, flush=True)
        return 130 if isinstance(error, KeyboardInterrupt) else 1


if __name__ == "__main__":
    sys.exit(main())
