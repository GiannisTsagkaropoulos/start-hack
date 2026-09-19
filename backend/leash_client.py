"""Authenticated HTTP client for the real Leash production API.

Stdlib only (urllib) - no new dependency added for this. TEAM_API_KEY is
read from the environment exactly once at construction and is never logged,
printed, or returned by any method here. Every real call is optionally
recorded to a LeashLedger with headers/bodies redacted before they ever
reach the ledger's record() call.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

from leash_ledger import LeashLedger


class LeashApiError(Exception):
    def __init__(self, status: int, error_body: Any):
        self.status = status
        self.error_body = error_body
        super().__init__(f"Leash API error {status}: {error_body!r}")


class LeashClient:
    def __init__(self, base_url: str | None = None, api_key: str | None = None, timeout: float = 30.0, ledger: LeashLedger | None = None):
        self.base_url = (base_url or os.environ["LEASH_BASE_URL"]).rstrip("/")
        self._api_key = api_key or os.environ["TEAM_API_KEY"]
        self.timeout = timeout
        self.ledger = ledger
        # Mutable run context the worker updates as it learns each value, so
        # every subsequent ledger record is automatically tagged with it.
        self.scenario_id: str | None = None
        self.run_id: str | None = None

    def _headers(self, authed: bool = True) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if authed:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def _request(
        self,
        method: str,
        path: str,
        body: dict | None = None,
        authed: bool = True,
        authorization_id: str | None = None,
        source_authorization_id: str | None = None,
    ) -> tuple[int, Any]:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request_headers = self._headers(authed)
        req = urllib.request.Request(url, data=data, method=method, headers=request_headers)

        t0 = time.monotonic()
        status: int | None = None
        response_headers: dict[str, str] = {}
        response_body: Any = None
        error_for_ledger: Any = None

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                status = resp.status
                response_headers = dict(resp.headers.items())
                raw = resp.read()
                response_body = None if (status == 204 or not raw) else json.loads(raw)
            return status, response_body
        except urllib.error.HTTPError as error:
            status = error.code
            response_headers = dict(error.headers.items()) if error.headers else {}
            raw = error.read()
            try:
                parsed = json.loads(raw) if raw else None
            except json.JSONDecodeError:
                parsed = raw.decode("utf-8", errors="replace")
            response_body = parsed
            error_for_ledger = (parsed or {}).get("error", parsed) if isinstance(parsed, dict) else parsed
            raise LeashApiError(status, error_for_ledger) from error
        finally:
            if self.ledger is not None:
                elapsed_ms = (time.monotonic() - t0) * 1000
                self.ledger.record(
                    method=method,
                    path=path,
                    elapsed_ms=elapsed_ms,
                    request_headers=request_headers,
                    request_body=body,
                    response_status=status,
                    response_headers=response_headers,
                    response_body=response_body,
                    scenario_id=self.scenario_id,
                    run_id=self.run_id,
                    authorization_id=authorization_id,
                    source_authorization_id=source_authorization_id,
                    error=error_for_ledger,
                )

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

    def submit_decision(
        self,
        authorization_id: str,
        decision: str,
        reason_codes: list[str],
        customer_message: str,
        evidence: list[dict],
        source_authorization_id: str | None = None,
    ) -> dict:
        payload = {
            "authorization_id": authorization_id,
            "decision": decision,
            "reason_codes": reason_codes,
            "customer_message": customer_message,
            "evidence": evidence,
        }
        _, body = self._request(
            "POST",
            f"/v1/authorizations/{authorization_id}/decision",
            payload,
            authorization_id=authorization_id,
            source_authorization_id=source_authorization_id,
        )
        return body

    def resolve_authorization(self, authorization_id: str, decision: str, customer_message: str, evidence: list[dict]) -> dict:
        payload = {"decision": decision, "customer_message": customer_message, "evidence": evidence}
        _, body = self._request("POST", f"/v1/authorizations/{authorization_id}/resolve", payload, authorization_id=authorization_id)
        return body

    def team_reset(self) -> dict:
        _, body = self._request("POST", "/v1/team/reset", {})
        return body
