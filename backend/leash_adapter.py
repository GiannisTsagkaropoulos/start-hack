"""Adapter: real Leash mandate/authorization shapes -> engine input shapes.

This module does not implement decision logic. It exposes only rules present in
the mandate and facts present in the event; it must never invent either.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


@dataclass
class _Spending:
    per_item_purchase_price_max: float | None = None
    total_price_max: float | None = None
    period_days: int | None = None
    currency: str = "CHF"
    comparison_field: str = "items"


@dataclass
class _RequestedItem:
    name: str
    category: str
    quantity: int
    max_price_per_item: float | None = None


@dataclass
class _Products:
    allowed_categories: list[str] = field(default_factory=list)
    items: list[_RequestedItem] = field(default_factory=list)


@dataclass
class _Merchant:
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
    total_price_max: float | None = None
    period_days: int | None = None
    currency = "CHF"
    comparison_field = "items"
    blocklist: list[str] = []
    allowlist: list[str] = []
    require_returnable = False
    require_cancellable = False
    max_recent_attempts_10m: int | None = None
    allowed_categories: list[str] = []
    requested_item_values: dict[int, dict[str, Any]] = {}

    item_rule_pattern = re.compile(
        r"^authorization\.items\[(\d+)\]\.(item_name|item_category|quantity|unit_price)$"
    )

    for rule in hard_rules:
        field_name = rule.get("field")
        operator = rule.get("operator")
        value = rule.get("value")

        if field_name == "authorization.items.item_category" and operator == "in" and isinstance(value, list):
            allowed_categories = [item for item in value if isinstance(item, str)]

        item_match = item_rule_pattern.match(field_name or "")
        if item_match:
            item_index = int(item_match.group(1))
            item_field = item_match.group(2)
            item_values = requested_item_values.setdefault(item_index, {})
            if item_field in {"item_name", "item_category"} and operator == "=" and isinstance(value, str):
                item_values[item_field] = value
            elif item_field == "quantity" and operator in ("<=", "=") and isinstance(value, int):
                item_values[item_field] = value
            elif item_field == "unit_price" and operator in ("<=", "<") and isinstance(value, (int, float)):
                item_values[item_field] = float(value)
                currency = rule.get("currency") or currency

        if field_name in ("authorization.items.unit_price", "authorization.billing_amount_chf") and operator in ("<=", "<") and rule.get("scope", "purchase") == "purchase":
            if isinstance(value, (int, float)):
                per_item_max = float(value)
                currency = rule.get("currency") or "CHF"
                comparison_field = "billing_amount_chf" if field_name == "authorization.billing_amount_chf" else "items"

        if field_name == "authorization.amount" and operator in ("<=", "<") and isinstance(value, (int, float)):
            total_price_max = float(value)
            currency = rule.get("currency") or currency
            if rule.get("scope") == "period":
                raw_period_days = rule.get("period_days")
                if not isinstance(raw_period_days, int) or raw_period_days < 1:
                    raise ValueError("A period-scoped total rule requires a positive period_days value.")
                period_days = raw_period_days

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

    requested_items: list[_RequestedItem] = []
    for index in sorted(requested_item_values):
        item = requested_item_values[index]
        if not isinstance(item.get("item_name"), str) or not isinstance(item.get("item_category"), str) or not isinstance(item.get("quantity"), int):
            raise ValueError(f"Mandate item {index} is missing its name, category, or quantity rule.")
        requested_items.append(
            _RequestedItem(
                name=item["item_name"],
                category=item["item_category"],
                quantity=item["quantity"],
                max_price_per_item=item.get("unit_price"),
            )
        )

    if (
        not requested_items
        and not allowed_categories
        and per_item_max is None
        and total_price_max is None
    ):
        raise ValueError(
            "Mandate has no supported item, product-category, or spending rules."
        )

    return EnginePolicy(
        spending=_Spending(
            per_item_purchase_price_max=per_item_max,
            total_price_max=total_price_max,
            period_days=period_days,
            currency=currency,
            comparison_field=comparison_field,
        ),
        products=_Products(allowed_categories=allowed_categories, items=requested_items),
        merchant=_Merchant(
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
    mandate = event_data.get("mandate") or {}
    context = event_data.get("context") or {}
    return {
        "authorization_id": authorization["authorization_id"],
        "source_authorization_id": authorization.get("source_authorization_id"),
        "customer_id": mandate.get("customer_id"),
        "card_id": authorization["card_id"],
        "merchant_id": authorization["merchant"]["merchant_id"],
        "amount": authorization.get("amount"),
        "currency": authorization.get("currency"),
        "amount_chf": authorization.get("billing_amount_chf"),
        "scenario_approved_spend_chf": context.get("approved_spend_in_period_chf"),
        "timestamp": authorization.get("timestamp") or event_data.get("occurred_at"),
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
