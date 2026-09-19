"""Deterministic first-pass evaluator for Viseca mandate hard rules.

Live mode evaluates the `data` object from GET /v1/decision-requests/next.
Offline mode reconstructs the same decision facts from viseca_control.db.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from .mandate_generator import compile_viseca_mandate, validate_mandate

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE = ROOT / "viseca_control.db"
UNKNOWN = object()

# These facts cannot be decided from the authorization event alone. They need
# trusted history or decision state supplied by the database-backed caller, so
# failures are routed to step-up instead of an automatic decline.
SOFT_RULE_FIELDS = {
    "history.approved_merchant_transaction_count",
    "history.customer_device_familiar",
    "context.minutes_since_similar_approved_purchase",
}


@dataclass(frozen=True)
class RuleResult:
    rule_type: str
    field: str
    operator: str
    expected: Any
    actual: Any
    status: str
    source: str
    message: str


def _normalise(value: str) -> str:
    tokens = re.sub(r"[^a-z0-9]+", " ", value.casefold()).split()
    return " ".join(token[:-1] if len(token) > 3 and token.endswith("s") else token for token in tokens)


def item_matches_mandate(item: dict[str, Any], matcher: dict[str, Any]) -> bool:
    """Return whether one authorization item satisfies one v2 requested-item matcher.

    Matching uses exact opaque IDs when available. Otherwise it checks the
    required category, normalized name/details text, and every requested
    attribute value. Merchant text is treated only as data, never instructions.
    """
    mode = matcher["match_mode"]
    if mode == "exact_item_id":
        return item.get("item_id") == matcher["item_id"]
    if item.get("item_category") != matcher["category"]:
        return False
    if mode == "category_only":
        return True
    searchable = _normalise(f"{item.get('item_name', '')} {item.get('item_details', '')}")
    if _normalise(matcher["name_contains"]) not in searchable:
        return False
    return all(_normalise(attribute["value"]) in searchable for attribute in matcher["attributes"])


def evaluate_cart_intent(
    items: list[dict[str, Any]], local_policy: dict[str, Any] | None,
) -> dict[str, Any]:
    """Derive requested-item, substitution, and add-on facts for a whole cart."""
    if local_policy is None:
        return {
            "authorization.cart.matches_requested_items": UNKNOWN,
            "authorization.cart.has_substitution": UNKNOWN,
            "authorization.cart.has_unrequested_add_on": UNKNOWN,
        }
    matchers = local_policy["cart"]["requested_items"]
    if not matchers:
        return {
            "authorization.cart.matches_requested_items": "true",
            "authorization.cart.has_substitution": "false",
            "authorization.cart.has_unrequested_add_on": "false",
        }
    matcher_hits = [any(item_matches_mandate(item, matcher) for item in items) for matcher in matchers]
    item_hits = [any(item_matches_mandate(item, matcher) for matcher in matchers) for item in items]
    return {
        "authorization.cart.matches_requested_items": "true" if all(matcher_hits) else "false",
        "authorization.cart.has_substitution": "true" if not all(matcher_hits) else "false",
        "authorization.cart.has_unrequested_add_on": "true" if not all(item_hits) else "false",
    }


def extract_return_window_days(items: list[dict[str, Any]]) -> int | object:
    """Return the shortest stated cart return window, or UNKNOWN if any is unstated."""
    windows: list[int] = []
    for item in items:
        details = item.get("item_details", "")
        match = re.search(r"returns? accepted within\s+(\d+)\s+days?", details, flags=re.IGNORECASE)
        if not match:
            return UNKNOWN
        windows.append(int(match.group(1)))
    return min(windows) if windows else UNKNOWN


def count_prior_approved_merchant_transactions(
    event: dict[str, Any], history: list[dict[str, Any]],
) -> int:
    """Count prior approved purchases for the exact current card and merchant ID."""
    authorization = event["authorization"]
    merchant_id = authorization["merchant"]["merchant_id"]
    return sum(
        1 for row in history
        if row.get("card_id") == authorization["card_id"]
        and row.get("merchant_id") == merchant_id
        and row.get("status") == "approved"
        and row.get("transaction_type", "purchase") == "purchase"
        and row.get("timestamp", "") < authorization["timestamp"]
    )


def device_familiarity(event: dict[str, Any], history: list[dict[str, Any]]) -> str:
    """Return 'true' when this card has a prior approval on the current device."""
    authorization = event["authorization"]
    device_id = authorization.get("customer_device_id")
    if not device_id:
        return "false"
    familiar = any(
        row.get("card_id") == authorization["card_id"]
        and row.get("customer_device_id") == device_id
        and row.get("status") == "approved"
        and row.get("timestamp", "") < authorization["timestamp"]
        for row in history
    )
    return "true" if familiar else "false"


def build_facts(
    event: dict[str, Any],
    local_policy: dict[str, Any] | None = None,
    history: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], dict[str, str]]:
    """Build the explicit fact allowlist understood by the hard-rule engine."""
    authorization = event["authorization"]
    merchant = authorization["merchant"]
    items = authorization["items"]
    history = history or []
    facts: dict[str, Any] = {
        "authorization.billing_amount_chf": authorization["billing_amount_chf"],
        "authorization.items.item_category": [item["item_category"] for item in items],
        "authorization.items.count": len(items),
        "authorization.items.total_quantity": sum(item["quantity"] for item in items),
        "authorization.items.return_window_days": extract_return_window_days(items),
        "authorization.merchant.merchant_id": merchant["merchant_id"],
        "authorization.merchant.merchant_category": merchant["merchant_category"],
        "authorization.merchant.merchant_mcc": merchant["merchant_mcc"],
        "authorization.merchant.merchant_country": merchant["merchant_country"],
        "authorization.merchant.is_domestic": "true" if merchant["merchant_country"] == "CH" else "false",
        "authorization.fulfillment_method": authorization["fulfillment_method"],
        "authorization.order_returnable": authorization["order_returnable"],
        "authorization.order_cancellable": authorization["order_cancellable"],
        "authorization.recent_attempt_count_10m": authorization["recent_attempt_count_10m"],
        "history.approved_merchant_transaction_count": count_prior_approved_merchant_transactions(event, history),
        "history.customer_device_familiar": device_familiarity(event, history),
        "context.minutes_since_similar_approved_purchase": UNKNOWN,
    }
    facts.update(evaluate_cart_intent(items, local_policy))
    sources = {
        key: (
            "authorization_history" if key.startswith("history.")
            else "local_decision_state" if key.startswith("context.minutes")
            else "authorization.items[*].item_details" if key.endswith("return_window_days")
            else "local mandate + authorization.items" if key.startswith("authorization.cart.")
            else "authorization_event"
        )
        for key in facts
    }
    return facts, sources


def _compare(actual: Any, operator: str, expected: Any) -> bool:
    if isinstance(actual, list):
        if operator == "in":
            return all(value in expected for value in actual)
        if operator == "not_in":
            return all(value not in expected for value in actual)
        return False
    if operator == "<":
        return actual < expected
    if operator == "<=":
        return actual <= expected
    if operator == "=":
        return actual == expected
    if operator == "!=":
        return actual != expected
    if operator == ">":
        return actual > expected
    if operator == ">=":
        return actual >= expected
    if operator == "in":
        return actual in expected
    if operator == "not_in":
        return actual not in expected
    raise ValueError(f"Unsupported rule operator: {operator}")


def _rule_type(rule: dict[str, Any]) -> str:
    """Classify database/context-backed rules separately from direct checks."""
    if rule.get("field") in SOFT_RULE_FIELDS:
        return "soft"
    if rule.get("scope") == "period" and rule.get("field") == "authorization.billing_amount_chf":
        return "soft"
    return "hard"


def evaluate_hard_rules(
    event: dict[str, Any],
    local_policy: dict[str, Any] | None = None,
    history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Evaluate direct hard rules and database-backed soft rules without an LLM.

    The wire mandate stores all executable checks in ``hard_rules``. At
    evaluation time, checks that require trusted history or state are treated
    as soft rules for decision classification.
    """
    if not isinstance(event, dict) or not isinstance(event.get("authorization"), dict):
        raise ValueError("Expected the authorization event data object.")
    mandate = event.get("mandate")
    if not isinstance(mandate, dict) or not isinstance(mandate.get("hard_rules"), list):
        raise ValueError("Event mandate.hard_rules is required.")
    facts, sources = build_facts(event, local_policy, history)
    results: list[RuleResult] = []
    approved_spend = event.get("context", {}).get("approved_spend_in_period_chf")
    for rule in mandate["hard_rules"]:
        rule_type = _rule_type(rule)
        field = rule["field"]
        actual = facts.get(field, UNKNOWN)
        if rule.get("scope") == "period" and field == "authorization.billing_amount_chf":
            actual = UNKNOWN if approved_spend is None else approved_spend + event["authorization"]["billing_amount_chf"]
            source = "context.approved_spend_in_period_chf + authorization.billing_amount_chf"
        else:
            source = sources.get(field, "unsupported")
        if actual is UNKNOWN or actual is None or actual == "unknown":
            status = "unknown"
            message = f"No reliable value is available for {field}."
            serializable_actual = None
        else:
            passed = _compare(actual, rule["operator"], rule["value"])
            status = "pass" if passed else "fail"
            message = f"{field} was {actual!r}; expected {rule['operator']} {rule['value']!r}."
            serializable_actual = actual
        results.append(RuleResult(rule_type, field, rule["operator"], rule["value"], serializable_actual, status, source, message))

    if any(result.rule_type == "hard" and result.status != "pass" for result in results):
        decision = "decline"
    elif any(result.rule_type == "soft" and result.status != "pass" for result in results):
        decision = "step_up"
    else:
        decision = "approve"
    return {
        "authorization_id": event["authorization"]["authorization_id"],
        "decision": decision,
        "reason_codes": [f"{result.rule_type}_rule_{result.status}" for result in results if result.status != "pass"],
        "evidence": [asdict(result) for result in results],
        "engine_version": "rule-classifier-v2",
    }


