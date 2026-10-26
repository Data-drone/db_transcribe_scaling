"""Load one Qwen stage at a time; keep synthetic persona references for audit."""

from __future__ import annotations

import gc
import re
from pathlib import Path

import numpy as np

from .config import BASE_MODEL, DESIGN_MODEL, stable_seed


class ToneBackend:
    """Plumbing fixture only. These tones are NOT speech and cannot evaluate ASR."""

    provenance = {"backend": "tone", "contains_synthetic_speech": False}

    def prepare(self, personas: list[dict], seed: int) -> dict:
        return {p["id"]: (self._tone(seed, p["id"]), 16000) for p in personas}

    def _tone(self, seed: int, name: str) -> np.ndarray:
        frequency = 180 + stable_seed(seed, name) % 400
        return 0.1 * np.sin(2 * np.pi * frequency * np.arange(8000) / 16000)

    def synthesize(self, persona: dict, text: str, seed: int):
        return self._tone(seed, persona["id"] + text), 16000


class QwenBackend:
    def __init__(self, *, design_revision: str, base_revision: str, device: str = "cuda:0"):
        self.refs = {DESIGN_MODEL: design_revision, BASE_MODEL: base_revision}
        self.device = device
        self.provenance = {"backend": "qwen", "contains_synthetic_speech": True, "models": {}}

    def _check_device(self):
        import torch

        details = {"requested": self.device, "torch_version": str(torch.__version__)}
        if self.device.startswith("cuda"):
            if not torch.cuda.is_available():
                raise RuntimeError("CUDA requested but unavailable; no model weights downloaded")
            props = torch.cuda.get_device_properties(self.device)
            details.update(
                name=props.name,
                total_memory_bytes=props.total_memory,
                cuda_version=torch.version.cuda,
            )
        self.provenance["device"] = details
        print(f"TTS device: {details}", flush=True)

    def _load(self, model_id: str):
        import torch
        from huggingface_hub import HfApi, snapshot_download
        from qwen_tts import Qwen3TTSModel

        requested = self.refs[model_id]
        revision = HfApi().model_info(model_id, revision=requested).sha
        if not revision or not re.fullmatch(r"[0-9a-f]{40}", revision):
            raise ValueError("Hugging Face did not resolve an immutable model revision")
        print(f"Downloading {model_id} at {revision}", flush=True)
        snapshot = snapshot_download(model_id, revision=revision)
        if not (Path(snapshot) / "speech_tokenizer").is_dir():
            raise ValueError("Expected the pinned snapshot to include speech_tokenizer")
        self.provenance["models"][model_id] = {"requested": requested, "revision": revision}
        print(f"Loading {model_id}", flush=True)
        return Qwen3TTSModel.from_pretrained(
            snapshot,
            device_map=self.device,
            dtype=torch.float32 if self.device == "cpu" else torch.bfloat16,
            attn_implementation="sdpa",
        )

    def _seed(self, seed: int):
        import torch
        from transformers import set_seed

        set_seed(seed)
        # Seeded sampling improves replayability; GPU kernels may still vary across runs.
        if self.device.startswith("cuda") and not torch.cuda.is_available():
            raise RuntimeError("CUDA requested but unavailable; run on a GPU or use --backend tone")

    def prepare(self, personas: list[dict], seed: int) -> dict:
        import torch

        self._check_device()
        design = self._load(DESIGN_MODEL)
        references = {}
        with torch.inference_mode():
            for p in personas:
                print(f"Designing persona {p['id']}", flush=True)
                self._seed(stable_seed(seed, "persona", p["id"]))
                wavs, rate = design.generate_voice_design(
                    text=p["reference_text"],
                    language=p["language"],
                    instruct=p["description"],
                    max_new_tokens=1024,
                )
                references[p["id"]] = (wavs[0], rate)
        del design
        gc.collect()
        if self.device.startswith("cuda"):
            torch.cuda.empty_cache()
        print("VoiceDesign unloaded; preparing reusable persona prompts", flush=True)
        self.model = self._load(BASE_MODEL)
        self.prompts = {}
        with torch.inference_mode():
            for p in personas:
                self.prompts[p["id"]] = self.model.create_voice_clone_prompt(
                    ref_audio=references[p["id"]],
                    ref_text=p["reference_text"],
                    x_vector_only_mode=False,
                )
        return references

    def synthesize(self, persona: dict, text: str, seed: int):
        import torch

        self._seed(seed)
        with torch.inference_mode():
            wavs, rate = self.model.generate_voice_clone(
                text=text,
                language=persona["language"],
                voice_clone_prompt=self.prompts[persona["id"]],
                max_new_tokens=1024,
            )
        return wavs[0], rate
