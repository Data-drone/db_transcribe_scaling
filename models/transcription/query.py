"""Query a deployed transcription endpoint with bounded retries and no embedded tokens."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import random
import time

from runtime import request_from_file, validate_batch


def query_chunks(client, endpoint: str, rows: list[dict], *, attempts: int = 3, sleep=time.sleep) -> list[dict]:
    from databricks.sdk.errors import DatabricksError
    validate_batch(rows)
    response = None
    for attempt in range(attempts):
        try:
            response = client.serving_endpoints.query(name=endpoint, dataframe_records=rows).as_dict()
            break
        except DatabricksError as exc:
            # Do not retry authorization, invalid input or missing endpoints.
            if exc.error_code not in {"REQUEST_LIMIT_EXCEEDED", "TOO_MANY_REQUESTS",
                                      "TEMPORARILY_UNAVAILABLE", "INTERNAL_ERROR"} or attempt + 1 == attempts:
                raise
            sleep(min(2 ** attempt + random.random(), 10))
    if response is None:
        raise ValueError("attempts must be positive")
    predictions = response.get("predictions")
    if not isinstance(predictions, list) or len(predictions) != len(rows):
        raise RuntimeError("Endpoint returned an unexpected prediction shape")
    if [p.get("chunk_id") for p in predictions] != [r["chunk_id"] for r in rows]:
        raise RuntimeError("Endpoint response chunk IDs do not match request order")
    return predictions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--wav", required=True, type=Path)
    parser.add_argument("--chunk-id", required=True)
    parser.add_argument("--language", default="English")
    parser.add_argument("--speaker-role", default="unknown")
    parser.add_argument("--offset-seconds", type=float, default=0.0)
    args = parser.parse_args()
    row = request_from_file(args.wav, args.chunk_id, language=args.language,
                            speaker_role=args.speaker_role, offset_seconds=args.offset_seconds)
    from databricks.sdk import WorkspaceClient
    predictions = query_chunks(WorkspaceClient(profile=args.profile), args.endpoint, [row])
    print(json.dumps(predictions, indent=2, ensure_ascii=False))
    if any(p.get("status") == "error" for p in predictions):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
