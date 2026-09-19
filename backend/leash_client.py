"""Authenticated HTTP client for the real Leash production API.

Stdlib only (urllib) - no new dependency added for this. TEAM_API_KEY is
read from the environment exactly once at construction and is never logged,
printed, or returned by any method here.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


class LeashApiError(Exception):
    def __init__(self, status: int, error_body: Any):
        self.status = status
        self.error_body = error_body
        super().__init__(f"Leash API error {status}: {error_body!r}")


class LeashClient:
    def __init__(self, base_url: str | None = None, api_key: str | None = None, timeout: float = 30.0):
        self.base_url = (base_url or os.environ["LEASH_BASE_URL"]).rstrip("/")
        self._api_key = api_key or os.environ["TEAM_API_KEY"]
        self.timeout = timeout

    def _headers(self, authed: bool = True) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if authed:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def _request(self, method: str, path: str, body: dict | None = None, authed: bool = True) -> tuple[int, Any]:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers=self._headers(authed))
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                status = resp.status
                raw = resp.read()
        except urllib.error.HTTPError as error:
            raw = error.read()
            status = error.code
            try:
                parsed = json.loads(raw) if raw else None
            except json.JSONDecodeError:
                parsed = raw.decode("utf-8", errors="replace")
            raise LeashApiError(status, (parsed or {}).get("error", parsed) if isinstance(parsed, dict) else parsed) from error

        if status == 204 or not raw:
            return status, None
        return status, json.loads(raw)

    def healthz(self) -> dict:
        _, body = self._request("GET", "/healthz", authed=False)
        return body

    def bootstrap(self) -> dict:
        _, body = self._request("GET", "/v1/bootstrap")
        return body

    def reference_data(self) -> dict:
        _, body = self._request("GET", "/v1/reference-data")
        return body

    def create_mandate(self, instruction: str, hard_rules: list[dict], uncertainty_policy: str = "ask") -> dict:
        payload = {
            "instruction": instruction,
            "hard_rules": hard_rules,
            "uncertainty_policy": uncertainty_policy,
            "guidance": [],
            "open_questions": [],
        }
        _, body = self._request("POST", "/v1/mandates", payload)
        return body

    def confirm_mandate(self, draft_id: str) -> dict:
        _, body = self._request("POST", f"/v1/mandates/{draft_id}/confirm", {"confirmed": True})
        return body

    def get_mandate(self, mandate_id: str) -> dict:
        _, body = self._request("GET", f"/v1/mandates/{mandate_id}")
        return body

    def create_scenario_run(self, mandate_id: str, scenario_id: str) -> dict:
        _, body = self._request("POST", "/v1/scenario-runs", {"mandate_id": mandate_id, "scenario_id": scenario_id})
        return body

    def get_scenario_run(self, run_id: str) -> dict:
        _, body = self._request("GET", f"/v1/scenario-runs/{run_id}")
        return body

    def next_decision_request(self, wait: int = 25) -> tuple[int, dict | None]:
        """Returns (status, envelope). status 204 means no request - caller loops."""
        status, body = self._request("GET", f"/v1/decision-requests/next?wait={wait}")
        return status, body

    def submit_decision(self, authorization_id: str, decision: str, reason_codes: list[str], customer_message: str, evidence: list[dict]) -> dict:
        payload = {
            "decision": decision,
            "reason_codes": reason_codes,
            "customer_message": customer_message,
            "evidence": evidence,
        }
        _, body = self._request("POST", f"/v1/authorizations/{authorization_id}/decision", payload)
        return body

    def resolve_authorization(self, authorization_id: str, decision: str, customer_message: str, evidence: list[dict]) -> dict:
        payload = {"decision": decision, "customer_message": customer_message, "evidence": evidence}
        _, body = self._request("POST", f"/v1/authorizations/{authorization_id}/resolve", payload)
        return body

    def team_reset(self) -> dict:
        _, body = self._request("POST", "/v1/team/reset", {})
        return body
