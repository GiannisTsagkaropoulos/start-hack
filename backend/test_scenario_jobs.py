"""Network-free proof that the UI job follows the documented Leash sequence."""
from __future__ import annotations

import time

from scenario_jobs import (
    _approved_scenario_items,
    confirm_and_start_job,
    get_job,
    policy_to_hard_rules,
    prepare_job,
)


class FakeLeashClient:
    def __init__(self):
        self.calls: list[str] = []
        self.scenario_id = None
        self.run_id = None
        self.submitted = False

    def healthz(self):
        self.calls.append("healthz")
        return {"status": "ok", "service": "fake", "api_version": "1", "pack_version": "test"}

    def bootstrap(self):
        self.calls.append("bootstrap")
        return {
            "api_version": "1",
            "pack_version": "test",
            "timeouts": {"long_poll_max_wait_seconds": 1},
            "scenarios": [{"scenario_id": "SCEN0000", "scenario_name": "Connection check", "event_count": 1}],
        }

    def reference_data(self):
        self.calls.append("reference_data")
        return {"scenarios": []}

    def create_mandate(self, instruction, hard_rules):
        self.calls.append("create_mandate")
        return {"draft_id": "MD_test", "status": "draft", "instruction": instruction, "hard_rules": hard_rules}

    def confirm_mandate(self, draft_id):
        self.calls.append("confirm_mandate")
        assert draft_id == "MD_test"
        return {"mandate_id": "TM_test", "status": "active"}

    def create_scenario_run(self, mandate_id, scenario_id):
        self.calls.append("create_scenario_run")
        assert (mandate_id, scenario_id) == ("TM_test", "SCEN0000")
        return {"run_id": "RUN_test", "status": "running", "counters": {"remaining": 1}}

    def get_scenario_run(self, run_id):
        self.calls.append("get_scenario_run")
        return {
            "run_id": run_id,
            "status": "completed" if self.submitted else "running",
            "counters": {"remaining": 0 if self.submitted else 1},
        }

    def next_decision_request(self, wait=25):
        self.calls.append("next_decision_request")
        return 200, {
            "run_id": "RUN_test",
            "authorization_id": "LA_test",
            "data": {
                "occurred_at": "2026-08-09T10:04:00Z",
                "authorization": {
                    "authorization_id": "LA_test",
                    "source_authorization_id": "AU0001",
                    "scenario_id": "SCEN0000",
                    "replay_order": 1,
                    "card_id": "CA0001",
                    "merchant": {"merchant_id": "ME0001", "merchant_name": "Alpine Basket", "merchant_country": "CH"},
                    "amount": 20.0,
                    "currency": "CHF",
                    "billing_amount_chf": 20.0,
                    "authority_status": "active",
                    "card_status_at_attempt": "active",
                    "initiator_type": "agent",
                    "purchase_description": "Groceries",
                    "items": [{"item_name": "Bread", "item_category": "groceries", "quantity": 1, "unit_price": 5.0, "currency": "CHF", "item_details": "Fresh bread"}],
                    "order_returnable": "true",
                    "order_cancellable": "unknown",
                },
                "mandate": {
                    "customer_id": "CU0001",
                    "hard_rules": [
                        {"field": "authorization.items[0].item_name", "operator": "=", "value": "bread", "scope": "purchase"},
                        {"field": "authorization.items[0].item_category", "operator": "=", "value": "groceries", "scope": "purchase"},
                        {"field": "authorization.items[0].quantity", "operator": "<=", "value": 1, "scope": "purchase"},
                        {"field": "authorization.items[0].unit_price", "operator": "<=", "value": 100, "currency": "CHF", "scope": "purchase"},
                        {"field": "authorization.amount", "operator": "<=", "value": 500, "currency": "CHF", "scope": "purchase"},
                    ]
                },
                "context": {"approved_spend_in_period_chf": 0.0},
            },
        }

    def submit_decision(self, authorization_id, decision, reason_codes, customer_message, evidence, source_authorization_id=None):
        self.calls.append("submit_decision")
        self.submitted = True
        return {"status": "approved", "is_final": True, "decision": decision}


POLICY = {
    "raw_instructions": "Allow purchases up to CHF 100.",
    "products": {
        "items": [
            {"name": "bread", "category": "groceries", "quantity": 1, "max_price_per_item": 100},
        ]
    },
    "spending": {
        "total_price_max": 500,
        "currency": "CHF",
        "period_in_days": None,
    },
    "merchant": {"blocklist": [], "allowlist": []},
    "order_terms": {"require_returnable": True, "require_cancellable": True},
}


