"""Adapter: real Leash mandate/authorization shapes -> the EXISTING engine's
input shapes. This module does not implement any decision logic itself -
decision_engine.evaluate_purchase() is called unchanged. If the engine ever
reads more of the policy than the two attribute paths below, this adapter
needs to grow with it; it must never silently invent a rule the mandate
doesn't actually contain.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class _Spending:
    per_item_purchase_price_max: float


@dataclass
class _Merchant:
    familiarity_required: bool = False
    familiarity_min_prior_approved: int = 0


@dataclass
class EnginePolicy:
    """Exposes exactly the attribute paths decision_engine.evaluate_purchase()
    reads (policy.spending.per_item_purchase_price_max,
    policy.merchant.familiarity_required,
    policy.merchant.familiarity_min_prior_approved) - nothing more."""
    spending: _Spending
    merchant: _Merchant = field(default_factory=_Merchant)


def mandate_snapshot_to_engine_policy(mandate: dict[str, Any]) -> EnginePolicy:
    """Reads the real hard_rules array (field/operator/value/currency/scope)
    from a mandate snapshot - either the embedded run-start snapshot or a
    freshly confirmed mandate - and extracts only the two facts the current
    engine checks. Any other hard_rule present is left unread by design
    (the engine doesn't evaluate it today); this must not be mistaken for
    those rules being "satisfied."
    """
    hard_rules = mandate.get("hard_rules", [])

    per_item_max: float | None = None
    familiarity_required = False
    familiarity_min: int = 0

    for rule in hard_rules:
        field_name = rule.get("field")
        operator = rule.get("operator")
        value = rule.get("value")

        if field_name == "authorization.billing_amount_chf" and operator in ("<=", "<") and rule.get("scope", "purchase") == "purchase":
            if isinstance(value, (int, float)):
                per_item_max = float(value)

        if field_name == "history.approved_merchant_transaction_count" and operator == ">=":
            if isinstance(value, (int, float)):
                familiarity_required = True
                familiarity_min = int(value)

    if per_item_max is None:
        raise ValueError(
            "Mandate has no authorization.billing_amount_chf <= N hard rule the "
            "current engine can evaluate. Refusing to invent a default limit."
        )

    return EnginePolicy(
        spending=_Spending(per_item_purchase_price_max=per_item_max),
        merchant=_Merchant(familiarity_required=familiarity_required, familiarity_min_prior_approved=familiarity_min),
    )


def authorization_event_to_purchase(event_data: dict[str, Any]) -> dict[str, Any]:
    """Converts data.authorization from a real authorization.request event
    into the purchase dict decision_engine.evaluate_purchase() expects.
    Uses the LIVE authorization_id for this call's identity, per the task's
    explicit instruction to keep live vs source IDs separate."""
    authorization = event_data["authorization"]
    return {
        "authorization_id": authorization["authorization_id"],
        "card_id": authorization["card_id"],
        "merchant_id": authorization["merchant"]["merchant_id"],
        "amount_chf": authorization["billing_amount_chf"],
        "timestamp": event_data.get("occurred_at") or authorization.get("timestamp"),
    }


def engine_decision_to_leash_decision(result) -> tuple[str, list[str], str, list[dict]]:
    """Maps the engine's existing DecisionResponse (approve/decline/step_up)
    onto the fields POST /v1/authorizations/{id}/decision or /resolve expect.
    """
    decision = result.decision
    reason_codes = list(result.reason_codes) or ["within_policy"]
    evidence = [item.model_dump() if hasattr(item, "model_dump") else item for item in result.evidence]
    customer_message = next((e["message"] for e in evidence if isinstance(e, dict) and e.get("status") != "pass"), "Approved within your confirmed authority.")
    return decision, reason_codes, customer_message, evidence
