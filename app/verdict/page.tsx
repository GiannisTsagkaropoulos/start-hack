"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, HelpCircle, ShieldAlert } from "lucide-react";
import { VERDICT_STORAGE_KEY } from "@/lib/viseca-control-layer";
import type { DecisionEvidence, DecisionResponse } from "@/lib/viseca-control-layer";

const decisionStyle = {
  approve: { label: "Approved", tone: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2 },
  decline: { label: "Declined", tone: "bg-red-50 text-red-700 border-red-200", Icon: ShieldAlert },
  step_up: { label: "Customer review needed", tone: "bg-amber-50 text-amber-800 border-amber-200", Icon: HelpCircle },
};

export default function VerdictPage() {
  const [verdict, setVerdict] = useState<DecisionResponse | null | undefined>(undefined);
  const [softCheckDecisions, setSoftCheckDecisions] = useState<Record<string, "accepted" | "rejected">>({});
  const [transactionApproved, setTransactionApproved] = useState(false);

  useEffect(() => {
    // sessionStorage is unavailable during server rendering, so the initial
    // read has to happen in an effect rather than a useState initializer.
    const stored = sessionStorage.getItem(VERDICT_STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVerdict(stored ? (JSON.parse(stored) as DecisionResponse) : null);
  }, []);

  if (verdict === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f9f7] text-slate-500">
        Loading verdict…
      </main>
    );
  }

  if (verdict === null) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f7f9f7] px-5 text-center text-slate-600">
        <p>No verdict yet. Confirm a wallet policy first to get a classification.</p>
        <Link href="/wallet" className="inline-flex items-center gap-2 font-semibold text-emerald-700 hover:text-emerald-800">
          <ArrowLeft size={17} /> Go to wallet policy
        </Link>
      </main>
    );
  }

  const presentation = decisionStyle[verdict.decision];
  const Icon = presentation.Icon;
  const softCheckProblems = verdict.evidence.filter(
    (item) => item.rule_type === "soft" && item.status !== "pass",
  );
  const allSoftChecksAccepted = softCheckProblems.every(
    (item, index) => softCheckDecisions[softCheckId(item, index)] === "accepted",
  );
  const hasRejectedSoftCheck = softCheckProblems.some(
    (item, index) => softCheckDecisions[softCheckId(item, index)] === "rejected",
  );

  function setSoftCheckDecision(id: string, decision: "accepted" | "rejected") {
    setSoftCheckDecisions((current) => ({ ...current, [id]: decision }));
    setTransactionApproved(false);
  }

  function proceedWithTransaction() {
    if (allSoftChecksAccepted) setTransactionApproved(true);
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
          <h2 className="font-bold">Soft-check review</h2>
          <p className="mt-1 text-sm text-slate-500">
            These checks did not pass automatically. Review each explanation and choose whether to accept the exception or reject the transaction.
          </p>
          <div className="mt-4 space-y-4">
            {softCheckProblems.length ? softCheckProblems.map((item, index) => {
              const id = softCheckId(item, index);
              const decision = softCheckDecisions[id];
              return (
                <article key={id} className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                  <p className="text-sm font-bold text-amber-950">{softCheckTitle(item)}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{item.message}</p>
                  <details className="mt-3 rounded-xl border border-amber-200 bg-white/70 px-3 py-2 text-sm text-slate-700">
                    <summary className="cursor-pointer font-semibold text-amber-900">View check details</summary>
                    <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                      <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">What we needed</dt><dd className="mt-1">{describeExpected(item)}</dd></div>
                      <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">What we found</dt><dd className="mt-1">{item.actual === null ? "We could not verify this information." : formatEvidenceValue(item.actual)}</dd></div>
                      <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Checked from</dt><dd className="mt-1">{friendlySource(item.source)}</dd></div>
                    </dl>
                  </details>
                  <div className="mt-4 flex flex-wrap gap-3" role="radiogroup" aria-label={`Decision for ${item.field}`}>
                    <ReviewChoice
                      checked={decision === "accepted"}
                      label="Accept exception"
                      description="Continue despite this soft-check result."
                      onChange={() => setSoftCheckDecision(id, "accepted")}
                      tone="emerald"
                    />
                    <ReviewChoice
                      checked={decision === "rejected"}
                      label="Reject transaction"
                      description="Do not allow this transaction to continue."
                      onChange={() => setSoftCheckDecision(id, "rejected")}
                      tone="red"
                    />
                  </div>
                </article>
              );
            }) : (
              <p className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">There are no failed or unknown soft checks to review.</p>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={proceedWithTransaction}
              disabled={!allSoftChecksAccepted || transactionApproved}
              className="rounded-xl bg-emerald-600 px-4 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {transactionApproved ? "Transaction approved" : "Proceed with transaction"}
            </button>
            {hasRejectedSoftCheck && <p className="text-sm font-medium text-red-700">This transaction is rejected because at least one soft-check concern was rejected.</p>}
            {!allSoftChecksAccepted && !hasRejectedSoftCheck && <p className="text-sm text-slate-500">Accept every soft-check exception to proceed.</p>}
            {transactionApproved && <p className="flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 size={17} /> All soft-check exceptions were accepted.</p>}
          </div>
        </section>

      </div>
    </main>
  );
}

function softCheckId(item: DecisionEvidence, index: number) {
  return `${item.field}-${item.source}-${index}`;
}

function softCheckTitle(item: DecisionEvidence) {
  if (item.field === "history.approved_merchant_transaction_count") {
    return "Merchant history is unknown";
  }
  if (item.field.startsWith("history.")) return "Purchase history needs review";
  if (item.field.startsWith("merchant.")) return "Merchant information needs review";
  if (item.field.startsWith("session.")) return "Session details need review";
  if (item.field.startsWith("risk.") || item.field.startsWith("fraud.")) return "Transaction risk needs review";
  return "This transaction needs review";
}

function describeExpected(item: DecisionEvidence) {
  if (item.field === "history.approved_merchant_transaction_count" && item.operator === ">=") {
    return `At least ${formatEvidenceValue(item.expected)} previously approved purchase${item.expected === 1 ? "" : "s"} with this merchant.`;
  }

  const operator = { ">=": "At least", ">": "More than", "<=": "At most", "<": "Less than", "=": "Exactly", "!=": "Anything except" }[item.operator] ?? "Must be";
  return `${operator} ${formatEvidenceValue(item.expected)}.`;
}

function formatEvidenceValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function friendlySource(source: string) {
  const names: Record<string, string> = {
    authorization_history: "Your approved purchase history",
    merchant_profile: "Merchant profile information",
    session_context: "Your current session details",
    risk_engine: "Transaction risk assessment",
  };
  return names[source] ?? source.replaceAll("_", " ");
}

function ReviewChoice({
  checked,
  label,
  description,
  onChange,
  tone,
}: {
  checked: boolean;
  label: string;
  description: string;
  onChange: () => void;
  tone: "emerald" | "red";
}) {
  const colors = tone === "emerald"
    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
    : "border-red-300 bg-red-50 text-red-900";

  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${colors}`}>
      <input type="radio" checked={checked} onChange={onChange} className="mt-1 h-4 w-4" />
      <span><span className="block text-sm font-bold">{label}</span><span className="block text-xs opacity-80">{description}</span></span>
    </label>
  );
}
