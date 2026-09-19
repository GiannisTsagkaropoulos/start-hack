/**
 * Contract copied from VisecaControlLayer/api.py and its mandate JSON schemas.
 *
 * `parse-policy` currently returns `ParsedPolicyDraft`. `confirm-policy`
 * deliberately accepts `LocalMandateV2` instead, so a draft cannot be
 * confirmed until the control layer returns / transforms it into a v2 mandate.
 */

export type Currency = "CHF" | "USD" | "EUR";
export type ConstraintState = "unrestricted" | "required";
export type UncertaintyPolicy = "ask" | "decline" | "approve";

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
  spending: {
    per_item_purchase_price_max: number | null;
    per_period_purchase_price_max: number | null;
    currency: Currency | null;
    period_in_days: number | null;
  };
  merchant: {
    familiarity_required: boolean | null;
    familiarity_min_prior_approved: number | null;
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
  notes_for_customer: string | null;
}

export interface ParsePolicyResponse {
  walletId: number;
  policy: ParsedPolicyDraft;
  missingFields: string[];
  defaultsApplied: Record<string, unknown>;
  complete: boolean;
  reasoning: string[] | null;
}

export interface StateValue {
  state: ConstraintState;
  value: number | null;
}

export interface StateValues<T extends string = string> {
  state: ConstraintState;
  values: T[];
}

export interface ItemMatcher {
  match_mode: "exact_item_id" | "name_and_category" | "category_only";
  item_id: string | null;
  name_contains: string | null;
  category: string | null;
  attributes: Array<{ name: string; value: string }>;
}

/** Exact local-v2 policy required by `POST /confirm-policy`. */
export interface LocalMandateV2 {
  mandate_id: string;
  raw_instruction: string;
  policy_version: 2;
  uncertainty_policy: UncertaintyPolicy;
  spending: {
    per_purchase: { state: ConstraintState; max_chf: number | null };
    rolling_period: { state: ConstraintState; max_chf: number | null; days: number | null };
  };
  cart: {
    allowed_categories: StateValues;
    denied_categories: StateValues;
    requested_items: ItemMatcher[];
    max_distinct_lines: StateValue;
    max_total_quantity: StateValue;
    allow_substitutions: boolean;
    allow_unrequested_add_ons: boolean;
  };
  merchant: {
    allowlist_ids: string[];
    blocklist_ids: string[];
    required_categories: StateValues;
    required_mccs: StateValues;
    familiarity: { state: ConstraintState; minimum_prior_approved: number | null };
  };
  order_terms: {
    fulfillment_methods: StateValues;
    returnable: ConstraintState;
    min_return_window_days: StateValue;
    cancellable: ConstraintState;
  };
  session: {
    trusted_device: "unrestricted" | "required" | "review";
    max_recent_attempts_10m: StateValue;
    domestic_only: "unrestricted" | "required" | "review";
  };
  prompt_injection_defense: true;
}

export interface ConfirmPolicyRequest {
  wallet_id: number;
  policy: LocalMandateV2;
}

export interface VisecaMandateRule {
  field: string;
  operator: "<" | "<=" | "=" | "!=" | ">" | ">=" | "in" | "not_in";
  value: number | string | string[];
  currency?: "CHF" | "EUR" | "GBP" | "USD" | null;
  scope?: "purchase" | "period" | null;
  period_days?: number | null;
}

export interface VisecaMandateDraft {
  instruction: string;
  hard_rules: VisecaMandateRule[];
  uncertainty_policy: UncertaintyPolicy;
  guidance: string[];
  open_questions: string[];
}

export interface ConfirmPolicyResponse {
  success: boolean;
  message: string;
  walletId: number;
  mandate: LocalMandateV2;
  visecaMandate: VisecaMandateDraft;
  modelResponse: { policyVersion: number; mandateId: string };
  reasoning: string[] | null;
}

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

export interface DecisionResponse {
  authorization_id: string;
  decision: "approve" | "decline" | "step_up";
  reason_codes: Array<
    "hard_rule_fail" | "hard_rule_unknown" | "soft_rule_fail" | "soft_rule_unknown"
  >;
  evidence: DecisionEvidence[];
  engine_version: "rule-classifier-v2";
}

const unrestricted = (): StateValue => ({ state: "unrestricted", value: null });

/**
 * Adapts the editable legacy parse response to the strict local-v2 mandate
 * required by the confirmation endpoint. The backend's current two endpoint
 * schemas do not compose directly.
 */
export function toLocalMandateV2(
  draft: ParsedPolicyDraft,
  fallbackInstruction: string,
): LocalMandateV2 {
  if (draft.spending.currency && draft.spending.currency !== "CHF") {
    throw new Error("The confirmation API accepts CHF mandates only. Choose CHF before confirming.");
  }

  const perPurchase = draft.spending.per_item_purchase_price_max;
  const periodMax = draft.spending.per_period_purchase_price_max;
  const periodDays = draft.spending.period_in_days;
  const familiarityMinimum = Math.max(1, draft.merchant.familiarity_min_prior_approved ?? 1);
  const merchantIds = (ids: string[] | null) =>
    (ids ?? []).filter((id) => /^ME\d{4}$/.test(id));

  return {
    mandate_id: "TM-PENDING-CONFIRMATION",
    raw_instruction: draft.raw_instructions.trim() || fallbackInstruction,
    policy_version: 2,
    uncertainty_policy: "ask",
    spending: {
      per_purchase: perPurchase === null
        ? { state: "unrestricted", max_chf: null }
        : { state: "required", max_chf: perPurchase },
      rolling_period: periodMax === null || periodDays === null
        ? { state: "unrestricted", max_chf: null, days: null }
        : { state: "required", max_chf: periodMax, days: periodDays },
    },
    cart: {
      allowed_categories: { state: "unrestricted", values: [] },
      denied_categories: { state: "unrestricted", values: [] },
      requested_items: [],
      max_distinct_lines: unrestricted(),
      max_total_quantity: unrestricted(),
      allow_substitutions: false,
      allow_unrequested_add_ons: false,
    },
    merchant: {
      allowlist_ids: merchantIds(draft.merchant.allowlist),
      blocklist_ids: merchantIds(draft.merchant.blocklist),
      required_categories: { state: "unrestricted", values: [] },
      required_mccs: { state: "unrestricted", values: [] },
      familiarity: draft.merchant.familiarity_required
        ? { state: "required", minimum_prior_approved: familiarityMinimum }
        : { state: "unrestricted", minimum_prior_approved: null },
    },
    order_terms: {
      fulfillment_methods: { state: "unrestricted", values: [] },
      returnable: draft.order_terms.require_returnable ? "required" : "unrestricted",
      min_return_window_days: unrestricted(),
      cancellable: draft.order_terms.require_cancellable ? "required" : "unrestricted",
    },
    session: {
      trusted_device: draft.session.trusted_devices_only ? "required" : "unrestricted",
      max_recent_attempts_10m: draft.session.max_recent_attempts_10m === null
        ? unrestricted()
        : { state: "required", value: draft.session.max_recent_attempts_10m },
      domestic_only: draft.session.domestic_only ? "required" : "unrestricted",
    },
    prompt_injection_defense: true,
  };
}
