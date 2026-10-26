"""Create paired audio fixtures and JSONL manifests without modifying other subprojects."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import platform
import time
from pathlib import Path

from .audio import impair, mix_turns, mono, write_wav
from .config import plan, stable_seed, validate


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n")


def append_json(stream, value) -> None:
    stream.write(json.dumps(value, ensure_ascii=False, allow_nan=False) + "\n")
    stream.flush()


def versions() -> dict:
    result = {"python": platform.python_version()}
    for package in ("numpy", "scipy", "soundfile", "torch", "qwen-tts", "transformers", "mlflow"):
        try:
            result[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            pass
    return result


def variants(root, folder, clean, rate, conditions, seed, identity):
    clean_meta = write_wav(root, f"{folder}/clean.wav", clean, rate)
    yield {
        **clean_meta,
        "condition_id": "clean",
        "clean_sha256": clean_meta["audio_sha256"],
        "impairment": None,
    }
    for condition in conditions:
        effect_seed = stable_seed(seed, "impairment", identity, condition["id"])
        degraded, details = impair(clean, rate, condition, effect_seed)
        yield {
            **write_wav(root, f"{folder}/{condition['id']}.wav", degraded, rate),
            "condition_id": condition["id"],
            "clean_sha256": clean_meta["audio_sha256"],
            "impairment": details,
        }


def generate(config: dict, output: Path, backend) -> dict:
    validate(config)
    # Refuse reuse, including existing empty directories: partial runs remain inspectable.
    output.mkdir(parents=True, exist_ok=False)
    write_json(output / "config.json", config)
    config_hash = hashlib.sha256((output / "config.json").read_bytes()).hexdigest()
    metadata = {
        "schema_version": 1,
        "config_sha256": config_hash,
        "plan": plan(config),
        "versions": versions(),
        "backend": backend.provenance,
        "reference_status": "unverified_script",
        "timestamp_granularity": "utterance",
        "replay_note": "Seeds and resolved weights recorded; GPU synthesis may vary across runs.",
    }
    project = Path(__file__).resolve().parent.parent
    sources = [
        *sorted((project / "audio_data_gen").glob("*.py")),
        project / "pyproject.toml",
        project / "uv.lock",
    ]
    metadata["source_sha256"] = {
        str(path.relative_to(project)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sources
        if path.is_file()
    }
    write_json(output / "provenance.json", metadata)
    summary = {"status": "running", "clip_rows": 0, "conversation_rows": 0}
    write_json(output / "summary.json", summary)
    started = time.monotonic()
    try:
        references = backend.prepare(config["personas"], config["seed"])
        rate = config["sample_rate"]
        personas = {p["id"]: p for p in config["personas"]}
        persona_manifest = []
        for p in personas.values():
            audio, source_rate = references[p["id"]]
            audio = mono(audio, source_rate, rate)
            persona_manifest.append(
                {
                    **p,
                    **write_wav(output, f"personas/{p['id']}.wav", audio, rate),
                    "seed": stable_seed(config["seed"], "persona", p["id"]),
                }
            )
        write_json(output / "personas.json", persona_manifest)
        with (
            (output / "clips.jsonl").open("w") as clips,
            (output / "conversations.jsonl").open("w") as conversations,
        ):
            for case in config["conversations"]:
                turns, segments = [], []
                for index, turn in enumerate(case["turns"]):
                    p = personas[turn["persona"]]
                    clip_id = f"{case['id']}-t{index:03d}"
                    print(f"Synthesizing {clip_id} with {p['id']}", flush=True)
                    seed = stable_seed(config["seed"], "tts", case["id"], str(index), p["id"])
                    audio, source_rate = backend.synthesize(p, turn["text"], seed)
                    clean = mono(audio, source_rate, rate)
                    turns.append((clean, turn.get("gap_seconds", 0.3)))
                    segment = {
                        "clip_id": clip_id,
                        "persona_id": p["id"],
                        "speaker_role": p["role"],
                        "language": p["language"],
                        "text": turn["text"],
                        "tts_seed": seed,
                    }
                    segments.append(segment)
                    for variant in variants(
                        output,
                        f"clips/{clip_id}",
                        clean,
                        rate,
                        config["conditions"],
                        config["seed"],
                        clip_id,
                    ):
                        append_json(
                            clips,
                            {
                                **segment,
                                **variant,
                                "sample_id": f"{clip_id}-{variant['condition_id']}",
                                "conversation_id": case["id"],
                                "split": case["split"],
                                "reference_status": "unverified_script",
                                "schema_version": 1,
                                "backend": backend.provenance["backend"],
                                "contains_synthetic_speech": backend.provenance[
                                    "contains_synthetic_speech"
                                ],
                            },
                        )
                        summary["clip_rows"] += 1
                mixed, intervals, gain = mix_turns(turns, rate)
                timeline = [
                    {**s, "start": start, "end": end}
                    for s, (start, end) in zip(segments, intervals, strict=True)
                ]
                for variant in variants(
                    output,
                    f"conversations/{case['id']}",
                    mixed,
                    rate,
                    config["conditions"],
                    config["seed"],
                    case["id"],
                ):
                    append_json(
                        conversations,
                        {
                            **variant,
                            "conversation_id": case["id"],
                            "scenario": case["scenario"],
                            "sample_id": f"{case['id']}-{variant['condition_id']}",
                            "split": case["split"],
                            "segments": timeline,
                            "mix_gain": gain,
                            "reference_status": "unverified_script",
                            "schema_version": 1,
                            "timestamp_granularity": "utterance",
                            "backend": backend.provenance["backend"],
                            "contains_synthetic_speech": backend.provenance[
                                "contains_synthetic_speech"
                            ],
                        },
                    )
                    summary["conversation_rows"] += 1
        summary["status"] = "complete"
    except Exception as exc:
        summary.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        summary["elapsed_seconds"] = time.monotonic() - started
        metadata["backend"] = backend.provenance
        write_json(output / "provenance.json", metadata)
        write_json(output / "summary.json", summary)
    return summary
