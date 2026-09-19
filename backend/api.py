"""FastAPI adapter for generating and confirming Viseca local-v2 mandates.

Run locally after installing ``requirements.txt``:
    uvicorn api:app --reload
"""
from __future__ import annotations
import json
import logging
from typing import Any
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import openai
from pydantic import ValidationError

from models.api_contracts import (
    ConfirmationRequest,
    ConfirmationResponse,
    PolicyRequest,
    PolicyResponse,
)
from models.custom_mandate.policy_draft import DraftSchema

from services.mandate_generator import (
    PENDING_MANDATE_ID,
    compile_viseca_mandate,
    load_project_env,
    request_mandate,
    validate_mandate,
)

# --- Required key fields that must be specified or filled with preselected defaults ---
REQUIRED_FIELDS = [
    "spending.per_item_purchase_price_max",
    "spending.currency",
    "merchant.familiarity_required",
    "order_terms.require_returnable",
    "order_terms.require_cancellable",
    "session.trusted_devices_only",
    "session.domestic_only",
]

# --- Default Fallback Values when user input is missing ---
DEFAULT_PRESELECTIONS = {
    "spending.per_item_purchase_price_max": 100.0,
    "spending.currency": "CHF",
    "merchant.familiarity_required": True,
    "order_terms.require_returnable": True,
    "order_terms.require_cancellable": False,
    "session.trusted_devices_only": True,
    "session.domestic_only": True,
}

