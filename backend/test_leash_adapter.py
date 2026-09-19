"""Unit tests for the pure conversion logic only - no network, no secret.
These prove the adapter maps the documented real shapes correctly; they are
NOT a substitute for the real end-to-end SCEN0000 run against the live server.
"""
from leash_adapter import authorization_event_to_purchase, mandate_snapshot_to_engine_policy
from decision_engine import evaluate_purchase


def test_mandate_snapshot_amount_only():
    mandate = {
        "hard_rules": [
            {"field": "authorization.billing_amount_chf", "operator": "<=", "value": 1000, "currency": "CHF", "scope": "purchase"}
        ],
    }
    policy = mandate_snapshot_to_engine_policy(mandate)
    assert policy.spending.per_item_purchase_price_max == 1000
    assert policy.merchant.familiarity_required is False


def test_mandate_snapshot_with_familiarity():
    mandate = {
        "hard_rules": [
            {"field": "authorization.billing_amount_chf", "operator": "<=", "value": 120, "currency": "CHF", "scope": "purchase"},
            {"field": "history.approved_merchant_transaction_count", "operator": ">=", "value": 3},
        ],
    }
    policy = mandate_snapshot_to_engine_policy(mandate)
    assert policy.spending.per_item_purchase_price_max == 120
    assert policy.merchant.familiarity_required is True
    assert policy.merchant.familiarity_min_prior_approved == 3


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
        "card_id": "CA0001",
        "merchant_id": "ME0001",
        "amount_chf": 20.0,
        "timestamp": "2026-08-09T10:04:00Z",
    }


def test_end_to_end_conversion_feeds_existing_engine_unchanged():
    """The real point of this adapter: prove the EXISTING evaluate_purchase()
    runs unmodified against converted real-shaped input."""
    mandate = {
        "hard_rules": [
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
        },
    }
    policy = mandate_snapshot_to_engine_policy(mandate)
    purchase = authorization_event_to_purchase(event_data)
    result = evaluate_purchase(policy, purchase)
    assert result.decision == "approve"


if __name__ == "__main__":
    test_mandate_snapshot_amount_only()
    test_mandate_snapshot_with_familiarity()
    test_mandate_snapshot_no_amount_rule_raises()
    test_authorization_event_to_purchase()
    test_end_to_end_conversion_feeds_existing_engine_unchanged()
    print("ALL ADAPTER UNIT TESTS PASSED")
