from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest
import soundfile as sf

from audio_data_gen.audio import impair, mix_turns, mono
from audio_data_gen.config import load, plan, validate
from audio_data_gen.generate import generate
from audio_data_gen.tts import ToneBackend
from submit_air import workload

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def config():
    return load(ROOT / "configs/banking-demo.json")


@pytest.mark.parametrize(
    "mutate",
    [
        lambda c: c["personas"][0].update(id="../outside"),
        lambda c: c["personas"].append(deepcopy(c["personas"][0])),
        lambda c: c["conversations"][0]["turns"][0].update(persona="missing"),
        lambda c: c["conditions"][0].update(bandpass_hz=[3400, 300]),
        lambda c: c["conditions"][0].update(noise_snr_db=float("nan")),
        lambda c: c["conditions"][0].update(dropouts={"count": 1.5, "duration_ms": 20}),
        lambda c: c["conditions"][0].update(id="clean"),
        lambda c: c["conversations"][0]["turns"][0].update(gap_seconds=-0.2),
        lambda c: c.update(seed=True),
        lambda c: c["conditions"][0].update(unknown_effect=True),
    ],
)
def test_invalid_experiment_rejected_before_generation(config, mutate):
    mutate(config)
    with pytest.raises(ValueError):
        validate(config)


def test_plan_counts_real_audio_expansion(config):
    result = plan(config)
    assert result["unique_speech_clips"] == 8
    assert result["clip_files"] == 32
    assert result["conversation_files"] == 8


def test_clean_only_experiment(config):
    config["conditions"] = []
    validate(config)
    assert plan(config)["clip_files"] == 8


def test_snr_and_no_unintended_modification():
    rate = 16000
    clean = 0.1 * np.sin(2 * np.pi * 440 * np.arange(rate) / rate)
    original = clean.copy()
    noisy, details = impair(clean, rate, {"id": "noise", "noise_snr_db": 12}, 123)
    measured = 20 * np.log10(np.sqrt(np.mean(clean**2)) / np.sqrt(np.mean((noisy - clean) ** 2)))
    assert measured == pytest.approx(12, abs=1e-9)
    assert details["peak_limit_gain"] == 1
    assert np.array_equal(clean, original)


def test_impairments_repeat_with_seed_and_preserve_duration(config):
    rate = config["sample_rate"]
    clean = np.full(rate, 0.2)
    for condition in config["conditions"]:
        first, metadata = impair(clean, rate, condition, 42)
        second, repeated = impair(clean, rate, condition, 42)
        assert np.array_equal(first, second)
        assert metadata == repeated
        assert len(first) == len(clean)
        assert np.isfinite(first).all() and np.max(np.abs(first)) <= 0.98
        for start, end in metadata["dropout_intervals"]:
            assert np.all(first[round(start * rate) : round(end * rate)] == 0)


def test_mix_overlap_and_preserve_earlier_tail():
    mixed, intervals, gain = mix_turns(
        [
            (np.ones(1000) * 0.6, 0),
            (np.ones(100) * 0.6, -0.5),
        ],
        1000,
    )
    assert intervals == [(0, 1), (0.5, 0.6)]
    assert len(mixed) == 1000
    assert np.max(mixed) == pytest.approx(0.98)
    assert gain < 1
    assert mixed[700] > 0  # shorter overlapping turn must not trim the first one


@pytest.mark.parametrize(
    "audio,rate",
    [
        (np.zeros(100), 16000),
        (np.array([np.nan]), 16000),
        (np.ones((100, 2)), 16000),
        (np.ones(31 * 16000), 16000),
    ],
)
def test_bad_tts_audio_fails_without_silent_truncation(audio, rate):
    with pytest.raises(ValueError):
        mono(audio, rate, 16000)


def test_resample_duration_and_peak():
    converted = mono(np.ones(24000) * 2, 24000, 16000)
    assert len(converted) == 16000
    assert np.max(np.abs(converted)) <= 0.98000001