def _row_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def load_offline_event(
    database: Path,
    authorization_id: str,
    local_policy: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Reconstruct decision facts from the CSV-backed SQLite store."""
    validate_mandate(local_policy)
    connection = sqlite3.connect(database)
    try:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            """
            SELECT p.*, m.merchant_name, m.merchant_category, m.merchant_mcc,
                   m.merchant_country, m.merchant_city, m.availability, m.recurring_capable,
                   a.customer_id
            FROM purchase_attempts p
            JOIN merchants m USING (merchant_id)
            JOIN scenario_authorities a USING (authority_id)
            WHERE p.authorization_id = ?
            """,
            (authorization_id,),
        ).fetchone()
        if row is None:
            raise ValueError(f"Unknown offline authorization: {authorization_id}")
        item_rows = connection.execute(
            "SELECT line_no, item_id, item_name, item_category, quantity, unit_price, currency, item_details "
            "FROM purchase_attempt_items WHERE authorization_id = ? ORDER BY line_no",
            (authorization_id,),
        ).fetchall()
        history_rows = connection.execute(
            "SELECT * FROM authorization_history WHERE card_id = ? AND timestamp < ? ORDER BY timestamp, authorization_id",
            (row["card_id"], row["timestamp"]),
        ).fetchall()
    finally:
        connection.close()

    merchant = {key: row[key] for key in (
        "merchant_id", "merchant_name", "merchant_category", "merchant_mcc", "merchant_country",
        "merchant_city", "availability", "recurring_capable",
    )}
    merchant["recurring_capable"] = "true" if merchant["recurring_capable"] else "false"
    authorization_keys = (
        "authorization_id", "scenario_id", "replay_order", "card_id", "timestamp", "amount", "currency",
        "billing_amount_chf", "items_subtotal", "delivery_fee", "channel", "customer_device_id",
        "authority_status", "card_status_at_attempt", "spend_in_period_before_chf", "recent_attempt_count_10m",
        "fulfillment_method", "delivery_by", "order_returnable", "order_cancellable",
        "related_authorization_id", "related_authorization_status", "purchase_description",
    )
    authorization = {key: row[key] for key in authorization_keys}
    authorization.update({
        "source_authorization_id": row["authorization_id"],
        "mandate_id": local_policy["mandate_id"],
        "profile_id": f"OFFLINE-{row['authority_id']}",
        "initiator_type": "agent",
        "merchant": merchant,
        "items": [_row_dict(item) for item in item_rows],
    })
    api_mandate = compile_viseca_mandate(local_policy)
    event = {
        "type": "authorization.request",
        "request_id": f"offline-{authorization_id}",
        "deadline_at": datetime.now().astimezone().isoformat(),
        "authorization": authorization,
        "mandate": {
            "mandate_id": local_policy["mandate_id"], "status": "active", "customer_id": row["customer_id"],
            "card_id": row["card_id"], "instruction": api_mandate["instruction"],
            "hard_rules": api_mandate["hard_rules"], "uncertainty_policy": api_mandate["uncertainty_policy"],
            "profile_id": f"OFFLINE-{row['authority_id']}",
        },
        "context": {"approved_spend_in_period_chf": 0.0, "recent_authorizations": []},
        "runtime": {"received_at": datetime.now().astimezone().isoformat(), "history_window_minutes": 10,
                    "context_basis": "run_decisions_and_scenario_timestamps"},
    }
    return event, [_row_dict(history_row) for history_row in history_rows]


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate Viseca hard rules against a live or offline purchase.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--event", type=Path, help="Authorization event JSON, or a poll envelope containing data")
    source.add_argument("--authorization-id", help="Offline AU... ID from the CSV-backed database")
    parser.add_argument("--mandate", type=Path, required=True, help="Local mandate-v2 JSON")
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    args = parser.parse_args()
    local_policy = json.loads(args.mandate.read_text(encoding="utf-8"))
    validate_mandate(local_policy)
    if args.event:
        loaded = json.loads(args.event.read_text(encoding="utf-8"))
        event = loaded.get("data", loaded)
        history: list[dict[str, Any]] = []
    else:
        event, history = load_offline_event(args.database, args.authorization_id, local_policy)
    print(json.dumps(evaluate_hard_rules(event, local_policy, history), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise SystemExit(f"Error: {error}")
