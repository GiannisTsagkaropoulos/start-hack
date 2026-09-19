"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Lock,
  ShieldCheck,
} from "lucide-react";
import {
  AuthorityBlock,
  ExternalBlock,
} from "@/components/wallet/AuthorityGrammar";

type Step = "select" | "describe" | "review";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const DEFAULT_POLICY = {
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

// Human-readable labels for the fields that actually appear in the review UI.
// Everything else in the schema still round-trips through draftPolicy untouched.
const FIELD_LABELS: Record<string, string> = {
  "spending.per_item_purchase_price_max": "Maximum per item",
  "spending.per_period_purchase_price_max": "Maximum per period",
  "merchant.familiarity_required": "Merchant must be one you've used before",
  "order_terms.require_returnable": "Item must be returnable",
  "order_terms.require_cancellable": "Order must be cancellable",
  "session.domestic_only": "Purchases must be domestic (Switzerland)",
};

export default function WalletPage() {
  const [step, setStep] = useState<Step>("select");
  const [walletId, setWalletId] = useState("");
  const [policyText, setPolicyText] = useState("");
  const [additionalText, setAdditionalText] = useState("");
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [draftPolicy, setDraftPolicy] = useState<any>(DEFAULT_POLICY);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReparsing, setIsReparsing] = useState(false);
  const [error, setError] = useState("");
  const [isConfirmed, setIsConfirmed] = useState(false);

  const progress = useMemo(
    () => ({ select: 1, describe: 2, review: 3 })[step],
    [step],
  );

  const updatePolicyValue = (path: string, value: any) => {
    const keys = path.split(".");
    setDraftPolicy((prev: any) => {
      const updated = structuredClone(prev);
      let current = updated;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) current[keys[i]] = {};
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;
      return updated;
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
      const data = await res.json();
      setDraftPolicy(data.policy);
      setMissingFields(data.missingFields || []);
      setStep("review");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't reach the interpreter. Nothing was granted.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReparseWithMoreInfo = async () => {
    if (!additionalText.trim()) return;
    setIsReparsing(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/parse-policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_id: Number(walletId),
          policy_text: policyText,
          additional_text: additionalText,
        }),
      });
      if (!res.ok) throw new Error("Failed to update policy with new details.");
      const data = await res.json();
      setDraftPolicy(data.policy);
      setMissingFields(data.missingFields || []);
      setPolicyText((prev) => `${prev}\n\n${additionalText}`);
      setAdditionalText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error updating policy.");
    } finally {
      setIsReparsing(false);
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
        body: JSON.stringify({ wallet_id: Number(walletId), policy: draftPolicy }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail?.[0]?.msg || "Validation failed. Nothing was granted.");
      }
      setIsConfirmed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirmation failed. Nothing was granted.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f7f9f7] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 py-8 sm:px-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-lg font-bold tracking-tight text-slate-800">
            Leash
          </Link>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <div className="flex items-center gap-1.5">
              {(["select", "describe", "review"] as Step[]).map((s, i) => (
                <span
                  key={s}
                  className={`h-1.5 w-6 rounded-full transition-colors ${
                    i < progress ? "bg-emerald-500" : "bg-slate-200"
                  }`}
                />
              ))}
            </div>
          </div>
        </header>

        <section className="flex-1 py-10 sm:py-14">
          {step === "select" && (
            <form onSubmit={selectWallet} className="space-y-6 max-w-xl">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-600">
                  Before your agent can spend anything
                </p>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl leading-tight">
                  Whose spending authority is this?
                </h1>
                <p className="mt-3 text-slate-500">
                  Every purchase your agent attempts will be checked against the
                  authority you're about to define here — nothing more.
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Wallet
                </label>
                <select
                  value={walletId}
                  onChange={(e) => setWalletId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-emerald-500"
                  required
                >
                  <option value="">Select a wallet</option>
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
            <form onSubmit={submitPolicy} className="space-y-6 max-w-xl">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-600">
                  Step {progress} of 3 — in your own words
                </p>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl leading-tight">
                  What is your agent allowed to buy?
                </h1>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <textarea
                  value={policyText}
                  onChange={(e) => setPolicyText(e.target.value)}
                  placeholder="Buy running shoes under CHF 120. Require returnable items and allow trusted devices only."
                  className="min-h-36 w-full resize-none border-0 p-0 text-lg leading-relaxed outline-none placeholder:text-slate-300"
                  autoFocus
                  required
                />
              </div>
              <p className="text-xs text-slate-400">
                We'll turn this into specific, checkable rules on the next
                screen — you'll see exactly what we understood before anything
                is granted.
              </p>
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
                  {isSubmitting ? "Reading your rules…" : "Show me what you understood"}{" "}
                  <ArrowRight size={18} />
                </button>
              </div>
            </form>
          )}

          {step === "review" && (
            <form onSubmit={confirmPolicy} className="space-y-6">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-600">
                  Step {progress} of 3 — before you grant anything
                </p>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl leading-tight">
                  Is this what you meant?
                </h1>
              </div>

              {/* One transformation, one container: their words become structured
                  rules in the same visual object, not two separate boxes the
                  eye has to reconcile on its own. */}
              <div className="rounded-2xl border-2 border-slate-200 bg-white overflow-hidden">
                <div className="px-6 pt-5 pb-4 bg-slate-50/80">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 mb-1.5">
                    You said
                  </p>
                  <p className="text-slate-600 italic leading-relaxed">
                    "{draftPolicy.raw_instructions || policyText}"
                  </p>
                </div>
                <div className="flex items-center gap-3 px-6">
                  <div className="h-px flex-1 bg-slate-200" />
                  <ArrowRight size={14} className="text-slate-300 rotate-90" />
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
                <div className="px-6 pt-4 pb-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 mb-1">
                    We understood
                  </p>
                </div>
                <div className="divide-y divide-slate-100 px-6 pb-2">
                  <ReviewRow
                    label={FIELD_LABELS["spending.per_item_purchase_price_max"]}
                    isMissing={missingFields.includes("spending.per_item_purchase_price_max")}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={draftPolicy.spending?.per_item_purchase_price_max ?? ""}
                        placeholder="e.g. 120"
                        onChange={(e) =>
                          updatePolicyValue(
                            "spending.per_item_purchase_price_max",
                            e.target.value ? parseFloat(e.target.value) : null,
                          )
                        }
                        className="w-28 rounded-lg border border-slate-300 px-3 py-1.5 text-right font-mono outline-none focus:border-emerald-500"
                      />
                      <select
                        value={draftPolicy.spending?.currency || "CHF"}
                        onChange={(e) => updatePolicyValue("spending.currency", e.target.value || null)}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 outline-none focus:border-emerald-500"
                      >
                        <option value="CHF">CHF</option>
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                      </select>
                    </div>
                  </ReviewRow>
                  <ReviewRow
                    label={FIELD_LABELS["spending.per_period_purchase_price_max"]}
                    isMissing={missingFields.includes("spending.per_period_purchase_price_max")}
                  >
                    <input
                      type="number"
                      value={draftPolicy.spending?.per_period_purchase_price_max ?? ""}
                      placeholder="None"
                      onChange={(e) =>
                        updatePolicyValue(
                          "spending.per_period_purchase_price_max",
                          e.target.value ? parseFloat(e.target.value) : null,
                        )
                      }
                      className="w-32 rounded-lg border border-slate-300 px-3 py-1.5 text-right font-mono outline-none focus:border-emerald-500"
                    />
                  </ReviewRow>
                  <ToggleRow
                    label={FIELD_LABELS["merchant.familiarity_required"]}
                    value={draftPolicy.merchant?.familiarity_required}
                    isMissing={missingFields.includes("merchant.familiarity_required")}
                    onChange={(v) => updatePolicyValue("merchant.familiarity_required", v)}
                  />
                  <ToggleRow
                    label={FIELD_LABELS["order_terms.require_returnable"]}
                    value={draftPolicy.order_terms?.require_returnable}
                    isMissing={missingFields.includes("order_terms.require_returnable")}
                    onChange={(v) => updatePolicyValue("order_terms.require_returnable", v)}
                  />
                  <ToggleRow
                    label={FIELD_LABELS["order_terms.require_cancellable"]}
                    value={draftPolicy.order_terms?.require_cancellable}
                    isMissing={missingFields.includes("order_terms.require_cancellable")}
                    onChange={(v) => updatePolicyValue("order_terms.require_cancellable", v)}
                  />
                  <ToggleRow
                    label={FIELD_LABELS["session.domestic_only"]}
                    value={draftPolicy.session?.domestic_only}
                    isMissing={missingFields.includes("session.domestic_only")}
                    onChange={(v) => updatePolicyValue("session.domestic_only", v)}
                  />
                </div>
              </div>

              {missingFields.length > 0 && (
                <ExternalBlock eyebrow="We're not guessing at these — tell us or we'll ask you every time">
                  <div className="space-y-3">
                    <p className="text-sm text-amber-900">
                      {missingFields.length} rule{missingFields.length > 1 ? "s" : ""} above
                      {missingFields.length > 1 ? " are" : " is"} still unset. Anything left
                      blank means the agent will pause and ask you directly the first time it
                      matters, instead of us assuming an answer.
                    </p>
                    <div className="flex gap-2">
                      <input
                        value={additionalText}
                        onChange={(e) => setAdditionalText(e.target.value)}
                        placeholder="Add a detail, e.g. 'only from merchants I've bought from before'"
                        className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
                      />
                      <button
                        type="button"
                        onClick={handleReparseWithMoreInfo}
                        disabled={!additionalText.trim() || isReparsing}
                        className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
                      >
                        {isReparsing ? "Updating…" : "Add detail"}
                      </button>
                    </div>
                  </div>
                </ExternalBlock>
              )}

              {/* The moment of granting authority — deliberately distinct from a form Submit */}
              {!isConfirmed ? (
                <AuthorityBlock eyebrow="You are about to grant this authority">
                  <div className="flex items-start justify-between gap-6">
                    <p className="text-sm text-slate-200 max-w-sm">
                      From now on, wallet {walletId}'s agent may spend up to{" "}
                      <strong className="text-white">
                        {draftPolicy.spending?.per_item_purchase_price_max
                          ? `${draftPolicy.spending.currency ?? "CHF"} ${draftPolicy.spending.per_item_purchase_price_max} per item`
                          : "an amount you haven't set yet"}
                      </strong>{" "}
                      under exactly the rules above — nothing wider, nothing implied.
                    </p>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex shrink-0 items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3.5 font-semibold text-white hover:bg-emerald-400 disabled:opacity-40"
                    >
                      <Lock size={16} />
                      {isSubmitting ? "Granting…" : "Grant this authority"}
                    </button>
                  </div>
                </AuthorityBlock>
              ) : (
                <AuthorityBlock eyebrow="Authority active">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="text-emerald-400 shrink-0" size={22} />
                    <p className="text-sm text-slate-200">
                      Wallet {walletId} is now live under these exact rules. Every
                      purchase the agent attempts will be checked against them before
                      anything is spent.
                    </p>
                  </div>
                  <Link
                    href="/wallet/activity"
                    className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-emerald-300 hover:text-emerald-200"
                  >
                    See how a purchase gets checked against this <ArrowRight size={14} />
                  </Link>
                </AuthorityBlock>
              )}

              {error && <ErrorMessage message={error} />}

              {!isConfirmed && (
                <button
                  type="button"
                  onClick={() => setStep("describe")}
                  className="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-700"
                >
                  <ArrowLeft size={16} /> Edit what I said
                </button>
              )}
            </form>
          )}
        </section>
      </div>
    </main>
  );
}

function ReviewRow({
  label,
  isMissing,
  children,
}: {
  label: string;
  isMissing?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-sm font-medium text-slate-600 flex items-center gap-2 flex-wrap">
        {label}
        {isMissing && (
          <span className="shrink-0 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
            Not set
          </span>
        )}
      </span>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  value,
  isMissing,
  onChange,
}: {
  label: string;
  value: boolean | null | undefined;
  isMissing?: boolean;
  onChange: (v: boolean | null) => void;
}) {
  return (
    <ReviewRow label={label} isMissing={isMissing}>
      <div className="flex overflow-hidden rounded-lg border border-slate-300">
        {[
          { v: true, label: "Yes" },
          { v: false, label: "No" },
        ].map((opt) => (
          <button
            key={String(opt.v)}
            type="button"
            onClick={() => onChange(opt.v)}
            className={`px-3.5 py-1.5 text-sm font-semibold transition-colors ${
              value === opt.v
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </ReviewRow>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      <AlertCircle size={17} className="shrink-0" /> {message}
    </p>
  );
}
