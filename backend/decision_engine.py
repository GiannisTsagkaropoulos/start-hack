import csv
import os
import re
from datetime import datetime, timedelta
from functools import lru_cache
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
    engine_version: str = "rule-classifier-v7"


_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
_HISTORY_CSV = os.path.join(_DATA_DIR, "authorization_history.csv")
_FX_RATES_CSV = os.path.join(_DATA_DIR, "fx_rates.csv")

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


@lru_cache(maxsize=1)
def _load_history_rows() -> tuple[dict[str, str], ...] | None:
    if not os.path.exists(_HISTORY_CSV):
        return None
    with open(_HISTORY_CSV, newline="", encoding="utf-8") as fh:
        return tuple(csv.DictReader(fh))


def _count_prior_merchant_transactions(merchant_id: str, before: datetime) -> int | None:
    """Count earlier transactions for this merchant across every user/card."""
    rows = _load_history_rows()
    if rows is None:
        return None

    count = 0
    for row in rows:
        if row["merchant_id"] != merchant_id:
            continue
        if datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00")) < before:
            count += 1
    return count


@lru_cache(maxsize=1)
def _load_fx_rates() -> dict[str, float] | None:
    if not os.path.exists(_FX_RATES_CSV):
        return None
    with open(_FX_RATES_CSV, newline="", encoding="utf-8") as fh:
        return {
            row["from_currency"]: float(row["rate"])
            for row in csv.DictReader(fh)
            if row.get("to_currency") == "CHF"
        }


def _convert_amount(amount: float | int | None, source_currency: str | None, target_currency: str) -> float | None:
    if amount is None or source_currency is None:
        return None
    if source_currency == target_currency:
        return float(amount)
    rates = _load_fx_rates()
    if not rates or source_currency not in rates or target_currency not in rates:
        return None
    amount_chf = float(amount) * rates[source_currency]
    return round(amount_chf / rates[target_currency], 2)


def _chf_to_currency(amount_chf: float | int | None, target_currency: str) -> float | None:
    if amount_chf is None:
        return None
    rates = _load_fx_rates()
    if not rates or target_currency not in rates:
        return None
    return round(float(amount_chf) / rates[target_currency], 2)


def _sum_prior_customer_spend_chf(
    customer_id: str,
    before: datetime,
    period_days: int,
) -> float | None:
    """Approved customer purchases/refunds in the rolling period before this event."""
    rows = _load_history_rows()
    if rows is None:
        return None

    period_start = before - timedelta(days=period_days)
    total = 0.0
    for row in rows:
        if row.get("customer_id") != customer_id or row.get("status") != "approved":
            continue
        if row.get("transaction_type") not in {"purchase", "refund"}:
            continue
        timestamp = datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00"))
        if period_start <= timestamp < before:
            total += float(row["billing_amount_chf"])
    return round(total, 2)


def _name_tokens(value: str) -> set[str]:
    stop_words = {"a", "an", "the", "pair", "of", "item", "product", "order"}

    def stem(token: str) -> str:
        if token.endswith("ies") and len(token) > 4:
            return token[:-3] + "y"
        if token.endswith("es") and len(token) > 4:
            return token[:-2]
        if token.endswith("s") and len(token) > 3:
            return token[:-1]
        return token

    return {
        stem(token)
        for token in re.findall(r"[a-z0-9]+", value.casefold())
        if token not in stop_words
    }


