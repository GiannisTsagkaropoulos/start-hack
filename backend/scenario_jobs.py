"""In-process orchestration for the documented Leash API workflow.

The browser talks only to our FastAPI service.  This module keeps the team key
server-side, creates a reviewable mandate draft, and starts the scenario worker
only after a separate customer confirmation call.  Job state is intentionally
process-local for the demo; Leash remains the authoritative store for mandates,
runs, authorizations, and final decisions.
"""
from __future__ import annotations

import copy
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from decision_engine import evaluate_purchase
from leash_adapter import (
    authorization_event_to_purchase,
    engine_decision_to_leash_decision,
    mandate_snapshot_to_engine_policy,
)
from leash_client import LeashClient
from leash_ledger import LeashLedger


ClientFactory = Callable[[], LeashClient]

_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.RLock()
_ledger: LeashLedger | None = None
_ledger_lock = threading.Lock()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_client_factory() -> LeashClient:
    global _ledger
    with _ledger_lock:
        if _ledger is None:
            ledger_path = Path(__file__).resolve().parent / "logs" / "leash_interactions.jsonl"
            _ledger = LeashLedger(ledger_path)
    return LeashClient(ledger=_ledger)


def policy_to_hard_rules(policy: dict[str, Any]) -> list[dict[str, Any]]:
    """Translate the checks supported by the existing classifier to Leash rules.

    Publish only rules that the classifier can enforce either from the current
    authorization event or from the existing merchant-history lookup.
    """
    spending = policy["spending"]
    merchant = policy["merchant"]
    currency = spending["currency"]
    allowed_categories = policy["products"]["allowed_categories"]
    if not allowed_categories:
        raise ValueError("At least one allowed product category is required.")
    rules: list[dict[str, Any]] = [
        {
            "field": "authorization.items.item_category",
            "operator": "in",
            "value": allowed_categories,
            "scope": "purchase",
        },
        {
            "field": "authorization.items.unit_price",
            "operator": "<=",
            "value": spending["per_item_purchase_price_max"],
            "currency": currency,
            "scope": "purchase",
        }
    ]
    if merchant.get("familiarity_required"):
        rules.append(
            {
                "field": "history.approved_merchant_transaction_count",
                "operator": ">=",
                "value": max(1, merchant.get("familiarity_min_prior_approved") or 1),
                "scope": "purchase",
            }
        )

    blocklist = merchant.get("blocklist") or []
    if blocklist:
        rules.append({"field": "authorization.merchant", "operator": "not_in", "value": blocklist, "scope": "purchase"})

    allowlist = merchant.get("allowlist") or []
    if allowlist:
        rules.append({"field": "authorization.merchant", "operator": "in", "value": allowlist, "scope": "purchase"})

    order_terms = policy.get("order_terms", {})
    if order_terms.get("require_returnable"):
        rules.append({"field": "authorization.order_returnable", "operator": "=", "value": "true", "scope": "purchase"})
    if order_terms.get("require_cancellable"):
        rules.append({"field": "authorization.order_cancellable", "operator": "=", "value": "true", "scope": "purchase"})

    max_attempts = policy.get("session", {}).get("max_recent_attempts_10m")
    if max_attempts is not None:
        # The event contains the number of earlier attempts. Using '< max'
        # means the current attempt remains within a total-attempt cap of max.
        rules.append({"field": "authorization.recent_attempt_count_10m", "operator": "<", "value": max_attempts, "scope": "purchase"})
    return rules


def prepare_job(
    wallet_id: int,
    policy: dict[str, Any],
    client_factory: ClientFactory = _default_client_factory,
) -> dict[str, Any]:
    """Run discovery and create the draft that the customer must review."""
    client = client_factory()
    health = client.healthz()
    bootstrap = client.bootstrap()
    reference_data = client.reference_data()
    hard_rules = policy_to_hard_rules(policy)
    draft = client.create_mandate(policy["raw_instructions"], hard_rules)

    job_id = f"JOB_{uuid.uuid4().hex[:16]}"
    scenarios = [
        {
            "scenario_id": item["scenario_id"],
            "scenario_name": item["scenario_name"],
            "event_count": item["event_count"],
            "status": "queued",
            "run_id": None,
            "counters": {},
            "results": [],
        }
        for item in bootstrap.get("scenarios", [])
    ]
    job = {
        "job_id": job_id,
        "wallet_id": wallet_id,
        "status": "awaiting_confirmation",
        "created_at": _utc_now(),
        "updated_at": _utc_now(),
        "health": {
            "status": health.get("status"),
            "service": health.get("service"),
            "api_version": health.get("api_version"),
            "pack_version": health.get("pack_version"),
        },
        "bootstrap": {
            "api_version": bootstrap.get("api_version"),
            "pack_version": bootstrap.get("pack_version"),
            "timeouts": bootstrap.get("timeouts", {}),
        },
        "reference_data_loaded": reference_data is not None,
        "draft": draft,
        "mandate_id": None,
        "scenarios": scenarios,
        "error": None,
    }
    with _jobs_lock:
        _jobs[job_id] = job
    return get_job(job_id)


