"""Synthetic redaction proof - uses a FAKE token, never the real TEAM_API_KEY.
Must pass before any real production request is made.
"""
import json
import os
import tempfile

from leash_ledger import LeashLedger

FAKE_TOKEN = "fake-bearer-token-not-real-xyz123"  # noqa: not a real secret


def test_redaction():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "test_ledger.jsonl")
        ledger = LeashLedger(path)
        ledger.record(
            method="POST",
            path="/v1/mandates",
            elapsed_ms=12.3,
            request_headers={"Authorization": f"Bearer {FAKE_TOKEN}", "Content-Type": "application/json", "Cookie": "session=abc123"},
            request_body={"instruction": "test", "api_key": FAKE_TOKEN, "nested": {"token": FAKE_TOKEN, "safe_field": "keep me"}},
            response_status=200,
            response_headers={"Set-Cookie": "session=xyz789"},
            response_body={"draft_id": "MD_test", "credential": FAKE_TOKEN},
            error=None,
        )

        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
            entry = json.loads(raw.strip())

        assert FAKE_TOKEN not in raw, "FAKE TOKEN LEAKED INTO LEDGER - REDACTION FAILED"
        assert entry["request_headers"]["Authorization"] == "[REDACTED]"
        assert entry["request_headers"]["Cookie"] == "[REDACTED]"
        assert entry["response_headers"]["Set-Cookie"] == "[REDACTED]"
        assert entry["request_body"]["api_key"] == "[REDACTED]"
        assert entry["request_body"]["nested"]["token"] == "[REDACTED]"
        assert entry["request_body"]["nested"]["safe_field"] == "keep me"
        assert entry["response_body"]["credential"] == "[REDACTED]"
        assert entry["request_headers"]["Content-Type"] == "application/json"
        assert entry["sequence"] == 1


if __name__ == "__main__":
    test_redaction()
    print("REDACTION TEST PASSED - fake token never appeared in ledger, safe fields preserved")
