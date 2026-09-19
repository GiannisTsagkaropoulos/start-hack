"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  ParsePolicyResponse,
  ParsedPolicyDraft,
  toLocalMandateV2,
} from "@/lib/viseca-control-layer";

type Step = "select" | "describe" | "review";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const DEFAULT_POLICY: ParsedPolicyDraft = {
  raw_instructions: "",
  spending: {
    per_item_purchase_price_max: null,
    per_period_purchase_price_max: null,
    currency: null,
    period_in_days: null,
  },
  merchant: {
    familiarity_required: null,
    familiarity_min_prior_approved: 0,
    blocklist: [],
    allowlist: [],
  },
  order_terms: {
    require_returnable: null,
    require_cancellable: null,
  },
  session: {
    max_recent_attempts_10m: null,
    trusted_devices_only: true,
    domestic_only: null,
  },
  duplicate_check: {
    block_repeats_within_minutes: null,
  },
  notes_for_customer: "",
};

export default function WalletPage() {
  const [step, setStep] = useState<Step>("select");
  const [walletId, setWalletId] = useState("");
  const [policyText, setPolicyText] = useState("");
  const [, setMissingFields] = useState<string[]>([]);
  const [draftPolicy, setDraftPolicy] = useState<ParsedPolicyDraft>(DEFAULT_POLICY);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [isConfirmed, setIsConfirmed] = useState(false);

  const progress = useMemo(
    () => ({ select: 1, describe: 2, review: 3 })[step],
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

    setMissingFields((prev) => prev.filter((field) => field !== path));
  };

  const selectWallet = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!walletId) return;
    setStep("describe");
    setError("");
  };

  const submitPolicy = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!policyText.trim()) return;

    setIsSubmitting(true);
    setError("");
    setIsConfirmed(false);

    try {
      const res = await fetch(`${API_URL}/parse-policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_id: Number(walletId),
          policy_text: policyText.trim(),
        }),
      });

      if (!res.ok) throw new Error("Failed to parse the policy.");

      const data = (await res.json()) as ParsePolicyResponse;
      setDraftPolicy(data.policy);
      setMissingFields(data.missingFields || []);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error parsing policy.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmPolicy = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/confirm-policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_id: Number(walletId),
          policy: toLocalMandateV2(draftPolicy, policyText),
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail?.[0]?.msg || "Validation failed.");
      }

      setIsConfirmed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirmation failed.");
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
                {step === "select" && "Choose a wallet"}
                {step === "describe" && "Describe your shopping rules"}
                {step === "review" && "Review your wallet policy"}
              </h1>
            </div>
          </div>

          {step === "select" && (
            <form onSubmit={selectWallet} className="space-y-6">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                  <Sparkles size={24} />
                </div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Wallet ID
                </label>
                <select
                  value={walletId}
                  onChange={(e) => setWalletId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-emerald-500"
                  required
                >
                  <option value="">Select an ID</option>
                  {Array.from({ length: 32 }, (_, id) => (
                    <option key={id} value={id}>
                      Wallet {id}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={!walletId}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3.5 font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
              >
                Continue <ArrowRight size={18} />
              </button>
            </form>
          )}

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
              <div className="flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep("select")}
                  className="flex items-center gap-2 rounded-xl px-4 py-3 font-semibold text-slate-600 hover:bg-slate-200"
                >
                  <ArrowLeft size={18} /> Back
                </button>
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
            <form onSubmit={confirmPolicy} className="space-y-8">
              {/* Header Status */}
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-semibold">
                      Here is what we extracted
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      All fields are listed in schema order and are fully
                      editable.
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
                <SectionBlock title="1. Raw Instructions">
                  <InputField
                    label="Raw Instructions"
                    value={draftPolicy.raw_instructions || ""}
                    onChange={(val) =>
                      updatePolicyValue("raw_instructions", val)
                    }
                  />
                </SectionBlock>

                {/* 2. Spending */}
                <SectionBlock title="2. Spending Controls">
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
                  />
                  <SelectField
                    label="Currency"
                    value={draftPolicy.spending?.currency || "CHF"}
                    options={[
                      { label: "CHF", value: "CHF" },
                      { label: "USD", value: "USD" },
                      { label: "EUR", value: "EUR" },
                    ]}
                    onChange={(val) =>
                      updatePolicyValue("spending.currency", val || null)
                    }
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
                  />
                </SectionBlock>

                {/* 3. Merchant */}
                <SectionBlock title="3. Merchant Rules">
                  <SelectField
                    label="Familiarity Required"
                    value={
                      draftPolicy.merchant?.familiarity_required === null
                        ? ""
                        : String(draftPolicy.merchant?.familiarity_required)
                    }
                    options={[
                      { label: "Yes", value: "true" },
                      { label: "No", value: "false" },
                    ]}
                    onChange={(val) =>
                      updatePolicyValue(
                        "merchant.familiarity_required",
                        val === "" ? null : val === "true",
                      )
                    }
                  />
                </SectionBlock>

                {/* 4. Order Terms */}
                <SectionBlock title="4. Order Terms">
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
                  />
                </SectionBlock>

                {/* 5. Session */}
                <SectionBlock title="5. Session Restrictions">
                  <SelectField
                    label="Domestic Purchases Only"
                    value={
                      draftPolicy.session?.domestic_only === null
                        ? ""
                        : String(draftPolicy.session?.domestic_only)
                    }
                    options={[
                      { label: "Yes", value: "true" },
                      { label: "No", value: "false" },
                    ]}
                    onChange={(val) =>
                      updatePolicyValue(
                        "session.domestic_only",
                        val === "" ? null : val === "true",
                      )
                    }
                  />
                </SectionBlock>
              </div>

              {isConfirmed && (
                <div className="rounded-2xl bg-slate-900 p-5 text-center text-white">
                  <p className="font-semibold">
                    Policy confirmed for Wallet {walletId}.
                  </p>
                  <p className="mt-1 text-sm text-slate-300">
                    The control layer is active for your shopping agent.
                  </p>
                  <Link
                    href="/verdict"
                    className="mt-4 inline-flex rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
                  >
                    View classification verdict
                  </Link>
                </div>
              )}

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
                {!isConfirmed && (
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                  >
                    {isSubmitting ? "Confirming..." : "Confirm policy"}{" "}
                    <Check size={18} />
                  </button>
                )}
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
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
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
}: {
  label: string;
  value: string | number;
  onChange: (val: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm font-semibold text-slate-700">
      {label}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 font-normal outline-none focus:border-emerald-500"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (val: string) => void;
}) {
  return (
    <label className="block text-sm font-semibold text-slate-700">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-normal outline-none focus:border-emerald-500"
      >
        <option value="">Don&apos;t care</option>
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
      className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      <AlertCircle size={17} /> {message}
    </p>
  );
}
