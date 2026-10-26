#!/usr/bin/env python3
"""Run explicit stages of Intelligence acceptance through the deployed Apps proxy.

No stage runs by importing this file. preflight/status/evidence are read-only;
sample/feedback/full persist business workflow data and require --execute.
Never fabricate trusted forwarded identity headers or persist access tokens.
"""
import argparse
import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

PROFILE = "fevm-serverless-stable-prvwqx"
LABEL = {
    "name": "Deployment verification — customer card replacement",
    "definition": "The customer explicitly requests replacing a bank card because it is lost, stolen, damaged, or needs replacement. A mention of a card without a replacement request does not match.",
    "includeExamples": "I lost my card and need a replacement. Please replace my damaged debit card.",
    "excludeExamples": "A balance check, money transfer, password reset, or an agent mentioning a card without the customer requesting replacement.",
    "speakerFocus": "customer", "queue": "", "startDate": "2020-03-15", "endDate": "2020-06-02",
}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-url", required=True)
    parser.add_argument("--stage", choices=["preflight", "sample", "status", "evidence", "feedback", "full", "verify"], default="preflight")
    parser.add_argument("--state", default="/private/tmp/call-insights-intelligence-live.json")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--interaction-id")
    parser.add_argument("--verdict", choices=["correct", "incorrect"])
    parser.add_argument("--note")
    args = parser.parse_args()
    parsed = urlparse(args.app_url)
    if parsed.scheme != "https" or not (parsed.hostname or "").endswith(".databricksapps.com") or parsed.username or parsed.password or parsed.port not in (None, 443) or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        parser.error("Use the verified HTTPS Databricks Apps origin, without path or credentials.")
    if args.stage in {"sample", "feedback", "full"} and not args.execute:
        parser.error("This stage persists live workflow data; provide --execute after authorization.")
    base = args.app_url.rstrip("/")
    token_result = subprocess.run(["databricks", "auth", "token", "--profile", PROFILE, "-o", "json"], capture_output=True, text=True)
    if token_result.returncode:
        raise RuntimeError("Could not obtain the selected profile's user token; repair normal CLI authentication.")
    token = json.loads(token_result.stdout)["access_token"]
    opener = build_opener(NoRedirect())
    state_path = Path(args.state)
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    if state and state.get("appUrl") != base:
        raise RuntimeError("The saved verification state belongs to another app origin.")

    def save():
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps(state, indent=2) + "\n")

    def request(path, method="GET", body=None, expected=200):
        data = None if body is None else json.dumps(body).encode()
        req = Request(base + path, data=data, method=method, headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
        try:
            with opener.open(req, timeout=60) as response:
                status, content_type, text = response.status, response.headers.get("Content-Type", ""), response.read().decode()
        except HTTPError as error:
            status, content_type, text = error.code, error.headers.get("Content-Type", ""), error.read().decode()
        if status != expected:
            try:
                failure = json.loads(text)
                detail = {key: failure[key] for key in ("error", "message", "code", "error_code") if key in failure}
            except (ValueError, TypeError):
                detail = {"contentType": content_type}
            safe_detail = json.dumps(detail).replace(token, "[redacted]")[:1500]
            raise RuntimeError(f"{method} {path}: expected HTTP {expected}, received {status}; {safe_detail}")
        if "text/event-stream" in content_type:
            result = None
            for block in text.replace("\r\n", "\n").split("\n\n"):
                payload = "\n".join(line[5:].lstrip() for line in block.splitlines() if line.startswith("data:"))
                if not payload:
                    continue
                event = json.loads(payload)
                if event.get("type") == "error" or "error" in event:
                    raise RuntimeError(f"Analytics stream failed for {path}; inspect authorized app logs.")
                if event.get("type") == "result":
                    result = event.get("data", [])
            if result is None:
                raise RuntimeError("Analytics stream contained no result event.")
            return result
        if "json" not in content_type:
            raise RuntimeError("The app returned a login or other non-JSON page; trusted proxy identity was not established.")
        return json.loads(text)

    def analytics(key, **values):
        markers = {key: {"__sql_type": "INT" if isinstance(value, int) else "DOUBLE" if isinstance(value, float) else "STRING", "value": str(value)} for key, value in values.items()}
        return request("/api/analytics/query/" + key, "POST", {"format": "JSON_ARRAY", "parameters": markers})

    identity = request("/api/whoami")
    if not identity.get("email") or not identity.get("user"):
        raise RuntimeError("Trusted Apps proxy identity is incomplete.")
    labels = request("/api/intelligence/labels")
    if args.stage == "preflight":
        print(json.dumps({"identity": identity, "savedLabels": len(labels), "appUrl": base}, indent=2))
        return
    if not state:
        if args.stage != "sample":
            raise RuntimeError("Create the acceptance label with the sample stage first.")
        state.update(appUrl=base, actor=identity)
    if state.get("actor") != identity:
        raise RuntimeError("Verification state belongs to a different signed-in actor.")
    if args.stage == "sample":
        if not state.get("labelId"):
            label = request("/api/intelligence/labels", "POST", LABEL, 201)
            state.update(labelId=label["id"], version=label["currentVersion"], originalRevision=label["versions"][0])
            save()
        label_path = "/api/intelligence/labels/" + quote(state["labelId"], safe="")
        if state["version"] == 1:
            revised = {**LABEL, "definition": LABEL["definition"] + " Evaluate only explicit statements by the customer."}
            label = request(label_path, "PUT", revised)
            assert label["currentVersion"] == 2 and len(label["versions"]) == 2
            assert label["versions"][0] == state["originalRevision"], "The prior revision changed during an edit"
            state["version"] = 2
            save()
        if not state.get("sample"):
            request(label_path + "/runs", "POST", {"version": state["version"], "type": "full"}, 409)
            state["sample"] = request(label_path + "/runs", "POST", {"version": state["version"], "type": "sample"}, 202)
            save()
        print(json.dumps({"labelId": state["labelId"], "version": state["version"], "sample": state["sample"]}, indent=2))
        return
    runs = analytics("intelligence_runs", label_id=state["labelId"], refresh_nonce=str(time.time_ns()))
    sample_id = state["sample"]["runId"]
    sample = next((run for run in runs if run["run_id"] == sample_id), None)
    if args.stage == "status":
        current_id = state.get("full", state["sample"])["runId"]
        results = analytics("intelligence_results", run_id=current_id, page_offset=0, refresh_nonce=str(time.time_ns()))
        print(json.dumps({"runs": runs, "visibleResults": len(results), "results": results}, indent=2))
    elif args.stage == "evidence":
        if not args.interaction_id:
            parser.error("Evidence review requires --interaction-id.")
        print(json.dumps(analytics("call_segments", interaction_id=args.interaction_id), indent=2))
    elif args.stage == "feedback":
        if not args.interaction_id or not args.verdict or not args.note:
            parser.error("Feedback requires a reviewed interaction ID, verdict, and truthful review note.")
        result = request("/api/intelligence/runs/" + sample_id + "/feedback", "PUT", {"interactionId": args.interaction_id, "verdict": args.verdict, "note": args.note})
        state["reviewed"] = {"interactionId": args.interaction_id, "verdict": args.verdict}
        save()
        print(json.dumps(result))
    elif args.stage == "full":
        if not sample or sample["status"] != "completed" or int(sample["error_count"]) != 0:
            raise RuntimeError("A completed, error-free same-version sample is required.")
        if not state.get("reviewed"):
            raise RuntimeError("Review at least one source decision and save a truthful verdict first.")
        if not state.get("full"):
            label_path = "/api/intelligence/labels/" + quote(state["labelId"], safe="")
            estimate = request(label_path + "/estimate", "POST", {"version": state["version"]})
            state["estimate"] = estimate
            save()
            state["full"] = request(label_path + "/runs", "POST", {"version": state["version"], "type": "full", "cohortId": estimate["cohortId"]}, 202)
            save()
        print(json.dumps({"estimate": state["estimate"], "full": state["full"]}, indent=2))
    elif args.stage == "verify":
        full_id = state["full"]["runId"]
        full = next((run for run in runs if run["run_id"] == full_id), None)
        label = next((label for label in labels if label["id"] == state["labelId"]), None)
        assert label and label["versions"][0] == state["originalRevision"]
        assert label["currentVersion"] == state["version"] == 2
        for run in (sample, full):
            assert run and run["status"] == "completed" and int(run["error_count"]) == 0
            assert int(run["processed_count"]) == int(run["interactions_in_scope"])
        sample_results = analytics("intelligence_results", run_id=sample_id, page_offset=0, refresh_nonce=str(time.time_ns()))
        full_results = analytics("intelligence_results", run_id=full_id, page_offset=0, refresh_nonce=str(time.time_ns()))
        assert len(sample_results) == int(sample["interactions_in_scope"]) == 20
        assert len(full_results) == int(full["interactions_in_scope"]) == state["estimate"]["count"] == 50
        assert len({row["interaction_id"] for row in full_results}) == 50
        verdicts = {row["interaction_id"]: row["verdict"] for row in sample_results if row["verdict"]}
        assert verdicts.get("0002f70f7386445b") == "correct"
        assert verdicts.get("0091a706bc604188") == "correct"
        matches = [row for row in full_results if row["matched"] in (True, "true")]
        assert len(matches) == int(full["matched_count"])
        assert all(row["grounded"] in (True, "true") and float(row["evidence_start_seconds"]) >= 0 for row in matches)
        breakdown = analytics("intelligence_breakdown", run_id=full_id, refresh_nonce=str(time.time_ns()))
        for dimension in ("queue", "agent", "day"):
            assert sum(int(row["evaluated_count"]) for row in breakdown if row["dimension"] == dimension) == 50
        summary = analytics("intelligence_summary", refresh_nonce=str(time.time_ns()))
        latest = next(row for row in summary if row["label_id"] == state["labelId"])
        assert latest["status"] == "completed" and latest["run_type"] == "full"
        print(json.dumps({"verifiedAt": datetime.now(timezone.utc).isoformat(), "appUrl": base, "profile": PROFILE, "actor": identity, "labelId": state["labelId"], "version": state["version"], "priorRevisionUnchanged": True, "sample": sample, "sampleResultCount": len(sample_results), "persistedSampleVerdicts": verdicts, "preview": {key: state["estimate"][key] for key in ("cohortId", "count", "estimatedTokens", "modelEndpoint", "inputCost", "outputCost", "expiresAt")}, "full": full, "fullResultCount": len(full_results), "uniqueFullSources": 50, "groundedFullMatches": len(matches), "breakdowns": breakdown, "latestLibrarySummary": latest, "reviewScope": "Two sample decisions reviewed against authorized masked transcripts; audio and browser acceptance handled separately.", "limitations": ["Single authorized identity; restricted second-identity acceptance remains outstanding.", "No inference-accuracy, latency, or cost target established.", "Automatic incremental tracking is not implemented."]}, indent=2))


if __name__ == "__main__":
    main()
