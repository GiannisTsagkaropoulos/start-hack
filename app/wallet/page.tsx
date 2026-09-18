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

type ParsedPolicy = {
  walletId: number;
  firstWord: string;
  originalText: string;
  missingFields: string[];
};

type Step = "select" | "describe" | "review";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function WalletPage() {
  const [step, setStep] = useState<Step>("select");
  const [walletId, setWalletId] = useState("");
  const [policyText, setPolicyText] = useState("");
  const [parsedPolicy, setParsedPolicy] = useState<ParsedPolicy | null>(null);
  const [maxPrice, setMaxPrice] = useState("");
  const [refundable, setRefundable] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [isConfirmed, setIsConfirmed] = useState(false);

  const progress = useMemo(
    () => ({ select: 1, describe: 2, review: 3 })[step],
    [step],
  );

  const selectWallet = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!walletId) return;
    setStep("describe");
    setError("");
  };

  const submitPolicy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!policyText.trim()) return;

    setIsSubmitting(true);
    setError("");
    setIsConfirmed(false);

    try {
      const response = await fetch(`${API_URL}/parse-policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_id: Number(walletId),
          policy_text: policyText.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error("The policy could not be parsed.");
      }

      const data = (await response.json()) as ParsedPolicy;
      setParsedPolicy(data);
      setStep("review");
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Something went wrong while parsing the policy.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const goBack = () => {
    setError("");
    setIsConfirmed(false);
    setStep(step === "review" ? "describe" : "select");
  };

  const confirmPolicy = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsConfirmed(true);
  };

  const hasMissingFields = Boolean(parsedPolicy?.missingFields.length);

  return (
    <main className="min-h-screen bg-[#f7f9f7] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-8 sm:px-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-lg font-bold tracking-tight text-slate-800">
            Control<span className="text-emerald-600">Layer</span>
          </Link>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <ShieldCheck size={18} className="text-emerald-600" />
            Wallet policy setup
          </div>
        </header>

        <section className="mx-auto w-full max-w-2xl flex-1 py-14 sm:py-20">
          <div className="mb-10 flex items-center justify-between">
            <div>
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-600">
                Step {progress} of 3
              </p>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                {step === "select" && "Choose a wallet"}
                {step === "describe" && "Describe your shopping rules"}
                {step === "review" && "Review your wallet policy"}
              </h1>
            </div>
            <div className="hidden items-center gap-2 sm:flex" aria-label={`Step ${progress} of 3`}>
              {[1, 2, 3].map((item) => (
                <span
                  key={item}
                  className={`h-2 w-10 rounded-full ${
                    item <= progress ? "bg-emerald-500" : "bg-slate-200"
                  }`}
                />
              ))}
            </div>
          </div>

          {step === "select" && (
            <form onSubmit={selectWallet} className="space-y-8">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                  <Sparkles size={24} />
                </div>
                <h2 className="mb-2 text-xl font-semibold">Which wallet should we configure?</h2>
                <p className="mb-7 text-slate-500">
                  Select one of the demo wallets. Your policy stays tied to this wallet.
                </p>
                <label htmlFor="wallet-id" className="mb-2 block text-sm font-semibold text-slate-700">
                  Wallet ID
                </label>
                <select
                  id="wallet-id"
                  value={walletId}
                  onChange={(event) => setWalletId(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
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
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3.5 font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!walletId}
              >
                Continue <ArrowRight size={18} />
              </button>
            </form>
          )}

          {step === "describe" && (
            <form onSubmit={submitPolicy} className="space-y-8">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-500">Configuring</p>
                    <p className="font-semibold text-slate-800">Wallet {walletId}</p>
                  </div>
                  <button type="button" onClick={goBack} className="text-sm font-semibold text-slate-500 hover:text-slate-900">
                    Change wallet
                  </button>
                </div>
                <label htmlFor="policy-text" className="mb-2 block text-sm font-semibold text-slate-700">
                  What should the shopping agent be allowed to buy?
                </label>
                <textarea
                  id="policy-text"
                  value={policyText}
                  onChange={(event) => setPolicyText(event.target.value)}
                  placeholder="Example: Buy running shoes, size 42, under €120. Only choose items that can be returned."
                  className="min-h-44 w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-base leading-7 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                  required
                />
                <p className="mt-3 text-sm text-slate-500">
                  Use natural language. In this first prototype, the backend echoes the first word and checks for a couple of policy controls.
                </p>
              </div>
              {error && <ErrorMessage message={error} />}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                <button type="button" onClick={goBack} className="flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 font-semibold text-slate-600 hover:bg-slate-200/60">
                  <ArrowLeft size={18} /> Back
                </button>
                <button
                  type="submit"
                  disabled={!policyText.trim() || isSubmitting}
                  className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3.5 font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSubmitting ? "Parsing policy..." : "Parse policy"} <ArrowRight size={18} />
                </button>
              </div>
            </form>
          )}

          {step === "review" && parsedPolicy && (
            <form onSubmit={confirmPolicy} className="space-y-6">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                <div className="mb-7 flex items-start justify-between gap-4">
                  <div>
                    <p className="mb-1 text-sm text-slate-500">Parsed for Wallet {parsedPolicy.walletId}</p>
                    <h2 className="text-xl font-semibold">Here is what we understood</h2>
                  </div>
                  <CheckCircle2 className="shrink-0 text-emerald-500" size={28} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <SummaryItem label="First word detected" value={parsedPolicy.firstWord} />
                  <SummaryItem label="Policy text" value={parsedPolicy.originalText} />
                </div>
              </div>

              {hasMissingFields ? (
                <div className="rounded-3xl border border-amber-200 bg-amber-50/70 p-6 sm:p-8">
                  <div className="mb-6 flex gap-3">
                    <AlertCircle className="mt-0.5 shrink-0 text-amber-600" size={22} />
                    <div>
                      <h2 className="font-semibold text-slate-900">A few controls still need your input</h2>
                      <p className="mt-1 text-sm text-slate-600">Complete these fields before confirming the policy.</p>
                    </div>
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2">
                    {parsedPolicy.missingFields.includes("maxPrice") && (
                      <label className="text-sm font-semibold text-slate-700">
                        Maximum price
                        <div className="mt-2 flex rounded-xl border border-slate-300 bg-white focus-within:border-emerald-500 focus-within:ring-4 focus-within:ring-emerald-500/10">
                          <span className="flex items-center pl-4 text-slate-500">€</span>
                          <input required value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} type="number" min="0" step="0.01" placeholder="120" className="w-full rounded-xl px-2 py-3 outline-none" />
                        </div>
                      </label>
                    )}
                    {parsedPolicy.missingFields.includes("refundable") && (
                      <label className="text-sm font-semibold text-slate-700">
                        Items must be refundable?
                        <select required value={refundable} onChange={(event) => setRefundable(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10">
                          <option value="">Choose one</option>
                          <option value="yes">Yes, refundable only</option>
                          <option value="no">No preference</option>
                        </select>
                      </label>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-900">
                  <p className="flex items-center gap-2 font-semibold"><Check size={18} /> All required controls were found.</p>
                </div>
              )}

              {isConfirmed && (
                <div className="rounded-2xl bg-slate-900 p-5 text-center text-white">
                  <p className="font-semibold">Policy confirmed for Wallet {parsedPolicy.walletId}.</p>
                  <p className="mt-1 text-sm text-slate-300">The shopping agent can now use these controls.</p>
                </div>
              )}
              {error && <ErrorMessage message={error} />}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                <button type="button" onClick={goBack} className="flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 font-semibold text-slate-600 hover:bg-slate-200/60">
                  <ArrowLeft size={18} /> Edit policy
                </button>
                {!isConfirmed && (
                  <button type="submit" className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3.5 font-semibold text-white transition hover:bg-emerald-700">
                    Confirm policy <Check size={18} />
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

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="break-words font-medium text-slate-900">{value}</p>
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <AlertCircle size={17} /> {message}
    </p>
  );
}
