"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
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
  approve: { label: "Approved", tone: "text-authority", dot: "bg-authority", Icon: CheckCircle2 },
  decline: { label: "Declined", tone: "text-decline", dot: "bg-decline", Icon: ShieldAlert },
  step_up: { label: "Needs your approval", tone: "text-review", dot: "bg-review", Icon: HelpCircle },
} as const;

export default function VerdictPage() {
  const reduceMotion = useReducedMotion();
  const [jobId, setJobId] = useState<string | null | undefined>(undefined);
  const [job, setJob] = useState<ScenarioJobResponse | null>(null);
  const [error, setError] = useState("");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
      const value = stored ? (JSON.parse(stored) as { job_id?: unknown }) : null;
      nextJobId = typeof value?.job_id === "string" ? value.job_id : null;
    } catch {}
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

  if (jobId === undefined) return <CenteredState message="Loading live scenario results…" />;
  if (!jobId) {
    return (
      <CenteredState message="No scenario job is attached to this browser session.">
        <Link href="/wallet" className="inline-flex items-center gap-2 text-sm font-semibold text-authority hover:text-authority-strong">
          <ArrowLeft size={16} /> Set up a wallet policy
        </Link>
      </CenteredState>
    );
  }
  if (!job) return <CenteredState message={error || "Loading live scenario results…"} />;

  const finishedScenarios = job.scenarios.filter((s) => s.status === "completed").length;
  const running = job.status === "running" || job.status === "awaiting_customer";

  return (
    <main className="min-h-screen bg-surface-0 px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/wallet" className="inline-flex items-center gap-2 text-sm font-semibold text-ink-3 hover:text-ink-1">
          <ArrowLeft size={16} /> Wallet policy
        </Link>

        <header className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-authority">Live authority in effect</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-ink-1 sm:text-3xl">Every transaction, checked</h1>
            <p className="mt-1.5 font-mono text-[12.5px] text-ink-3">
              {job.job_id} · {finishedScenarios}/{job.scenarios.length} scenarios complete
            </p>
          </div>
          <JobStatusBadge status={job.status} />
        </header>

        {job.status === "failed" && (
          <FailureBanner message={job.error} />
        )}
        {error && job.status !== "failed" && (
          <p role="alert" className="mt-5 flex items-center gap-2 rounded-xl border border-decline-tint-border bg-decline-tint px-4 py-3 text-sm text-decline">
            <AlertTriangle size={16} /> {error}
          </p>
        )}

        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label="Classified" value={job.summary.total} />
          <StatCard label="Approved" value={job.summary.approve} tone="authority" />
          <StatCard label="Declined" value={job.summary.decline} tone="decline" />
          <StatCard label="Step-ups" value={job.summary.step_up} tone="review" />
          <StatCard label="Needs your answer" value={job.summary.awaiting_customer} tone="review" />
        </section>

        {running && (
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-border-subtle bg-surface-1 px-4 py-3 text-[13px] text-ink-2">
            <LoaderCircle size={16} className="animate-spin text-authority" />
            Watching Leash in real time — you can resolve a step-up without stopping the run.
          </div>
        )}

        <div className="mt-7 space-y-5">
          {job.scenarios.map((scenario) => (
            <section key={scenario.scenario_id} className="overflow-hidden rounded-2xl border border-border-subtle bg-surface-1">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
                <div>
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-ink-3">{scenario.scenario_id}</p>
                  <h2 className="mt-0.5 text-[15px] font-semibold text-ink-1">{scenario.scenario_name}</h2>
                </div>
                <div className="text-right text-[12.5px] text-ink-3">
                  <p className="font-semibold capitalize text-ink-2">{scenario.status.replaceAll("_", " ")}</p>
                  <p className="tabular-nums">{scenario.results.length}/{scenario.event_count}</p>
                </div>
              </header>

              {scenario.results.length === 0 ? (
                <p className="px-5 py-8 text-[13px] text-ink-3">
                  {scenario.status === "queued" ? "Waiting for the previous scenario to finish." : "Waiting for the first authorization."}
                </p>
              ) : (
                <div>
                  {scenario.results
                    .toSorted((a, b) => (a.purchase.replay_order ?? 0) - (b.purchase.replay_order ?? 0))
                    .map((result) => (
                      <TransactionRow
                        key={result.authorization_id}
                        result={result}
                        expanded={expandedId === result.authorization_id}
                        onToggle={() =>
                          setExpandedId((current) => (current === result.authorization_id ? null : result.authorization_id))
                        }
                        resolving={resolvingId === result.authorization_id}
                        onResolve={(decision) => resolve(result, decision)}
                        reduceMotion={!!reduceMotion}
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

function TransactionRow({
  result,
  expanded,
  onToggle,
  resolving,
  onResolve,
  reduceMotion,
}: {
  result: ScenarioAuthorizationResult;
  expanded: boolean;
  onToggle: () => void;
  resolving: boolean;
  onResolve: (decision: "approve" | "decline") => void;
  reduceMotion: boolean;
}) {
  const displayedDecision = result.final_decision ?? result.engine_decision;
  const style = decisionStyle[displayedDecision];
  const Icon = style.Icon;
  const needsHuman = result.engine_decision === "step_up" && !result.is_final;

  return (
    <div className="border-b border-border-subtle last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-surface-2/60"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold text-ink-1">
            #{result.purchase.replay_order ?? "–"} {result.purchase.description || "Purchase authorization"}
          </p>
          <p className="truncate text-[12px] text-ink-3">
            {result.purchase.merchant_name || "Unknown merchant"} · {result.source_authorization_id || result.authorization_id}
          </p>
        </div>
        <p className="shrink-0 tabular-nums text-[14px] font-semibold text-ink-1">
          {formatMoney(result.purchase.amount, result.purchase.currency)}
        </p>
        <span className={`hidden shrink-0 items-center gap-1.5 text-[12.5px] font-semibold sm:flex ${style.tone}`}>
          <Icon size={15} /> {style.label}
        </span>
        {needsHuman && (
          <span className="shrink-0 rounded-full bg-review px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            Action needed
          </span>
        )}
        <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }} className="shrink-0 text-ink-3">
          <ChevronDown size={16} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pl-9">
              <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold sm:hidden ${style.tone}`}>
                <Icon size={15} /> {style.label}
              </span>
              <p className="mt-2 text-[13.5px] leading-6 text-ink-2">{result.customer_message}</p>

              {result.evidence.length > 0 && (
                <div className="mt-4 space-y-1.5 rounded-xl bg-surface-2 p-3">
                  <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                    Policy checks ({result.evidence.length})
                  </p>
                  {result.evidence.map((item, index) => (
                    <div
                      key={`${item.field}-${index}`}
                      className="flex items-start justify-between gap-3 rounded-lg bg-surface-1 px-3 py-2 text-[12.5px]"
                    >
                      <span className={item.status === "fail" ? "text-decline" : item.status === "unknown" ? "text-review" : "text-ink-2"}>
                        {item.message}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          item.status === "pass"
                            ? "bg-authority-tint text-authority-strong"
                            : item.status === "fail"
                              ? "bg-decline-tint text-decline"
                              : "bg-review-tint text-review"
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {needsHuman && (
                <div className="mt-4 rounded-xl border border-review-tint-border bg-review-tint p-4">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-review">
                    <Clock3 size={16} /> Paused for your decision
                  </div>
                  <p className="mt-1 text-[12.5px] text-review/90">
                    {result.human_deadline_at
                      ? `Answer before ${new Date(result.human_deadline_at).toLocaleTimeString()}.`
                      : "Awaiting your response."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={resolving}
                      onClick={() => onResolve("approve")}
                      className="flex-1 rounded-lg bg-authority px-4 py-2.5 text-[13px] font-semibold text-white transition-transform hover:bg-authority-strong active:scale-[0.98] disabled:opacity-40 sm:flex-none"
                    >
                      {resolving ? "Submitting…" : "Approve purchase"}
                    </button>
                    <button
                      type="button"
                      disabled={resolving}
                      onClick={() => onResolve("decline")}
                      className="flex-1 rounded-lg border border-decline-tint-border bg-surface-1 px-4 py-2.5 text-[13px] font-semibold text-decline transition-colors hover:bg-decline-tint active:scale-[0.98] disabled:opacity-40 sm:flex-none"
                    >
                      Decline purchase
                    </button>
                  </div>
                </div>
              )}

              {result.engine_decision === "step_up" && result.is_final && result.final_decision && (
                <p className="mt-4 text-[12.5px] font-medium text-ink-3">
                  Automated read: needed your approval · You answered: <span className="font-semibold text-ink-1">{result.final_decision}</span>
                </p>
              )}
              {result.engine_decision === "step_up" && result.is_final && !result.final_decision && (
                <p className="mt-4 text-[12.5px] font-medium text-review">
                  The review window closed without an answer ({result.status ?? "closed"}).
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FailureBanner({ message }: { message: string | null }) {
  return (
    <div className="mt-5 rounded-2xl border border-decline-tint-border bg-decline-tint p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-decline" />
        <div>
          <p className="text-[13.5px] font-semibold text-decline">This run stopped early</p>
          <p className="mt-1 text-[12.5px] leading-5 text-decline/90">
            {message ||
              "The worker received an authorization for a run it wasn't tracking, most likely because another run was active on the same team key at the same time. No purchase evidence was fabricated — the run simply halted rather than guess."}
          </p>
        </div>
      </div>
    </div>
  );
}

function JobStatusBadge({ status }: { status: ScenarioJobResponse["status"] }) {
  const labels: Record<ScenarioJobResponse["status"], string> = {
    awaiting_confirmation: "Awaiting confirmation",
    running: "Running",
    awaiting_customer: "Waiting for you",
    completed: "Completed",
    failed: "Failed",
  };
  const tone =
    status === "completed"
      ? "border-authority-tint-border bg-authority-tint text-authority-strong"
      : status === "failed"
        ? "border-decline-tint-border bg-decline-tint text-decline"
        : "border-border-subtle bg-surface-1 text-ink-2";
  return <span className={`rounded-full border px-3.5 py-2 text-[12.5px] font-semibold ${tone}`}>{labels[status]}</span>;
}

function StatCard({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: number;
  tone?: "ink" | "authority" | "decline" | "review";
}) {
  const colors = {
    ink: "text-ink-1",
    authority: "text-authority",
    decline: "text-decline",
    review: "text-review",
  };
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-1 p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${colors[tone]}`}>{value}</p>
    </div>
  );
}

function CenteredState({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface-0 px-5 text-center text-ink-3">
      <div className="flex items-center gap-3 text-[14px]">
        <LoaderCircle className="animate-spin" size={18} /> {message}
      </div>
      {children}
    </main>
  );
}

function formatMoney(amount: number | null, currency: string | null) {
  if (amount === null) return "—";
  return `${currency ?? ""} ${amount.toFixed(2)}`.trim();
}
