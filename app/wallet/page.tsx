"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  ParsePolicyResponse,
  ParsedPolicyDraft,
  ProductCategory,
  ScenarioJobResponse,
  VERDICT_STORAGE_KEY,
  WalletPolicy,
  readErrorMessage,
} from "@/lib/viseca-control-layer";

function toWalletPolicy(draft: ParsedPolicyDraft): WalletPolicy {
  return {
    raw_instructions: draft.raw_instructions,
    products: {
      items: (draft.products.items ?? []).map((item) => ({
        name: item.name as string,
        category: item.category as ProductCategory,
        quantity: item.quantity as number,
        max_price_per_item: item.max_price_per_item ?? null,
      })),
    },
    spending: {
      total_price_max: draft.spending.total_price_max ?? null,
      currency: draft.spending.currency as WalletPolicy["spending"]["currency"],
      period_in_days: draft.spending.period_in_days ?? null,
    },
    merchant: {
      blocklist: draft.merchant.blocklist ?? [],
      allowlist: draft.merchant.allowlist ?? [],
    },
    order_terms: {
      require_returnable: draft.order_terms.require_returnable ?? true,
      require_cancellable: draft.order_terms.require_cancellable ?? true,
    },
    notes_for_customer: draft.notes_for_customer ?? "",
  };
}

type Step = "describe" | "review";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WALLET_ID = 0;

const PRODUCT_CATEGORIES: { label: string; value: ProductCategory }[] = [
  { label: "Books", value: "books" },
  { label: "Clothing", value: "clothing" },
  { label: "Cosmetics", value: "cosmetics" },
  { label: "Dining", value: "dining" },
  { label: "Electronics", value: "electronics" },
  { label: "Food delivery", value: "food_delivery" },
  { label: "Fuel", value: "fuel" },
  { label: "Gift cards", value: "gift_card" },
  { label: "Groceries", value: "groceries" },
  { label: "Home improvement", value: "home_improvement" },
  { label: "Hotel", value: "hotel" },
  { label: "Household", value: "household" },
  { label: "Membership", value: "membership" },
  { label: "Sporting goods", value: "sporting_goods" },
  { label: "Subscriptions", value: "subscriptions" },
  { label: "Transport", value: "transport" },
];

type DraftItem = NonNullable<ParsedPolicyDraft["products"]["items"]>[number];

function getMissingRequiredFields(policy: ParsedPolicyDraft): string[] {
  const missing: string[] = [];
  const items = policy.products.items ?? [];
  if (items.length === 0) missing.push("products.items");
  items.forEach((item, index) => {
    if (!item.name?.trim()) missing.push(`products.items.${index}.name`);
    if (!item.category) missing.push(`products.items.${index}.category`);
    if (!item.quantity || item.quantity < 1) missing.push(`products.items.${index}.quantity`);
  });

  const hasItemLimit = items.some((item) => item.max_price_per_item !== null);
  if (policy.spending.total_price_max === null && !hasItemLimit) {
    missing.push("spending.total_price_max_or_item_limit");
  }
  if (!policy.spending.currency) missing.push("spending.currency");
  if (policy.spending.period_in_days !== null && policy.spending.total_price_max === null) {
    missing.push("spending.total_price_max");
  }
  return missing;
}

const DEFAULT_POLICY: ParsedPolicyDraft = {
  raw_instructions: "",
  products: {
    items: null,
  },
  spending: {
    total_price_max: null,
    currency: null,
    period_in_days: null,
  },
  merchant: {
    blocklist: [],
    allowlist: [],
  },
  order_terms: {
    require_returnable: true,
    require_cancellable: true,
  },
  notes_for_customer: "",
};

