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
    expected: float | int | str | None
    actual: float | int | str | None
    status: CheckStatus
    source: str
    message: str


class DecisionResponse(BaseModel):
    authorization_id: str
    decision: Literal["approve", "decline", "step_up"]
    reason_codes: list[ReasonCode]
    evidence: list[DecisionEvidence]
    engine_version: str = "rule-classifier-v2"


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
}


def _count_prior_approved_merchant_purchases(card_id: str, merchant_id: str, before: datetime) -> int | None:
    if not os.path.exists(_HISTORY_CSV):
        return None

    count = 0
    with open(_HISTORY_CSV, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row["card_id"] != card_id or row["merchant_id"] != merchant_id:
                continue
            if row["status"] != "approved":
                continue
            if datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00")) < before:
                count += 1
    return count


def evaluate_purchase(policy, purchase: dict = DEMO_PURCHASE) -> DecisionResponse:
    evidence: list[DecisionEvidence] = []
    reason_codes: list[ReasonCode] = []

    max_amount = policy.spending.per_item_purchase_price_max
    amount = purchase["amount_chf"]
    amount_status: CheckStatus = "pass" if amount <= max_amount else "fail"
    evidence.append(DecisionEvidence(
        rule_type="hard",
        field="authorization.billing_amount_chf",
        operator="<=",
        expected=max_amount,
        actual=amount,
        status=amount_status,
        source="purchase_request",
        message=(
            f"Purchase amount CHF {amount:.2f} is within the CHF {max_amount:.2f} per-item limit."
            if amount_status == "pass"
            else f"Purchase amount CHF {amount:.2f} exceeds the CHF {max_amount:.2f} per-item limit."
        ),
    ))
    if amount_status == "fail":
        reason_codes.append("hard_rule_fail")

    if policy.merchant.familiarity_required:
        before = datetime.fromisoformat(purchase["timestamp"].replace("Z", "+00:00"))
        prior_count = _count_prior_approved_merchant_purchases(purchase["card_id"], purchase["merchant_id"], before)
        expected = max(1, policy.merchant.familiarity_min_prior_approved or 1)

        status: CheckStatus
        if prior_count is None:
            status = "unknown"
            message = "No reliable value is available for merchant purchase history."
        elif prior_count >= expected:
            status = "pass"
            message = f"{prior_count} earlier approved purchases with this merchant meet the familiarity requirement."
        else:
            status = "fail"
            message = f"Only {prior_count} earlier approved purchases with this merchant; {expected} required."

        evidence.append(DecisionEvidence(
            rule_type="soft",
            field="history.approved_merchant_transaction_count",
            operator=">=",
            expected=expected,
            actual=prior_count,
            status=status,
            source="authorization_history",
            message=message,
        ))
        if status == "fail":
            reason_codes.append("soft_rule_fail")
        elif status == "unknown":
            reason_codes.append("soft_rule_unknown")

    if any(e.rule_type == "hard" and e.status == "fail" for e in evidence):
        decision: Literal["approve", "decline", "step_up"] = "decline"
    elif any(e.rule_type == "soft" and e.status != "pass" for e in evidence):
        decision = "step_up"
    else:
        decision = "approve"

    return DecisionResponse(
        authorization_id=purchase["authorization_id"],
        decision=decision,
        reason_codes=reason_codes,
        evidence=evidence,
    )