LOGGER = logging.getLogger(__name__)
GPT_MODEL = "gpt-5-mini"
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app = FastAPI(title="Wallet Control Layer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
load_project_env()


def _format_validation_errors(errors: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Return safe, concise validation details for logs and 422 responses."""
    return [
        {
            "field": ".".join(str(part) for part in error.get("loc", ())) or "request",
            "reason": error.get("msg", "Invalid value."),
        }
        for error in errors
    ]


@app.exception_handler(RequestValidationError)
async def log_request_validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
    details = _format_validation_errors(error.errors())
    LOGGER.warning("422 request validation failed for %s: %s", request.url.path, details)
    return JSONResponse(status_code=422, content={"detail": details})


def parse_with_llm(text: str) -> DraftSchema:
    # Uses OPENAI_API_KEY from the process environment or this project's .env.
    # The browser only ever talks to this API; the key stays server-side.
    client = openai.OpenAI()

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
        model=GPT_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format=DraftSchema,
    )
    return completion.choices[0].message.parsed


def check_and_apply_defaults(draft: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    missing = []
    applied_defaults = {}

    spending = draft.setdefault("spending", {})
    if spending.get("per_item_purchase_price_max") is None:
        missing.append("spending.per_item_purchase_price_max")
        spending["per_item_purchase_price_max"] = DEFAULT_PRESELECTIONS["spending.per_item_purchase_price_max"]
        applied_defaults["spending.per_item_purchase_price_max"] = DEFAULT_PRESELECTIONS["spending.per_item_purchase_price_max"]

    if spending.get("currency") is None:
        missing.append("spending.currency")
        spending["currency"] = DEFAULT_PRESELECTIONS["spending.currency"]
        applied_defaults["spending.currency"] = DEFAULT_PRESELECTIONS["spending.currency"]

    merchant = draft.setdefault("merchant", {})
    if merchant.get("familiarity_required") is None:
        missing.append("merchant.familiarity_required")
        merchant["familiarity_required"] = DEFAULT_PRESELECTIONS["merchant.familiarity_required"]
        applied_defaults["merchant.familiarity_required"] = DEFAULT_PRESELECTIONS["merchant.familiarity_required"]

    order_terms = draft.setdefault("order_terms", {})
    if order_terms.get("require_returnable") is None:
        missing.append("order_terms.require_returnable")
        order_terms["require_returnable"] = DEFAULT_PRESELECTIONS["order_terms.require_returnable"]
        applied_defaults["order_terms.require_returnable"] = DEFAULT_PRESELECTIONS["order_terms.require_returnable"]

    if order_terms.get("require_cancellable") is None:
        missing.append("order_terms.require_cancellable")
        order_terms["require_cancellable"] = DEFAULT_PRESELECTIONS["order_terms.require_cancellable"]
        applied_defaults["order_terms.require_cancellable"] = DEFAULT_PRESELECTIONS["order_terms.require_cancellable"]

    session = draft.setdefault("session", {})
    if session.get("trusted_devices_only") is None:
        missing.append("session.trusted_devices_only")
        session["trusted_devices_only"] = DEFAULT_PRESELECTIONS["session.trusted_devices_only"]
        applied_defaults["session.trusted_devices_only"] = DEFAULT_PRESELECTIONS["session.trusted_devices_only"]

    if session.get("domestic_only") is None:
        missing.append("session.domestic_only")
        session["domestic_only"] = DEFAULT_PRESELECTIONS["session.domestic_only"]
        applied_defaults["session.domestic_only"] = DEFAULT_PRESELECTIONS["session.domestic_only"]

    return missing, applied_defaults


@app.post("/parse-policy", response_model=PolicyResponse)
def parse_policy(request: PolicyRequest) -> PolicyResponse:
    combined_text = request.policy_text
    if request.additional_text:
        combined_text += f"\nAdditional constraints: {request.additional_text}"

    try:
        parsed_draft = parse_with_llm(combined_text)
    except openai.APIConnectionError as error:
        LOGGER.warning("Could not reach the OpenAI API: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "The OpenAI API is unavailable. Check the network connection "
                "and the OPENAI_API_KEY configured for the control layer."
            ),
        ) from error
    except ValidationError as error:
        details = _format_validation_errors(error.errors())
        LOGGER.warning("422 structured policy parsing failed for /parse-policy: %s", details)
        raise HTTPException(status_code=422, detail=details) from error
    except Exception as error:
        LOGGER.exception("Policy parsing failed for /parse-policy: %s", error)
        raise HTTPException(
            status_code=502,
            detail="The policy parser could not produce a valid response.",
        ) from error
    draft_dict = parsed_draft.model_dump()

    missing, defaults = check_and_apply_defaults(draft_dict)

    print("\n=================== LLM PARSED OUTPUT ===================")
    print(f"Wallet ID: {request.wallet_id}")
    print(json.dumps(draft_dict, indent=2, default=str))
    print("Missing Fields Filled With Defaults:", missing)
    print("=========================================================\n")

    return PolicyResponse(
        walletId=request.wallet_id,
        policy=draft_dict,
        missingFields=missing,
        defaultsApplied=defaults,
        complete=len(missing) == 0,
        reasoning=None 
    )


@app.post("/confirm-policy", response_model=ConfirmationResponse)
def confirm_policy(request: ConfirmationRequest) -> ConfirmationResponse:
    print("\n=================== CONFIRMED POLICY ===================")
    print(f"Wallet ID: {request.wallet_id}")
    print(json.dumps(request.policy, indent=2, default=str))
    print("========================================================\n")

    mandate = request.policy
    try:
        validate_mandate(mandate)
        viseca_mandate = compile_viseca_mandate(mandate)
    except ValueError as error:
        LOGGER.warning(
            "422 mandate validation failed for /confirm-policy (wallet_id=%s): %s",
            request.wallet_id,
            error,
        )
        raise HTTPException(status_code=422, detail=str(error)) from error

    return ConfirmationResponse(
        success=True,
        message="Wallet policy validated and saved.",
        walletId=request.wallet_id,
        mandate=mandate,
        visecaMandate=viseca_mandate,
        # This is auditable confirmation metadata, not an LLM response or
        # private chain-of-thought.
        modelResponse={
            "policyVersion": mandate["policy_version"],
            "mandateId": mandate["mandate_id"],
        },
    )

