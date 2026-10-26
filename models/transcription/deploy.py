"""Plan/create/update an explicit UC model version using a selected CLI profile."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import time

from runtime import registered_name, request_from_file


def endpoint_config(model: str, version: str, workload_type: str, scale_to_zero: bool = False) -> dict:
    registered_name(model)
    if not re.fullmatch(r"[1-9][0-9]*", version):
        raise ValueError("Deploy an explicit positive numeric model version, not an alias")
    entity = f"asr-v{version}"
    return {"served_entities": [{"name": entity, "entity_name": model, "entity_version": version,
                                  "workload_type": workload_type, "workload_size": "Small",
                                  "scale_to_zero_enabled": scale_to_zero,
                                  "environment_vars": {"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"}}],
            "traffic_config": {"routes": [{"served_model_name": entity, "traffic_percentage": 100}]}}


def requested_version_ready(endpoint: dict, config: dict) -> bool:
    state = endpoint.get("state") or {}
    update = state.get("config_update", "")
    if "FAILED" in update:
        raise RuntimeError(f"Endpoint configuration update failed: {update}")
    if state.get("ready") != "READY" or update != "NOT_UPDATING":
        return False
    wanted = config["served_entities"][0]
    active = endpoint.get("config") or {}
    entity_matches = any(e.get("name") == wanted["name"] and e.get("entity_name") == wanted["entity_name"]
                         and str(e.get("entity_version")) == wanted["entity_version"]
                         and all(e.get(key) == wanted[key] for key in (
                             "workload_type", "workload_size", "scale_to_zero_enabled"))
                         and all((e.get("environment_vars") or {}).get(key) == value
                                 for key, value in wanted["environment_vars"].items())
                         for e in active.get("served_entities", []))
    routes = (active.get("traffic_config") or {}).get("routes", [])
    return entity_matches and any(r.get("served_model_name") == wanted["name"]
                                  and r.get("traffic_percentage") == 100 for r in routes)


def wait_for_version(client, endpoint_name: str, config: dict, timeout: float = 2400,
                     interval: float = 15, *, clock=time.monotonic, sleep=time.sleep) -> dict:
    deadline = clock() + timeout
    previous_progress = None
    while True:
        current = client.serving_endpoints.get(endpoint_name).as_dict()
        if requested_version_ready(current, config):
            return current
        pending = current.get("pending_config") or current.get("config") or {}
        progress = {"state": current.get("state"), "entities": [
            {"name": entity.get("name"), "state": entity.get("state")}
            for entity in pending.get("served_entities", [])]}
        if progress != previous_progress:
            print(json.dumps({"endpoint": endpoint_name, "progress": progress}), file=sys.stderr, flush=True)
            previous_progress = progress
        if clock() >= deadline:
            raise TimeoutError("Requested model version did not become ready; no alias was promoted")
        sleep(min(interval, max(0.0, deadline - clock())))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--registered-model", required=True, type=registered_name)
    parser.add_argument("--version", required=True)
    parser.add_argument("--workload-type", required=True, choices=["GPU_SMALL", "GPU_MEDIUM"])
    parser.add_argument("--scale-to-zero", action="store_true", help="Opt-in development cold starts")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Create/update the endpoint and check a spoken fixture")
    mode.add_argument("--wait-only", action="store_true",
                      help="Resume readiness/fixture checks without creating or updating the endpoint")
    parser.add_argument("--update-existing", action="store_true", help="Allow replacing an existing endpoint config")
    parser.add_argument("--timeout-seconds", type=int, default=2400)
    parser.add_argument("--sample-wav", type=Path)
    parser.add_argument("--expected-text")
    parser.add_argument("--output", type=Path, default=Path("deployment.json"))
    args = parser.parse_args()
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}", args.endpoint) or args.endpoint.startswith("databricks-"):
        parser.error("Use a valid endpoint name without the reserved databricks- prefix")
    config = endpoint_config(args.registered_model, args.version, args.workload_type, args.scale_to_zero)
    if args.timeout_seconds <= 0:
        parser.error("--timeout-seconds must be positive")
    plan = {"name": args.endpoint, "config": config}
    if not args.apply and not args.wait_only:
        print(json.dumps(plan, indent=2))
        return
    if not args.sample_wav or not args.expected_text:
        parser.error("--apply/--wait-only requires --sample-wav and --expected-text for a real endpoint smoke test")
    sample = request_from_file(args.sample_wav, "deployment-fixture")

    from databricks.sdk import WorkspaceClient
    from databricks.sdk.errors import NotFound
    from databricks.sdk.service.serving import EndpointCoreConfigInput
    from register import check_prediction

    client = WorkspaceClient(profile=args.profile)
    previous = None
    try:
        previous = client.serving_endpoints.get(args.endpoint).as_dict()
    except NotFound:
        pass
    # Save the prior active configuration before any mutation for an explicit rollback.
    receipt = {"profile": args.profile, "endpoint": args.endpoint, "requested": config,
               "previous_config": (previous or {}).get("config"),
               "started_at": datetime.now(timezone.utc).isoformat(), "status": "planned"}
    if args.wait_only and previous is None:
        raise RuntimeError("--wait-only requires an existing endpoint")
    if previous and args.apply and not args.update_existing:
        raise RuntimeError("Endpoint already exists; inspect its config and pass --update-existing to replace it")
    if previous and args.apply and (previous.get("state") or {}).get("config_update") == "IN_PROGRESS":
        raise RuntimeError("Existing configuration update is in progress; wait before submitting another")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2) + "\n")
    try:
        if args.apply:
            typed = EndpointCoreConfigInput.from_dict(config)
            if previous:
                client.serving_endpoints.update_config(name=args.endpoint, served_entities=typed.served_entities,
                                                       traffic_config=typed.traffic_config)
            else:
                client.serving_endpoints.create(name=args.endpoint, config=typed)
        wait_for_version(client, args.endpoint, config, args.timeout_seconds)
        response = client.serving_endpoints.query(name=args.endpoint, dataframe_records=[sample]).as_dict()
        check_prediction(response, args.expected_text)
        receipt["fixture_prediction"] = response
        receipt["status"] = "ready_and_smoke_tested"
    except TimeoutError as exc:
        receipt.update(status="readiness_timed_out", error=f"{type(exc).__name__}: {exc}")
        raise
    except Exception as exc:
        receipt.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        args.output.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"endpoint": args.endpoint, "version": args.version, "status": receipt["status"],
                      "receipt": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
