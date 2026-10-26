from __future__ import annotations

import base64
from copy import deepcopy
import io
import json
import math
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from deploy import endpoint_config, main as deploy_main, requested_version_ready, wait_for_version
from query import query_chunks
from register import check_prediction
from runtime import (MAX_REQUEST_BYTES, decode_request, immutable_revision, normalize_result,
                     output_record, read_wav, registered_name, validate_batch)


def wav_bytes(*, channels=1, rate=8000, seconds=1, silent=False):
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes((b"\x00\x00" if silent else b"\x01\x01") * int(rate * seconds) * channels)
    return buffer.getvalue()


def row(**changes):
    return {"chunk_id": "c1", "audio_base64": base64.b64encode(wav_bytes()).decode(), **changes}


MANIFEST = {"model_id": "Qwen/Qwen3-ASR-1.7B", "model_revision": "a" * 40,
            "aligner_revision": "b" * 40}


def engine_result():
    return SimpleNamespace(text="Hello world.", language="English", time_stamps=[
        SimpleNamespace(text="Hello", start_time=0.1, end_time=0.4),
        SimpleNamespace(text="world", start_time=0.5, end_time=0.9)])


class ContractTests(unittest.TestCase):
    def test_8khz_input_and_negative_padding_offset(self):
        request = decode_request(row(offset_seconds=-0.5, speaker_role="agent"))
        self.assertEqual(request.sample_rate, 8000)
        self.assertEqual(len(request.sha256), 64)
        text, segments, status = normalize_result(engine_result(), request, aligned=True)
        self.assertEqual((text, status), ("Hello world.", "ok"))
        self.assertEqual(segments[0]["start"], 0.0)
        self.assertEqual(segments[1]["end"], 0.4)
        self.assertEqual(segments[0]["speaker_id"], "agent")

    def test_offset_applied_once(self):
        request = decode_request(row(offset_seconds=40.0))
        _, segments, _ = normalize_result(engine_result(), request, aligned=True)
        self.assertEqual(segments[0]["start"], 40.1)

    def test_input_hash_changes(self):
        self.assertNotEqual(decode_request(row()).sha256,
                            decode_request(row(audio_base64=base64.b64encode(wav_bytes(silent=True)).decode())).sha256)

    def test_stereo_long_empty_and_truncated_rejected(self):
        for data in [wav_bytes(channels=2), wav_bytes(seconds=31), wav_bytes(seconds=0), wav_bytes()[:-2], b"x"]:
            with self.subTest(size=len(data)), self.assertRaises(ValueError):
                read_wav(data)

    def test_bad_fields(self):
        for changes in [{"audio_base64": "%%%"}, {"audio_base64": "https://example.com/x.wav"},
                        {"offset_seconds": math.inf}, {"offset_seconds": True}, {"speaker_role": "admin"},
                        {"chunk_id": ""}, {"language": None}, {"unexpected": "field"}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                decode_request(row(**changes))

    def test_batch_bounds(self):
        for rows in [[], [row()] * 5, [row(audio_base64="x" * MAX_REQUEST_BYTES)]]:
            with self.assertRaises(ValueError):
                validate_batch(rows)

    def test_invalid_or_missing_alignment_not_invented(self):
        result = engine_result()
        result.time_stamps[0].end_time = 5
        with self.assertRaises(ValueError):
            normalize_result(result, decode_request(row()), aligned=True)
        result.time_stamps = []
        with self.assertRaises(ValueError):
            normalize_result(result, decode_request(row()), aligned=True)

    def test_text_only_is_coarse_clip_interval(self):
        _, spans, _ = normalize_result(engine_result(), decode_request(row()), aligned=False)
        self.assertEqual((spans[0]["start"], spans[0]["end"]), (0.0, 1.0))

    def test_empty_recognition_is_explicit(self):
        self.assertEqual(normalize_result(SimpleNamespace(text=" "), decode_request(row()), aligned=True),
                         ("", [], "empty"))

    def test_model_identifiers(self):
        self.assertEqual(immutable_revision("a" * 40), "a" * 40)
        for value in ["main", "123"]:
            with self.assertRaises(ValueError):
                immutable_revision(value)
        with self.assertRaises(ValueError):
            registered_name("workspace_model")


class ModelTests(unittest.TestCase):
    def make_model(self):
        from model import QwenTranscriptionModel
        model = QwenTranscriptionModel()
        model.manifest = MANIFEST
        model.aligned = True
        model.lock = threading.Lock()
        model.engine = Mock()
        model.engine.transcribe.return_value = [engine_result()]
        return model

    def test_bad_chunk_does_not_discard_good_chunk(self):
        import pandas as pd
        model = self.make_model()
        result = model.predict(None, pd.DataFrame([row(audio_base64="bad"), row(chunk_id="good")]))
        self.assertEqual(result.status.tolist(), ["error", "ok"])
        self.assertEqual(model.engine.transcribe.call_count, 1)

    def test_digital_silence_skips_engine(self):
        import pandas as pd
        model = self.make_model()
        data = row(audio_base64=base64.b64encode(wav_bytes(silent=True)).decode())
        result = model.predict(None, pd.DataFrame([data]))
        self.assertEqual(result.iloc[0].status, "no_speech")
        model.engine.transcribe.assert_not_called()

    def test_optional_dataframe_cells(self):
        import pandas as pd
        model = self.make_model()
        result = model.predict(None, pd.DataFrame([row(), row(chunk_id="second", offset_seconds=10.0)]))
        self.assertEqual(result.status.tolist(), ["ok", "ok"])

    def test_oom_is_recorded(self):
        import pandas as pd
        model = self.make_model()
        model.engine.transcribe.side_effect = RuntimeError("CUDA out of memory")
        result = model.predict(None, pd.DataFrame([row()]))
        self.assertEqual(result.iloc[0].status, "error")
        self.assertIn("out of memory", json.loads(result.iloc[0].result_json)["error_message"])

    def test_missing_gpu_fails_startup(self):
        from model import QwenTranscriptionModel
        with patch.dict(sys.modules, {"torch": SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False)),
                                     "qwen_asr": SimpleNamespace(Qwen3ASRModel=Mock())}):
            with self.assertRaisesRegex(RuntimeError, "CUDA"):
                QwenTranscriptionModel().load_context(SimpleNamespace(artifacts={}))

    def test_platform_torch_override_fails_before_loading_qwen(self):
        from model import QwenTranscriptionModel
        with tempfile.TemporaryDirectory() as temp:
            manifest = Path(temp) / "manifest.json"
            manifest.write_text(json.dumps({**MANIFEST, "direct_requirements": ["torch==2.10.0"]}))
            fake_torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True))
            with patch.dict(sys.modules, {"torch": fake_torch}), \
                    patch("model.importlib.metadata.version", return_value="2.7.1+cu118"):
                with self.assertRaisesRegex(RuntimeError, "Serving runtime changed torch"):
                    QwenTranscriptionModel().load_context(SimpleNamespace(artifacts={"manifest": str(manifest)}))

    def test_mlflow_models_from_code_roundtrip(self):
        import mlflow
        import pandas as pd
        from mlflow.models import ModelSignature
        from mlflow.types import ColSpec, Schema
        fake_engine = Mock()
        fake_engine.transcribe.return_value = [engine_result()]
        fake_qwen = SimpleNamespace(Qwen3ASRModel=SimpleNamespace(from_pretrained=Mock(return_value=fake_engine)))
        fake_torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True, is_bf16_supported=lambda: True),
                                     bfloat16="bf16", float16="fp16")
        with tempfile.TemporaryDirectory() as temp, patch.dict(sys.modules, {"torch": fake_torch, "qwen_asr": fake_qwen}):
            root = Path(temp)
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps(MANIFEST))
            (root / "asr").mkdir()
            (root / "aligner").mkdir()
            source = Path(__file__).resolve().parents[1]
            signature = ModelSignature(inputs=Schema([ColSpec("string", "chunk_id"), ColSpec("string", "audio_base64")]),
                                       outputs=Schema([ColSpec("string", "chunk_id"), ColSpec("string", "status"),
                                                       ColSpec("string", "result_json")]))
            mlflow.pyfunc.save_model(path=str(root / "saved"), python_model=str(source / "model.py"),
                                     code_paths=[str(source / "runtime.py")], signature=signature,
                                     artifacts={"manifest": str(manifest), "asr": str(root / "asr"),
                                                "aligner": str(root / "aligner")}, pip_requirements=[],
                                     input_example=pd.DataFrame([row()]))
            loaded = mlflow.pyfunc.load_model(str(root / "saved"))
            result = loaded.predict(pd.DataFrame([row()]))
            self.assertEqual(result.iloc[0].status, "ok")
            kwargs = fake_qwen.Qwen3ASRModel.from_pretrained.call_args.kwargs
            self.assertTrue(kwargs["local_files_only"])
            self.assertTrue(kwargs["forced_aligner_kwargs"]["local_files_only"])

            # Exercise the same dataframe serialization and scoring path used by registration.
            from mlflow.models.python_api import _serialize_input_data
            from mlflow.pyfunc.scoring_server import _predict
            input_path, output_path = root / "input.json", root / "output.json"
            serialized = _serialize_input_data(pd.DataFrame([row()]), "json")
            self.assertIn("dataframe_split", json.loads(serialized))
            input_path.write_text(serialized)
            _predict(str(root / "saved"), str(input_path), str(output_path), "json")
            check_prediction(json.loads(output_path.read_text()), "hello world")


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.config = endpoint_config("cat.schema.asr", "2", "GPU_MEDIUM")
        self.ready = {"state": {"ready": "READY", "config_update": "NOT_UPDATING"}, "config": self.config}

    def test_sdk_roundtrip(self):
        from databricks.sdk.service.serving import EndpointCoreConfigInput
        self.assertEqual(EndpointCoreConfigInput.from_dict(self.config).as_dict(), self.config)

    def test_ready_requires_requested_version_and_route(self):
        self.assertTrue(requested_version_ready(self.ready, self.config))
        for mutate in [lambda e: e["state"].update(config_update="IN_PROGRESS"),
                       lambda e: e["config"]["served_entities"][0].update(entity_version="1"),
                       lambda e: e["config"]["traffic_config"]["routes"][0].update(traffic_percentage=50)]:
            endpoint = deepcopy(self.ready)
            mutate(endpoint)
            self.assertFalse(requested_version_ready(endpoint, self.config))

    def test_update_failure_is_terminal(self):
        endpoint = deepcopy(self.ready)
        endpoint["state"]["config_update"] = "UPDATE_FAILED"
        with self.assertRaises(RuntimeError):
            requested_version_ready(endpoint, self.config)

    def test_same_version_with_old_gpu_or_runtime_settings_is_not_ready(self):
        for change in [{"workload_type": "GPU_SMALL"}, {"scale_to_zero_enabled": True},
                       {"environment_vars": {"HF_HUB_OFFLINE": "0"}}]:
            endpoint = deepcopy(self.ready)
            endpoint["config"]["served_entities"][0].update(change)
            self.assertFalse(requested_version_ready(endpoint, self.config))

    def test_wait_does_not_report_old_ready_config(self):
        old = deepcopy(self.ready)
        old["state"]["config_update"] = "IN_PROGRESS"
        client = Mock()
        client.serving_endpoints.get.side_effect = [SimpleNamespace(as_dict=lambda: old),
                                                   SimpleNamespace(as_dict=lambda: self.ready)]
        sleeper = Mock()
        self.assertEqual(wait_for_version(client, "asr", self.config, sleep=sleeper), self.ready)
        sleeper.assert_called_once()

    def test_timeout(self):
        client = Mock()
        old = deepcopy(self.ready)
        old["state"]["ready"] = "NOT_READY"
        client.serving_endpoints.get.return_value = SimpleNamespace(as_dict=lambda: old)
        with self.assertRaises(TimeoutError):
            wait_for_version(client, "asr", self.config, timeout=1, clock=Mock(side_effect=[0, 2]))

    def test_fixture_quality_gate(self):
        prediction = output_record("c1", MANIFEST, text="Hello, WORLD!", status="ok")
        check_prediction({"predictions": [prediction]}, "hello world")
        with self.assertRaises(RuntimeError):
            check_prediction({"predictions": [prediction]}, "goodbye")

    def test_wait_only_never_mutates_and_saves_fixture_response(self):
        self.run_wait_only()

    def test_wait_only_timeout_is_not_reported_as_endpoint_failure(self):
        self.run_wait_only(timeout=True)

    def run_wait_only(self, timeout=False):
        client = Mock()
        client.serving_endpoints.get.return_value = SimpleNamespace(as_dict=lambda: self.ready)
        response = {"predictions": [output_record("deployment-fixture", MANIFEST,
                                                   text="Hello world", status="ok")]}
        client.serving_endpoints.query.return_value = SimpleNamespace(as_dict=lambda: response)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture, receipt = root / "fixture.wav", root / "receipt.json"
            fixture.write_bytes(wav_bytes())
            argv = ["deploy.py", "--profile", "selected", "--endpoint", "asr",
                    "--registered-model", "cat.schema.asr", "--version", "2",
                    "--workload-type", "GPU_MEDIUM", "--wait-only", "--sample-wav", str(fixture),
                    "--expected-text", "hello world", "--output", str(receipt)]
            with patch.object(sys, "argv", argv), patch("databricks.sdk.WorkspaceClient", return_value=client), \
                    patch("deploy.wait_for_version", side_effect=TimeoutError("still building") if timeout else None):
                if timeout:
                    with self.assertRaises(TimeoutError):
                        deploy_main()
                else:
                    deploy_main()
            saved = json.loads(receipt.read_text())
            self.assertEqual(saved["status"], "readiness_timed_out" if timeout else "ready_and_smoke_tested")
            if timeout:
                client.serving_endpoints.query.assert_not_called()
            else:
                self.assertEqual(saved["fixture_prediction"], response)
        client.serving_endpoints.create.assert_not_called()
        client.serving_endpoints.update_config.assert_not_called()

    def test_query_retry_and_response_identity(self):
        from databricks.sdk.errors import DatabricksError
        client = Mock()
        client.serving_endpoints.query.side_effect = [DatabricksError(error_code="REQUEST_LIMIT_EXCEEDED"),
            SimpleNamespace(as_dict=lambda: {"predictions": [{"chunk_id": "c1", "status": "ok"}]})]
        sleeper = Mock()
        self.assertEqual(query_chunks(client, "asr", [row()], sleep=sleeper)[0]["status"], "ok")
        sleeper.assert_called_once()
        client.serving_endpoints.query.side_effect = DatabricksError(error_code="PERMISSION_DENIED")
        with self.assertRaises(DatabricksError):
            query_chunks(client, "asr", [row()], sleep=sleeper)


if __name__ == "__main__":
    unittest.main()