def confirm_and_start_job(
    job_id: str,
    client_factory: ClientFactory = _default_client_factory,
) -> dict[str, Any]:
    with _jobs_lock:
        job = _require_job(job_id)
        if job["status"] != "awaiting_confirmation":
            raise ValueError("This mandate has already been confirmed or cannot be started.")
        draft_id = job["draft"]["draft_id"]

    client = client_factory()
    confirmed = client.confirm_mandate(draft_id)
    with _jobs_lock:
        job = _require_job(job_id)
        job["mandate_id"] = confirmed["mandate_id"]
        job["status"] = "running"
        job["updated_at"] = _utc_now()

    thread = threading.Thread(
        target=_run_all_scenarios,
        args=(job_id, client_factory),
        name=f"leash-{job_id}",
        daemon=True,
    )
    thread.start()
    return get_job(job_id)


def get_job(job_id: str) -> dict[str, Any]:
    with _jobs_lock:
        job = copy.deepcopy(_require_job(job_id))

    results = [result for scenario in job["scenarios"] for result in scenario["results"]]
    job["summary"] = {
        "total": len(results),
        "approve": sum(_display_decision(item) == "approve" for item in results),
        "decline": sum(_display_decision(item) == "decline" for item in results),
        "step_up": sum(item["engine_decision"] == "step_up" for item in results),
        "awaiting_customer": sum(not item["is_final"] for item in results),
    }
    return job


def resolve_authorization(
    job_id: str,
    authorization_id: str,
    decision: str,
    client_factory: ClientFactory = _default_client_factory,
) -> dict[str, Any]:
    if decision not in {"approve", "decline"}:
        raise ValueError("A customer resolution must be approve or decline.")

    with _jobs_lock:
        job = _require_job(job_id)
        result = _find_result(job, authorization_id)
        if result["engine_decision"] != "step_up":
            raise ValueError("Only a step-up authorization can be resolved.")
        if result["is_final"]:
            raise ValueError("This authorization already has a final result.")

    message = (
        "The customer confirmed this purchase."
        if decision == "approve"
        else "The customer rejected this purchase."
    )
    client = client_factory()
    response = client.resolve_authorization(authorization_id, decision, message, [])

    with _jobs_lock:
        job = _require_job(job_id)
        result = _find_result(job, authorization_id)
        result["final_decision"] = decision
        result["status"] = response.get("status", "resolved")
        result["is_final"] = response.get("is_final", True)
        result["customer_resolution_message"] = message
        result["resolved_at"] = _utc_now()
        job["updated_at"] = _utc_now()
        if not _has_pending_customer_decisions(job) and job["status"] == "awaiting_customer":
            job["status"] = "running"
    return get_job(job_id)


def _run_all_scenarios(job_id: str, client_factory: ClientFactory) -> None:
    try:
        with _jobs_lock:
            mandate_id = _require_job(job_id)["mandate_id"]
            scenario_ids = [item["scenario_id"] for item in _require_job(job_id)["scenarios"]]

        for scenario_id in scenario_ids:
            _run_one_scenario(job_id, mandate_id, scenario_id, client_factory())

        with _jobs_lock:
            job = _require_job(job_id)
            job["status"] = "completed"
            job["updated_at"] = _utc_now()
    except Exception as error:  # surfaced verbatim to the local UI, never includes the key
        with _jobs_lock:
            job = _require_job(job_id)
            job["status"] = "failed"
            job["error"] = str(error)
            job["updated_at"] = _utc_now()


