"""API contract tests; requires the optional FastAPI runtime dependencies."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

try:
    from fastapi.testclient import TestClient
    from api import app
    from test_mandate_generator import generated_policy
    from services.mandate_generator import assemble_mandate
except ModuleNotFoundError as error:  # pragma: no cover - dependency guidance
    raise unittest.SkipTest("Install requirements.txt to run API contract tests.") from error


class PolicyAPITest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self.policy = assemble_mandate("Buy road-running shoes", generated_policy())

    @patch("api.parse_with_llm")
    def test_parse_returns_local_mandate(self, parse_with_llm):
        parse_with_llm.return_value = self.policy
        response = self.client.post("/parse-policy", json={
            "walletId": "wallet-123", "policyText": "Buy road-running shoes",
        })
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["walletId"], "wallet-123")
        self.assertEqual(body["policy"], self.policy)
        self.assertEqual(body["missingFields"], [])
        self.assertTrue(body["complete"])

    def test_confirm_returns_local_and_viseca_mandates(self):
        response = self.client.post("/confirm-policy", json={
            "wallet_id": "wallet-123", "policy": self.policy,
        })
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["success"])
        self.assertEqual(body["mandate"], self.policy)
        self.assertIn("hard_rules", body["visecaMandate"])
        self.assertEqual(body["modelResponse"]["policyVersion"], 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
