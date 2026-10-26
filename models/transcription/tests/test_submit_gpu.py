from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from test_serving import wav_bytes
import submit_gpu


class SubmissionTests(unittest.TestCase):
    def test_url_requirements_are_single_inline_tokens(self):
        config = submit_gpu.workload(Path("/tmp/stage"), model="cat.schema.asr", experiment="test",
                                     directory="/Workspace/Users/test", expected_text="hello", timeout=20,
                                     dependencies=["torch @ https://example.com/torch.whl"],
                                     revision="a" * 40, aligner_revision="b" * 40)
        self.assertEqual(config["environment"]["dependencies"][0], "torch@https://example.com/torch.whl")
        self.assertIn("--revision " + "a" * 40, config["command"])
        self.assertIn("--aligner-revision " + "b" * 40, config["command"])

    def run_main(self, root, extra=()):
        fixture = root / "fixture.wav"
        fixture.write_bytes(wav_bytes())
        argv = ["submit_gpu.py", "--profile", "chosen-workspace", "--registered-model", "cat.schema.asr",
                "--experiment-directory", "/Workspace/Users/test@example.com", "--sample-wav", str(fixture),
                "--expected-text", "a phrase with 'quotes' and $(literal)", "--output-dir", str(root / "output"),
                *extra]
        with patch.object(sys, "argv", argv), contextlib.redirect_stdout(io.StringIO()):
            submit_gpu.main()

    def test_default_only_validates_and_stages_selected_files(self):
        def check(command, **kwargs):
            config = json.loads(Path(command[command.index("--file") + 1]).read_text())
            stage = Path(config["code_source"]["root_path"])
            self.assertEqual((stage / "fixture.wav").read_bytes(), wav_bytes())
            self.assertFalse((stage / ".venv").exists())
            self.assertEqual(config["max_retries"], 0)
            self.assertIn("'a phrase with", config["command"])
            self.assertIn("--dry-run", command)
            self.assertEqual(command[command.index("--profile") + 1], "chosen-workspace")
            return SimpleNamespace(returncode=0, stdout='{"data":{"status":"DRY_RUN_OK"}}', stderr="")
        with tempfile.TemporaryDirectory() as temp, patch.object(submit_gpu.subprocess, "run", side_effect=check) as run:
            self.run_main(Path(temp))
            self.assertEqual(run.call_count, 1)

    def test_apply_requires_idempotency_key(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(submit_gpu.subprocess, "run") as run:
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                self.run_main(Path(temp), ["--apply"])
            run.assert_not_called()

    def test_failed_validation_never_launches(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(submit_gpu.subprocess, "run") as run:
            run.return_value = SimpleNamespace(returncode=1, stdout="", stderr="FEATURE_DISABLED")
            with self.assertRaises(SystemExit):
                self.run_main(Path(temp), ["--apply", "--idempotency-key", "stable-key"])
            self.assertEqual(run.call_count, 1)

    def test_apply_validates_then_submits_with_stable_key(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(submit_gpu.subprocess, "run") as run:
            run.return_value = SimpleNamespace(returncode=0, stdout='{"data":{"run_id":123}}', stderr="")
            self.run_main(Path(temp), ["--apply", "--idempotency-key", "stable-key"])
            commands = [call.args[0] for call in run.call_args_list]
            self.assertIn("--dry-run", commands[0])
            self.assertNotIn("--dry-run", commands[1])
            self.assertEqual(commands[1][-2:], ["--idempotency-key", "stable-key"])
            self.assertEqual(json.loads((Path(temp) / "output/submission.json").read_text())["data"]["run_id"], 123)


if __name__ == "__main__":
    unittest.main()