export default function WalletPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("describe");
  const [policyText, setPolicyText] = useState("");
  const [draftPolicy, setDraftPolicy] = useState<ParsedPolicyDraft>(DEFAULT_POLICY);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const progress = step === "describe" ? 1 : 2;

  const updatePolicyValue = (path: string, value: unknown) => {
    const keys = path.split(".");
    setDraftPolicy((prev) => {
      const updated = structuredClone(prev) as unknown as Record<string, unknown>;
      let current = updated;
      for (let i = 0; i < keys.length - 1; i++) {
        const next = current[keys[i]];
        if (typeof next !== "object" || next === null || Array.isArray(next)) {
          current[keys[i]] = {};
        }
        current = current[keys[i]] as Record<string, unknown>;
      }
      current[keys[keys.length - 1]] = value;
      return updated as unknown as ParsedPolicyDraft;
    });

  };

  const updateItem = (index: number, field: keyof DraftItem, value: DraftItem[keyof DraftItem]) => {
    setDraftPolicy((previous) => {
      const items = [...(previous.products.items ?? [])];
      items[index] = { ...items[index], [field]: value };
      return { ...previous, products: { items } };
    });
  };

  const addItem = () => {
    setDraftPolicy((previous) => ({
      ...previous,
      products: {
        items: [
          ...(previous.products.items ?? []),
          { name: "", category: null, quantity: null, max_price_per_item: null },
        ],
      },
    }));
  };

  const removeItem = (index: number) => {
    setDraftPolicy((previous) => ({
      ...previous,
      products: {
        items: (previous.products.items ?? []).filter((_, itemIndex) => itemIndex !== index),
      },
    }));
  };

  const isUnknown = (path: string) => {
    const value = path.split(".").reduce<unknown>((current, key) => {
      if (typeof current !== "object" || current === null) return undefined;
      return (current as Record<string, unknown>)[key];
    }, draftPolicy);

    return value === null || value === undefined || value === "" ||
      (Array.isArray(value) && value.length === 0);
  };

  const requestedItems = draftPolicy.products.items ?? [];
  const hasItemPriceLimit = requestedItems.some((item) => item.max_price_per_item !== null);
  const needsMonetaryLimit = draftPolicy.spending.total_price_max === null && !hasItemPriceLimit;
  const periodNeedsTotal =
    draftPolicy.spending.period_in_days !== null && draftPolicy.spending.total_price_max === null;
  const missingRequiredFields = getMissingRequiredFields(draftPolicy);

  const submitPolicy = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!policyText.trim()) return;

    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/parse-policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_id: WALLET_ID,
          policy_text: policyText.trim(),
        }),
      });

      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to parse the policy."));

      const data = (await res.json()) as ParsePolicyResponse;
      setDraftPolicy(data.policy);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error parsing policy.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const prepareMandate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (missingRequiredFields.length > 0) {
      setError("Please answer every yellow required field before confirming the policy.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const policy = toWalletPolicy(draftPolicy);

      const prepareRes = await fetch(`${API_URL}/leash/mandates/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_id: WALLET_ID,
          policy,
        }),
      });

      if (!prepareRes.ok) {
        throw new Error(await readErrorMessage(prepareRes, "The Leash mandate draft could not be created."));
      }

      const preparedJob = (await prepareRes.json()) as ScenarioJobResponse;
      const response = await fetch(`${API_URL}/leash/jobs/${preparedJob.job_id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "The mandate could not be confirmed or started."),
        );
      }

      const confirmedJob = (await response.json()) as ScenarioJobResponse;
      sessionStorage.setItem(
        VERDICT_STORAGE_KEY,
        JSON.stringify({ job_id: confirmedJob.job_id }),
      );
      router.push("/verdict");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare and start the scenario run.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-void text-ink-0">
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-5 py-8 sm:px-8">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="text-lg font-bold tracking-tight text-ink-0"
          >
            Viseca<span className="text-authority-strong">AI-shopper</span>
          </Link>
          <div className="flex items-center gap-2 text-sm font-medium text-ink-2">
            <ShieldCheck size={18} className="text-authority-strong" />
            Wallet policy setup
          </div>
        </header>

        <section className="mx-auto w-full max-w-2xl flex-1 py-10 sm:py-14">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-authority-strong">
                Step {progress} of 2
              </p>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                {step === "describe" && "Describe your shopping rules"}
                {step === "review" && "Review your wallet policy"}
              </h1>
            </div>
          </div>

          {step === "describe" && (
            <form onSubmit={submitPolicy} className="space-y-6">
              <div className="rounded-3xl border border-border-hairline bg-surface-1 p-6">
                <label className="mb-2 block text-sm font-semibold text-ink-1">
                  What do you want the agent to buy?
                </label>
                <textarea
                  value={policyText}
                  onChange={(e) => setPolicyText(e.target.value)}
                  placeholder="Example: Buy running shoes under €120. Require returnable items and allow trusted devices only."
                  className="min-h-36 w-full rounded-xl border border-border-hairline px-4 py-3 text-base outline-none focus:border-authority"
                  required
                />
              </div>
              {error && <ErrorMessage message={error} />}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!policyText.trim() || isSubmitting}
                  className="flex items-center gap-2 rounded-xl bg-ink-0 px-5 py-3.5 font-semibold text-void hover:bg-ink-1 disabled:opacity-40"
                >
                  {isSubmitting ? "Parsing..." : "Parse policy"}{" "}
                  <ArrowRight size={18} />
                </button>
              </div>
            </form>
          )}

          {step === "review" && (
            <form onSubmit={prepareMandate} className="space-y-8">
              {/* Header Status */}
              <div className="rounded-3xl border border-border-hairline bg-surface-1 p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-semibold">
                      Here is what we extracted
                    </h2>
                    <p className="mt-1 text-sm text-ink-2">
                      Yellow sections contain values the policy did not specify.
                      Complete every field marked Required before confirming.
                    </p>
                  </div>
                  <CheckCircle2
                    className="shrink-0 text-authority-strong"
                    size={28}
                  />
                </div>
              </div>

              {/* List of Extracted Fields in Exact Schema Order */}
              <div className="space-y-6">
                {/* 1. Raw Instructions */}
                <SectionBlock title="1. Raw Instructions" needsAttention={isUnknown("raw_instructions")}>
                  <InputField
                    label="Raw Instructions"
                    value={draftPolicy.raw_instructions || ""}
                    onChange={(val) =>
                      updatePolicyValue("raw_instructions", val)
                    }
                  />
                </SectionBlock>

                {/* 2. Requested items - category remains the primary rule. */}
                <SectionBlock
                  title="2. Requested Items"
                  needsAttention={
                    requestedItems.length === 0 ||
                    requestedItems.some((item) => !item.name || !item.category || !item.quantity)
                  }
                >
                  <p className="text-sm leading-6 text-ink-2">
                    Each row becomes a separate mandate item. Category is checked first;
                    quantity is tracked cumulatively across approved purchases.
                  </p>
                  {requestedItems.map((item, index) => (
                    <div
                      key={index}
                      className="rounded-2xl border border-border-hairline bg-surface-2 p-4"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <h4 className="font-semibold text-ink-0">Item {index + 1}</h4>
                        <button
                          type="button"
                          onClick={() => removeItem(index)}
                          className="rounded-lg p-2 text-ink-3 hover:bg-decline-dim hover:text-decline"
                          aria-label={`Remove item ${index + 1}`}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <InputField
                          label="Requested object"
                          value={item.name ?? ""}
                          placeholder="e.g. computer monitor"
                          onChange={(value) => updateItem(index, "name", value || null)}
                          required
                          needsAttention={!item.name}
                        />
                        <SelectField
                          label="Product category"
                          value={item.category ?? ""}
                          options={PRODUCT_CATEGORIES}
                          onChange={(value) =>
                            updateItem(index, "category", (value || null) as ProductCategory | null)
                          }
                          required
                          needsAttention={!item.category}
                        />
                        <InputField
                          label="Total quantity allowed"
                          type="number"
                          value={item.quantity ?? ""}
                          placeholder="e.g. 1"
                          onChange={(value) =>
                            updateItem(index, "quantity", value ? parseInt(value, 10) : null)
                          }
                          required
                          needsAttention={!item.quantity}
                          min="1"
                          step="1"
                        />
                        <InputField
                          label="Max price for this item"
                          type="number"
                          value={item.max_price_per_item ?? ""}
                          placeholder="Optional when a total limit is set"
                          onChange={(value) =>
                            updateItem(
                              index,
                              "max_price_per_item",
                              value ? parseFloat(value) : null,
                            )
                          }
                          needsAttention={needsMonetaryLimit}
                          min="0.01"
                          step="0.01"
                        />
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addItem}
                    className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-authority px-4 py-3 text-sm font-semibold text-authority-strong hover:bg-authority-dim"
                  >
                    <Plus size={17} /> Add another item
                  </button>
                </SectionBlock>

                {/* 3. Spending */}
                <SectionBlock
                  title="3. Spending Controls"
                  needsAttention={
                    needsMonetaryLimit || isUnknown("spending.currency") || periodNeedsTotal
                  }
                >
                  <SelectField
                    label="Currency"
                    value={draftPolicy.spending?.currency || ""}
                    options={[
                      { label: "CHF", value: "CHF" },
                      { label: "USD", value: "USD" },
                      { label: "EUR", value: "EUR" },
                    ]}
                    onChange={(val) =>
                      updatePolicyValue("spending.currency", val || null)
                    }
                    required
                    needsAttention={isUnknown("spending.currency")}
                  />
                  <InputField
                    label="Maximum total spend"
                    type="number"
                    value={draftPolicy.spending?.total_price_max ?? ""}
                    placeholder="e.g. 500.00"
                    onChange={(val) =>
                      updatePolicyValue(
                        "spending.total_price_max",
                        val ? parseFloat(val) : null,
                      )
                    }
                    required={needsMonetaryLimit || periodNeedsTotal}
                    needsAttention={needsMonetaryLimit || periodNeedsTotal}
                    min="0.01"
                    step="0.01"
                  />

                </SectionBlock>

                {/* 4. Order Terms */}
                <SectionBlock
                  title="4. Order Terms"
                >
                  <SelectField
                    label="Require Returnable"
                    value={
                      draftPolicy.order_terms?.require_returnable === null
                        ? ""
                        : String(draftPolicy.order_terms?.require_returnable)
                    }
                    options={[
                      { label: "Yes", value: "true" },
                      { label: "No preference", value: "false" },
                    ]}
                    onChange={(val) =>
                      updatePolicyValue(
                        "order_terms.require_returnable",
                        val === "" ? null : val === "true",
                      )
                    }
                    required
                  />
                  <SelectField
                    label="Require Cancellable"
                    value={
                      draftPolicy.order_terms?.require_cancellable === null
                        ? ""
                        : String(draftPolicy.order_terms?.require_cancellable)
                    }
                    options={[
                      { label: "Yes", value: "true" },
                      { label: "No preference", value: "false" },
                    ]}
                    onChange={(val) =>
                      updatePolicyValue(
                        "order_terms.require_cancellable",
                        val === "" ? null : val === "true",
                      )
                    }
                    required
                  />
                </SectionBlock>
              </div>

              {error && <ErrorMessage message={error} />}

              {/* Footer Actions */}
              <div className="flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep("describe")}
                  className="flex items-center gap-2 rounded-xl px-4 py-3 font-semibold text-ink-2 hover:bg-surface-2"
                >
                  <ArrowLeft size={18} /> Edit prompt
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 rounded-xl bg-authority px-6 py-3.5 font-semibold text-white hover:bg-authority-strong disabled:opacity-40"
                >
                  {isSubmitting ? "Starting scenarios..." : "Run scenario evaluation"}{" "}
                  <ArrowRight size={18} />
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}

function SectionBlock({
  title,
  children,
  needsAttention = false,
}: {
  title: string;
  children: React.ReactNode;
  needsAttention?: boolean;
}) {
  return (
    <div
      className={`rounded-3xl border p-6 shadow-sm ${
        needsAttention
          ? "border-review/40 bg-review-dim"
          : "border-border-hairline bg-surface-1"
      }`}
    >
      <h3 className="mb-4 text-base font-bold text-ink-0">{title}</h3>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = "text",
  placeholder = "",
  required = false,
  needsAttention = false,
  min,
  step,
}: {
  label: string;
  value: string | number;
  onChange: (val: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  needsAttention?: boolean;
  min?: string;
  step?: string;
}) {
  return (
    <label className="block text-sm font-semibold text-ink-1">
      {label} {required && <span className="text-review">Required</span>}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        min={min}
        step={step}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full rounded-xl border px-4 py-2.5 font-normal outline-none focus:border-authority ${
          needsAttention ? "border-review/40 bg-review-dim" : "border-border-hairline bg-surface-1"
        }`}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  required = false,
  needsAttention = false,
}: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (val: string) => void;
  required?: boolean;
  needsAttention?: boolean;
}) {
  return (
    <label className="block text-sm font-semibold text-ink-1">
      {label} {required && <span className="text-review">Required</span>}
      <select
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full rounded-xl border px-4 py-2.5 font-normal outline-none focus:border-authority ${
          needsAttention ? "border-review/40 bg-review-dim" : "border-border-hairline bg-surface-1"
        }`}
      >
        <option value="">{required ? "Select an option" : "Don't care"}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-center gap-2 rounded-xl border border-decline/30 bg-decline-dim px-4 py-3 text-sm text-decline"
    >
      <AlertCircle size={17} /> {message}
    </p>
  );
}
