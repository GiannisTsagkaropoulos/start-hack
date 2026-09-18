from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


class PolicyRequest(BaseModel):
    wallet_id: int = Field(ge=0, le=31)
    policy_text: str = Field(min_length=1)


class PolicyResponse(BaseModel):
    walletId: int
    firstWord: str
    originalText: str
    missingFields: list[str]


app = FastAPI(title="Wallet Control Layer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/parse-policy", response_model=PolicyResponse)
def parse_policy(request: PolicyRequest) -> PolicyResponse:
    words = request.policy_text.strip().split()
    first_word = words[0] if words else ""
    normalized_text = request.policy_text.lower()

    missing_fields: list[str] = []
    if not any(symbol in normalized_text for symbol in ("€", "$", "£")) and "price" not in normalized_text:
        missing_fields.append("maxPrice")
    if not any(term in normalized_text for term in ("refund", "return")):
        missing_fields.append("refundable")

    return PolicyResponse(
        walletId=request.wallet_id,
        firstWord=first_word,
        originalText=request.policy_text,
        missingFields=missing_fields,
    )
