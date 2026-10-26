"""MLflow Models from Code entry point; weights are supplied as MLflow artifacts."""
from __future__ import annotations

import json
import importlib.metadata
import os
from pathlib import Path
import threading
import time

import mlflow
import pandas as pd

from runtime import ALIGNED_LANGUAGES, decode_request, normalize_result, output_record, validate_batch


class QwenTranscriptionModel(mlflow.pyfunc.PythonModel):
    def load_context(self, context):
        # Both ASR and processor/aligner loads must stay offline, including nested loads.
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        import torch

        if not torch.cuda.is_available():
            raise RuntimeError("Qwen serving requires a CUDA GPU; use GPU notebook/serving compute")
        self.manifest = json.loads(Path(context.artifacts["manifest"]).read_text())
        for spec in self.manifest.get("direct_requirements", []):
            name, version = spec.split("==")
            if name in {"torch", "torchaudio", "torchvision"}:
                actual = importlib.metadata.version(name)
                if actual != version:
                    raise RuntimeError(f"Serving runtime changed {spec} to {actual}; rebuild with matching GPU packages")
        expected_cuda = self.manifest.get("validation_cuda")
        if expected_cuda and torch.version.cuda != expected_cuda:
            raise RuntimeError(f"Expected PyTorch CUDA {expected_cuda}, got {torch.version.cuda}")
        from qwen_asr import Qwen3ASRModel

        self.aligned = "aligner" in context.artifacts
        dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
        kwargs = {"dtype": dtype, "device_map": "cuda:0", "attn_implementation": "sdpa",
                  "local_files_only": True, "max_inference_batch_size": 1, "max_new_tokens": 1024}
        if self.aligned:
            kwargs.update(forced_aligner=context.artifacts["aligner"],
                          forced_aligner_kwargs={"dtype": dtype, "device_map": "cuda:0",
                                                 "attn_implementation": "sdpa", "local_files_only": True})
        self.engine = Qwen3ASRModel.from_pretrained(context.artifacts["asr"], **kwargs)
        self.lock = threading.Lock()

    def predict(self, context, model_input: pd.DataFrame, params=None) -> pd.DataFrame:
        rows = model_input.to_dict(orient="records")
        # MLflow fills missing optional dataframe cells with NaN; normalize only these.
        for row in rows:
            for key in ("language", "speaker_role", "offset_seconds"):
                if key in row and pd.isna(row[key]):
                    del row[key]
        validate_batch(rows)
        import numpy as np
        outputs = []
        for row in rows:
            started = time.monotonic()
            request = None
            try:
                request = decode_request(row)
                if not any(request.pcm):
                    outputs.append(output_record(request.chunk_id, self.manifest, request=request,
                                                 status="no_speech", elapsed=time.monotonic() - started))
                    continue
                if self.aligned and request.language and request.language not in ALIGNED_LANGUAGES:
                    raise ValueError("Word timestamps support only the 11 forced-aligner languages")
                samples = np.frombuffer(request.pcm, dtype="<i2").astype(np.float32) / 32768.0
                with self.lock:
                    result = self.engine.transcribe(audio=(samples, request.sample_rate),
                                                    language=request.language,
                                                    return_time_stamps=self.aligned)[0]
                text, segments, status = normalize_result(result, request, aligned=self.aligned)
                outputs.append(output_record(request.chunk_id, self.manifest, request=request,
                                             text=text, segments=segments, language=result.language,
                                             status=status, elapsed=time.monotonic() - started))
            except Exception as exc:
                # A bad chunk does not discard results for other rows. Load failures still fail startup.
                outputs.append(output_record(str(row.get("chunk_id", "")), self.manifest, request=request,
                                             error=f"{type(exc).__name__}: {exc}"[:500],
                                             elapsed=time.monotonic() - started))
        return pd.DataFrame(outputs, columns=["chunk_id", "status", "result_json"])


mlflow.models.set_model(QwenTranscriptionModel())