def test_policy_to_hard_rules():
    assert policy_to_hard_rules(POLICY) == [
        {
            "field": "authorization.items[0].item_name",
            "operator": "=",
            "value": "bread",
            "scope": "purchase",
        },
        {
            "field": "authorization.items[0].item_category",
            "operator": "=",
            "value": "groceries",
            "scope": "purchase",
        },
        {
            "field": "authorization.items[0].quantity",
            "operator": "<=",
            "value": 1,
            "scope": "purchase",
        },
        {
            "field": "authorization.items[0].unit_price",
            "operator": "<=",
            "value": 100,
            "currency": "CHF",
            "scope": "purchase",
        },
        {
            "field": "authorization.amount",
            "operator": "<=",
            "value": 500,
            "currency": "CHF",
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
    ]


def test_approved_scenario_items_uses_only_final_approved_purchases():
    job = {
        "scenarios": [
            {
                "scenario_id": "SCEN0000",
                "results": [
                    {
                        "final_decision": "approve",
                        "purchase": {
                            "items": [
                                {
                                    "name": "Trail-running shoes",
                                    "category": "sporting_goods",
                                    "quantity": 1,
                                    "unit_price": 120,
                                    "currency": "CHF",
                                    "details": "Shoes",
                                }
                            ]
                        },
                    },
                    {
                        "final_decision": "decline",
                        "purchase": {
                            "items": [
                                {
                                    "name": "Trail-running shoes",
                                    "category": "sporting_goods",
                                    "quantity": 5,
                                }
                            ]
                        },
                    },
                ],
            }
        ]
    }
    assert _approved_scenario_items(job, "SCEN0000") == [
        {
            "item_name": "Trail-running shoes",
            "item_category": "sporting_goods",
            "quantity": 1,
            "unit_price": 120,
            "currency": "CHF",
            "item_details": "Shoes",
        }
    ]


def test_policy_to_all_event_local_rules():
    policy = {
        **POLICY,
        "merchant": {
            **POLICY["merchant"],
            "blocklist": ["Blocked Shop"],
            "allowlist": ["Alpine Basket"],
        },
    }
    merchant_rules = [rule for rule in policy_to_hard_rules(policy) if rule["field"] == "authorization.merchant"]
    assert merchant_rules == [
        {
            "field": "authorization.merchant",
            "operator": "not_in",
            "value": ["Blocked Shop"],
            "scope": "purchase",
        },
        {
            "field": "authorization.merchant",
            "operator": "in",
            "value": ["Alpine Basket"],
            "scope": "purchase",
        },
    ]


def test_period_rule_is_optional_and_compiled_only_when_present():
    policy = {
        **POLICY,
        "spending": {**POLICY["spending"], "period_in_days": 30},
    }
    total_rule = next(rule for rule in policy_to_hard_rules(policy) if rule["field"] == "authorization.amount")
    assert total_rule == {
        "field": "authorization.amount",
        "operator": "<=",
        "value": 500,
        "currency": "CHF",
        "scope": "period",
        "period_days": 30,
    }


def test_complete_workflow_sequence():
    fake = FakeLeashClient()
    factory = lambda: fake
    prepared = prepare_job(1, POLICY, client_factory=factory)
    assert prepared["status"] == "awaiting_confirmation"
    assert fake.calls == ["healthz", "bootstrap", "reference_data", "create_mandate"]

    confirm_and_start_job(prepared["job_id"], client_factory=factory)
    deadline = time.monotonic() + 2
    while get_job(prepared["job_id"])["status"] != "completed" and time.monotonic() < deadline:
        time.sleep(0.01)

    completed = get_job(prepared["job_id"])
    assert completed["status"] == "completed"
    assert completed["summary"] == {
        "total": 1,
        "approve": 1,
        "decline": 0,
        "step_up": 0,
        "awaiting_customer": 0,
    }
    assert fake.calls == [
        "healthz",
        "bootstrap",
        "reference_data",
        "create_mandate",
        "confirm_mandate",
        "create_scenario_run",
        "get_scenario_run",
        "next_decision_request",
        "submit_decision",
        "get_scenario_run",
    ]


if __name__ == "__main__":
    test_policy_to_hard_rules()
    test_approved_scenario_items_uses_only_final_approved_purchases()
    test_policy_to_all_event_local_rules()
    test_period_rule_is_optional_and_compiled_only_when_present()
    test_complete_workflow_sequence()
    print("SCENARIO JOB WORKFLOW TESTS PASSED")
