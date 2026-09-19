"""Local, gitignored, append-only diagnostic ledger for real Leash API calls.

This is audit/diagnostic evidence only - never application state, never read
back by the worker to make decisions. Every record is written and flushed
(with fsync) immediately, so a crash mid-run does not lose earlier evidence.

Redaction is applied to every header and every body BEFORE the record is
constructed, so no caller can accidentally bypass it by passing a raw dict
straight through.
"""
from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SENSITIVE_HEADER_NAMES = {"authorization", "cookie", "set-cookie"}
_SENSITIVE_KEY_PATTERN = re.compile(r"(api[_-]?key|token|credential|secret|password|bearer)", re.IGNORECASE)
_REDACTED = "[REDACTED]"


def _redact_headers(headers: dict[str, str] | None) -> dict[str, str]:
    if not headers:
        return {}
    return {k: (_REDACTED if k.lower() in _SENSITIVE_HEADER_NAMES else v) for k, v in headers.items()}


def _redact_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: (_REDACTED if _SENSITIVE_KEY_PATTERN.search(k) else _redact_value(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact_value(item) for item in value]
    return value


def redact_body(body: Any) -> Any:
    if body is None:
        return None
    return _redact_value(body)


class LeashLedger:
    """One instance per process. Thread-safe append with immediate flush."""

    def __init__(self, path: str | os.PathLike):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._sequence = 0

    def record(
        self,
        *,
        method: str,
        path: str,
        elapsed_ms: float,
        request_headers: dict[str, str] | None,
        request_body: Any,
        response_status: int | None,
        response_headers: dict[str, str] | None,
        response_body: Any,
        scenario_id: str | None = None,
        run_id: str | None = None,
        authorization_id: str | None = None,
        source_authorization_id: str | None = None,
        error: Any = None,
    ) -> None:
        with self._lock:
            self._sequence += 1
            entry = {
                "sequence": self._sequence,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "elapsed_ms": round(elapsed_ms, 2),
                "method": method,
                "path": path,
                "request_headers": _redact_headers(request_headers),
                "request_body": redact_body(request_body),
                "response_status": response_status,
                "response_headers": _redact_headers(response_headers),
                "response_body": redact_body(response_body),
                "scenario_id": scenario_id,
                "run_id": run_id,
                "authorization_id": authorization_id,
                "source_authorization_id": source_authorization_id,
                "error": redact_body(error),
            }
            with open(self.path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry, default=str) + "\n")
                fh.flush()
                os.fsync(fh.fileno())
