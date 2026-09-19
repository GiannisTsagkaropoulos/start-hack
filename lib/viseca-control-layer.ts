/**
 * Contract verified directly against the running backend/main.py in this
 * repo (Schema/DraftSchema/PolicyResponse and the Leash scenario-job facade).
 * This file previously also described a `LocalMandateV2` shape and a richer
 * confirm-policy response; neither is what backend/main.py actually returns.
 * The production Leash flow below is represented separately from the local
 * parsing schema so the two contracts cannot be confused again.
 */

export type Currency = "CHF" | "USD" | "EUR";
export type ProductCategory =
  | "books"
  | "clothing"
  | "cosmetics"
  | "dining"
  | "electronics"
  | "food_delivery"
  | "fuel"
  | "gift_card"
  | "groceries"
  | "home_improvement"
  | "hotel"
  | "household"
  | "membership"
  | "sporting_goods"
  | "subscriptions"
  | "transport";

export interface ParsePolicyRequest {
  /** Integer from 0 through 31, inclusive. */
  wallet_id: number;
  /** Non-empty after trimming by the caller. */
  policy_text: string;
  additional_text?: string | null;
}

/** Exact `PolicyResponse.policy` shape returned by the current API. */
export interface ParsedPolicyDraft {
  raw_instructions: string;
  products: {
    allowed_categories: ProductCategory[] | null;
  };
  spending: {
    per_item_purchase_price_max: number | null;
    per_period_purchase_price_max: number | null;
    currency: Currency | null;
    period_in_days: number | null;
  };
  merchant: {
    blocklist: string[] | null;
    allowlist: string[] | null;
  };
  order_terms: {
    require_returnable: boolean | null;
    require_cancellable: boolean | null;
  };
  session: {
    max_recent_attempts_10m: number | null;
    trusted_devices_only: boolean | null;
    domestic_only: boolean | null;
  };
  duplicate_check: {
    block_repeats_within_minutes: number | null;
  };
  notes_for_customer: string | null;
}

/** Exact `PolicyResponse` returned by `POST /parse-policy` - no more, no less. */
export interface ParsePolicyResponse {
  walletId: number;
  policy: ParsedPolicyDraft;
  missingFields: string[];
  complete: boolean;
}

/** Exact `ConfirmationResponse` returned by `POST /confirm-policy` - no more, no less.
 *  Confirmation only; no mandate, no persistence, no model response is returned. */
export interface ConfirmPolicyResponse {
  success: boolean;
  message: string;
  walletId: number;
}

/** Exact `ConfirmationRequest.policy` / `DecisionRequest.policy` shape the local backend accepts. */
export interface WalletPolicy {
  raw_instructions: string;
  products: {
    allowed_categories: ProductCategory[];
  };
  spending: {
    per_item_purchase_price_max: number;
    per_period_purchase_price_max: number | null;
    currency: Currency;
    period_in_days: number | null;
  };
  merchant: {
    blocklist: string[];
    allowlist: string[];
  };
  order_terms: {
    require_returnable: boolean | null;
    require_cancellable: boolean | null;
  };
  session: {
    max_recent_attempts_10m: number | null;
    trusted_devices_only: boolean;
    domestic_only: boolean | null;
  };
  duplicate_check: {
    block_repeats_within_minutes: number | null;
  };
  notes_for_customer: string;
}

export interface DecisionRequest {
  wallet_id: number;
  policy: WalletPolicy;
}

/** sessionStorage key used to hand the active Leash job to /verdict. */
export const VERDICT_STORAGE_KEY = "wallet-scenario-job";

export interface DecisionEvidence {
  rule_type: "hard" | "soft";
  field: string;
  operator: string;
  expected: unknown;
  actual: unknown | null;
  status: "pass" | "fail" | "unknown";
  source: string;
  message: string;
}

