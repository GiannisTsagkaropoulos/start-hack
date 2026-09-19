"""Unit tests for deterministic authorization-event checks."""
from __future__ import annotations

from copy import deepcopy

from decision_engine import evaluate_purchase
from leash_adapter import mandate_snapshot_to_engine_policy


RULES = [
    {
        "field": "authorization.items.item_category",
        "operator": "in",
        "value": ["groceries"],
        "scope": "purchase",
    },
    {
        "field": "authorization.items.unit_price",
        "operator": "<=",
        "value": 20,
        "currency": "CHF",
        "scope": "purchase",
    },
    {
        "field": "authorization.merchant",
        "operator": "not_in",
        "value": ["Blocked Shop"],
        "scope": "purchase",
    },
    {
        "field": "authorization.merchant",
        "operator": "in",
        "value": ["Alpine Basket", "groceries"],
        "scope": "purchase",
    },
    {
        "field": "authorization.order_returnable",
        "operator": "=",
        "value": "true",
        "scope": "purchase",
    },
    {
        "field": "authorization.order_cancellable",
        "operator": "=",
        "value": "true",
        "scope": "purchase",
    },
    {
        "field": "authorization.recent_attempt_count_10m",
        "operator": "<",
        "value": 3,
        "scope": "purchase",
    },
]

PURCHASE = {
    "authorization_id": "LA_test",
    "card_id": "CA0001",
    "merchant_id": "ME0001",
    "merchant_name": "Alpine Basket",
    "merchant_category": "groceries",
    "amount_chf": 25.0,
    "timestamp": "2026-08-09T10:04:00Z",
    "items": [
        {"item_name": "Bread", "item_category": "groceries", "unit_price": 5.0, "currency": "CHF"},
        {"item_name": "Cheese", "item_category": "groceries", "unit_price": 15.0, "currency": "CHF"},
    ],
    "order_returnable": "true",
    "order_cancellable": "true",
    "recent_attempt_count_10m": 2,
    "authority_status": "active",
    "card_status_at_attempt": "active",
    "initiator_type": "agent",
}


def decide(purchase_updates: dict | None = None, rules: list[dict] | None = None):
    purchase = deepcopy(PURCHASE)
    purchase.update(purchase_updates or {})
    policy = mandate_snapshot_to_engine_policy({"hard_rules": rules or RULES})
    return evaluate_purchase(policy, purchase)


def test_all_event_local_rules_pass():
    assert decide().decision == "approve"


def test_item_over_limit_declines():
    result = decide({"items": [{"item_name": "Expensive food", "item_category": "groceries", "unit_price": 21.0, "currency": "CHF"}]})
    assert result.decision == "decline"


def test_item_currency_without_conversion_steps_up():
    result = decide({"items": [{"item_name": "Food", "item_category": "groceries", "unit_price": 19.0, "currency": "EUR"}]})
    assert result.decision == "step_up"
    assert "hard_rule_unknown" in result.reason_codes


def test_blocklisted_or_non_allowlisted_merchant_declines():
    assert decide({"merchant_name": "Blocked Shop"}).decision == "decline"
    assert decide({"merchant_name": "Different Shop", "merchant_category": "fashion"}).decision == "decline"


def test_required_order_term_failure_and_unknown():
    assert decide({"order_returnable": "false"}).decision == "decline"


def test_non_subscription_cancellability_is_always_skipped():
    assert decide({"order_cancellable": None}).decision == "approve"
    assert decide({"order_cancellable": "not_applicable"}).decision == "approve"
    assert decide({"order_cancellable": "unknown"}).decision == "approve"

    sporting_goods_rules = deepcopy(RULES)
    sporting_goods_rules[0]["value"] = ["sporting_goods"]
    result = decide(
        {
            "items": [
                {
                    "item_name": "Running shoes",
                    "item_category": "sporting_goods",
                    "unit_price": 15.0,
                    "currency": "CHF",
                }
            ],
            "order_cancellable": "unknown",
        },
        sporting_goods_rules,
    )
    assert result.decision == "approve"
    assert not any(item.field == "authorization.order_cancellable" for item in result.evidence)


