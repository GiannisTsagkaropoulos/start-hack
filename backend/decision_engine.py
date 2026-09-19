import csv
import os
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

RuleType = Literal["hard", "soft"]
CheckStatus = Literal["pass", "fail", "unknown"]
ReasonCode = Literal["hard_rule_fail", "hard_rule_unknown", "soft_rule_fail", "soft_rule_unknown"]


class DecisionEvidence(BaseModel):
    rule_type: RuleType
    field: str
    operator: str
    expected: float | int | str | list[str] | None
    actual: float | int | str | None
    status: CheckStatus
    source: str
    message: str


class DecisionResponse(BaseModel):
    authorization_id: str
    decision: Literal["approve", "decline", "step_up"]
    reason_codes: list[ReasonCode]
    evidence: list[DecisionEvidence]
    engine_version: str = "rule-classifier-v5"


_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
_HISTORY_CSV = os.path.join(_DATA_DIR, "authorization_history.csv")

# There is no live purchase simulator wired up yet, so every confirmed policy
# is classified against the supplied connection-check purchase (AU0001: a
# CHF 20 grocery order at Alpine Basket on card CA0001) instead of a
# hand-written mock verdict.
DEMO_PURCHASE = {
    "authorization_id": "AU0001",
    "card_id": "CA0001",
    "merchant_id": "ME0001",
    "amount_chf": 20.00,
    "timestamp": "2026-08-09T10:04:00Z",
    "items": [
        {
            "item_name": "Grocery item",
            "item_category": "groceries",
            "unit_price": 20.00,
            "currency": "CHF",
        }
    ],
    "merchant_name": "Alpine Basket",
    "merchant_category": "groceries",
    "order_returnable": "true",
    "order_cancellable": "true",
    "recent_attempt_count_10m": 0,
    "authority_status": "active",
    "card_status_at_attempt": "active",
    "initiator_type": "agent",
}


def get_purchase_to_evaluate() -> dict:
    """The ONE seam to replace when a real purchase source exists.

    Today this returns the fixed local demo purchase above. When the
    sponsor's production purchase-evaluation transport is authoritative
    (see docs/viseca-control-layer-contract.md), replace this function's
    body with that call - evaluate_purchase()'s classification logic and
    the DecisionResponse contract do not need to change.
    """
    return DEMO_PURCHASE


