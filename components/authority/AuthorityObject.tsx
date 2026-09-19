"use client";

/**
 * The iconic object of this product: the customer's spending authority made
 * physical. Two material states:
 *
 * - draft: soft, dashed, slightly restless boundary - still editable, still
 *   fluid. Chips can reorder/appear as the customer edits the review step.
 * - sealed: fired ONLY after the real backend confirms the mandate. The
 *   boundary draws itself closed via an SVG stroke animation (actual path
 *   length measured at runtime, not a guessed constant), chips lock into a
 *   tight grid with a small settle-bounce, and a light sweep converges
 *   through the object once. This choreography never starts before the real
 *   `sealed` prop flips true - motion always follows truth, never precedes
 *   it.
 *
 * This same component is reused, unchanged, as the persistent "authority"
 * chip carried (via GSAP Flip, see transitionBus.ts) from /wallet into the
 * compact header of /verdict, which is what gives the illusion of one
 * physical object moving through the product rather than a new one being
 * built on each screen.
 */
import { useEffect, useRef } from "react";
import { AuthorityChip, AuthorityRule } from "./AuthorityChip";

export default function AuthorityObject({
  rules,
  sealed,
  compact = false,
  flipId,
  headline,
}: {
  rules: AuthorityRule[];
  sealed: boolean;
  compact?: boolean;
  flipId?: string;
  headline?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<SVGRectElement>(null);
  const lightRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const wasSealed = useRef(sealed);

  useEffect(() => {
    const justSealed = sealed && !wasSealed.current;
    wasSealed.current = sealed;
    if (!justSealed) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cancelled = false;
    (async () => {
      const { gsap } = await import("gsap");
      if (cancelled) return;

      const tl = gsap.timeline();
      const chips = chipsRef.current ? Array.from(chipsRef.current.children) : [];
      if (chips.length) {
        tl.fromTo(
          chips,
          { scale: 0.96 },
          { scale: 1, duration: 0.35, ease: "back.out(2.4)", stagger: 0.05 },
          0,
        );
      }
      if (rectRef.current) {
        const length = rectRef.current.getTotalLength();
        gsap.set(rectRef.current, { strokeDasharray: length, strokeDashoffset: length, opacity: 1 });
        tl.to(rectRef.current, { strokeDashoffset: 0, duration: 0.75, ease: "power2.inOut" }, 0.1);
      }
      if (lightRef.current) {
        tl.fromTo(
          lightRef.current,
          { opacity: 0, scale: 1.5 },
          { opacity: 1, scale: 1, duration: 0.6, ease: "power2.out" },
          0.15,
        ).to(lightRef.current, { opacity: 0, duration: 0.6, ease: "power2.in" }, 0.75);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sealed]);

  return (
    <div
      ref={rootRef}
      data-flip-id={flipId}
      className={`relative overflow-hidden rounded-[28px] transition-[padding] duration-500 ${
        compact ? "p-4" : "p-6 sm:p-7"
      }`}
      style={{
        background: sealed
          ? "linear-gradient(180deg, rgba(61,220,151,0.07), rgba(11,13,18,0.6))"
          : "rgba(255,255,255,0.03)",
        backdropFilter: "blur(20px)",
      }}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        <rect
          ref={rectRef}
          x="1"
          y="1"
          width="calc(100% - 2px)"
          height="calc(100% - 2px)"
          rx="27"
          fill="none"
          stroke="var(--authority-line)"
          strokeWidth="1.5"
          opacity={sealed ? 1 : 0}
        />
      </svg>
      {!sealed && (
        <div
          className="pointer-events-none absolute inset-0 rounded-[28px] border border-dashed"
          style={{ borderColor: "var(--border-hairline-strong)" }}
        />
      )}
      <div
        ref={lightRef}
        className="pointer-events-none absolute inset-0 opacity-0"
        style={{
          background: "radial-gradient(60% 60% at 50% 40%, rgba(61,220,151,0.35), transparent 70%)",
        }}
      />

      <div className="relative">
        {headline && !compact && (
          <div className="mb-4 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-3">{headline}</p>
            <StatusPill sealed={sealed} />
          </div>
        )}
        <div ref={chipsRef} className={compact ? "flex flex-wrap gap-2" : "grid gap-2 sm:grid-cols-2"}>
          {compact
            ? rules.map((rule) => (
                <span
                  key={rule.id}
                  className="rounded-full border border-authority-line/30 bg-authority-dim px-3 py-1 font-mono text-[11px] font-semibold text-authority-strong"
                >
                  {rule.label} · {rule.value}
                </span>
              ))
            : rules.map((rule) => <AuthorityChip key={rule.id} rule={rule} sealed={sealed} flipId={`chip-${rule.id}`} />)}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ sealed }: { sealed: boolean }) {
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
        sealed ? "bg-authority-dim text-authority-strong" : "bg-white/5 text-ink-2"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${sealed ? "bg-authority-strong" : "bg-ink-3"}`} />
      {sealed ? "Active" : "Draft"}
    </span>
  );
}
