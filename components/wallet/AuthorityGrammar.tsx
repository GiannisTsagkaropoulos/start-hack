"use client";

/**
 * Shared visual grammar for the trust boundary. Four containment styles,
 * never color alone, so the difference reads even in a screenshot.
 *
 *  - Authority   : what the human confirmed. Solid ink fill, no border needed.
 *  - Interpreted : what the system extracted from their words. Outlined, editable.
 *  - External    : merchant / agent-attempt content. Dashed, always labeled
 *                  "not your authority," never allowed to look confirmed.
 *  - Evidence    : the decision trace. Monospace, evidence over adjectives.
 */

export function AuthorityBlock({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-ink-900 text-white p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-300 mb-2">
        {eyebrow}
      </p>
      {children}
    </div>
  );
}

export function InterpretedBlock({
  eyebrow,
  children,
  className = "",
}: {
  eyebrow: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border-2 border-slate-200 bg-white p-5 ${className}`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 mb-2">
        {eyebrow}
      </p>
      {children}
    </div>
  );
}

export function ExternalBlock({
  eyebrow = "External content — not your authority",
  children,
}: {
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700 mb-2 flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
        {eyebrow}
      </p>
      {children}
    </div>
  );
}

export function EvidenceRow({
  field,
  expected,
  actual,
  status,
}: {
  field: string;
  expected: string;
  actual: string;
  status: "pass" | "fail" | "unknown";
}) {
  const color =
    status === "fail"
      ? "text-red-600"
      : status === "unknown"
        ? "text-amber-600"
        : "text-emerald-600";
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-t border-slate-100 first:border-t-0 font-mono text-[13px]">
      <span className="text-slate-500 truncate">{field}</span>
      <span className="text-slate-400 shrink-0">
        expected {expected} · was <span className={color}>{actual}</span>
      </span>
    </div>
  );
}
