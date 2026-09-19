"""Unit tests for mandate-v2 generation and Viseca compilation; no network needed."""
import copy
import sys
import unittest
from pathlib import Path

from services.mandate_generator import (
    LLM_POLICY_SCHEMA,
    PENDING_MANDATE_ID,
    apply_non_permissive_defaults,
    assemble_mandate,
    bind_confirmed_mandate_id,
    compile_viseca_mandate,
    extract_output_text,
    validate_mandate,
)


def generated_policy():
    return {
        "uncertainty_policy": "ask",
        "spending": {
            "per_purchase": {"state": "required", "max_chf": 200},
            "rolling_period": {"state": "unrestricted", "max_chf": None, "days": None},
        },
        "cart": {
            "allowed_categories": {"state": "required", "values": ["sporting_goods"]},
            "denied_categories": {"state": "unrestricted", "values": []},
            "requested_items": [{
                "match_mode": "name_and_category", "item_id": None,
                "name_contains": "road-running shoes", "category": "sporting_goods",
                "attributes": [{"name": "size_eu", "value": "43"}],
            }],
            "max_distinct_lines": {"state": "required", "value": 1},
            "max_total_quantity": {"state": "required", "value": 1},
            "allow_substitutions": False,
            "allow_unrequested_add_ons": False,
        },
        "merchant": {
            "allowlist_ids": [], "blocklist_ids": [],
            "required_categories": {"state": "required", "values": ["sporting_goods"]},
            "required_mccs": {"state": "unrestricted", "values": []},
            "familiarity": {"state": "unrestricted", "minimum_prior_approved": None},
        },
        "order_terms": {
            "fulfillment_methods": {"state": "unrestricted", "values": []},
            "returnable": "required",
            "min_return_window_days": {"state": "required", "value": 14},
            "cancellable": "unrestricted",
        },
        "session": {
            "trusted_device": "unrestricted",
            "max_recent_attempts_10m": {"state": "unrestricted", "value": None},
            "domestic_only": "unrestricted",
        },
        "duplicate_check": {"state": "unrestricted", "value": None},
    }


class MandateGeneratorTest(unittest.TestCase):
    def test_reads_top_level_sdk_style_text(self):
        self.assertEqual(extract_output_text({"output_text": '{"ok":true}'}), '{"ok":true}')

    def test_reads_raw_responses_api_content(self):
        body = {"status": "completed", "output": [{"content": [{"type": "output_text", "text": '{"ok":true}'}]}]}
        self.assertEqual(extract_output_text(body), '{"ok":true}')

    def test_reports_incomplete_result(self):
        with self.assertRaisesRegex(RuntimeError, "incomplete reason"):
            extract_output_text({"id": "resp_test", "status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}})

    def test_model_schema_excludes_trusted_fields(self):
        self.assertNotIn("mandate_id", LLM_POLICY_SCHEMA["properties"])
        self.assertNotIn("raw_instruction", LLM_POLICY_SCHEMA["properties"])
        self.assertNotIn("policy_version", LLM_POLICY_SCHEMA["properties"])
        self.assertNotIn("prompt_injection_defense", LLM_POLICY_SCHEMA["properties"])

    def test_code_assembles_valid_v2_with_trusted_fields(self):
        mandate = assemble_mandate("Buy size 43 road-running shoes", generated_policy())
        validate_mandate(mandate)
        self.assertEqual(mandate["mandate_id"], PENDING_MANDATE_ID)
        self.assertEqual(mandate["policy_version"], 2)
        self.assertTrue(mandate["prompt_injection_defense"])

    def test_required_constraint_cannot_have_null_value(self):
        mandate = assemble_mandate("Buy shoes", generated_policy())
        mandate["spending"]["per_purchase"]["max_chf"] = None
        with self.assertRaisesRegex(ValueError, "max_chf is required"):
            validate_mandate(mandate)

    def test_compiles_exact_viseca_post_shape_and_rules(self):
        instruction = "Buy size 43 road-running shoes for CHF 200 or less."
        payload = compile_viseca_mandate(assemble_mandate(instruction, generated_policy()))
        self.assertEqual(set(payload), {"instruction", "hard_rules", "uncertainty_policy", "guidance", "open_questions"})
        self.assertEqual(payload["instruction"], instruction)
        by_field = {rule["field"]: rule for rule in payload["hard_rules"]}
        self.assertEqual(by_field["authorization.billing_amount_chf"]["value"], 200)
        self.assertEqual(by_field["authorization.items.return_window_days"]["value"], 14)
        self.assertIn("size_eu=43", payload["guidance"][0])

    def test_review_session_generates_guidance(self):
        policy = generated_policy()
        policy["session"]["trusted_device"] = "review"
        payload = compile_viseca_mandate(assemble_mandate("Pause suspicious sessions", policy))
        self.assertTrue(any("Step up" in line for line in payload["guidance"]))

    def test_bind_accepts_documented_tm_prefix(self):
        mandate = assemble_mandate("Buy shoes", generated_policy())
        bound = bind_confirmed_mandate_id(mandate, "TM_EXAMPLE_0001")
        self.assertEqual(bound["mandate_id"], "TM_EXAMPLE_0001")

    def test_compiler_does_not_mutate_local_policy(self):
        mandate = assemble_mandate("Buy shoes", generated_policy())
        original = copy.deepcopy(mandate)
        compile_viseca_mandate(mandate)
        self.assertEqual(mandate, original)

    def test_generic_uncertainty_does_not_create_session_rule(self):
        policy = generated_policy()
        policy["session"]["trusted_device"] = "review"
        corrected = apply_non_permissive_defaults("Buy groceries. Ask me when uncertain.", policy)
        self.assertEqual(corrected["session"]["trusted_device"], "unrestricted")

    def test_one_item_enforces_line_and_quantity_caps(self):
        policy = generated_policy()
        policy["cart"]["max_distinct_lines"] = {"state": "unrestricted", "value": None}
        policy["cart"]["max_total_quantity"] = {"state": "unrestricted", "value": None}
        corrected = apply_non_permissive_defaults("Buy one ordinary grocery item.", policy)
        self.assertEqual(corrected["cart"]["max_distinct_lines"]["value"], 1)
        self.assertEqual(corrected["cart"]["max_total_quantity"]["value"], 1)

    def test_bought_before_means_one_prior_approval(self):
        policy = generated_policy()
        corrected = apply_non_permissive_defaults("Buy from a seller I have bought from before.", policy)
        self.assertEqual(corrected["merchant"]["familiarity"], {"state": "required", "minimum_prior_approved": 1})


if __name__ == "__main__":
    unittest.main(verbosity=2)
