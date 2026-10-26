from __future__ import annotations

from copy import deepcopy
import io
from pathlib import Path
import tempfile
import threading
import time
import unittest
import wave

from benchmark import ai_result, crop_wav, edits, paired_wer_delta, run_load, score, select_samples, summarize, words
from test_serving import wav_bytes


def sample(index=0, **changes):
    return {"sample_id": f"c{index}", "sid": f"call{index % 2}", "speaker_role": "agent",
            "reference_text": "one two three", "input_sha256": f"hash{index}",
            "input_duration_seconds": 2.0, "duration_seconds": 2.0, **changes}


class AccuracyTests(unittest.TestCase):
    def test_normalization_and_edit_counts(self):
        self.assertEqual(words("[noise] HELLO, can’t pay $20.30!"), ["hello", "can't", "pay", "20", "30"])
        self.assertEqual(edits(["a", "b"], ["a", "x", "c"]),
                         {"errors": 2, "substitutions": 1, "deletions": 0, "insertions": 1})
        self.assertEqual(score("one two three", "")["deletions"], 3)
        self.assertEqual(score("a", "a b c")["wer"], 2.0)  # WER is not capped at one.

    def test_ai_response_and_no_speech_are_not_invented_text(self):
        self.assertEqual(ai_result({"response": {"segments": [{"text": "Hello"}, {"text": "bank"}]}})["text"], "Hello bank")
        self.assertEqual(ai_result({"error_message": "stage12 segmentation size 0: no audio"})["status"], "no_speech")
        self.assertEqual(ai_result({"error_message": "request throttled"})["status"], "error")
        with self.assertRaises(ValueError):
            ai_result({})

    def test_failures_are_scored_and_excluded_from_useful_throughput(self):
        def invoke(item):
            if item["sample_id"] == "c0":
                raise RuntimeError("throttled")
            return {"status": "ok", "text": "four"}
        rows, _ = run_load([sample(0), sample(1, reference_text="four")], invoke, 1)
        metrics = summarize(rows, 2.0)
        self.assertEqual(metrics["wer_all"], 3 / 4)  # Weighted by four reference words, not mean(1, 0).
        self.assertEqual(metrics["wer_completed_only"], 0)
        self.assertEqual(metrics["error_rate"], .5)
        self.assertEqual(metrics["successful_audio_hours_per_wall_hour"], 1.0)
        self.assertEqual(rows[0]["hypothesis"], "")

    def test_preparation_failure_is_retained_without_a_request(self):
        def forbidden(item):
            self.fail("Must not send an invalid audio crop")
        rows, _ = run_load([sample(preparation_error="missing source")], forbidden, 1)
        metrics = summarize(rows, 1.0)
        self.assertEqual(metrics["wer_all"], 1)
        self.assertEqual(metrics["requests"], 0)
        self.assertEqual(metrics["successful_audio_hours_per_wall_hour"], 0)
        self.assertNotIn("latency_all_p95_seconds", metrics)

    def test_call_paired_bootstrap_and_input_identity(self):
        left, _ = run_load([sample(0), sample(1)], lambda item: {"status": "error", "text": ""}, 1)
        right, _ = run_load([sample(0), sample(1)], lambda item: {"status": "ok", "text": "one two three"}, 1)
        result = paired_wer_delta(left, right, 42, draws=100)
        self.assertEqual(result["wer_delta_qwen_minus_ai"], -1)
        self.assertEqual(result["independent_calls"], 2)
        self.assertEqual(result["wer_delta_ci95_low"], -1)
        changed = deepcopy(right)
        changed[0]["input_sha256"] = "different"
        with self.assertRaises(ValueError):
            paired_wer_delta(left, changed, 42)
        with self.assertRaises(ValueError):
            paired_wer_delta(left, right[:1], 42)


class SamplingAndLoadTests(unittest.TestCase):
    def test_balanced_selection_is_deterministic_and_order_independent(self):
        candidates = [sample(i, speaker_role=role, duration_seconds=duration)
                      for i, (role, duration) in enumerate((
                          ("agent", 2), ("agent", 5), ("agent", 15),
                          ("customer", 2), ("customer", 5), ("customer", 15), ("agent", 2)))]
        chosen = select_samples(candidates, 6, 42)
        self.assertEqual(chosen, select_samples(list(reversed(candidates)), 6, 42))
        self.assertEqual(sum(item["speaker_role"] == "agent" for item in chosen), 3)
        with self.assertRaises(ValueError):
            select_samples([sample(), sample()], 2, 42)

    def test_crop_contains_exact_requested_frames(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "source.wav"
            path.write_bytes(wav_bytes(seconds=3))
            data = crop_wav(str(path), .5, 1.25)
            with wave.open(io.BytesIO(data), "rb") as audio:
                self.assertEqual(audio.getnframes(), 10000)
                self.assertEqual(audio.getnchannels(), 1)
                self.assertEqual(audio.readframes(10000), b"\x01\x01" * 10000)
            with self.assertRaises(ValueError):
                crop_wav(str(path), 2.5, 1)

    def test_load_is_bounded_ordered_and_one_attempt_per_item(self):
        lock = threading.Lock()
        active, peak, calls = 0, 0, []

        def invoke(item):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
                calls.append(item["sample_id"])
            time.sleep(.01)
            with lock:
                active -= 1
            return {"status": "ok", "text": "one two three"}

        rows, wall = run_load([sample(i) for i in range(8)], invoke, 2)
        self.assertEqual([row["sample_id"] for row in rows], [f"c{i}" for i in range(8)])
        self.assertEqual(len(set(calls)), 8)
        self.assertLessEqual(peak, 2)
        self.assertGreater(wall, 0)
        self.assertTrue(all(row["completion_latency_seconds"] >= row["request_latency_seconds"] for row in rows))


if __name__ == "__main__":
    unittest.main()
