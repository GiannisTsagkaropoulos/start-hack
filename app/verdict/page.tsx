"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, ArrowLeft, ChevronDown, LoaderCircle } from "lucide-react";
import {
  LeashHardRule,
  ScenarioAuthorizationResult,
  ScenarioJobResponse,
  VERDICT_STORAGE_KEY,
  readErrorMessage,
} from "@/lib/viseca-control-layer";
import { takeAuthorityFlipState } from "@/lib/presentation/transitionBus";
import { loadFlip } from "@/lib/presentation/flip";
import AuthorityObject from "@/components/authority/AuthorityObject";
import { AuthorityRule } from "@/components/authority/AuthorityChip";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function hardRulesToAuthorityRules(rules: LeashHardRule[]): AuthorityRule[] {
  return rules.map((rule, i) => ({
    id: `${rule.field}-${i}`,
    label: rule.field.split(".").pop()?.replaceAll("_", " ") ?? rule.field,
    value: `${rule.operator} ${Array.isArray(rule.value) ? rule.value.join(", ") : rule.value}${rule.currency ? " " + rule.currency : ""}`,
  }));
}

export default function VerdictPage() {
  const reduceMotion = !!useReducedMotion();
  const [jobId, setJobId] = useState<string | null | undefined>(undefined);
  const [job, setJob] = useState<ScenarioJobResponse | null>(null);
  const [error, setError] = useState("");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showLedger, setShowLedger] = useState(false);
  const authorityRef = useRef<HTMLDivElement>(null);
  const flipApplied = useRef(false);

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

  // Signature moment 3, receiving end: if the wallet page left a captured
  // geometry behind, render the authority object at this new position/size
  // then let GSAP Flip animate FROM the old box - the same object arriving,
  // not a new one appearing.
  useEffect(() => {
    if (flipApplied.current || reduceMotion || !job || !authorityRef.current) return;
    const state = takeAuthorityFlipState();
    if (!state) return;
    flipApplied.current = true;
    (async () => {
      const Flip = await loadFlip();
      Flip.from(state, { targets: authorityRef.current, duration: 0.9, ease: "power3.inOut", scale: true });
    })();
  }, [job, reduceMotion]);

  async function resolve(result: ScenarioAuthorizationResult, decision: "approve" | "decline") {
    if (!jobId) return;
    setResolvingId(result.authorization_id);
    setError("");
    try {
      const response = await fetch(`${API_URL}/leash/jobs/${jobId}/authorizations/${result.authorization_id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Could not resolve the purchase."));
      setJob((await response.json()) as ScenarioJobResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not resolve the purchase.");
    } finally {
      setResolvingId(null);
    }
  }

  if (jobId === undefined) return <CenteredState message="Loading live authority…" />;
  if (!jobId) {
    return (
      <CenteredState message="No authority is attached to this browser session.">
        <Link href="/wallet" className="text-sm font-semibold text-authority hover:text-authority-strong">
          <ArrowLeft className="mr-1 inline" size={15} /> Set up a wallet policy
        </Link>
      </CenteredState>
    );
  }
  if (!job) return <CenteredState message={error || "Loading live authority…"} />;

  const allResults = job.scenarios.flatMap((s) => s.results.map((r) => ({ ...r, scenario: s })));
  const pendingHuman = allResults.filter((r) => r.engine_decision === "step_up" && !r.is_final);
  const settled = allResults.filter((r) => !(r.engine_decision === "step_up" && !r.is_final)).toReversed();
  const running = job.status === "running" || job.status === "awaiting_customer";
  const rules = hardRulesToAuthorityRules(job.draft.hard_rules);

  return (
    <main className="relative min-h-screen px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between">
          <Link href="/wallet" className="text-[13px] font-medium text-ink-2 hover:text-ink-0">
            <ArrowLeft className="mr-1 inline" size={14} /> Wallet
          </Link>
          {running && (
            <span className="flex items-center gap-2 text-[12px] text-ink-3">
              <LoaderCircle size={13} className="animate-spin text-authority" /> watching live
            </span>
          )}
        </div>

        <div ref={authorityRef} className="mt-5">
          <AuthorityObject rules={rules} sealed compact headline="Spending authority" flipId="authority-object" />
        </div>

        {job.status === "failed" && <FailureBanner message={job.error} />}
        {error && job.status !== "failed" && (
          <p role="alert" className="mt-4 flex items-center gap-2 rounded-xl border border-decline/30 bg-decline-dim px-4 py-3 text-sm text-decline">
            <AlertTriangle size={15} /> {error}
          </p>
        )}

        {/* Signature moment 4: uncertainty suspends time. Pending human
            decisions render above everything else, at full salience; the
            rest of the stream below is intentionally quieter while one is
            open. */}
        <AnimatePresence>
          {pendingHuman.map((result) => (
            <HumanApertureCard key={result.authorization_id} result={result} resolving={resolvingId === result.authorization_id} onResolve={(d) => resolve(result, d)} />
          ))}
        </AnimatePresence>

        <div className={`mt-6 space-y-2 transition-[filter,opacity] duration-500 ${pendingHuman.length > 0 ? "opacity-70 blur-[1px]" : ""}`}>
          <AnimatePresence initial={false}>
            {settled.map((result) => (
              <TransactionMoment
                key={result.authorization_id}
                result={result}
                expanded={expandedId === result.authorization_id}
                onToggle={() => setExpandedId((c) => (c === result.authorization_id ? null : result.authorization_id))}
                reduceMotion={reduceMotion}
              />
            ))}
          </AnimatePresence>
          {settled.length === 0 && pendingHuman.length === 0 && (
            <p className="rounded-2xl border border-border-hairline bg-white/[0.02] px-5 py-8 text-center text-[13px] text-ink-3">
              Your agent hasn&rsquo;t attempted a purchase yet.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowLedger((v) => !v)}
          className="mt-8 flex w-full items-center justify-between rounded-xl border border-border-hairline bg-white/[0.02] px-4 py-3 text-left text-[13px] font-medium text-ink-2 hover:bg-white/[0.05]"
        >
          <span>View activity ledger ({allResults.length})</span>
          <motion.span animate={{ rotate: showLedger ? 180 : 0 }}><ChevronDown size={15} /></motion.span>
        </button>

        <AnimatePresence initial={false}>
          {showLedger && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
              <ActivityLedger job={job} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}

/* -------------------------- transaction physics -------------------------- */

const decisionTone = { approve: "text-authority-strong", decline: "text-decline", step_up: "text-review" } as const;

function TransactionMoment({
  result,
  expanded,
  onToggle,
  reduceMotion,
}: {
  result: ScenarioAuthorizationResult;
  expanded: boolean;
  onToggle: () => void;
  reduceMotion: boolean;
}) {
  const displayed = result.final_decision ?? result.engine_decision;
  const tone = decisionTone[displayed];
  const untrusted = result.purchase.description;

  const entrance = reduceMotion
    ? { initial: { opacity: 1 }, animate: { opacity: 1 } }
    : displayed === "decline"
      ? { initial: { x: -24, opacity: 0 }, animate: { x: [-24, 6, 0], opacity: 1 }, transition: { duration: 0.55, ease: "easeOut" as const } }
      : { initial: { x: -24, opacity: 0 }, animate: { x: 0, opacity: 1 }, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } };

  return (
    <motion.div
      layout
      initial={entrance.initial}
      animate={entrance.animate}
      exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98 }}
      transition={"transition" in entrance ? entrance.transition : { duration: 0.3 }}
      className="overflow-hidden rounded-2xl border border-border-hairline bg-white/[0.02]"
    >
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.03]">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${displayed === "approve" ? "bg-authority-strong" : displayed === "decline" ? "bg-decline" : "bg-review"}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-ink-0">{result.purchase.merchant_name || "Unknown merchant"}</p>
          <p className="truncate text-[11.5px] text-ink-3">{result.source_authorization_id || result.authorization_id}</p>
        </div>
        <p className="shrink-0 font-mono text-[14px] tabular-nums text-ink-0">{formatMoney(result.purchase.amount, result.purchase.currency)}</p>
        <span className={`hidden shrink-0 text-[11.5px] font-semibold uppercase tracking-wide sm:inline ${tone}`}>{displayed}</span>
        <ChevronDown size={14} className="shrink-0 text-ink-3" style={{ transform: expanded ? "rotate(180deg)" : undefined, transition: "transform 0.2s" }} />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
            <div className="space-y-3 px-4 pb-4 pl-7">
              {untrusted && (
                <p className="rounded-lg border border-dashed border-white/15 bg-white/[0.04] px-3 py-2 text-[12px] italic leading-5 text-ink-1">
                  <span className="mr-1.5 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold not-italic uppercase tracking-wide text-ink-2">
                    Evidence, not authority
                  </span>
                  {untrusted}
                </p>
              )}
              <p className="text-[13px] leading-6 text-ink-1">{result.customer_message}</p>
              {result.evidence.length > 0 && (
                <div className="space-y-1 rounded-lg bg-white/[0.02] p-2.5">
                  {result.evidence.map((item, i) => (
                    <div key={`${item.field}-${i}`} className="flex items-start justify-between gap-3 text-[12px]">
                      <span className={item.status === "fail" ? "text-decline" : item.status === "unknown" ? "text-review" : "text-ink-2"}>{item.message}</span>
                      <span className="shrink-0 font-mono text-[10px] uppercase text-ink-3">{item.status}</span>
                    </div>
                  ))}
                </div>
              )}
              {result.engine_decision === "step_up" && result.is_final && result.final_decision && (
                <p className="text-[12px] text-ink-3">Needed your approval → you answered <span className="font-semibold text-ink-1">{result.final_decision}</span></p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function HumanApertureCard({
  result,
  resolving,
  onResolve,
}: {
  result: ScenarioAuthorizationResult;
  resolving: boolean;
  onResolve: (decision: "approve" | "decline") => void;
}) {
  const [aperture, setAperture] = useState<"closed" | "open">("closed");

  const handle = (decision: "approve" | "decline") => {
    if (decision === "approve") setAperture("open");
    onResolve(decision);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="relative mt-5 overflow-hidden rounded-2xl border border-review/30 bg-review-dim p-5"
    >
      <motion.div
        className="pointer-events-none absolute inset-0 rounded-full border border-review/40"
        style={{ margin: "auto" }}
        animate={aperture === "open" ? { scale: 30, opacity: 0 } : { scale: 1, opacity: 0.5 }}
        transition={{ duration: 0.6, ease: "easeIn" }}
      />
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-review">Needs your attention</p>
      <p className="mt-1 text-[17px] font-semibold text-ink-0">
        {result.purchase.merchant_name || "Unknown merchant"} · {formatMoney(result.purchase.amount, result.purchase.currency)}
      </p>
      <p className="mt-2 text-[13px] leading-6 text-ink-1">{result.customer_message}</p>
      {result.human_deadline_at && (
        <p className="mt-1 text-[11.5px] text-ink-3">Answer before {new Date(result.human_deadline_at).toLocaleTimeString()}.</p>
      )}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={resolving}
          onClick={() => handle("approve")}
          className="flex-1 rounded-xl bg-authority px-4 py-3 text-[13.5px] font-semibold text-[#04140d] transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {resolving ? "Submitting…" : "Approve"}
        </button>
        <button
          type="button"
          disabled={resolving}
          onClick={() => handle("decline")}
          className="flex-1 rounded-xl border border-decline/40 bg-transparent px-4 py-3 text-[13.5px] font-semibold text-decline transition-colors hover:bg-decline-dim disabled:opacity-40"
        >
          Decline
        </button>
      </div>
    </motion.div>
  );
}

function ActivityLedger({ job }: { job: ScenarioJobResponse }) {
  return (
    <div className="mt-3 space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <Stat label="Total" value={job.summary.total} />
        <Stat label="Approved" value={job.summary.approve} tone="text-authority-strong" />
        <Stat label="Declined" value={job.summary.decline} tone="text-decline" />
        <Stat label="Step-ups" value={job.summary.step_up} tone="text-review" />
        <Stat label="Awaiting you" value={job.summary.awaiting_customer} tone="text-review" />
      </div>
      {job.scenarios.map((scenario) => (
        <div key={scenario.scenario_id} className="overflow-hidden rounded-xl border border-border-hairline bg-white/[0.02]">
          <div className="flex items-center justify-between border-b border-border-hairline px-4 py-3">
            <p className="font-mono text-[11px] uppercase tracking-wide text-ink-2">{scenario.scenario_id} · {scenario.scenario_name}</p>
            <p className="text-[11px] tabular-nums text-ink-2">{scenario.results.length}/{scenario.event_count}</p>
          </div>
          {scenario.results.length === 0 ? (
            <p className="px-4 py-3 text-[12px] text-ink-3">No authorizations yet.</p>
          ) : (
            scenario.results
              .toSorted((a, b) => (a.purchase.replay_order ?? 0) - (b.purchase.replay_order ?? 0))
              .map((r) => {
                const d = r.final_decision ?? r.engine_decision;
                const tone = d === "approve" ? "text-authority-strong" : d === "decline" ? "text-decline" : "text-review";
                return (
                  <div key={r.authorization_id} className="flex items-center gap-3 border-b border-border-hairline/60 px-4 py-2.5 last:border-b-0">
                    <span className="w-7 shrink-0 font-mono text-[10.5px] text-ink-3">#{r.purchase.replay_order ?? "–"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] text-ink-0">{r.purchase.merchant_name || "Unknown merchant"}</p>
                      <p className="truncate text-[11px] text-ink-3">{r.purchase.description || r.source_authorization_id || r.authorization_id}</p>
                    </div>
                    <span className="shrink-0 font-mono text-[12.5px] tabular-nums text-ink-0">{formatMoney(r.purchase.amount, r.purchase.currency)}</span>
                    <span className={`w-16 shrink-0 text-right text-[10.5px] font-semibold uppercase tracking-wide ${tone}`}>{d}</span>
                  </div>
                );
              })
          )}
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, tone = "text-ink-0" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-border-hairline bg-white/[0.02] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

function FailureBanner({ message }: { message: string | null }) {
  return (
    <div className="mt-4 rounded-2xl border border-decline/30 bg-decline-dim p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={17} className="mt-0.5 shrink-0 text-decline" />
        <div>
          <p className="text-[13px] font-semibold text-decline">This run stopped early</p>
          <p className="mt-1 text-[12px] leading-5 text-decline/90">
            {message || "The worker received an authorization for a run it wasn't tracking, most likely because another run was active on the same team key at the same time. No purchase evidence was fabricated — the run simply halted rather than guess."}
          </p>
        </div>
      </div>
    </div>
  );
}

function CenteredState({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-5 text-center text-ink-2">
      <div className="flex items-center gap-3 text-[14px]"><LoaderCircle className="animate-spin" size={17} /> {message}</div>
      {children}
    </main>
  );
}

function formatMoney(amount: number | null, currency: string | null) {
  if (amount === null) return "—";
  return `${currency ?? ""} ${amount.toFixed(2)}`.trim();
}
