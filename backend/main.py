import json
from pathlib import Path
from typing import Any, Literal
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
import openai
from dotenv import load_dotenv

import decision_engine
from decision_engine import DecisionResponse
from leash_client import LeashApiError
from policy_items import merge_duplicate_items
from policy_prompt import (
    build_policy_extraction_messages,
    detect_explicit_currency,
    detect_explicit_period_days,
)
from scenario_jobs import confirm_and_start_job, get_job, prepare_job, resolve_authorization


load_dotenv()
load_dotenv(Path(__file__).resolve().parent / ".env")

Currency = Literal["CHF", "USD", "EUR"]
ProductCategory = Literal[
    "books",
    "clothing",
    "cosmetics",
    "dining",
    "electronics",
    "food_delivery",
    "fuel",
    "gift_card",
    "groceries",
    "home_improvement",
    "hotel",
    "household",
    "membership",
    "sporting_goods",
    "subscriptions",
    "transport",
]


# --- Strict Schemas (For Final Confirmation) ---
class Spending(BaseModel):
    total_price_max: float | None = Field(default=None, gt=0)
    currency: Currency
    period_in_days: int | None = Field(default=None, gt=0)


class ProductItem(BaseModel):
    name: str = Field(min_length=1)
    category: ProductCategory
    quantity: int = Field(ge=1)
    max_price_per_item: float | None = Field(default=None, gt=0)


class Products(BaseModel):
    items: list[ProductItem] = Field(min_length=1)


class Merchant(BaseModel):
    blocklist: list[str] = Field(default_factory=list)
    allowlist: list[str] = Field(default_factory=list)


class OrderTerms(BaseModel):
    require_returnable: bool = True
    require_cancellable: bool = True


class Schema(BaseModel):
    raw_instructions: str = Field(min_length=1)
    products: Products
    spending: Spending
    merchant: Merchant
    order_terms: OrderTerms
    notes_for_customer: str = ""

    @model_validator(mode="after")
    def validate_spending_controls(self) -> "Schema":
        has_item_limit = any(item.max_price_per_item is not None for item in self.products.items)
        if self.spending.total_price_max is None and not has_item_limit:
            raise ValueError("Provide a total-price limit or at least one item-price limit.")
        if self.spending.period_in_days is not None and self.spending.total_price_max is None:
            raise ValueError("A period can only be used with a total-price limit.")
        return self


# --- Draft Schemas (For LLM Extraction) ---
class DraftSpending(BaseModel):
    total_price_max: float | None = None
    currency: Currency | None = None
    period_in_days: int | None = None


class DraftProductItem(BaseModel):
    name: str | None = None
    category: ProductCategory | None = None
    quantity: int | None = None
    max_price_per_item: float | None = None


class DraftProducts(BaseModel):
    items: list[DraftProductItem] | None = None


class DraftMerchant(BaseModel):
    blocklist: list[str] | None = None
    allowlist: list[str] | None = None


class DraftOrderTerms(BaseModel):
    require_returnable: bool | None = None
    require_cancellable: bool | None = None


class DraftSchema(BaseModel):
    raw_instructions: str
    products: DraftProducts
    spending: DraftSpending
    merchant: DraftMerchant
    order_terms: DraftOrderTerms
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


class PrepareMandateRequest(BaseModel):
    wallet_id: int = Field(ge=0, le=31)
    policy: Schema


class ResolveAuthorizationRequest(BaseModel):
    decision: Literal["approve", "decline"]