def test_unknown_subscription_cancellability_steps_up():
    subscription_rules = deepcopy(RULES)
    subscription_rules[0]["value"] = ["subscriptions"]
    result = decide(
        {
            "items": [
                {
                    "item_name": "Streaming plan",
                    "item_category": "subscriptions",
                    "unit_price": 15.0,
                    "currency": "CHF",
                }
            ],
            "order_cancellable": "unknown",
        },
        subscription_rules,
    )
    assert result.decision == "step_up"
    assert any(item.field == "authorization.order_cancellable" for item in result.evidence)


def test_merchant_with_fewer_than_three_global_transactions_steps_up():
    result = decide({"merchant_id": "ME_NEVER_SEEN"})
    assert result.decision == "step_up"
    merchant_evidence = next(
        item for item in result.evidence
        if item.field == "history.all_user_merchant_transaction_count"
    )
    assert merchant_evidence.actual == 0
    assert merchant_evidence.status == "fail"


def test_merchant_with_exactly_three_global_transactions_passes():
    assert decide({"merchant_id": "ME0029"}).decision == "approve"


def test_velocity_limit_includes_current_attempt():
    assert decide({"recent_attempt_count_10m": 3}).decision == "decline"


def test_inactive_card_declines():
    assert decide({"card_status_at_attempt": "blocked"}).decision == "decline"


def test_product_category_mismatch_declines_immediately():
    result = decide({
        "card_status_at_attempt": "blocked",
        "items": [{"item_name": "Gift card", "item_category": "gift_card", "unit_price": 1000.0, "currency": "CHF"}],
    })
    assert result.decision == "decline"
    assert len(result.evidence) == 1
    assert result.evidence[0].field == "authorization.items[0].item_category"


def test_missing_mandate_category_declines_fail_closed():
    policy = mandate_snapshot_to_engine_policy({"hard_rules": RULES[1:]})
    result = evaluate_purchase(policy, deepcopy(PURCHASE))
    assert result.decision == "decline"
    assert result.evidence[0].field == "authorization.items.item_category"


def indexed_rules(*, total: float = 120, period_days: int | None = None, quantity: int = 1):
    total_rule = {
        "field": "authorization.amount",
        "operator": "<=",
        "value": total,
        "currency": "CHF",
        "scope": "period" if period_days is not None else "purchase",
    }
    if period_days is not None:
        total_rule["period_days"] = period_days
    return [
        {"field": "authorization.items[0].item_name", "operator": "=", "value": "bread", "scope": "purchase"},
        {"field": "authorization.items[0].item_category", "operator": "=", "value": "groceries", "scope": "purchase"},
        {"field": "authorization.items[0].quantity", "operator": "<=", "value": quantity, "scope": "purchase"},
        total_rule,
    ]


def indexed_purchase(**updates):
    purchase = deepcopy(PURCHASE)
    purchase.update({
        "customer_id": "CU_TEST",
        "merchant_id": "ME0029",
        "amount": 50.0,
        "currency": "CHF",
        "amount_chf": 50.0,
        "scenario_approved_spend_chf": 0.0,
        "items": [
            {
                "item_name": "Bread",
                "item_category": "groceries",
                "quantity": 1,
                "unit_price": 20.0,
                "currency": "CHF",
                "item_details": "Fresh bread",
            }
        ],
    })
    purchase.update(updates)
    return purchase


def test_total_basket_cap_does_not_require_an_item_price_cap():
    policy = mandate_snapshot_to_engine_policy({"hard_rules": indexed_rules(total=60)})
    assert evaluate_purchase(policy, indexed_purchase()).decision == "approve"
    assert evaluate_purchase(policy, indexed_purchase(amount=61.0, amount_chf=61.0)).decision == "decline"