def test_paired_manifests_audio_hashes_and_replay(config, tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    summary = generate(config, a, ToneBackend())
    generate(config, b, ToneBackend())
    clips = [json.loads(line) for line in (a / "clips.jsonl").read_text().splitlines()]
    calls = [json.loads(line) for line in (a / "conversations.jsonl").read_text().splitlines()]
    assert summary["status"] == "complete"
    assert len(clips) == 32 and len(calls) == 8
    assert (a / "clips.jsonl").read_bytes() == (b / "clips.jsonl").read_bytes()
    for row in clips + calls:
        audio_path = a / row["audio_path"]
        audio, rate = sf.read(audio_path)
        assert hashlib.sha256(audio_path.read_bytes()).hexdigest() == row["audio_sha256"]
        assert len(audio) == row["frames"] and rate == 16000
        assert sf.info(audio_path).subtype == "PCM_16"
        assert row["reference_status"] == "unverified_script"
        assert row["contains_synthetic_speech"] is False
    clean = {r["clip_id"]: r for r in clips if r["condition_id"] == "clean"}
    for row in clips:
        parent = clean[row["clip_id"]]
        assert row["clean_sha256"] == parent["audio_sha256"]
        assert row["text"] == parent["text"] and row["split"] == parent["split"]
        assert row["tts_seed"] == parent["tts_seed"]
    assert all(r["split"] == "test" for r in clips if r["conversation_id"] == "duplicate_charge")
    call = next(r for r in calls if r["conversation_id"] == "duplicate_charge")
    assert call["segments"][2]["start"] < call["segments"][1]["end"]
    with pytest.raises(FileExistsError):
        generate(config, a, ToneBackend())


def test_failed_run_is_preserved_and_not_marked_complete(config, tmp_path):
    backend = ToneBackend()
    backend.synthesize = lambda *args: (_ for _ in ()).throw(RuntimeError("fixture failure"))
    out = tmp_path / "failed"
    with pytest.raises(RuntimeError, match="fixture failure"):
        generate(config, out, backend)
    assert json.loads((out / "summary.json").read_text())["status"] == "failed"
    assert (out / "config.json").exists()


def test_air_plan_uses_locked_environment_and_persists_audio_in_mlflow():
    spec = workload(
        Path("/tmp/staging"),
        experiment="audio",
        experiment_directory="/Workspace/me",
        timeout=60,
        design_revision="a" * 40,
        base_revision="b" * 40,
    )
    assert spec["compute"] == {"num_accelerators": 1, "accelerator_type": "GPU_1xA10"}
    assert "--frozen" in spec["command"] and "--log-mlflow" in spec["command"]
    assert "uv.lock" in spec["code_source"]["include_paths"]
    assert spec["max_retries"] == 0
    assert spec["timeout_minutes"] == 60


def test_launcher_validates_before_submission_and_passes_explicit_profile(config, tmp_path):
    import submit_air

    calls = []

    def fake_cli(command, **kwargs):
        from subprocess import CompletedProcess

        calls.append(command)
        assert Path(command[command.index("--file") + 1]).exists()
        assert command[command.index("--profile") + 1] == "chosen-by-user"
        return CompletedProcess(command, 0, '{"data": {}}', "")

    args = [
        "submit_air.py",
        "--profile",
        "chosen-by-user",
        "--config",
        str(ROOT / "configs/banking-demo.json"),
        "--experiment-directory",
        "/Workspace/me",
        "--artifacts-dir",
        str(tmp_path / "submit"),
        "--apply",
        "--idempotency-key",
        "run-v1",
    ]
    with patch("sys.argv", args), patch("submit_air.subprocess.run", side_effect=fake_cli):
        submit_air.main()
    assert len(calls) == 2 and "--dry-run" in calls[0]
    assert "--idempotency-key" in calls[1]


def test_air_validation_failure_never_submits(tmp_path):
    from subprocess import CompletedProcess

    import submit_air

    args = [
        "submit_air.py",
        "--profile",
        "chosen-by-user",
        "--config",
        str(ROOT / "configs/banking-demo.json"),
        "--experiment-directory",
        "/Workspace/me",
        "--artifacts-dir",
        str(tmp_path / "fail"),
        "--apply",
        "--idempotency-key",
        "run-v1",
    ]
    with (
        patch("sys.argv", args),
        patch(
            "submit_air.subprocess.run", return_value=CompletedProcess([], 1, "", "invalid")
        ) as run,
    ):
        with pytest.raises(SystemExit):
            submit_air.main()
    assert run.call_count == 1


def test_mlflow_upload_failure_marks_run_failed(tmp_path):
    from types import ModuleType
    from unittest.mock import MagicMock

    from audio_data_gen.cli import main

    tracking = ModuleType("mlflow")
    for name in ("set_tracking_uri", "start_run", "set_tags", "set_tag", "end_run"):
        setattr(tracking, name, MagicMock())
    tracking.log_artifacts = MagicMock(side_effect=RuntimeError("upload failed"))
    args = [
        "audio-data-gen",
        "generate",
        "--config",
        str(ROOT / "configs/banking-demo.json"),
        "--backend",
        "tone",
        "--output-dir",
        str(tmp_path / "upload-fail"),
        "--log-mlflow",
    ]
    with (
        patch.dict("sys.modules", {"mlflow": tracking}),
        patch.dict("os.environ", {"MLFLOW_RUN_ID": "test-run"}),
        patch("sys.argv", args),
    ):
        with pytest.raises(RuntimeError, match="upload failed"):
            main()
    tracking.end_run.assert_called_once_with(status="FAILED")


def test_qwen_reuses_persona_prompts_and_releases_design_model(config):
    from contextlib import nullcontext
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    from audio_data_gen.config import BASE_MODEL, DESIGN_MODEL
    from audio_data_gen.tts import QwenBackend

    torch = SimpleNamespace(inference_mode=nullcontext, cuda=MagicMock())
    design, base = MagicMock(), MagicMock()
    design.generate_voice_design.return_value = ([np.ones(16000) * 0.1], 16000)
    base.create_voice_clone_prompt.side_effect = ["prompt-a", "prompt-b", "prompt-c"]
    base.generate_voice_clone.return_value = ([np.ones(16000) * 0.2], 16000)
    backend = QwenBackend(design_revision="a" * 40, base_revision="b" * 40)
    with (
        patch.dict("sys.modules", {"torch": torch}),
        patch.object(backend, "_load", side_effect=[design, base]) as loading,
        patch.object(backend, "_seed"),
        patch.object(backend, "_check_device"),
    ):
        refs = backend.prepare(config["personas"], 42)
        for _ in range(2):
            backend.synthesize(config["personas"][0], "Hello", 10)
    assert [call.args[0] for call in loading.call_args_list] == [DESIGN_MODEL, BASE_MODEL]
    assert len(refs) == 3
    assert design.generate_voice_design.call_count == 3
    assert base.create_voice_clone_prompt.call_count == 3
    torch.cuda.empty_cache.assert_called_once()
    assert all(
        call.kwargs["voice_clone_prompt"] == "prompt-a"
        for call in base.generate_voice_clone.call_args_list
    )
