"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, HelpCircle, ShieldAlert } from "lucide-react";
import type { DecisionResponse } from "@/lib/viseca-control-layer";

const EXAMPLE_VERDICT: DecisionResponse = {
  authorization_id: "AU_EXAMPLE_0001",
  decision: "step_up",
  reason_codes: ["soft_rule_unknown"],
  evidence: [{
    rule_type: "soft",
    field: "history.approved_merchant_transaction_count",
    operator: ">=",
    expected: 1,
    actual: null,
    status: "unknown",
    source: "authorization_history",
    message: "No reliable value is available for merchant purchase history.",
  }],
  engine_version: "rule-classifier-v2",
};

const decisionStyle = {
  approve: { label: "Approved", tone: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2 },
  decline: { label: "Declined", tone: "bg-red-50 text-red-700 border-red-200", Icon: ShieldAlert },
  step_up: { label: "Customer review needed", tone: "bg-amber-50 text-amber-800 border-amber-200", Icon: HelpCircle },
};

export default function VerdictPage() {
  const [verdict, setVerdict] = useState<DecisionResponse>(EXAMPLE_VERDICT);
  const [input, setInput] = useState(JSON.stringify(EXAMPLE_VERDICT, null, 2));
  const [error, setError] = useState("");
  const presentation = decisionStyle[verdict.decision];
  const Icon = presentation.Icon;

  function loadVerdict(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const parsed = JSON.parse(input) as DecisionResponse;
      if (!parsed.authorization_id || !["approve", "decline", "step_up"].includes(parsed.decision) || !Array.isArray(parsed.evidence)) {
        throw new Error("This is not a DecisionResponse object.");
      }
      setVerdict(parsed);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the decision JSON.");
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f9f7] px-5 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <Link href="/wallet" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft size={17} /> Wallet policy
        </Link>
        <header className="mt-8 flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">Final classification</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Authorization verdict</h1>
            <p className="mt-2 text-slate-500">{verdict.authorization_id} · {verdict.engine_version}</p>
          </div>
          <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 font-bold ${presentation.tone}`}>
            <Icon size={20} /> {presentation.label}
          </div>
        </header>

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-bold">Reason codes</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {verdict.reason_codes.length ? verdict.reason_codes.map((code) => <span key={code} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">{code}</span>) : <span className="text-sm text-slate-500">All evaluated rules passed.</span>}
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-bold">Decision evidence</h2>
          <div className="mt-4 space-y-3">
            {verdict.evidence.map((item, index) => (
              <article key={`${item.field}-${index}`} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <code className="text-sm font-semibold text-slate-800">{item.field}</code>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${item.status === "pass" ? "bg-emerald-100 text-emerald-700" : item.status === "fail" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>{item.rule_type} · {item.status}</span>
                </div>
                <p className="mt-3 text-sm text-slate-600">{item.message}</p>
                <dl className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-500 sm:grid-cols-3">
                  <div><dt className="font-semibold">Expected</dt><dd>{String(item.operator)} {JSON.stringify(item.expected)}</dd></div>
                  <div><dt className="font-semibold">Actual</dt><dd>{item.actual === null ? "Unknown" : JSON.stringify(item.actual)}</dd></div>
                  <div><dt className="font-semibold">Source</dt><dd>{item.source}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        </section>

        <form onSubmit={loadVerdict} className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="block text-sm font-bold">Load an engine response</label>
          <p className="mt-1 text-sm text-slate-500">Paste the exact DecisionResponse JSON returned by the classifier.</p>
          <textarea value={input} onChange={(event) => setInput(event.target.value)} className="mt-4 min-h-56 w-full rounded-xl border border-slate-300 p-3 font-mono text-xs outline-none focus:border-emerald-500" />
          {error && <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-red-700"><AlertCircle size={16} /> {error}</p>}
          <button type="submit" className="mt-4 rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white hover:bg-slate-700">Display verdict</button>
        </form>
      </div>
    </main>
  );
}
