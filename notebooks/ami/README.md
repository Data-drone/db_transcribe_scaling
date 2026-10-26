# AMI meeting transcription example

A standalone example using meeting audio from the [AMI Meeting Corpus](https://huggingface.co/datasets/edinburghcstr/ami). It demonstrates loading audio into Unity Catalog, transcribing it with `ai_transcribe`, comparing output with reference text, and measuring throughput at larger volumes. It does not depend on HarperValleyBank or Call Insights.

## Prerequisites

- Databricks compute supporting the notebook's SQL functions and Unity Catalog Volumes.
- Access to `ai_transcribe` (the notebooks were developed against its preview) and `ai_similarity` for the comparison cells. Confirm availability in your workspace.
- Permission to create/use the target schema, volume and Delta tables.
- Outbound access to Hugging Face for the loader. The loader installs `huggingface_hub` and uses pandas/PyArrow.

## Run order

Import these `.py` files as Databricks source notebooks, then run them in order:

1. [AMI Corpus Data Loader](AMI%20Corpus%20Data%20Loader.py): downloads a parquet shard, writes WAV files, and writes reference metadata. Default `MAX_SAMPLES` is 20. Change it in both configuration blocks, including the block after the Python restart. `None` loads the entire selected shard.
2. [AMI Meeting Corpus — Audio Transcription Pipeline](AMI%20Meeting%20Corpus%20-%20Audio%20Transcription%20Pipeline.py): runs transcription, extracts segments and compares reference/transcribed text using semantic similarity.
3. [AMI Transcription Scale Testing](AMI%20Transcription%20Scale%20Testing.py): optionally reruns transcription over the loaded audio and reports timing, outcomes and similarity. Increase the loader's selection before using this for scale experiments.

The default shard is `ihm/test-00000-of-00004.parquet`; selecting one shard is not the same as loading the full test split.

## Configuration and outputs

Current defaults are catalog `serverless_stable_prvwqx_catalog`, schema `audio_parsing`, and volume `ami_audio`. Update Python configuration **and** hardcoded SQL cells before targeting another environment.

| Output | Purpose |
|---|---|
| `/Volumes/<catalog>/audio_parsing/ami_audio/` | Extracted WAV audio |
| `<catalog>.audio_parsing.ami_meeting_audio` | Audio metadata and reference text |
| `<catalog>.audio_parsing.ami_transcriptions_raw` | Raw `ai_transcribe` results |
| `<catalog>.audio_parsing.ami_transcriptions` | Extracted speaker segments and reconstructed text |

The loader overwrites metadata, and the transcription/scale notebooks replace result tables. Audio files from earlier loads remain in the volume, while transcription reads the volume contents. Use a separate schema/volume for isolated experiments and ensure its contents match the intended benchmark input. Similarity scores are not word error rate.

These notebooks moved from `ai_transribe/`; their filenames and source contents are preserved. Existing workspace notebook paths and data are unchanged. See the [repository README](../../README.md) and [HarperValleyBank example](../harper_valley_bank/README.md) for the other workflow.
