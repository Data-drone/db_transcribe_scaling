"""Deterministic, duration-preserving approximations of noisy audio channels."""

from __future__ import annotations

import hashlib
import math
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, resample_poly, sosfilt


def mono(samples, rate: int, target_rate: int, *, max_seconds: float = 30) -> np.ndarray:
    y = np.asarray(samples, dtype=np.float64)
    if y.ndim != 1 or not len(y) or not np.isfinite(y).all():
        raise ValueError("TTS must return nonempty finite mono audio")
    if not isinstance(rate, (int, np.integer)) or not 8000 <= rate <= 96000:
        raise ValueError("Invalid TTS sample rate")
    if len(y) / rate > max_seconds:
        raise ValueError(
            f"TTS exceeded {max_seconds}s; shorten the script, audio was not truncated"
        )
    if np.max(np.abs(y)) < 1e-6:
        raise ValueError("TTS returned silent audio")
    if rate != target_rate:
        divisor = math.gcd(rate, target_rate)
        y = resample_poly(y, target_rate // divisor, rate // divisor)
    return peak_limit(y)[0]


def peak_limit(y: np.ndarray) -> tuple[np.ndarray, float]:
    gain = min(1.0, 0.98 / max(1e-12, float(np.max(np.abs(y)))))
    return y * gain, gain


def impair(clean: np.ndarray, rate: int, condition: dict, seed: int) -> tuple[np.ndarray, dict]:
    """SNR uses whole-clip RMS after filtering/echo, before dropout/clipping."""
    rng = np.random.default_rng(seed)
    y = clean.astype(np.float64, copy=True)
    details = {"seed": seed, "condition": condition, "dropout_intervals": []}
    if "bandpass_hz" in condition:
        sos = butter(4, condition["bandpass_hz"], btype="bandpass", fs=rate, output="sos")
        y = sosfilt(sos, y)
    if "echo" in condition:
        delay = round(condition["echo"]["delay_ms"] * rate / 1000)
        source = y.copy()
        if delay < len(y):
            y[delay:] += source[:-delay] * condition["echo"]["gain"]
    if "noise_snr_db" in condition:
        noise = rng.standard_normal(len(y))
        signal_rms = float(np.sqrt(np.mean(y**2)))
        target_noise_rms = signal_rms / 10 ** (condition["noise_snr_db"] / 20)
        noise *= target_noise_rms / max(1e-12, float(np.sqrt(np.mean(noise**2))))
        y += noise
        details["noise_reference_rms"] = signal_rms
        details["added_noise_rms"] = target_noise_rms
        details["snr_definition"] = "whole_clip_after_filter_and_echo_before_dropout_and_clipping"
    if "dropouts" in condition:
        d = condition["dropouts"]
        size = min(len(y), max(1, round(d["duration_ms"] * rate / 1000)))
        for _ in range(d["count"]):
            start = int(rng.integers(0, len(y) - size + 1))
            y[start : start + size] = 0
            details["dropout_intervals"].append([start / rate, (start + size) / rate])
    if "clip_level" in condition:
        y = np.clip(y, -condition["clip_level"], condition["clip_level"])
    y, details["peak_limit_gain"] = peak_limit(y)
    return y, details


def write_wav(root: Path, relative: str, samples: np.ndarray, rate: int) -> dict:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, samples, rate, format="WAV", subtype="PCM_16")
    return {
        "audio_path": relative,
        "audio_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "sample_rate": rate,
        "channels": 1,
        "frames": len(samples),
        "duration_seconds": len(samples) / rate,
        "encoding": "PCM_16",
    }


def mix_turns(turns: list[tuple[np.ndarray, float]], rate: int) -> tuple[np.ndarray, list, float]:
    """Gaps are relative to the previous turn's end. Negative gaps make overlap."""
    placements, previous_end = [], 0
    for audio, gap in turns:
        start = previous_end + round(gap * rate)
        if start < 0:
            raise ValueError("Overlap would place a turn before conversation start")
        end = start + len(audio)
        placements.append((start, end))
        previous_end = end
    total = max(end for _, end in placements)
    if total > 600 * rate:
        raise ValueError("Conversation exceeds 10 minutes; split it into shorter cases")
    mixed = np.zeros(total, dtype=np.float64)
    for (audio, _), (start, end) in zip(turns, placements, strict=True):
        mixed[start:end] += audio
    mixed, gain = peak_limit(mixed)
    return mixed, [(start / rate, end / rate) for start, end in placements], gain
