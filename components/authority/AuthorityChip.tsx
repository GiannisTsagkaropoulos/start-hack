export type AuthorityRule = {
  id: string;
  label: string;
  value: string;
};

export function AuthorityChip({
  rule,
  sealed,
  flipId,
}: {
  rule: AuthorityRule;
  sealed: boolean;
  flipId?: string;
}) {
  return (
    <div
      data-flip-id={flipId}
      className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 transition-colors duration-500 ${
        sealed
          ? "border-authority-line/40 bg-authority-dim"
          : "border-border-hairline bg-white/[0.03]"
      }`}
    >
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">{rule.label}</span>
      <span className={`font-mono text-[13px] font-semibold ${sealed ? "text-authority-strong" : "text-ink-1"}`}>
        {rule.value}
      </span>
    </div>
  );
}