def test_item_quantity_tracks_approved_units_not_basket_lines():
    policy = mandate_snapshot_to_engine_policy({"hard_rules": indexed_rules(quantity=3)})
    third_purchase = indexed_purchase(
        prior_approved_items=[
            {
                "item_name": "Bread",
                "item_category": "groceries",
                "quantity": 1,
                "item_details": "Fresh bread",
            },
            {
                "item_name": "Bread",
                "item_category": "groceries",
                "quantity": 1,
                "item_details": "Fresh bread",
            },
        ]
    )
    result = evaluate_purchase(policy, third_purchase)
    assert result.decision == "approve"
    quantity_evidence = next(
        item for item in result.evidence
        if item.field == "mandate.items[0].purchased_quantity"
    )
    assert quantity_evidence.actual == 3
    assert quantity_evidence.expected == 3
    assert not any(item.field == "authorization.items.length" for item in result.evidence)

    fourth_purchase = indexed_purchase(
        prior_approved_items=third_purchase["prior_approved_items"]
        + [
            {
                "item_name": "Bread",
                "item_category": "groceries",
                "quantity": 1,
                "item_details": "Fresh bread",
            }
        ]
    )
    result = evaluate_purchase(policy, fourth_purchase)
    assert result.decision == "decline"
    quantity_evidence = next(
        item for item in result.evidence
        if item.field == "mandate.items[0].purchased_quantity"
    )
    assert quantity_evidence.actual == 4


def test_multiple_matching_basket_lines_are_aggregated():
    policy = mandate_snapshot_to_engine_policy({"hard_rules": indexed_rules(quantity=2)})
    purchase = indexed_purchase()
    purchase["items"].append({
        "item_name": "Bread loaf",
        "item_category": "groceries",
        "quantity": 1,
        "unit_price": 10.0,
        "currency": "CHF",
        "item_details": "Fresh bread",
    })
    result = evaluate_purchase(policy, purchase)
    assert result.decision == "approve"
    quantity_evidence = next(
        item for item in result.evidence
        if item.field == "mandate.items[0].purchased_quantity"
    )
    assert quantity_evidence.actual == 2

    extra_item = indexed_purchase()
    extra_item["items"].append({
        "item_name": "Gift card",
        "item_category": "gift_card",
        "quantity": 1,
        "unit_price": 10.0,
        "currency": "CHF",
    })
    result = evaluate_purchase(policy, extra_item)
    assert result.decision == "decline"
    assert result.evidence[-1].field == "authorization.items[1].item_category"


def test_period_total_adds_scenario_and_current_spend():
    policy = mandate_snapshot_to_engine_policy({"hard_rules": indexed_rules(total=100, period_days=30)})
    result = evaluate_purchase(policy, indexed_purchase(scenario_approved_spend_chf=60.0))
    assert result.decision == "decline"
    period_evidence = next(
        item for item in result.evidence
        if item.field == "history.customer_approved_spend_plus_scenario_and_current"
    )
    assert period_evidence.actual == 110.0


def test_period_total_includes_previous_customer_transactions():
    policy = mandate_snapshot_to_engine_policy({"hard_rules": indexed_rules(total=100000, period_days=30)})
    result = evaluate_purchase(policy, indexed_purchase(customer_id="CU0001"))
    period_evidence = next(
        item for item in result.evidence
        if item.field == "history.customer_approved_spend_plus_scenario_and_current"
    )
    assert isinstance(period_evidence.actual, float)
    assert period_evidence.actual > 50.0


if __name__ == "__main__":
    test_all_event_local_rules_pass()
    test_item_over_limit_declines()
    test_item_currency_without_conversion_steps_up()
    test_blocklisted_or_non_allowlisted_merchant_declines()
    test_required_order_term_failure_and_unknown()
    test_non_subscription_cancellability_is_always_skipped()
    test_unknown_subscription_cancellability_steps_up()
    test_merchant_with_fewer_than_three_global_transactions_steps_up()
    test_merchant_with_exactly_three_global_transactions_passes()
    test_velocity_limit_includes_current_attempt()
    test_inactive_card_declines()
    test_product_category_mismatch_declines_immediately()
    test_missing_mandate_category_declines_fail_closed()
    test_total_basket_cap_does_not_require_an_item_price_cap()
    test_item_quantity_tracks_approved_units_not_basket_lines()
    test_multiple_matching_basket_lines_are_aggregated()
    test_period_total_adds_scenario_and_current_spend()
    test_period_total_includes_previous_customer_transactions()
    print("DECISION ENGINE TESTS PASSED")
