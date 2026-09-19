import json
import os
from typing import Any, Literal
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import openai

import decision_engine
from decision_engine import DecisionResponse

Currency = Literal["CHF", "USD", "EUR"]


# --- Strict Schemas (For Final Confirmation) ---
class Spending(BaseModel):
    per_item_purchase_price_max: float = Field(gt=0)
    per_period_purchase_price_max: float | None = Field(default=None, gt=0)
    currency: Currency
    period_in_days: int | None = Field(default=None, gt=0)


class Merchant(BaseModel):
    familiarity_required: bool | None = None
    familiarity_min_prior_approved: int = Field(default=0, ge=0)
    blocklist: list[str] = Field(default_factory=list)
    allowlist: list[str] = Field(default_factory=list)


class OrderTerms(BaseModel):
    require_returnable: bool | None = None
    require_cancellable: bool | None = None


class Session(BaseModel):
    max_recent_attempts_10m: int | None = Field(default=None, ge=0)
    trusted_devices_only: bool = True
    domestic_only: bool | None = None


class DuplicateCheck(BaseModel):
    block_repeats_within_minutes: int | None = Field(default=None, ge=0)


class Schema(BaseModel):
    raw_instructions: str = Field(min_length=1)
    spending: Spending
    merchant: Merchant
    order_terms: OrderTerms
    session: Session
    duplicate_check: DuplicateCheck
    notes_for_customer: str = ""


# --- Draft Schemas (For LLM Extraction) ---
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


# --- Request & Response Models ---
class PolicyRequest(BaseModel):
    wallet_id: int = Field(ge=0, le=31)
    policy_text: str = Field(min_length=1)
    additional_text: str | None = None


class PolicyResponse(BaseModel):
    walletId: int
    policy: dict[str, Any]
    missingFields: list[str]
    complete: bool


class ConfirmationRequest(BaseModel):
    wallet_id: int = Field(ge=0, le=31)
    policy: Schema


class ConfirmationResponse(BaseModel):
    success: bool
    message: str
    walletId: int


class DecisionRequest(BaseModel):
    wallet_id: int = Field(ge=0, le=31)
    policy: Schema


app = FastAPI(title="Wallet Control Layer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def parse_with_llm(text: str) -> DraftSchema:
    
    client = openai.OpenAI(
        base_url="http://localhost:11434/v1",
        api_key="ollama",  # Ollama requires a string here, but ignores the value
    )
    
    prompt = f"""
    You are an AI assistant configuring a secure wallet policy for an AI shopping agent.
    Extract the rules, limits, and preferences from the user's natural language input.
    If a value is not mentioned or cannot be confidently inferred, output null for it.

    User Input: "{text}"

    Output in JSON format a FinalSchema:

    class Spending(BaseModel):
    per_item_purchase_price_max: float = Field(gt=0)
    per_period_purchase_price_max: float | None = Field(default=None, gt=0)
    currency: Currency
    period_in_days: int | None = Field(default=None, gt=0)

class Merchant(BaseModel):
    familiarity_required: bool | None
    familiarity_min_prior_approved: int = Field(default=0, ge=0)
    blocklist: list[str] = Field(default_factory=list)
    allowlist: list[str] = Field(default_factory=list)

class OrderTerms(BaseModel):
    require_returnable: bool | None
    require_cancellable: bool | None

class Session(BaseModel):
    max_recent_attempts_10m: int | None = Field(default=None, ge=0)
    trusted_devices_only: bool
    domestic_only: bool | None

class DuplicateCheck(BaseModel):
    block_repeats_within_minutes: int | None = Field(default=None, ge=0)

class FinalSchema(BaseModel):
    raw_instructions: str = Field(min_length=1)
    spending: Spending
    merchant: Merchant
    order_terms: OrderTerms
    session: Session
    duplicate_check: DuplicateCheck
    notes_for_customer: str = ""
    """
    

    completion = client.beta.chat.completions.parse(
        model="llama3.2",  # Ensure this matches the model you pulled in Ollama
        messages=[{"role": "user", "content": prompt}],
        response_format=DraftSchema,
    )
    return completion.choices[0].message.parsed


def check_missing_fields(draft: dict[str, Any]) -> list[str]:
    missing = []

    # Spending
    spending = draft.get("spending", {})
    if spending.get("per_item_purchase_price_max") is None:
        missing.append("spending.per_item_purchase_price_max")
    if spending.get("currency") is None:
        missing.append("spending.currency")
    if spending.get("per_period_purchase_price_max") is None:
        missing.append("spending.per_period_purchase_price_max")
    if spending.get("period_in_days") is None:
        missing.append("spending.period_in_days")

    # Merchant
    merchant = draft.get("merchant", {})
    if merchant.get("familiarity_required") is None:
        missing.append("merchant.familiarity_required")
    if merchant.get("familiarity_min_prior_approved") is None:
        missing.append("merchant.familiarity_min_prior_approved")

    # Order Terms
    order_terms = draft.get("order_terms", {})
    if order_terms.get("require_returnable") is None:
        missing.append("order_terms.require_returnable")
    if order_terms.get("require_cancellable") is None:
        missing.append("order_terms.require_cancellable")

    # Session
    session = draft.get("session", {})
    if session.get("trusted_devices_only") is None:
        missing.append("session.trusted_devices_only")
    if session.get("domestic_only") is None:
        missing.append("session.domestic_only")
    if session.get("max_recent_attempts_10m") is None:
        missing.append("session.max_recent_attempts_10m")

    # Duplicate Check
    duplicate_check = draft.get("duplicate_check", {})
    if duplicate_check.get("block_repeats_within_minutes") is None:
        missing.append("duplicate_check.block_repeats_within_minutes")

    return missing


@app.post("/parse-policy", response_model=PolicyResponse)
def parse_policy(request: PolicyRequest) -> PolicyResponse:
    combined_text = request.policy_text
    if request.additional_text:
        combined_text += f"\nAdditional constraints: {request.additional_text}"

    
    parsed_draft = parse_with_llm(combined_text)
    
    draft_dict = parsed_draft.model_dump()

    # PRINT TO TERMINAL
    print("\n=================== LLM PARSED OUTPUT ===================")
    print(f"Wallet ID: {request.wallet_id}")
    print(json.dumps(draft_dict, indent=2, default=str))
    print("=========================================================\n")

    missing = check_missing_fields(draft_dict)

    return PolicyResponse(
        walletId=request.wallet_id,
        policy=draft_dict,
        missingFields=missing,
        complete=len(missing) == 0,
    )


@app.post("/confirm-policy", response_model=ConfirmationResponse)
def confirm_policy(request: ConfirmationRequest) -> ConfirmationResponse:
    print("\n=================== CONFIRMED POLICY ===================")
    print(f"Wallet ID: {request.wallet_id}")
    print(json.dumps(request.policy.model_dump(), indent=2, default=str))
    print("========================================================\n")

    return ConfirmationResponse(
        success=True,
        # No durable storage exists yet: this validates the policy against the
        # strict schema and confirms it for the current session only. /decision
        # requires the caller to resend the full policy - see decision_engine.py.
        message="Wallet policy validated and confirmed for this session.",
        walletId=request.wallet_id,
    )


@app.post("/decision", response_model=DecisionResponse)
def decide(request: DecisionRequest) -> DecisionResponse:
    return decision_engine.evaluate_purchase(request.policy)