def _item_name_matches(expected: str, actual: str, details: str, category: str) -> bool:
    expected_tokens = _name_tokens(expected)
    category_tokens = _name_tokens(category.replace("_", " "))
    if expected_tokens and (expected_tokens <= category_tokens or category_tokens <= expected_tokens):
        return True
    actual_tokens = _name_tokens(f"{actual} {details}")
    return bool(expected_tokens) and expected_tokens <= actual_tokens


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

    # Product category is the primary, fail-closed mandate check. New mandates
    # preserve every requested object as an indexed item; legacy mandates keep
    # the older global category allowlist behavior.
    product_policy = getattr(policy, "products", None)
    requested_items = list(getattr(product_policy, "items", None) or [])
    allowed_categories = list(getattr(product_policy, "allowed_categories", None) or [])
    items = purchase.get("items") or []
    if not items or (not requested_items and not allowed_categories):
        record(
            field="authorization.items.item_category",
            operator="in",
            expected=[item.category for item in requested_items] or allowed_categories,
            actual=None,
            status="fail",
            source="authorization_event",
            message=(
                "The confirmed mandate has no requested product category."
                if not requested_items and not allowed_categories
                else "The authorization has no cart lines with product categories."
            ),
        )
        return DecisionResponse(
            authorization_id=purchase["authorization_id"],
            decision="decline",
            reason_codes=reason_codes,
            evidence=evidence,
        )

    matched_requested_item_indexes: list[int] = []
    if requested_items:
        requested_categories = list(dict.fromkeys(item.category for item in requested_items))
        for index, item in enumerate(items):
            item_category = item.get("item_category")
            category_matches = [
                requested_index
                for requested_index, requested_item in enumerate(requested_items)
                if isinstance(item_category, str)
                and item_category.strip().casefold() == requested_item.category.strip().casefold()
            ]
            matches = bool(category_matches)
            record(
                field=f"authorization.items[{index}].item_category",
                operator="in",
                expected=requested_categories,
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

            item_name = item.get("item_name") or ""
            item_details = item.get("item_details") or ""
            name_match = next(
                (
                    requested_index
                    for requested_index in category_matches
                    if _item_name_matches(
                        requested_items[requested_index].name,
                        item_name,
                        item_details,
                        requested_items[requested_index].category,
                    )
                ),
                None,
            )
            # Preserve the category match so the later name check can explain
            # a same-category but different product precisely.
            matched_requested_item_indexes.append(
                name_match if name_match is not None else category_matches[0]
            )
    else:
        normalized_categories = {category.strip().casefold() for category in allowed_categories if category.strip()}
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

    max_amount = getattr(policy.spending, "per_item_purchase_price_max", None)
    policy_currency = getattr(policy.spending, "currency", "CHF")
    comparison_field = getattr(policy.spending, "comparison_field", "items")
    if requested_items:
        current_quantities: dict[int, int] = {}
        quantity_unknown: set[int] = set()

        for index, item in enumerate(items):
            requested_index = matched_requested_item_indexes[index]
            requested_item = requested_items[requested_index]
            item_name = item.get("item_name") or ""
            item_details = item.get("item_details") or ""
            name_matches = _item_name_matches(
                requested_item.name,
                item_name,
                item_details,
                requested_item.category,
            )
            record(
                field=f"authorization.items[{index}].item_name",
                operator="matches",
                expected=requested_item.name,
                actual=item_name or None,
                status="pass" if name_matches else "fail",
                source="authorization_event",
                message=(
                    f"{item_name} matches the requested {requested_item.name}."
                    if name_matches
                    else f"{item_name or f'Item {index + 1}'} does not match the requested {requested_item.name}."
                ),
            )

            actual_quantity = item.get("quantity")
            if name_matches:
                if isinstance(actual_quantity, int) and actual_quantity >= 1:
                    current_quantities[requested_index] = (
                        current_quantities.get(requested_index, 0) + actual_quantity
                    )
                else:
                    quantity_unknown.add(requested_index)

            if requested_item.max_price_per_item is None:
                continue
            item_price = item.get("unit_price")
            item_currency = item.get("currency")
            comparable_price = _convert_amount(item_price, item_currency, policy_currency)
            price_status: CheckStatus = (
                "unknown"
                if comparable_price is None
                else "pass"
                if comparable_price <= requested_item.max_price_per_item
                else "fail"
            )
            record(
                field=f"authorization.items[{index}].unit_price",
                operator="<=",
                expected=requested_item.max_price_per_item,
                actual=comparable_price,
                status=price_status,
                source="authorization_event+fx_rates",
                message=(
                    f"{item_name} costs {comparable_price:.2f} {policy_currency}, within the {requested_item.max_price_per_item:.2f} {policy_currency} item limit."
                    if price_status == "pass"
                    else f"{item_name} costs {comparable_price:.2f} {policy_currency}, above the {requested_item.max_price_per_item:.2f} {policy_currency} item limit."
                    if price_status == "fail"
                    else f"{item_name or f'Item {index + 1}'} cannot be converted to {policy_currency} for its item-price check."
                ),
            )

        prior_quantities: dict[int, int] = {}
        for prior_item in purchase.get("prior_approved_items") or []:
            prior_category = prior_item.get("item_category")
            if not isinstance(prior_category, str):
                continue
            prior_name = prior_item.get("item_name") or ""
            prior_details = prior_item.get("item_details") or ""
            requested_index = next(
                (
                    candidate_index
                    for candidate_index, candidate in enumerate(requested_items)
                    if prior_category.strip().casefold() == candidate.category.strip().casefold()
                    and _item_name_matches(candidate.name, prior_name, prior_details, candidate.category)
                ),
                None,
            )
            if requested_index is None:
                continue
            prior_quantity = prior_item.get("quantity")
            if isinstance(prior_quantity, int) and prior_quantity >= 1:
                prior_quantities[requested_index] = (
                    prior_quantities.get(requested_index, 0) + prior_quantity
                )
            else:
                quantity_unknown.add(requested_index)

        for requested_index in sorted(set(current_quantities) | quantity_unknown):
            requested_item = requested_items[requested_index]
            cumulative_quantity = None
            if requested_index not in quantity_unknown:
                cumulative_quantity = (
                    prior_quantities.get(requested_index, 0)
                    + current_quantities.get(requested_index, 0)
                )
            quantity_status: CheckStatus = (
                "unknown"
                if cumulative_quantity is None
                else "pass"
                if cumulative_quantity <= requested_item.quantity
                else "fail"
            )
            record(
                field=f"mandate.items[{requested_index}].purchased_quantity",
                operator="<=",
                expected=requested_item.quantity,
                actual=cumulative_quantity,
                status=quantity_status,
                source="scenario_approved_purchases+authorization_event",
                message=(
                    f"This purchase brings {requested_item.name} to {cumulative_quantity} of {requested_item.quantity} allowed."
                    if quantity_status == "pass"
                    else f"This purchase would bring {requested_item.name} to {cumulative_quantity}, exceeding the {requested_item.quantity} allowed."
                    if quantity_status == "fail"
                    else f"The cumulative purchased quantity for {requested_item.name} cannot be calculated."
                ),
            )
    elif comparison_field == "billing_amount_chf" and max_amount is not None:
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
    elif max_amount is not None:
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

    total_price_max = getattr(policy.spending, "total_price_max", None)
    period_days = getattr(policy.spending, "period_days", None)
    if total_price_max is not None:
        if period_days is None:
            comparable_total = _convert_amount(
                purchase.get("amount"),
                purchase.get("currency"),
                policy_currency,
            )
            if comparable_total is None:
                comparable_total = _chf_to_currency(purchase.get("amount_chf"), policy_currency)
            total_status: CheckStatus = (
                "unknown"
                if comparable_total is None
                else "pass"
                if comparable_total <= total_price_max
                else "fail"
            )
            record(
                field="authorization.amount",
                operator="<=",
                expected=total_price_max,
                actual=comparable_total,
                status=total_status,
                source="authorization_event+fx_rates",
                message=(
                    f"Basket total {comparable_total:.2f} {policy_currency} is within the {total_price_max:.2f} {policy_currency} limit."
                    if total_status == "pass"
                    else f"Basket total {comparable_total:.2f} {policy_currency} exceeds the {total_price_max:.2f} {policy_currency} limit."
                    if total_status == "fail"
                    else f"The basket total cannot be converted to {policy_currency}."
                ),
            )
        else:
            timestamp_text = purchase.get("timestamp")
            customer_id = purchase.get("customer_id")
            scenario_spend_chf = purchase.get("scenario_approved_spend_chf")
            current_amount_chf = purchase.get("amount_chf")
            history_spend_chf: float | None = None
            if isinstance(timestamp_text, str) and isinstance(customer_id, str):
                before = datetime.fromisoformat(timestamp_text.replace("Z", "+00:00"))
                history_spend_chf = _sum_prior_customer_spend_chf(customer_id, before, period_days)

            comparable_total = None
            if (
                history_spend_chf is not None
                and isinstance(scenario_spend_chf, (int, float))
                and isinstance(current_amount_chf, (int, float))
            ):
                cumulative_chf = history_spend_chf + float(scenario_spend_chf) + float(current_amount_chf)
                comparable_total = _chf_to_currency(cumulative_chf, policy_currency)

            total_status = (
                "unknown"
                if comparable_total is None
                else "pass"
                if comparable_total <= total_price_max
                else "fail"
            )
            record(
                field="history.customer_approved_spend_plus_scenario_and_current",
                operator="<=",
                expected=total_price_max,
                actual=comparable_total,
                status=total_status,
                source="authorization_history+scenario_context+authorization_event+fx_rates",
                message=(
                    f"Rolling {period_days}-day spend including this basket is {comparable_total:.2f} {policy_currency}, within the {total_price_max:.2f} {policy_currency} limit."
                    if total_status == "pass"
                    else f"Rolling {period_days}-day spend including this basket is {comparable_total:.2f} {policy_currency}, above the {total_price_max:.2f} {policy_currency} limit."
                    if total_status == "fail"
                    else f"The rolling {period_days}-day spend could not be calculated from customer history and scenario context."
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
