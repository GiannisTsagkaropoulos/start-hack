"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ShieldCheck,
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
      allowed_categories: draft.products.allowed_categories ?? [],
    },
    spending: {
      per_item_purchase_price_max: draft.spending.per_item_purchase_price_max as number,
      per_period_purchase_price_max: draft.spending.per_period_purchase_price_max as number,
      currency: draft.spending.currency as WalletPolicy["spending"]["currency"],
      period_in_days: draft.spending.period_in_days as number,
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

type Step = "describe" | "review" | "confirm";

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

const requiredConfirmationFields = [
  "products.allowed_categories",
  "spending.per_item_purchase_price_max",
  "spending.per_period_purchase_price_max",
  "spending.currency",
  "spending.period_in_days",
] as const;

const DEFAULT_POLICY: ParsedPolicyDraft = {
  raw_instructions: "",
  products: {
    allowed_categories: null,
  },
  spending: {
    per_item_purchase_price_max: null,
    per_period_purchase_price_max: null,
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
  const [preparedJob, setPreparedJob] = useState<ScenarioJobResponse | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const progress = useMemo(
    () => ({ describe: 1, review: 2, confirm: 3 })[step],
    [step],
  );

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

  const isUnknown = (path: string) => {
    const value = path.split(".").reduce<unknown>((current, key) => {
      if (typeof current !== "object" || current === null) return undefined;
      return (current as Record<string, unknown>)[key];
    }, draftPolicy);

    return value === null || value === undefined || value === "" ||
      (Array.isArray(value) && value.length === 0);
  };

  const missingRequiredFields = requiredConfirmationFields.filter(isUnknown);

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

      const job = (await prepareRes.json()) as ScenarioJobResponse;
      setPreparedJob(job);
      setStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mandate preparation failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmAndRun = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!preparedJob) return;

    setIsSubmitting(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/leash/jobs/${preparedJob.job_id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, "The mandate could not be confirmed or started."),
        );
      }

      const job = (await response.json()) as ScenarioJobResponse;
      sessionStorage.setItem(VERDICT_STORAGE_KEY, JSON.stringify({ job_id: job.job_id }));
      router.push("/verdict");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the scenario run.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f7f9f7] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-5 py-8 sm:px-8">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="text-lg font-bold tracking-tight text-slate-800"
          >
            Viseca<span className="text-emerald-600">AI-shopper</span>
          </Link>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <ShieldCheck size={18} className="text-emerald-600" />
            Wallet policy setup
          </div>
        </header>

        <section className="mx-auto w-full max-w-2xl flex-1 py-10 sm:py-14">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">
                Step {progress} of 3
              </p>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                {step === "describe" && "Describe your shopping rules"}
                {step === "review" && "Review your wallet policy"}
                {step === "confirm" && "Confirm the Leash mandate"}
              </h1>
            </div>
          </div>

          {step === "describe" && (
            <form onSubmit={submitPolicy} className="space-y-6">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  What do you want the agent to buy?
                </label>
                <textarea
                  value={policyText}
                  onChange={(e) => setPolicyText(e.target.value)}
                  placeholder="Example: Buy running shoes under €120. Require returnable items and allow trusted devices only."
                  className="min-h-36 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-emerald-500"
                  required
                />
              </div>
              {error && <ErrorMessage message={error} />}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!policyText.trim() || isSubmitting}
                  className="flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3.5 font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
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
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-semibold">
                      Here is what we extracted
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Yellow sections contain values the policy did not specify.
                      Complete every field marked Required before confirming.
                    </p>
                  </div>
                  <CheckCircle2
                    className="shrink-0 text-emerald-500"
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

                {/* 2. Products - the primary authorization rule. */}
                <SectionBlock
                  title="2. Allowed Product Categories"
                  needsAttention={isUnknown("products.allowed_categories")}
                >
                  <MultiSelectField
                    label="Every cart item must match one of these categories"
                    values={draftPolicy.products?.allowed_categories ?? []}
                    options={PRODUCT_CATEGORIES}
                    onChange={(values) =>
                      updatePolicyValue("products.allowed_categories", values)
                    }
                    required
                    needsAttention={isUnknown("products.allowed_categories")}
                  />
                </SectionBlock>

                {/* 3. Spending */}
                <SectionBlock
                  title="3. Spending Controls"
                  needsAttention={[
                    "spending.per_item_purchase_price_max",
                    "spending.currency",
                    "spending.per_period_purchase_price_max",
                    "spending.period_in_days",
                  ].some(isUnknown)}
                >
                  <InputField
                    label="Max Price Per Item"
                    type="number"
                    value={
                      draftPolicy.spending?.per_item_purchase_price_max ?? ""
                    }
                    placeholder="e.g. 120.00"
                    onChange={(val) =>
                      updatePolicyValue(
                        "spending.per_item_purchase_price_max",
                        val ? parseFloat(val) : null,
                      )
                    }
                    required
                    needsAttention={isUnknown("spending.per_item_purchase_price_max")}
                  />
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
                    label="Max Price Per Period"
                    type="number"
                    value={
                      draftPolicy.spending?.per_period_purchase_price_max ?? ""
                    }
                    placeholder="e.g. 500.00"
                    onChange={(val) =>
                      updatePolicyValue(
                        "spending.per_period_purchase_price_max",
                        val ? parseFloat(val) : null,
                      )
                    }
                    required
                    needsAttention={isUnknown("spending.per_period_purchase_price_max")}
                  />

                  <InputField
                    label="Period (in Days)"
                    type="number"
                    value={draftPolicy.spending?.period_in_days ?? ""}
                    placeholder="e.g. 30"
                    onChange={(val) =>
                      updatePolicyValue(
                        "spending.period_in_days",
                        val ? parseInt(val) : null,
                      )
                    }
                    required
                    needsAttention={isUnknown("spending.period_in_days")}
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
                  className="flex items-center gap-2 rounded-xl px-4 py-3 font-semibold text-slate-600 hover:bg-slate-200"
                >
                  <ArrowLeft size={18} /> Edit prompt
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  {isSubmitting ? "Creating draft..." : "Create mandate draft"}{" "}
                  <Check size={18} />
                </button>
              </div>
            </form>
          )}

          {step === "confirm" && preparedJob && (
            <form onSubmit={confirmAndRun} className="space-y-6">
              <div className="rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">
                      Leash draft {preparedJob.draft.draft_id}
                    </p>
                    <h2 className="mt-2 text-xl font-semibold">Review before activation</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      The service is healthy, bootstrap and reference data were loaded, and this
                      draft has not been activated yet. Confirming starts all five scenarios.
                    </p>
                  </div>
                  <CheckCircle2 className="shrink-0 text-emerald-500" size={28} />
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="font-bold">Instruction</h3>
                <p className="mt-2 text-sm leading-6 text-slate-700">{preparedJob.draft.instruction}</p>
                <h3 className="mt-6 font-bold">Compiled checks</h3>
                <div className="mt-3 space-y-3">
                  {preparedJob.draft.hard_rules.map((rule, index) => (
                    <div key={`${rule.field}-${index}`} className="rounded-xl bg-slate-50 p-4 text-sm">
                      <span className="font-semibold text-slate-900">{rule.field}</span>{" "}
                      <span className="text-slate-600">{rule.operator} {String(rule.value)}</span>
                      {rule.currency && <span className="text-slate-500"> {rule.currency}</span>}
                    </div>
                  ))}
                </div>
              </div>

              {error && <ErrorMessage message={error} />}

              <div className="flex justify-between gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setPreparedJob(null);
                    setStep("review");
                  }}
                  className="flex items-center gap-2 rounded-xl px-4 py-3 font-semibold text-slate-600 hover:bg-slate-200"
                >
                  <ArrowLeft size={18} /> Edit policy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  {isSubmitting ? "Starting scenarios..." : "Confirm and run all scenarios"}
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
          ? "border-amber-300 bg-amber-50"
          : "border-slate-200 bg-white"
      }`}
    >
      <h3 className="mb-4 text-base font-bold text-slate-900">{title}</h3>
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
}: {
  label: string;
  value: string | number;
  onChange: (val: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  needsAttention?: boolean;
}) {
  return (
    <label className="block text-sm font-semibold text-slate-700">
      {label} {required && <span className="text-amber-800">Required</span>}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full rounded-xl border px-4 py-2.5 font-normal outline-none focus:border-emerald-500 ${
          needsAttention ? "border-amber-300 bg-amber-50" : "border-slate-300 bg-white"
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
    <label className="block text-sm font-semibold text-slate-700">
      {label} {required && <span className="text-amber-800">Required</span>}
      <select
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full rounded-xl border px-4 py-2.5 font-normal outline-none focus:border-emerald-500 ${
          needsAttention ? "border-amber-300 bg-amber-50" : "border-slate-300 bg-white"
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

function MultiSelectField({
  label,
  values,
  options,
  onChange,
  required = false,
  needsAttention = false,
}: {
  label: string;
  values: ProductCategory[];
  options: { label: string; value: ProductCategory }[];
  onChange: (values: ProductCategory[]) => void;
  required?: boolean;
  needsAttention?: boolean;
}) {
  const selected = new Set(values);
  return (
    <fieldset
      className={`rounded-xl border p-4 ${
        needsAttention ? "border-amber-300 bg-amber-50" : "border-slate-300 bg-white"
      }`}
    >
      <legend className="px-1 text-sm font-semibold text-slate-700">
        {label} {required && <span className="text-amber-800">Required</span>}
      </legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={selected.has(option.value)}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...values, option.value]
                  : values.filter((value) => value !== option.value);
                onChange(next);
              }}
              className="size-4 rounded border-slate-300 text-emerald-600"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      <AlertCircle size={17} /> {message}
    </p>
  );
}