/** Legacy local `/decision` response; the production verdict uses ScenarioJobResponse. */
export interface DecisionResponse {
  authorization_id: string;
  decision: "approve" | "decline" | "step_up";
  reason_codes: Array<
    "hard_rule_fail" | "hard_rule_unknown" | "soft_rule_fail" | "soft_rule_unknown"
  >;
  evidence: DecisionEvidence[];
  engine_version: "rule-classifier-v2";
}

export interface LeashHardRule {
  field: string;
  operator: string;
  value: number | string | string[];
  currency?: string | null;
  scope?: string | null;
  period_days?: number | null;
}

export interface ScenarioPurchaseSummary {
  description: string | null;
  amount: number | null;
  currency: string | null;
  billing_amount_chf: number | null;
  merchant_name: string | null;
  merchant_country: string | null;
  replay_order: number | null;
  items: Array<{
    name: string | null;
    quantity: number | null;
    unit_price: number | null;
    currency: string | null;
  }>;
}

export interface ScenarioAuthorizationResult {
  authorization_id: string;
  source_authorization_id: string | null;
  engine_decision: "approve" | "decline" | "step_up";
  final_decision: "approve" | "decline" | null;
  reason_codes: string[];
  customer_message: string;
  evidence: DecisionEvidence[];
  status: string | null;
  is_final: boolean;
  human_deadline_at: string | null;
  decision_latency_ms: number;
  purchase: ScenarioPurchaseSummary;
  customer_resolution_message?: string;
  resolved_at?: string;
}

export interface ScenarioResult {
  scenario_id: string;
  scenario_name: string;
  event_count: number;
  status: string;
  run_id: string | null;
  counters: Record<string, number>;
  results: ScenarioAuthorizationResult[];
}

export interface ScenarioJobResponse {
  job_id: string;
  wallet_id: number;
  status: "awaiting_confirmation" | "running" | "awaiting_customer" | "completed" | "failed";
  created_at: string;
  updated_at: string;
  health: {
    status: string | null;
    service: string | null;
    api_version: string | null;
    pack_version: string | null;
  };
  bootstrap: {
    api_version: string | null;
    pack_version: string | null;
    timeouts: Record<string, number>;
  };
  reference_data_loaded: boolean;
  draft: {
    draft_id: string;
    status: string;
    instruction: string;
    hard_rules: LeashHardRule[];
  };
  mandate_id: string | null;
  scenarios: ScenarioResult[];
  summary: {
    total: number;
    approve: number;
    decline: number;
    step_up: number;
    awaiting_customer: number;
  };
  error: string | null;
}

/**
 * Formats FastAPI's `detail` (a string, or a list of {loc/msg} or
 * {field/reason} objects) into one human-readable line per error, e.g.
 * "Currency: Field required." Falls back to null when nothing usable is
 * found, so callers can supply their own generic message instead.
 */
export function formatValidationDetail(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return null;

  const messages = detail.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const message =
      typeof record.msg === "string"
        ? record.msg
        : typeof record.reason === "string"
          ? record.reason
          : typeof record.message === "string"
            ? record.message
            : null;
    if (!message) return [];

    const rawField = Array.isArray(record.loc)
      ? record.loc.filter((part) => part !== "body").map(String).join(".")
      : typeof record.field === "string"
        ? record.field.replace(/^body\./, "")
        : "";
    const field = rawField.replace(/^policy\./, "");
    return [field ? `${field}: ${message}` : message];
  });

  return messages.length > 0 ? messages.join(" ") : null;
}

export async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("json")) {
    const body: unknown = await response.json().catch(() => null);
    if (typeof body === "object" && body !== null) {
      const record = body as Record<string, unknown>;
      const detail = formatValidationDetail(record.detail);
      if (detail) return detail;
      if (typeof record.message === "string") return record.message;
    }
  } else {
    const body = await response.text().catch(() => "");
    if (body.trim()) return body.trim();
  }

  return `${fallback} (HTTP ${response.status})`;
}