def _count_prior_merchant_transactions(merchant_id: str, before: datetime) -> int | None:
    """Count earlier transactions for this merchant across every user/card."""
    if not os.path.exists(_HISTORY_CSV):
        return None

    count = 0
    with open(_HISTORY_CSV, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row["merchant_id"] != merchant_id:
                continue
            if datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00")) < before:
                count += 1
    return count


def evaluate_purchase(policy, purchase: dict | None = None) -> DecisionResponse:
    purchase = purchase if purchase is not None else get_purchase_to_evaluate()
    evidence: list[DecisionEvidence] = []
    reason_codes: list[ReasonCode] = []

    def record(
        *,
        field: str,
        operator: str,
        expected: float | int | str | list[str] | None,
        actual: float | int | str | None,
        status: CheckStatus,
        source: str,
        message: str,
        rule_type: RuleType = "hard",
    ) -> None:
        evidence.append(DecisionEvidence(
            rule_type=rule_type,
            field=field,
            operator=operator,
            expected=expected,
            actual=actual,
            status=status,
            source=source,
            message=message,
        ))
        if status == "fail":
            code: ReasonCode = "hard_rule_fail" if rule_type == "hard" else "soft_rule_fail"
            if code not in reason_codes:
                reason_codes.append(code)
        elif status == "unknown":
            code = "hard_rule_unknown" if rule_type == "hard" else "soft_rule_unknown"
            if code not in reason_codes:
                reason_codes.append(code)

    # Product category is the primary, fail-closed mandate check. It runs
    # before price, merchant, order-term, session, or history checks. The first
    # cart line that does not exactly match the confirmed category allowlist
    # ends evaluation immediately with a decline.
    allowed_categories = list(getattr(getattr(policy, "products", None), "allowed_categories", None) or [])
    normalized_categories = {category.strip().casefold() for category in allowed_categories if category.strip()}
    items = purchase.get("items") or []
    if not normalized_categories or not items:
        record(
            field="authorization.items.item_category",
            operator="in",
            expected=allowed_categories,
            actual=None,
            status="fail",
            source="authorization_event",
            message=(
                "The confirmed mandate has no allowed product category."
                if not normalized_categories
                else "The authorization has no cart lines with product categories."
            ),
        )
        return DecisionResponse(
            authorization_id=purchase["authorization_id"],
            decision="decline",
            reason_codes=reason_codes,
            evidence=evidence,
        )

    for index, item in enumerate(items):
        item_category = item.get("item_category")
        matches = (
            isinstance(item_category, str)
            and item_category.strip().casefold() in normalized_categories
        )
        record(
            field=f"authorization.items[{index}].item_category",
            operator="in",
            expected=allowed_categories,
            actual=item_category,
            status="pass" if matches else "fail",
            source="authorization_event",
            message=(
                f"{item.get('item_name') or f'Item {index + 1}'} matches the confirmed {item_category} category."
                if matches
                else f"{item.get('item_name') or f'Item {index + 1}'} has category {item_category!r}, which is outside the confirmed mandate."
            ),
        )
        if not matches:
            return DecisionResponse(
                authorization_id=purchase["authorization_id"],
                decision="decline",
                reason_codes=reason_codes,
                evidence=evidence,
            )

    # These are required event facts, independent of customer-configured rules.
    # A known-inactive authority/card is a definite rejection. Missing facts are
    # escalated instead of being silently treated as safe.
    for field, expected, message_label in (
        ("authority_status", "active", "purchase authority"),
        ("card_status_at_attempt", "active", "card"),
        ("initiator_type", "agent", "purchase initiator"),
    ):
        actual = purchase.get(field)
        status: CheckStatus = "unknown" if actual is None else ("pass" if actual == expected else "fail")
        record(
            field=f"authorization.{field}",
            operator="=",
            expected=expected,
            actual=actual,
            status=status,
            source="authorization_event",
            message=(
                f"The {message_label} is valid."
                if status == "pass"
                else f"The {message_label} is {actual!r}; expected {expected!r}."
                if status == "fail"
                else f"The authorization event does not provide the {message_label}."
            ),
        )

    max_amount = policy.spending.per_item_purchase_price_max
    policy_currency = getattr(policy.spending, "currency", "CHF")
    comparison_field = getattr(policy.spending, "comparison_field", "items")
    if comparison_field == "billing_amount_chf":
        # Backward compatibility for already-created mandates that used the old
        # (incorrectly named) per-purchase billing-amount rule.
        amount = purchase.get("amount_chf")
        amount_status: CheckStatus = "unknown" if amount is None else ("pass" if amount <= max_amount else "fail")
        record(
            field="authorization.billing_amount_chf",
            operator="<=",
            expected=max_amount,
            actual=amount,
            status=amount_status,
            source="authorization_event",
            message=(
                "The billing amount is unavailable."
                if amount_status == "unknown"
                else f"Purchase amount CHF {amount:.2f} is within the CHF {max_amount:.2f} limit."
                if amount_status == "pass"
                else f"Purchase amount CHF {amount:.2f} exceeds the CHF {max_amount:.2f} limit."
            ),
        )
    else:
        items = purchase.get("items")
        if not items:
            record(
                field="authorization.items.unit_price",
                operator="<=",
                expected=max_amount,
                actual=None,
                status="unknown",
                source="authorization_event",
                message="No cart lines are available to check the per-item price limit.",
            )
        else:
            for index, item in enumerate(items):
                item_price = item.get("unit_price")
                item_currency = item.get("currency")
                item_name = item.get("item_name") or f"item {index + 1}"
                if item_price is None or item_currency is None or item_currency != policy_currency:
                    status = "unknown"
                else:
                    status = "pass" if item_price <= max_amount else "fail"
                record(
                    field=f"authorization.items[{index}].unit_price",
                    operator="<=",
                    expected=max_amount,
                    actual=item_price,
                    status=status,
                    source="authorization_event",
                    message=(
                        f"{item_name} costs {item_price:.2f} {item_currency}, within the {max_amount:.2f} {policy_currency} limit."
                        if status == "pass"
                        else f"{item_name} costs {item_price:.2f} {item_currency}, above the {max_amount:.2f} {policy_currency} limit."
                        if status == "fail"
                        else f"{item_name} cannot be compared with the {policy_currency} limit without a matching price and currency conversion."
                    ),
                )

    merchant_policy = getattr(policy, "merchant", None)
    merchant_name = purchase.get("merchant_name")
    merchant_id = purchase.get("merchant_id")
    merchant_category = purchase.get("merchant_category")
    merchant_values = {
        str(value).strip().casefold()
        for value in (merchant_id, merchant_name, merchant_category)
        if value is not None and str(value).strip()
    }

    def normalized(values: list[str] | None) -> set[str]:
        return {value.strip().casefold() for value in (values or []) if value.strip()}

    blocklist = list(getattr(merchant_policy, "blocklist", None) or [])
    if blocklist:
        blocked = normalized(blocklist)
        status = "unknown" if not merchant_values else ("fail" if merchant_values & blocked else "pass")
        record(
            field="authorization.merchant",
            operator="not_in",
            expected=blocklist,
            actual=merchant_name or merchant_id,
            status=status,
            source="authorization_event",
            message=(
                "The merchant does not match the blocklist."
                if status == "pass"
                else "The merchant matches the configured blocklist."
                if status == "fail"
                else "Merchant identity is unavailable for the blocklist check."
            ),
        )

    allowlist = list(getattr(merchant_policy, "allowlist", None) or [])
    if allowlist:
        allowed = normalized(allowlist)
        status = "unknown" if not merchant_values else ("pass" if merchant_values & allowed else "fail")
        record(
            field="authorization.merchant",
            operator="in",
            expected=allowlist,
            actual=merchant_name or merchant_id,
            status=status,
            source="authorization_event",
            message=(
                "The merchant matches the configured allowlist."
                if status == "pass"
                else "The merchant is not on the configured allowlist."
                if status == "fail"
                else "Merchant identity is unavailable for the allowlist check."
            ),
        )

    order_terms = getattr(policy, "order_terms", None)
    for policy_field, purchase_field, label in (
        ("require_returnable", "order_returnable", "returnable"),
        ("require_cancellable", "order_cancellable", "cancellable"),
    ):
        if not getattr(order_terms, policy_field, False):
            continue
        actual = purchase.get(purchase_field)
        if purchase_field == "order_cancellable":
            is_subscription = any(
                str(item.get("item_category", "")).strip().casefold() == "subscriptions"
                for item in items
            )
            if not is_subscription:
                # Cancellability is a subscription-only check. Some
                # non-subscription fixtures use the literal "unknown" rather
                # than omitting the field, so gate on product category instead
                # of the field's presence alone.
                continue
        status = "pass" if actual == "true" else "unknown" if actual in (None, "unknown") else "fail"
        record(
            field=f"authorization.{purchase_field}",
            operator="=",
            expected="true",
            actual=actual,
            status=status,
            source="authorization_event",
            message=(
                f"The order is {label}."
                if status == "pass"
                else f"The order is not {label}."
                if status == "fail"
                else f"It is unknown whether the order is {label}."
            ),
        )

    session = getattr(policy, "session", None)
    max_attempts = getattr(session, "max_recent_attempts_10m", None)
    if max_attempts is not None:
        prior_attempts = purchase.get("recent_attempt_count_10m")
        current_attempt_number = prior_attempts + 1 if isinstance(prior_attempts, int) else None
        status = "unknown" if current_attempt_number is None else ("pass" if current_attempt_number <= max_attempts else "fail")
        record(
            field="authorization.recent_attempt_count_10m",
            operator="current_attempt<=",
            expected=max_attempts,
            actual=current_attempt_number,
            status=status,
            source="authorization_event",
            message=(
                "The current attempt is within the ten-minute velocity limit."
                if status == "pass"
                else "The current attempt exceeds the ten-minute velocity limit."
                if status == "fail"
                else "The recent-attempt count is unavailable."
            ),
        )

    before = datetime.fromisoformat(purchase["timestamp"].replace("Z", "+00:00"))
    prior_count = _count_prior_merchant_transactions(purchase["merchant_id"], before)
    merchant_history_status: CheckStatus
    if prior_count is None:
        merchant_history_status = "unknown"
        merchant_history_message = "Merchant transaction history is unavailable; customer approval is required."
    elif prior_count >= 3:
        merchant_history_status = "pass"
        merchant_history_message = f"The merchant has {prior_count} earlier transactions across all users."
    else:
        merchant_history_status = "fail"
        merchant_history_message = (
            f"The merchant has only {prior_count} earlier transactions across all users; "
            "customer approval is required."
        )

    record(
        rule_type="soft",
        field="history.all_user_merchant_transaction_count",
        operator=">=",
        expected=3,
        actual=prior_count,
        status=merchant_history_status,
        source="authorization_history",
        message=merchant_history_message,
    )

    if any(e.rule_type == "hard" and e.status == "fail" for e in evidence):
        decision: Literal["approve", "decline", "step_up"] = "decline"
    elif any(e.status == "unknown" or (e.rule_type == "soft" and e.status == "fail") for e in evidence):
        decision = "step_up"
    else:
        decision = "approve"

    return DecisionResponse(
        authorization_id=purchase["authorization_id"],
        decision=decision,
        reason_codes=reason_codes,
        evidence=evidence,
    )
