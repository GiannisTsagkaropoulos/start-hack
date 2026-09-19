"""Tests for direct hard-rule filtering against the real offline fixture pack."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "database"))
from build_database import DEFAULT_DATA, build  # noqa: E402
from services.decision_engine import (
    count_prior_approved_merchant_transactions,
    evaluate_cart_intent,
    evaluate_hard_rules,
    extract_return_window_days,
    item_matches_mandate,
    load_offline_event,
)
from services.mandate_generator import assemble_mandate


def connection_policy(max_chf: float = 20) -> dict:
    return assemble_mandate(
        "Buy one ordinary grocery item for CHF 20 or less from a shop I use regularly. Ask me when uncertain.",
        {
            "uncertainty_policy": "ask",
            "spending": {
                "per_purchase": {"state": "required", "max_chf": max_chf},
                "rolling_period": {"state": "unrestricted", "max_chf": None, "days": None},
            },
            "cart": {
                "allowed_categories": {"state": "required", "values": ["groceries"]},
                "denied_categories": {"state": "unrestricted", "values": []},
                "requested_items": [{
                    "match_mode": "category_only", "item_id": None, "name_contains": None,
                    "category": "groceries", "attributes": [],
                }],
                "max_distinct_lines": {"state": "required", "value": 1},
                "max_total_quantity": {"state": "required", "value": 1},
                "allow_substitutions": False,
                "allow_unrequested_add_ons": False,
            },
            "merchant": {
                "allowlist_ids": [], "blocklist_ids": [],
                "required_categories": {"state": "unrestricted", "values": []},
                "required_mccs": {"state": "unrestricted", "values": []},
                "familiarity": {"state": "required", "minimum_prior_approved": 3},
            },
            "order_terms": {
                "fulfillment_methods": {"state": "unrestricted", "values": []},
                "returnable": "unrestricted",
                "min_return_window_days": {"state": "unrestricted", "value": None},
                "cancellable": "unrestricted",
            },
            "session": {
                "trusted_device": "unrestricted",
                "max_recent_attempts_10m": {"state": "unrestricted", "value": None},
                "domestic_only": "unrestricted",
            },
            "duplicate_check": {"state": "unrestricted", "value": None},
        },
    )


class DecisionEngineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.database = Path(cls.temp_dir.name) / "decision_test.db"
        build(DEFAULT_DATA, cls.database)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temp_dir.cleanup()

    def test_connection_fixture_passes_all_hard_rules(self):
        policy = connection_policy()
        event, history = load_offline_event(self.database, "AU0001", policy)
        result = evaluate_hard_rules(event, policy, history)
        self.assertEqual(result["decision"], "approve")
        self.assertTrue(all(item["status"] == "pass" for item in result["evidence"]))
        familiarity = next(item for item in result["evidence"] if item["field"] == "history.approved_merchant_transaction_count")
        self.assertEqual(familiarity["source"], "authorization_history")
        self.assertEqual(familiarity["rule_type"], "soft")
        self.assertGreaterEqual(familiarity["actual"], 3)

    def test_amount_above_limit_declines(self):
        policy = connection_policy(max_chf=19)
        event, history = load_offline_event(self.database, "AU0001", policy)
        result = evaluate_hard_rules(event, policy, history)
        self.assertEqual(result["decision"], "decline")
        amount = next(item for item in result["evidence"] if item["field"] == "authorization.billing_amount_chf")
        self.assertEqual(amount["status"], "fail")

    def test_unsupported_direct_fact_declines(self):
        policy = connection_policy()
        event, history = load_offline_event(self.database, "AU0001", policy)
        event["mandate"]["hard_rules"] = [{"field": "authorization.unsupported", "operator": "=", "value": "x"}]
        result = evaluate_hard_rules(event, policy, history)
        self.assertEqual(result["decision"], "decline")
        self.assertEqual(result["evidence"][0]["status"], "unknown")
        self.assertEqual(result["evidence"][0]["rule_type"], "hard")

    def test_failed_history_rule_steps_up(self):
        policy = connection_policy()
        event, history = load_offline_event(self.database, "AU0001", policy)
        event["mandate"]["hard_rules"] = [{
            "field": "history.approved_merchant_transaction_count",
            "operator": ">=",
            "value": 999,
        }]
        result = evaluate_hard_rules(event, policy, history)
        self.assertEqual(result["decision"], "step_up")
        self.assertEqual(result["reason_codes"], ["soft_rule_fail"])
        self.assertEqual(result["evidence"][0]["rule_type"], "soft")

    def test_unknown_stateful_rule_steps_up(self):
        policy = connection_policy()
        event, history = load_offline_event(self.database, "AU0001", policy)
        event["mandate"]["hard_rules"] = [{
            "field": "context.minutes_since_similar_approved_purchase",
            "operator": ">",
            "value": 30,
        }]
        result = evaluate_hard_rules(event, policy, history)
        self.assertEqual(result["decision"], "step_up")
        self.assertEqual(result["reason_codes"], ["soft_rule_unknown"])

    def test_period_spend_is_a_soft_rule(self):
        policy = connection_policy()
        event, history = load_offline_event(self.database, "AU0001", policy)
        event["mandate"]["hard_rules"] = [{
            "field": "authorization.billing_amount_chf",
            "operator": "<=",
            "value": 19,
            "scope": "period",
            "period_days": 30,
        }]
        result = evaluate_hard_rules(event, policy, history)
        self.assertEqual(result["decision"], "step_up")
        self.assertEqual(result["evidence"][0]["rule_type"], "soft")

    def test_hard_failure_takes_priority_over_soft_failure(self):
        policy = connection_policy(max_chf=19)
        event, history = load_offline_event(self.database, "AU0001", policy)
        familiarity = next(
            rule for rule in event["mandate"]["hard_rules"]
            if rule["field"] == "history.approved_merchant_transaction_count"
        )
        familiarity["value"] = 999
        result = evaluate_hard_rules(event, policy, history)
        self.assertEqual(result["decision"], "decline")

    def test_product_attributes_match_item_details(self):
        item = {
            "item_id": "IT0014", "item_name": "Road-running shoes", "item_category": "sporting_goods",
            "item_details": "Road-running shoe, size 43; returns accepted within 30 days",
        }
        matcher = {
            "match_mode": "name_and_category", "item_id": None, "name_contains": "road-running shoes",
            "category": "sporting_goods", "attributes": [{"name": "size_eu", "value": "43"}],
        }
        self.assertTrue(item_matches_mandate(item, matcher))
        matcher["attributes"][0]["value"] = "42"
        self.assertFalse(item_matches_mandate(item, matcher))

    def test_cart_intent_detects_unrequested_add_on(self):
        policy = connection_policy()
        items = [
            {"item_id": "IT0001", "item_name": "Fruit", "item_category": "groceries", "item_details": "Fruit"},
            {"item_id": "IT0017", "item_name": "Monitor", "item_category": "electronics", "item_details": "27-inch"},
        ]
        facts = evaluate_cart_intent(items, policy)
        self.assertEqual(facts["authorization.cart.has_unrequested_add_on"], "true")

    def test_return_window_uses_shortest_cart_term(self):
        items = [
            {"item_details": "Returns accepted within 30 days"},
            {"item_details": "Returns accepted within 14 days"},
        ]
        self.assertEqual(extract_return_window_days(items), 14)

    def test_familiarity_uses_exact_merchant_id(self):
        policy = connection_policy()
        event, history = load_offline_event(self.database, "AU0001", policy)
        expected = sum(1 for row in history if row["card_id"] == "CA0001" and row["merchant_id"] == "ME0001"
                       and row["status"] == "approved" and row["transaction_type"] == "purchase")
        self.assertEqual(count_prior_approved_merchant_transactions(event, history), expected)


if __name__ == "__main__":
    unittest.main(verbosity=2)
