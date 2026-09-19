"""Unit tests for the pure conversion logic only - no network, no secret.
These prove the adapter maps the documented real shapes correctly; they are
NOT a substitute for the real end-to-end SCEN0000 run against the live server.
"""
from leash_adapter import authorization_event_to_purchase, mandate_snapshot_to_engine_policy
from decision_engine import evaluate_purchase


def test_mandate_snapshot_amount_only():
    mandate = {
        "hard_rules": [
            {"field": "authorization.items.item_category", "operator": "in", "value": ["groceries"], "scope": "purchase"},
            {"field": "authorization.billing_amount_chf", "operator": "<=", "value": 1000, "currency": "CHF", "scope": "purchase"}
        ],
    }
    policy = mandate_snapshot_to_engine_policy(mandate)
    assert policy.spending.per_item_purchase_price_max == 1000
    assert policy.products.allowed_categories == ["groceries"]


def test_mandate_snapshot_no_amount_rule_raises():
    try:
        mandate_snapshot_to_engine_policy({"hard_rules": []})
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_authorization_event_to_purchase():
    event_data = {
        "occurred_at": "2026-08-09T10:04:00Z",
        "authorization": {
            "authorization_id": "LA_6bcd4067e93b4f25",
            "source_authorization_id": "AU0001",
            "card_id": "CA0001",
            "merchant": {"merchant_id": "ME0001"},
            "billing_amount_chf": 20.0,
        },
    }
    purchase = authorization_event_to_purchase(event_data)
    assert purchase == {
        "authorization_id": "LA_6bcd4067e93b4f25",
        "source_authorization_id": "AU0001",
        "customer_id": None,
        "card_id": "CA0001",
        "merchant_id": "ME0001",
        "amount": None,
        "currency": None,
        "amount_chf": 20.0,
        "scenario_approved_spend_chf": None,
        "timestamp": "2026-08-09T10:04:00Z",
        "items": [],
        "merchant_name": None,
        "merchant_category": None,
        "order_returnable": None,
        "order_cancellable": None,
        "recent_attempt_count_10m": None,
        "authority_status": None,
        "card_status_at_attempt": None,
        "initiator_type": None,
    }


def test_indexed_items_and_period_total_are_reconstructed():
    mandate = {
        "hard_rules": [
            {"field": "authorization.items[0].item_name", "operator": "=", "value": "book", "scope": "purchase"},
            {"field": "authorization.items[0].item_category", "operator": "=", "value": "books", "scope": "purchase"},
            {"field": "authorization.items[0].quantity", "operator": "<=", "value": 2, "scope": "purchase"},
            {"field": "authorization.items[1].item_name", "operator": "=", "value": "monitor", "scope": "purchase"},
            {"field": "authorization.items[1].item_category", "operator": "=", "value": "electronics", "scope": "purchase"},
            {"field": "authorization.items[1].quantity", "operator": "<=", "value": 1, "scope": "purchase"},
            {"field": "authorization.items[1].unit_price", "operator": "<=", "value": 300, "currency": "CHF", "scope": "purchase"},
            {"field": "authorization.amount", "operator": "<=", "value": 500, "currency": "CHF", "scope": "period", "period_days": 30},
        ]
    }
    policy = mandate_snapshot_to_engine_policy(mandate)
    assert [(item.name, item.category, item.quantity, item.max_price_per_item) for item in policy.products.items] == [
        ("book", "books", 2, None),
        ("monitor", "electronics", 1, 300.0),
    ]
    assert policy.spending.total_price_max == 500.0
    assert policy.spending.period_days == 30


def test_period_total_without_period_days_is_rejected():
    mandate = {
        "hard_rules": [
            {"field": "authorization.items.item_category", "operator": "in", "value": ["books"], "scope": "purchase"},
            {"field": "authorization.amount", "operator": "<=", "value": 100, "currency": "CHF", "scope": "period"},
        ]
    }
    try:
        mandate_snapshot_to_engine_policy(mandate)
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_end_to_end_conversion_feeds_existing_engine_unchanged():
    """The real point of this adapter: prove the EXISTING evaluate_purchase()
    runs unmodified against converted real-shaped input."""
    mandate = {
        "hard_rules": [
            {"field": "authorization.items.item_category", "operator": "in", "value": ["groceries"], "scope": "purchase"},
            {"field": "authorization.billing_amount_chf", "operator": "<=", "value": 1000, "currency": "CHF", "scope": "purchase"}
        ],
    }
    event_data = {
        "occurred_at": "2026-08-09T10:04:00Z",
        "authorization": {
            "authorization_id": "LA_test",
            "card_id": "CA0001",
            "merchant": {"merchant_id": "ME0001"},
            "billing_amount_chf": 20.0,
            "authority_status": "active",
            "card_status_at_attempt": "active",
            "initiator_type": "agent",
            "items": [
                {"item_name": "Bread", "item_category": "groceries", "unit_price": 5.0, "currency": "CHF"}
            ],
        },
    }
    policy = mandate_snapshot_to_engine_policy(mandate)
    purchase = authorization_event_to_purchase(event_data)
    result = evaluate_purchase(policy, purchase)
    assert result.decision == "approve"


if __name__ == "__main__":
    test_mandate_snapshot_amount_only()
    test_mandate_snapshot_no_amount_rule_raises()
    test_authorization_event_to_purchase()
    test_indexed_items_and_period_total_are_reconstructed()
    test_period_total_without_period_days_is_rejected()
    test_end_to_end_conversion_feeds_existing_engine_unchanged()
    print("ALL ADAPTER UNIT TESTS PASSED")
