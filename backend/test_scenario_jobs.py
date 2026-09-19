"""Network-free proof that the UI job follows the documented Leash sequence."""
from __future__ import annotations

import time

from scenario_jobs import confirm_and_start_job, get_job, policy_to_hard_rules, prepare_job


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
                    "purchase_description": "Groceries",
                    "items": [],
                },
                "mandate": {
                    "hard_rules": [{"field": "authorization.billing_amount_chf", "operator": "<=", "value": 100, "scope": "purchase"}]
                },
            },
        }

    def submit_decision(self, authorization_id, decision, reason_codes, customer_message, evidence, source_authorization_id=None):
        self.calls.append("submit_decision")
        self.submitted = True
        return {"status": "approved", "is_final": True, "decision": decision}


POLICY = {
    "raw_instructions": "Allow purchases up to CHF 100.",
    "spending": {"per_item_purchase_price_max": 100, "currency": "CHF"},
    "merchant": {"familiarity_required": False, "familiarity_min_prior_approved": 0},
}


def test_policy_to_hard_rules():
    assert policy_to_hard_rules(POLICY) == [
        {
            "field": "authorization.billing_amount_chf",
            "operator": "<=",
            "value": 100,
            "currency": "CHF",
            "scope": "purchase",
        }
    ]


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
    test_complete_workflow_sequence()
    print("SCENARIO JOB WORKFLOW TESTS PASSED")