app = FastAPI(title="Wallet Control Layer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def identify() -> dict[str, str]:
    """Confirm which backend/contract is actually running on this port.

    A separate, incompatible backend (Jafar's makedoniaz/VisecaControlLayer,
    which validates a completely different LocalMandateV2 mandate shape) can
    also be run locally on the same default port. Pointing this frontend at
    that backend instead of this one produces a generic, misleading
    "mandate has missing or unexpected fields" error that looks like a
    frontend bug but isn't - the two backends are simply not the same
    contract. Before debugging a confirm/decision failure, curl this route
    and confirm `contract` below, rather than assuming the request body is
    wrong.
    """
    return {
        "service": "wallet-control-layer",
        "branch": "integration/canonical-vertical-slice",
        "contract": "flat-schema-v1",
    }


def parse_with_llm(text: str) -> DraftSchema:
    client = openai.OpenAI(
        base_url="http://localhost:11434/v1",
        api_key="ollama",  # Ollama requires a string here, but ignores the value
    )

    completion = client.beta.chat.completions.parse(
        model="llama3.2",  # Ensure this matches the model you pulled in Ollama
        messages=build_policy_extraction_messages(text),
        response_format=DraftSchema,
        temperature=0,
    )
    parsed = completion.choices[0].message.parsed
    if parsed is None:
        raise ValueError("The local model did not return a parsed wallet policy.")

    # Currency is cheap and safer to verify deterministically. This guarantees
    # that an omitted currency stays null and common spellings such as
    # "francs" and "franks" become CHF even if the model guesses otherwise.
    parsed.spending.currency = detect_explicit_currency(text)
    parsed.spending.period_in_days = detect_explicit_period_days(text)
    return parsed


def check_missing_fields(draft: dict[str, Any]) -> list[str]:
    missing = []

    # Every requested object is kept separately so category, quantity, and an
    # optional unit-price ceiling can be checked against the matching cart line.
    products = draft.get("products", {})
    items = products.get("items") or []
    if not items:
        missing.append("products.items")
    for index, item in enumerate(items):
        if not item.get("name"):
            missing.append(f"products.items.{index}.name")
        if not item.get("category"):
            missing.append(f"products.items.{index}.category")
        if item.get("quantity") is None:
            missing.append(f"products.items.{index}.quantity")

    # At least one monetary ceiling is required, but it can be either a shared
    # basket/period total or one or more item-level limits.
    spending = draft.get("spending", {})
    has_item_limit = any(item.get("max_price_per_item") is not None for item in items)
    if spending.get("total_price_max") is None and not has_item_limit:
        missing.append("spending.total_price_max_or_item_limit")
    if spending.get("currency") is None:
        missing.append("spending.currency")
    if spending.get("period_in_days") is not None and spending.get("total_price_max") is None:
        missing.append("spending.total_price_max")

    return missing


@app.post("/parse-policy", response_model=PolicyResponse)
def parse_policy(request: PolicyRequest) -> PolicyResponse:
    combined_text = request.policy_text
    if request.additional_text:
        combined_text += f"\nAdditional constraints: {request.additional_text}"

    
    parsed_draft = parse_with_llm(combined_text)
    
    draft_dict = parsed_draft.model_dump()
    products = draft_dict.setdefault("products", {})
    products["items"] = merge_duplicate_items(products.get("items") or []) or None
    order_terms = draft_dict.setdefault("order_terms", {})
    if order_terms.get("require_returnable") is None:
        order_terms["require_returnable"] = True
    if order_terms.get("require_cancellable") is None:
        order_terms["require_cancellable"] = True

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


@app.post("/leash/mandates/prepare", status_code=201)
def prepare_leash_mandate(request: PrepareMandateRequest) -> dict[str, Any]:
    """Discover Leash metadata and create a draft for explicit user review."""
    try:
        return prepare_job(request.wallet_id, request.policy.model_dump())
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except LeashApiError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Leash rejected the mandate request (HTTP {error.status}): {error.error_body}",
        ) from error


@app.post("/leash/jobs/{job_id}/confirm", status_code=202)
def confirm_leash_mandate_and_start(job_id: str) -> dict[str, Any]:
    """Confirm the reviewed draft, then start processing every scenario."""
    try:
        return confirm_and_start_job(job_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except LeashApiError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Leash rejected mandate confirmation (HTTP {error.status}): {error.error_body}",
        ) from error


@app.get("/leash/jobs/{job_id}")
def read_leash_job(job_id: str) -> dict[str, Any]:
    try:
        return get_job(job_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/leash/jobs/{job_id}/authorizations/{authorization_id}/resolve")
def resolve_leash_authorization(
    job_id: str,
    authorization_id: str,
    request: ResolveAuthorizationRequest,
) -> dict[str, Any]:
    """Submit a real user answer for a pending step-up authorization."""
    try:
        return resolve_authorization(job_id, authorization_id, request.decision)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except LeashApiError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Leash rejected the customer resolution (HTTP {error.status}): {error.error_body}",
        ) from error
