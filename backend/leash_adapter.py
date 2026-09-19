"""Adapter: real Leash mandate/authorization shapes -> engine input shapes.

This module does not implement decision logic. It exposes only rules present in
the mandate and facts present in the event; it must never invent either.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class _Spending:
    per_item_purchase_price_max: float
    currency: str = "CHF"
    comparison_field: str = "items"


@dataclass
class _Products:
    allowed_categories: list[str] = field(default_factory=list)


@dataclass
class _Merchant:
    familiarity_required: bool = False
    familiarity_min_prior_approved: int = 0
    blocklist: list[str] = field(default_factory=list)
    allowlist: list[str] = field(default_factory=list)


@dataclass
class _OrderTerms:
    require_returnable: bool = False
    require_cancellable: bool = False


@dataclass
class _Session:
    max_recent_attempts_10m: int | None = None


@dataclass
class EnginePolicy:
    """Typed policy projection consumed by decision_engine.evaluate_purchase."""
    spending: _Spending
    products: _Products = field(default_factory=_Products)
    merchant: _Merchant = field(default_factory=_Merchant)
    order_terms: _OrderTerms = field(default_factory=_OrderTerms)
    session: _Session = field(default_factory=_Session)


def mandate_snapshot_to_engine_policy(mandate: dict[str, Any]) -> EnginePolicy:
    """Reads the real hard_rules array (field/operator/value/currency/scope)
    from a mandate snapshot - either the embedded run-start snapshot or a
    freshly confirmed mandate - and extracts only rules the engine implements.
    Any other hard_rule is left unread and must not be mistaken for satisfied.
    """
    hard_rules = mandate.get("hard_rules", [])

    per_item_max: float | None = None
    familiarity_required = False
    familiarity_min: int = 0
    currency = "CHF"
    comparison_field = "items"
    blocklist: list[str] = []
    allowlist: list[str] = []
    require_returnable = False
    require_cancellable = False
    max_recent_attempts_10m: int | None = None
    allowed_categories: list[str] = []

    for rule in hard_rules:
        field_name = rule.get("field")
        operator = rule.get("operator")
        value = rule.get("value")

        if field_name == "authorization.items.item_category" and operator == "in" and isinstance(value, list):
            allowed_categories = [item for item in value if isinstance(item, str)]

        if field_name in ("authorization.items.unit_price", "authorization.billing_amount_chf") and operator in ("<=", "<") and rule.get("scope", "purchase") == "purchase":
            if isinstance(value, (int, float)):
                per_item_max = float(value)
                currency = rule.get("currency") or "CHF"
                comparison_field = "billing_amount_chf" if field_name == "authorization.billing_amount_chf" else "items"

        if field_name == "history.approved_merchant_transaction_count" and operator == ">=":
            if isinstance(value, (int, float)):
                familiarity_required = True
                familiarity_min = int(value)

        if field_name == "authorization.merchant" and operator == "not_in" and isinstance(value, list):
            blocklist = [item for item in value if isinstance(item, str)]

        if field_name == "authorization.merchant" and operator == "in" and isinstance(value, list):
            allowlist = [item for item in value if isinstance(item, str)]

        if field_name == "authorization.order_returnable" and operator == "=" and value == "true":
            require_returnable = True

        if field_name == "authorization.order_cancellable" and operator == "=" and value == "true":
            require_cancellable = True

        if field_name == "authorization.recent_attempt_count_10m" and operator == "<" and isinstance(value, int):
            max_recent_attempts_10m = value

    if per_item_max is None:
        raise ValueError(
            "Mandate has no supported per-item or billing-amount <= N hard rule the "
            "current engine can evaluate. Refusing to invent a default limit."
        )

    return EnginePolicy(
        spending=_Spending(
            per_item_purchase_price_max=per_item_max,
            currency=currency,
            comparison_field=comparison_field,
        ),
        products=_Products(allowed_categories=allowed_categories),
        merchant=_Merchant(
            familiarity_required=familiarity_required,
            familiarity_min_prior_approved=familiarity_min,
            blocklist=blocklist,
            allowlist=allowlist,
        ),
        order_terms=_OrderTerms(
            require_returnable=require_returnable,
            require_cancellable=require_cancellable,
        ),
        session=_Session(max_recent_attempts_10m=max_recent_attempts_10m),
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
        "items": authorization.get("items", []),
        "merchant_name": authorization["merchant"].get("merchant_name"),
        "merchant_category": authorization["merchant"].get("merchant_category"),
        "order_returnable": authorization.get("order_returnable"),
        "order_cancellable": authorization.get("order_cancellable"),
        "recent_attempt_count_10m": authorization.get("recent_attempt_count_10m"),
        "authority_status": authorization.get("authority_status"),
        "card_status_at_attempt": authorization.get("card_status_at_attempt"),
        "initiator_type": authorization.get("initiator_type"),
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