def _run_one_scenario(job_id: str, mandate_id: str, scenario_id: str, client: LeashClient) -> None:
    client.scenario_id = scenario_id
    run = client.create_scenario_run(mandate_id, scenario_id)
    run_id = run["run_id"]
    client.run_id = run_id
    with _jobs_lock:
        scenario = _find_scenario(_require_job(job_id), scenario_id)
        scenario["run_id"] = run_id
        scenario["status"] = run.get("status", "running")
        scenario["counters"] = run.get("counters", {})
        _require_job(job_id)["updated_at"] = _utc_now()

    handled: set[str] = set()
    poll_wait = int(get_job(job_id)["bootstrap"]["timeouts"].get("long_poll_max_wait_seconds", 25))

    while True:
        current_run = client.get_scenario_run(run_id)
        with _jobs_lock:
            job = _require_job(job_id)
            scenario = _find_scenario(job, scenario_id)
            scenario["status"] = current_run["status"]
            scenario["counters"] = current_run.get("counters", {})
            job["status"] = "awaiting_customer" if _has_pending_customer_decisions(job) else "running"
            job["updated_at"] = _utc_now()
        if current_run["status"] == "completed":
            with _jobs_lock:
                # A run can complete when Leash's human deadline expires. Keep
                # the original step-up classification, but stop presenting an
                # expired authorization as actionable in the UI.
                scenario = _find_scenario(_require_job(job_id), scenario_id)
                for result in scenario["results"]:
                    if not result["is_final"]:
                        result["is_final"] = True
                        result["status"] = "timed_out"
            return

        status, envelope = client.next_decision_request(wait=poll_wait)
        if status == 204 or envelope is None:
            continue
        if envelope.get("run_id") != run_id:
            raise RuntimeError(
                f"Received authorization for unexpected run {envelope.get('run_id')}; "
                f"expected {run_id}. Stop other team workers before retrying."
            )

        authorization_id = envelope["authorization_id"]
        if authorization_id in handled:
            continue

        event_data = envelope["data"]
        mandate_snapshot = event_data["mandate"]
        policy = mandate_snapshot_to_engine_policy(mandate_snapshot)
        purchase = authorization_event_to_purchase(event_data)
        started = time.monotonic()
        engine_result = evaluate_purchase(policy, purchase)
        decision, reason_codes, customer_message, evidence = engine_decision_to_leash_decision(engine_result)
        response = client.submit_decision(
            authorization_id,
            decision,
            reason_codes,
            customer_message,
            evidence,
            source_authorization_id=event_data["authorization"].get("source_authorization_id"),
        )
        handled.add(authorization_id)

        result = {
            "authorization_id": authorization_id,
            "source_authorization_id": event_data["authorization"].get("source_authorization_id"),
            "engine_decision": decision,
            "final_decision": decision if response.get("is_final", decision != "step_up") else None,
            "reason_codes": reason_codes,
            "customer_message": customer_message,
            "evidence": evidence,
            "status": response.get("status"),
            "is_final": response.get("is_final", decision != "step_up"),
            "human_deadline_at": response.get("human_deadline_at"),
            "decision_latency_ms": round((time.monotonic() - started) * 1000, 2),
            "purchase": _purchase_summary(event_data),
        }
        with _jobs_lock:
            job = _require_job(job_id)
            scenario = _find_scenario(job, scenario_id)
            scenario["results"].append(result)
            if not result["is_final"]:
                scenario["status"] = "awaiting_customer"
                job["status"] = "awaiting_customer"
            job["updated_at"] = _utc_now()


def _purchase_summary(event_data: dict[str, Any]) -> dict[str, Any]:
    authorization = event_data["authorization"]
    merchant = authorization.get("merchant", {})
    return {
        "description": authorization.get("purchase_description"),
        "amount": authorization.get("amount"),
        "currency": authorization.get("currency"),
        "billing_amount_chf": authorization.get("billing_amount_chf"),
        "merchant_name": merchant.get("merchant_name"),
        "merchant_country": merchant.get("merchant_country"),
        "replay_order": authorization.get("replay_order"),
        "items": [
            {
                "name": item.get("item_name"),
                "quantity": item.get("quantity"),
                "unit_price": item.get("unit_price"),
                "currency": item.get("currency"),
            }
            for item in authorization.get("items", [])
        ],
    }


def _display_decision(result: dict[str, Any]) -> str:
    return result.get("final_decision") or result["engine_decision"]


def _has_pending_customer_decisions(job: dict[str, Any]) -> bool:
    return any(
        not result["is_final"]
        for scenario in job["scenarios"]
        for result in scenario["results"]
    )


def _require_job(job_id: str) -> dict[str, Any]:
    try:
        return _jobs[job_id]
    except KeyError as error:
        raise KeyError(f"Unknown scenario job: {job_id}") from error


def _find_scenario(job: dict[str, Any], scenario_id: str) -> dict[str, Any]:
    for scenario in job["scenarios"]:
        if scenario["scenario_id"] == scenario_id:
            return scenario
    raise KeyError(f"Unknown scenario: {scenario_id}")


def _find_result(job: dict[str, Any], authorization_id: str) -> dict[str, Any]:
    for scenario in job["scenarios"]:
        for result in scenario["results"]:
            if result["authorization_id"] == authorization_id:
                return result
    raise KeyError(f"Unknown authorization: {authorization_id}")
