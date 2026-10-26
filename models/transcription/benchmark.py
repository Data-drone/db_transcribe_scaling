"""Deterministic ASR scoring and bounded closed-loop load generation (no Spark dependency)."""
from __future__ import annotations

from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import io
import math
import random
import re
import time
import unicodedata
import wave

NORMALIZATION = "nfkc_casefold_strip_bracket_annotations_unicode_words_apostrophes_v1"
COMPLETED = {"ok", "empty", "no_speech"}


def words(text: str) -> list[str]:
    text = unicodedata.normalize("NFKC", text or "").casefold().replace("’", "'")
    text = re.sub(r"\[[^\]]*\]", " ", text)
    return re.findall(r"[^\W_]+(?:'[^\W_]+)*", text)


def edits(reference, hypothesis) -> dict:
    """Levenshtein counts; deterministic ties prefer substitution, deletion, insertion."""
    previous = [(j, 0, 0, j) for j in range(len(hypothesis) + 1)]
    for i, token in enumerate(reference, 1):
        current = [(i, 0, i, 0)]
        for j, other in enumerate(hypothesis, 1):
            distance, substitutions, deletions, insertions = previous[j - 1]
            mismatch = int(token != other)
            diagonal = (distance + mismatch, substitutions + mismatch, deletions, insertions)
            distance, substitutions, deletions, insertions = previous[j]
            delete = (distance + 1, substitutions, deletions + 1, insertions)
            distance, substitutions, deletions, insertions = current[j - 1]
            insert = (distance + 1, substitutions, deletions, insertions + 1)
            current.append(min((diagonal, delete, insert), key=lambda item: item[0]))
        previous = current
    return dict(zip(("errors", "substitutions", "deletions", "insertions"), previous[-1]))


def score(reference: str, hypothesis: str) -> dict:
    ref, hyp = words(reference), words(hypothesis)
    if not ref:
        raise ValueError("Accuracy samples must have a non-empty normalized human reference")
    counts = edits(ref, hyp)
    ref_chars, hyp_chars = " ".join(ref).replace(" ", ""), " ".join(hyp).replace(" ", "")
    character_errors = edits(ref_chars, hyp_chars)["errors"]
    return {**counts, "reference_words": len(ref), "reference_characters": len(ref_chars),
            "character_errors": character_errors, "wer": counts["errors"] / len(ref),
            "cer": character_errors / len(ref_chars), "exact_match": int(ref == hyp)}


def select_samples(candidates: list[dict], count: int, seed: int) -> list[dict]:
    """Round-robin role/duration strata, independent of ASR output or prior status."""
    buckets = defaultdict(list)
    seen = set()
    for item in candidates:
        if item["sample_id"] in seen:
            raise ValueError(f"Duplicate reference sample: {item['sample_id']}")
        seen.add(item["sample_id"])
        band = "short" if item["duration_seconds"] <= 3 else "medium" if item["duration_seconds"] <= 8 else "long"
        buckets[(item["speaker_role"], band)].append(item)
    for bucket in buckets.values():
        bucket.sort(key=lambda item: hashlib.sha256(f"{seed}:{item['sample_id']}".encode()).hexdigest())
    keys = sorted(buckets)
    random.Random(seed).shuffle(keys)
    result = []
    while len(result) < count:
        added = False
        for key in keys:
            if buckets[key] and len(result) < count:
                result.append(buckets[key].pop(0))
                added = True
        if not added:
            break
    return result


def crop_wav(path: str, start: float, duration: float) -> bytes:
    if not all(math.isfinite(v) for v in (start, duration)) or start < 0 or not 0 < duration <= 28:
        raise ValueError("Invalid reference crop bounds")
    with wave.open(path, "rb") as source:
        rate = source.getframerate()
        if (source.getnchannels(), source.getsampwidth(), source.getcomptype()) != (1, 2, "NONE"):
            raise ValueError("Source must be mono PCM16 WAV")
        first, last = round(start * rate), round((start + duration) * rate)
        if first >= source.getnframes() or last > source.getnframes() + 1:
            raise ValueError("Reference crop extends beyond source audio")
        last = min(last, source.getnframes())
        source.setpos(first)
        pcm = source.readframes(last - first)
        if len(pcm) != (last - first) * 2:
            raise ValueError("Truncated source audio")
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(rate)
        target.writeframes(pcm)
    return output.getvalue()


def ai_result(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("ai_transcribe returned a non-object result")
    error = raw.get("error_message") or ""
    if error:
        return {"status": "no_speech" if error.startswith("stage12 segmentation size 0") else "error",
                "text": "", "error": error, "raw": raw}
    response = raw.get("response")
    if not isinstance(response, dict):
        raise ValueError("ai_transcribe returned no response object")
    text = response.get("text")
    if text is None:
        segments = response.get("segments", [])
        if not isinstance(segments, list):
            raise ValueError("ai_transcribe segments must be an array")
        text = " ".join(segment.get("text", "") for segment in segments)
    if not isinstance(text, str):
        raise ValueError("ai_transcribe text must be a string")
    return {"status": "ok" if text.strip() else "empty", "text": text.strip(), "error": "", "raw": raw}


def percentile(values: list[float], quantile: float) -> float:
    values = sorted(values)
    position = (len(values) - 1) * quantile
    lower = math.floor(position)
    return values[lower] + (values[math.ceil(position)] - values[lower]) * (position - lower)


def run_load(samples: list[dict], invoke, concurrency: int, *, clock=time.perf_counter) -> tuple[list[dict], float]:
    """One attempt/sample; no application retries. All planned samples produce a scored row."""
    if not samples or not 1 <= concurrency <= 16:
        raise ValueError("Provide samples and concurrency between 1 and 16")
    started = clock()

    def execute(index, item, submitted):
        began = clock()
        latency = None
        result = {"status": "error", "text": "", "error": item.get("preparation_error", "")}
        request_made = not bool(item.get("preparation_error"))
        if request_made:
            try:
                result = invoke(item)
                if result["status"] not in COMPLETED | {"error"} or not isinstance(result["text"], str):
                    raise ValueError("Unexpected backend result contract")
            except Exception as exc:
                result = {"status": "error", "text": "", "error": f"{type(exc).__name__}: {exc}"[:1000],
                          "error_code": getattr(exc, "error_code", "")}
            latency = clock() - began
        hypothesis = result["text"] if result["status"] in COMPLETED else ""
        public = {key: value for key, value in item.items() if not key.startswith("_")}
        return {**public, "sequence": index, "status": result["status"], "hypothesis": hypothesis,
                "error": result.get("error", ""), "error_code": result.get("error_code", ""),
                "raw": result.get("raw"), "request_made": request_made,
                "request_latency_seconds": latency, "client_queue_seconds": began - submitted,
                "completion_latency_seconds": clock() - submitted,
                **score(item["reference_text"], hypothesis)}

    results = []
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(execute, index, item, clock()) for index, item in enumerate(samples)]
        for future in as_completed(futures):
            results.append(future.result())
    return sorted(results, key=lambda row: row["sequence"]), clock() - started


