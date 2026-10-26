"""Validate the complete experiment before loading models or writing any audio."""

from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path

LANGUAGES = {
    "Chinese",
    "English",
    "Japanese",
    "Korean",
    "German",
    "French",
    "Russian",
    "Portuguese",
    "Spanish",
    "Italian",
}
DESIGN_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
BASE_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"


def stable_seed(seed: int, *parts: str) -> int:
    data = json.dumps([seed, *parts], ensure_ascii=False).encode()
    return int.from_bytes(hashlib.sha256(data).digest()[:4], "big")


def identifier(value) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}", value):
        raise ValueError("IDs must be 1–80 letters, digits, underscores or hyphens")
    return value


def text(value, label: str, limit: int = 2000) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f"{label} must be nonempty text of at most {limit} characters")
    return value


def number(value, label: str, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be numeric")
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"{label} must be finite and between {low} and {high}")
    return float(value)


def fields(value: dict, required: set, optional: set = frozenset()) -> None:
    if not isinstance(value, dict) or required - value.keys() or value.keys() - required - optional:
        raise ValueError(f"Expected fields {sorted(required)}; optional {sorted(optional)}")


def validate(config: dict) -> dict:
    fields(config, {"name", "seed", "sample_rate", "personas", "conversations", "conditions"})
    identifier(config["name"])
    if type(config["seed"]) is not int or not 0 <= config["seed"] < 2**32:
        raise ValueError("seed must be an integer in [0, 2**32)")
    if type(config["sample_rate"]) is not int or config["sample_rate"] not in {16000, 24000}:
        raise ValueError("sample_rate must be 16000 or 24000")
    for name, maximum in (("personas", 100), ("conversations", 10000), ("conditions", 20)):
        items = config[name]
        minimum = 0 if name == "conditions" else 1
        if not isinstance(items, list) or not minimum <= len(items) <= maximum:
            raise ValueError(f"{name} must have between {minimum} and {maximum} entries")
        ids = [identifier(item.get("id")) for item in items if isinstance(item, dict)]
        if len(ids) != len(items) or len(set(ids)) != len(ids):
            raise ValueError(f"{name} must have unique IDs")
    personas = {p["id"]: p for p in config["personas"]}
    for p in personas.values():
        fields(p, {"id", "language", "description", "reference_text", "role"})
        if p["language"] not in LANGUAGES:
            raise ValueError(f"Unsupported language: {p['language']}")
        if p["role"] not in {"agent", "customer", "participant"}:
            raise ValueError("role must be agent, customer or participant")
        text(p["description"], "description")
        text(p["reference_text"], "reference_text", 500)
    for c in config["conversations"]:
        fields(c, {"id", "scenario", "split", "turns"})
        text(c["scenario"], "scenario")
        if c["split"] not in {"train", "validation", "test"}:
            raise ValueError("split must be train, validation or test")
        if not isinstance(c["turns"], list) or not 1 <= len(c["turns"]) <= 100:
            raise ValueError("Each conversation must have 1–100 turns")
        for t in c["turns"]:
            fields(t, {"persona", "text"}, {"gap_seconds"})
            if t["persona"] not in personas:
                raise ValueError(f"Unknown persona: {t['persona']}")
            text(t["text"], "turn text", 500)
            number(t.get("gap_seconds", 0.3), "gap_seconds", -2, 10)
        if c["turns"][0].get("gap_seconds", 0.3) < 0:
            raise ValueError("First turn cannot have a negative gap")
    allowed = {"bandpass_hz", "noise_snr_db", "dropouts", "echo", "clip_level"}
    for condition in config["conditions"]:
        fields(condition, {"id"}, allowed)
        if condition["id"] == "clean":
            raise ValueError("clean is generated automatically; omit it from conditions")
        if "bandpass_hz" in condition:
            band = condition["bandpass_hz"]
            if not isinstance(band, list) or len(band) != 2:
                raise ValueError("bandpass_hz must be [low, high]")
            low, high = [number(v, "bandpass_hz", 1, config["sample_rate"] / 2 - 1) for v in band]
            if low >= high:
                raise ValueError("bandpass lower frequency must be below upper frequency")
        if "noise_snr_db" in condition:
            number(condition["noise_snr_db"], "noise_snr_db", -10, 60)
        if "dropouts" in condition:
            d = condition["dropouts"]
            fields(d, {"count", "duration_ms"})
            if type(d["count"]) is not int or not 0 <= d["count"] <= 100:
                raise ValueError("dropouts.count must be an integer between 0 and 100")
            number(d["duration_ms"], "duration_ms", 1, 1000)
        if "echo" in condition:
            fields(condition["echo"], {"delay_ms", "gain"})
            number(condition["echo"]["delay_ms"], "echo.delay_ms", 1, 1000)
            number(condition["echo"]["gain"], "echo.gain", 0, 0.9)
        if "clip_level" in condition:
            number(condition["clip_level"], "clip_level", 0.01, 1)
    return config


def load(path: str | Path) -> dict:
    return validate(json.loads(Path(path).read_text()))


def plan(config: dict) -> dict:
    turns = sum(len(c["turns"]) for c in config["conversations"])
    variants = 1 + len(config["conditions"])
    return {
        "name": config["name"],
        "personas": len(config["personas"]),
        "unique_speech_clips": turns,
        "clip_files": turns * variants,
        "conversation_files": len(config["conversations"]) * variants,
        "conditions": ["clean", *[c["id"] for c in config["conditions"]]],
        "models": [DESIGN_MODEL, BASE_MODEL],
        "reference_status": "unverified_script",
        "notes": "Same clean audio reused for every impairment; listen before scoring ASR.",
    }
