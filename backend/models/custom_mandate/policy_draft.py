"""Customer-policy extraction models used before compiling a local mandate."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Currency = Literal["CHF", "USD", "EUR"]


class Spending(BaseModel):
    per_item_purchase_price_max: float = Field(gt=0)
    per_period_purchase_price_max: float | None = Field(default=None, gt=0)
    currency: Currency = "CHF"
    period_in_days: int | None = Field(default=None, gt=0)


class Merchant(BaseModel):
    familiarity_required: bool | None = True
    familiarity_min_prior_approved: int = Field(default=1, ge=0)
    blocklist: list[str] = Field(default_factory=list)
    allowlist: list[str] = Field(default_factory=list)


class OrderTerms(BaseModel):
    require_returnable: bool | None = True
    require_cancellable: bool | None = False


class Session(BaseModel):
    max_recent_attempts_10m: int | None = Field(default=None, ge=0)
    trusted_devices_only: bool = True
    domestic_only: bool | None = True


class DuplicateCheck(BaseModel):
    block_repeats_within_minutes: int | None = Field(default=None, ge=0)


class PolicyDraft(BaseModel):
    raw_instructions: str = Field(min_length=1)
    spending: Spending
    merchant: Merchant
    order_terms: OrderTerms
    session: Session
    duplicate_check: DuplicateCheck
    notes_for_customer: str = ""


class DraftSpending(BaseModel):
    per_item_purchase_price_max: float | None = None
    per_period_purchase_price_max: float | None = None
    currency: Currency | None = None
    period_in_days: int | None = None


class DraftMerchant(BaseModel):
    familiarity_required: bool | None = None
    familiarity_min_prior_approved: int | None = None
    blocklist: list[str] | None = None
    allowlist: list[str] | None = None


class DraftOrderTerms(BaseModel):
    require_returnable: bool | None = None
    require_cancellable: bool | None = None


class DraftSession(BaseModel):
    max_recent_attempts_10m: int | None = None
    trusted_devices_only: bool | None = None
    domestic_only: bool | None = None


class DraftDuplicateCheck(BaseModel):
    block_repeats_within_minutes: int | None = None


class DraftSchema(BaseModel):
    raw_instructions: str
    spending: DraftSpending
    merchant: DraftMerchant
    order_terms: DraftOrderTerms
    session: DraftSession
    duplicate_check: DraftDuplicateCheck
    notes_for_customer: str | None = ""