def summarize(rows: list[dict], wall_seconds: float) -> dict:
    if not rows or wall_seconds <= 0:
        raise ValueError("Cannot summarize an empty or zero-duration load test")
    ref_words = sum(r["reference_words"] for r in rows)
    ref_chars = sum(r["reference_characters"] for r in rows)
    successful = [r for r in rows if r["status"] == "ok"]
    completed = [r for r in rows if r["status"] in COMPLETED]
    measured = [r for r in rows if r["request_latency_seconds"] is not None]
    total_audio = sum(r["input_duration_seconds"] for r in rows)
    metrics = {"samples": len(rows), "requests": len(measured), "wall_seconds": wall_seconds,
               "wer_all": sum(r["errors"] for r in rows) / ref_words,
               "cer_all": sum(r["character_errors"] for r in rows) / ref_chars,
               "exact_match_rate": sum(r["exact_match"] for r in rows) / len(rows),
               "error_rate": sum(r["status"] == "error" for r in rows) / len(rows),
               "empty_rate": sum(r["status"] in {"empty", "no_speech"} for r in rows) / len(rows),
               "response_completion_rate": len(completed) / len(rows),
               "nonempty_transcription_rate": len(successful) / len(rows),
               "preparation_errors": sum(not r["request_made"] for r in rows),
               "reference_words": ref_words, "input_audio_seconds": total_audio,
               "attempted_requests_per_second": len(measured) / wall_seconds,
               "successful_audio_hours_per_wall_hour": sum(r["input_duration_seconds"] for r in successful) / wall_seconds,
               "batch_wall_rtf": wall_seconds / total_audio}
    for key in ("errors", "substitutions", "deletions", "insertions"):
        metrics[key] = sum(r[key] for r in rows)
    for role in sorted({r["speaker_role"] for r in rows}):
        subset = [r for r in rows if r["speaker_role"] == role]
        metrics[f"wer_{role}"] = sum(r["errors"] for r in subset) / sum(r["reference_words"] for r in subset)
    if completed:
        metrics["wer_completed_only"] = sum(r["errors"] for r in completed) / sum(r["reference_words"] for r in completed)
    for label, subset in (("all", measured), ("ok", [r for r in measured if r["status"] == "ok"])):
        if subset:
            latencies = [r["request_latency_seconds"] for r in subset]
            metrics.update({f"latency_{label}_p50_seconds": percentile(latencies, .5),
                            f"latency_{label}_p95_seconds": percentile(latencies, .95),
                            f"latency_{label}_mean_seconds": sum(latencies) / len(latencies),
                            f"request_{label}_rtf_p50": percentile([
                                r["request_latency_seconds"] / r["input_duration_seconds"] for r in subset], .5)})
    if measured:
        metrics["client_queue_p95_seconds"] = percentile([r["client_queue_seconds"] for r in measured], .95)
        metrics["completion_p95_seconds"] = percentile([r["completion_latency_seconds"] for r in measured], .95)
    return metrics


def paired_wer_delta(left: list[dict], right: list[dict], seed: int, draws: int = 1000) -> dict:
    """Qwen minus ai_transcribe, paired bootstrap by call (not correlated utterances)."""
    a, b = {r["sample_id"]: r for r in left}, {r["sample_id"]: r for r in right}
    if len(a) != len(left) or len(b) != len(right) or a.keys() != b.keys():
        raise ValueError("Paired accuracy needs the same unique sample IDs")
    calls = defaultdict(lambda: [0, 0])
    for key, row in a.items():
        other = b[key]
        if row["reference_text"] != other["reference_text"] or row["input_sha256"] != other["input_sha256"]:
            raise ValueError("Paired accuracy inputs differ")
        calls[row["sid"]][0] += other["errors"] - row["errors"]
        calls[row["sid"]][1] += row["reference_words"]
    values = list(calls.values())
    result = {"wer_delta_qwen_minus_ai": sum(v[0] for v in values) / sum(v[1] for v in values),
              "independent_calls": len(values)}
    if len(values) >= 2:
        rng = random.Random(seed)
        bootstrap = []
        for _ in range(draws):
            selected = rng.choices(values, k=len(values))
            bootstrap.append(sum(v[0] for v in selected) / sum(v[1] for v in selected))
        result.update(wer_delta_ci95_low=percentile(bootstrap, .025),
                      wer_delta_ci95_high=percentile(bootstrap, .975))
    return result
