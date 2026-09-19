"""HTTP request and response contracts for the control-layer API."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class PolicyRequest(BaseModel):
    wallet_id: int = Field(ge=0, le=31)
    policy_text: str = Field(min_length=1)
    additional_text: str | None = None


class PolicyResponse(BaseModel):
    walletId: int
    policy: dict[str, Any]
    missingFields: list[str]
    defaultsApplied: dict[str, Any]
    complete: bool
    reasoning: list[str] | None


class ConfirmationRequest(BaseModel):
    wallet_id: int = Field(ge=0, le=31)
    # The local mandate is validated by the canonical custom-mandate validator.
    policy: dict[str, Any]


class ConfirmationResponse(BaseModel):
    success: bool
    message: str
    walletId: int
    mandate: dict[str, Any]
    visecaMandate: dict[str, Any] = Field(serialization_alias="visecaMandate")
    modelResponse: dict[str, Any] = Field(serialization_alias="modelResponse")
    reasoning: list[str] | None = None
