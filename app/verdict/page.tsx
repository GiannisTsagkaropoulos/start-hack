"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  HelpCircle,
  LoaderCircle,
  ShieldAlert,
} from "lucide-react";
import {
  ScenarioAuthorizationResult,
  ScenarioJobResponse,
  VERDICT_STORAGE_KEY,
  readErrorMessage,
} from "@/lib/viseca-control-layer";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const decisionStyle = {
  approve: { label: "Approved", tone: "border-emerald-200 bg-emerald-50 text-emerald-700", Icon: CheckCircle2 },
  decline: { label: "Declined", tone: "border-red-200 bg-red-50 text-red-700", Icon: ShieldAlert },
  step_up: { label: "Customer review", tone: "border-amber-200 bg-amber-50 text-amber-800", Icon: HelpCircle },
};

export default function VerdictPage() {
  const [jobId, setJobId] = useState<string | null | undefined>(undefined);
  const [job, setJob] = useState<ScenarioJobResponse | null>(null);
  const [error, setError] = useState("");
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const refresh = useCallback(async (id: string) => {
    const response = await fetch(`${API_URL}/leash/jobs/${id}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await readErrorMessage(response, "Could not load scenario results."));
    const nextJob = (await response.json()) as ScenarioJobResponse;
    setJob(nextJob);
    setError("");
    return nextJob;
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem(VERDICT_STORAGE_KEY);
    let nextJobId: string | null = null;
    try {
      const value = stored ? JSON.parse(stored) as { job_id?: unknown } : null;
      nextJobId = typeof value?.job_id === "string" ? value.job_id : null;
    } catch {}
    // sessionStorage is unavailable during server rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJobId(nextJobId);
  }, []);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const nextJob = await refresh(jobId);
        if (!cancelled && nextJob.status !== "completed" && nextJob.status !== "failed") {
          timer = setTimeout(poll, 1000);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load scenario results.");
          timer = setTimeout(poll, 3000);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, refresh]);

  async function resolve(result: ScenarioAuthorizationResult, decision: "approve" | "decline") {
    if (!jobId) return;
    setResolvingId(result.authorization_id);
    setError("");
    try {
      const response = await fetch(
        `${API_URL}/leash/jobs/${jobId}/authorizations/${result.authorization_id}/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response, "Could not resolve the purchase."));
      setJob((await response.json()) as ScenarioJobResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not resolve the purchase.");
    } finally {
      setResolvingId(null);
    }
  }

  if (jobId === undefined) return <LoadingState message="Loading live scenario results…" />;
  if (!jobId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f7f9f7] px-5 text-center text-slate-600">
        <p>No scenario job is attached to this browser session.</p>
        <Link href="/wallet" className="inline-flex items-center gap-2 font-semibold text-emerald-700 hover:text-emerald-800">
          <ArrowLeft size={17} /> Set up a wallet policy
        </Link>
      </main>
    );
  }
  if (!job) return <LoadingState message={error || "Loading live scenario results…"} />;

  const finishedScenarios = job.scenarios.filter((scenario) => scenario.status === "completed").length;
  const running = job.status === "running" || job.status === "awaiting_customer";

  return (
    <main className="min-h-screen bg-[#f7f9f7] px-5 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/wallet" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft size={17} /> Wallet policy
        </Link>

        <header className="mt-8 flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">Live Leash results</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">All scenario classifications</h1>
            <p className="mt-2 text-slate-500">
              {job.job_id} · {finishedScenarios}/{job.scenarios.length} scenarios complete
            </p>
          </div>
          <JobStatus status={job.status} />
        </header>

        {error && (
          <p role="alert" className="mt-6 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle size={17} /> {error}
          </p>
        )}
        {job.error && (
          <p role="alert" className="mt-6 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle size={17} /> {job.error}
          </p>
        )}

        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard label="Classified" value={job.summary.total} />
          <SummaryCard label="Approved" value={job.summary.approve} tone="emerald" />
          <SummaryCard label="Declined" value={job.summary.decline} tone="red" />
          <SummaryCard label="Step-ups" value={job.summary.step_up} tone="amber" />
          <SummaryCard label="Needs your answer" value={job.summary.awaiting_customer} tone="amber" />
        </section>

        {running && (
          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            <LoaderCircle size={18} className="animate-spin" />
            Results update automatically while the worker polls Leash. You can resolve step-ups without stopping the worker.
          </div>
        )}

        <div className="mt-8 space-y-6">
          {job.scenarios.map((scenario) => (
            <section key={scenario.scenario_id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{scenario.scenario_id}</p>
                  <h2 className="mt-1 text-lg font-bold">{scenario.scenario_name}</h2>
                </div>
                <div className="text-right text-sm text-slate-500">
                  <p className="font-semibold capitalize text-slate-700">{scenario.status.replaceAll("_", " ")}</p>
                  <p>{scenario.results.length}/{scenario.event_count} classifications</p>
                </div>
              </header>

              {scenario.results.length === 0 ? (
                <p className="px-6 py-8 text-sm text-slate-500">
                  {scenario.status === "queued" ? "Waiting for the previous scenario to finish." : "Waiting for the first authorization."}
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {scenario.results
                    .toSorted((left, right) => (left.purchase.replay_order ?? 0) - (right.purchase.replay_order ?? 0))
                    .map((result) => (
                      <AuthorizationCard
                        key={result.authorization_id}
                        result={result}
                        resolving={resolvingId === result.authorization_id}
                        onResolve={(decision) => resolve(result, decision)}
                      />
                    ))}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

function AuthorizationCard({
  result,
  resolving,
  onResolve,
}: {
  result: ScenarioAuthorizationResult;
  resolving: boolean;
  onResolve: (decision: "approve" | "decline") => void;
}) {
  const displayedDecision = result.final_decision ?? result.engine_decision;
  const style = decisionStyle[displayedDecision];
  const Icon = style.Icon;

  return (
    <article className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-slate-900">
            #{result.purchase.replay_order ?? "–"} {result.purchase.description || "Purchase authorization"}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {result.purchase.merchant_name || "Unknown merchant"} · {formatMoney(result.purchase.amount, result.purchase.currency)} · {result.source_authorization_id || result.authorization_id}
          </p>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold ${style.tone}`}>
          <Icon size={17} /> {style.label}
        </span>
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-700">{result.customer_message}</p>

      {result.evidence.length > 0 && (
        <details className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <summary className="cursor-pointer font-semibold">Decision evidence ({result.evidence.length})</summary>
          <ul className="mt-3 space-y-2">
            {result.evidence.map((item, index) => (
              <li key={`${item.field}-${index}`} className={item.status === "fail" ? "text-red-700" : ""}>
                {item.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {result.engine_decision === "step_up" && !result.is_final && (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 font-bold text-amber-900">
            <Clock3 size={18} /> Customer decision required
          </div>
          <p className="mt-1 text-sm text-amber-900/80">
            This purchase is paused{result.human_deadline_at ? ` until ${new Date(result.human_deadline_at).toLocaleTimeString()}` : ""}.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={resolving}
              onClick={() => onResolve("approve")}
              className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              Approve purchase
            </button>
            <button
              type="button"
              disabled={resolving}
              onClick={() => onResolve("decline")}
              className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
            >
              Decline purchase
            </button>
          </div>
        </div>
      )}

      {result.engine_decision === "step_up" && result.is_final && result.final_decision && (
        <p className="mt-4 text-sm font-medium text-slate-600">
          Automated classification: Customer review · Final customer decision: {result.final_decision}
        </p>
      )}
      {result.engine_decision === "step_up" && result.is_final && !result.final_decision && (
        <p className="mt-4 text-sm font-medium text-amber-700">
          The customer-review window ended without a final approve or decline response ({result.status ?? "closed"}).
        </p>
      )}
    </article>
  );
}

function JobStatus({ status }: { status: ScenarioJobResponse["status"] }) {
  const labels = {
    awaiting_confirmation: "Awaiting confirmation",
    running: "Running",
    awaiting_customer: "Waiting for customer",
    completed: "Completed",
    failed: "Failed",
  };
  const tone = status === "completed"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status === "failed"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-blue-200 bg-blue-50 text-blue-700";
  return <span className={`rounded-xl border px-4 py-3 text-sm font-bold ${tone}`}>{labels[status]}</span>;
}

function SummaryCard({ label, value, tone = "slate" }: { label: string; value: number; tone?: "slate" | "emerald" | "red" | "amber" }) {
  const colors = {
    slate: "text-slate-900",
    emerald: "text-emerald-700",
    red: "text-red-700",
    amber: "text-amber-700",
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${colors[tone]}`}>{value}</p>
    </div>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f9f7] text-slate-500">
      <div className="flex items-center gap-3"><LoaderCircle className="animate-spin" size={20} /> {message}</div>
    </main>
  );
}

function formatMoney(amount: number | null, currency: string | null) {
  if (amount === null) return "Amount unavailable";
  return `${currency ?? ""} ${amount.toFixed(2)}`.trim();
}
