"""Bounded audio contract and Qwen adapter, shared by serving and callers.

Heavy inference dependencies are imported only when loading/running the model.
No paths or URLs from inference requests are opened by the server.
"""
from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
import hashlib
import io
import json
import math
from pathlib import Path
import re
import wave

MODEL_ID = "Qwen/Qwen3-ASR-1.7B"
ALIGNER_ID = "Qwen/Qwen3-ForcedAligner-0.6B"
MAX_AUDIO_SECONDS = 30
MAX_WAV_BYTES = 3_000_000
MAX_REQUEST_BYTES = 8_000_000
MAX_ROWS = 4
SAMPLE_RATES = {8000, 16000, 22050, 24000, 44100, 48000}
ALIGNED_LANGUAGES = {
    "Chinese", "English", "Cantonese", "French", "German", "Italian",
    "Japanese", "Korean", "Portuguese", "Russian", "Spanish",
}
REQUIRED = {"chunk_id", "audio_base64"}
OPTIONAL = {"language", "speaker_role", "offset_seconds"}


@dataclass(frozen=True)
class AudioRequest:
    chunk_id: str
    pcm: bytes
    sample_rate: int
    duration: float
    sha256: str
    language: str | None
    speaker_role: str
    offset_seconds: float


def immutable_revision(value: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError("Model revision must be an immutable 40-character HF commit SHA")
    return value


def registered_name(value: str) -> str:
    if len(value.split(".")) != 3 or not all(
        re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", part) for part in value.split(".")
    ):
        raise ValueError("Use a three-part Unity Catalog model name: catalog.schema.model")
    return value


def read_wav(data: bytes) -> tuple[bytes, int, float]:
    if len(data) > MAX_WAV_BYTES:
        raise ValueError(f"WAV exceeds {MAX_WAV_BYTES} bytes; submit shorter chunks")
    try:
        with wave.open(io.BytesIO(data), "rb") as audio:
            rate, count = audio.getframerate(), audio.getnframes()
            if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getcomptype() != "NONE":
                raise ValueError("Expected uncompressed mono PCM16 WAV; split speaker channels first")
            if rate not in SAMPLE_RATES:
                raise ValueError(f"Unsupported sample rate {rate}")
            if count <= 0 or count / rate > MAX_AUDIO_SECONDS:
                raise ValueError(f"Audio must contain >0 and <= {MAX_AUDIO_SECONDS} seconds")
            pcm = audio.readframes(count)
            if len(pcm) != count * 2:
                raise ValueError("Truncated WAV audio")
            return pcm, rate, count / rate
    except (wave.Error, EOFError) as exc:
        raise ValueError("Invalid PCM16 WAV") from exc


def decode_request(row: dict) -> AudioRequest:
    if not REQUIRED <= row.keys() or row.keys() - REQUIRED - OPTIONAL:
        raise ValueError(f"Required fields: {sorted(REQUIRED)}; optional: {sorted(OPTIONAL)}")
    chunk_id = row["chunk_id"]
    encoded = row["audio_base64"]
    if not isinstance(chunk_id, str) or not 1 <= len(chunk_id) <= 200:
        raise ValueError("chunk_id must be a non-empty string of at most 200 characters")
    if not isinstance(encoded, str) or len(encoded) > 4 * ((MAX_WAV_BYTES + 2) // 3):
        raise ValueError("audio_base64 must be a bounded base64-encoded WAV")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid audio_base64") from exc
    pcm, rate, duration = read_wav(data)
    language = row.get("language", "English")
    if not isinstance(language, str) or len(language) > 40:
        raise ValueError("language must be a language name, or an empty string for detection")
    role = row.get("speaker_role", "unknown")
    if role not in {"agent", "customer", "participant", "unknown"}:
        raise ValueError("Invalid speaker_role; this endpoint does not infer speaker identity")
    offset = row.get("offset_seconds", 0.0)
    if isinstance(offset, bool) or not isinstance(offset, (int, float)) or not math.isfinite(offset):
        raise ValueError("offset_seconds must be finite")
    if not -MAX_AUDIO_SECONDS <= offset <= 86400:
        raise ValueError("offset_seconds must be between -30 and 86400")
    return AudioRequest(chunk_id, pcm, rate, duration, hashlib.sha256(data).hexdigest(),
                        language.strip() or None, role, float(offset))


def validate_batch(rows: list[dict]) -> None:
    if not 1 <= len(rows) <= MAX_ROWS:
        raise ValueError(f"Submit 1–{MAX_ROWS} audio chunks per invocation")
    if len(json.dumps({"dataframe_records": rows}, allow_nan=False).encode()) > MAX_REQUEST_BYTES:
        raise ValueError(f"Request exceeds application cap of {MAX_REQUEST_BYTES} bytes")


def request_from_file(path: str | Path, chunk_id: str, *, language: str = "English",
                      speaker_role: str = "unknown", offset_seconds: float = 0.0) -> dict:
    with Path(path).open("rb") as stream:
        data = stream.read(MAX_WAV_BYTES + 1)
    row = {"chunk_id": chunk_id, "audio_base64": base64.b64encode(data).decode("ascii"),
           "language": language, "speaker_role": speaker_role, "offset_seconds": offset_seconds}
    decode_request(row)
    return row


def normalize_result(result, request: AudioRequest, *, aligned: bool) -> tuple[str, list, str]:
    text = result.text.strip()
    if not text:
        return "", [], "empty"
    if not aligned:
        return text, [{"start": max(0.0, request.offset_seconds),
                       "end": max(0.0, request.offset_seconds + request.duration),
                       "text": text, "speaker_id": request.speaker_role}], "ok"
    items = result.time_stamps
    if items is None or len(items) == 0:
        raise ValueError("Non-empty ASR output has no forced-alignment timestamps")
    segments = []
    previous_start = -1.0
    for item in items:
        start, end = float(item.start_time), float(item.end_time)
        if not all(math.isfinite(x) for x in (start, end)) or not 0 <= start <= end <= request.duration + 0.1:
            raise ValueError("Invalid forced-alignment interval")
        if start < previous_start:
            raise ValueError("Forced-alignment intervals are not ordered")
        previous_start = start
        segments.append({"start": round(max(0.0, request.offset_seconds + start), 3),
                         "end": round(max(0.0, request.offset_seconds + min(end, request.duration)), 3),
                         "text": str(item.text), "speaker_id": request.speaker_role})
    return text, segments, "ok"


def output_record(chunk_id: str, manifest: dict, *, request: AudioRequest | None = None,
                  text: str = "", segments: list | None = None, language: str = "",
                  status: str = "error", error: str = "", elapsed: float = 0.0) -> dict:
    # JSON in result_json can be parsed to VARIANT by the notebook ingestion path.
    result = {"response": {"text": text, "language": language, "segments": segments or []},
              "error_message": error,
              "metadata": {"input_duration_seconds": request.duration if request else 0.0,
                           "input_sha256": request.sha256 if request else "",
                           "backend": "qwen3-asr", "model_id": manifest["model_id"],
                           "model_revision": manifest["model_revision"],
                           "aligner_revision": manifest.get("aligner_revision", ""),
                           "timestamp_granularity": "word" if manifest.get("aligner_revision") else "clip",
                           "timestamp_origin": "call", "elapsed_seconds": round(elapsed, 4)}}
    return {"chunk_id": chunk_id, "status": status,
            "result_json": json.dumps(result, allow_nan=False, ensure_ascii=False)}
