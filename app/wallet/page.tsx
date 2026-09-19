"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertCircle, ArrowRight, ChevronDown, ShieldCheck } from "lucide-react";
import {
  ParsePolicyResponse,
  ParsedPolicyDraft,
  ProductCategory,
  ScenarioJobResponse,
  VERDICT_STORAGE_KEY,
  WalletPolicy,
  readErrorMessage,
} from "@/lib/viseca-control-layer";
import { extractLanguageFragments, LanguageFragment } from "@/lib/presentation/extractFragments";
import { setAuthorityFlipState } from "@/lib/presentation/transitionBus";
import { loadFlip } from "@/lib/presentation/flip";
import AuthorityObject from "@/components/authority/AuthorityObject";
import { AuthorityRule } from "@/components/authority/AuthorityChip";

function toWalletPolicy(draft: ParsedPolicyDraft): WalletPolicy {
  return {
    raw_instructions: draft.raw_instructions,
    products: { allowed_categories: draft.products.allowed_categories ?? [] },
    spending: {
      per_item_purchase_price_max: draft.spending.per_item_purchase_price_max as number,
      per_period_purchase_price_max: draft.spending.per_period_purchase_price_max,
      currency: draft.spending.currency as WalletPolicy["spending"]["currency"],
      period_in_days: draft.spending.period_in_days,
    },
    merchant: { blocklist: draft.merchant.blocklist ?? [], allowlist: draft.merchant.allowlist ?? [] },
    order_terms: {
      require_returnable: draft.order_terms.require_returnable,
      require_cancellable: draft.order_terms.require_cancellable,
    },
    session: {
      max_recent_attempts_10m: draft.session.max_recent_attempts_10m,
      trusted_devices_only: draft.session.trusted_devices_only as boolean,
      domestic_only: draft.session.domestic_only,
    },
    duplicate_check: { block_repeats_within_minutes: draft.duplicate_check?.block_repeats_within_minutes ?? null },
    notes_for_customer: draft.notes_for_customer ?? "",
  };
}

function draftToRules(draft: ParsedPolicyDraft): AuthorityRule[] {
  const rules: AuthorityRule[] = [];
  if (draft.products?.allowed_categories?.length) {
    rules.push({ id: "categories", label: "Allowed for", value: draft.products.allowed_categories.join(", ") });
  }
  if (draft.spending?.per_item_purchase_price_max != null) {
    rules.push({
      id: "amount",
      label: "Maximum per item",
      value: `${draft.spending.currency ?? ""} ${draft.spending.per_item_purchase_price_max}`.trim(),
    });
  }
  if (draft.spending?.per_period_purchase_price_max != null) {
    rules.push({
      id: "period-amount",
      label: `Per ${draft.spending.period_in_days ?? "period"} days`,
      value: `${draft.spending.currency ?? ""} ${draft.spending.per_period_purchase_price_max}`.trim(),
    });
  }
  if (draft.order_terms?.require_returnable) rules.push({ id: "returnable", label: "Order", value: "Must be returnable" });
  if (draft.order_terms?.require_cancellable) rules.push({ id: "cancellable", label: "Order", value: "Must be cancellable" });
  if (draft.session?.trusted_devices_only) rules.push({ id: "trusted-device", label: "Session", value: "Trusted devices only" });
  if (draft.session?.domestic_only) rules.push({ id: "domestic", label: "Session", value: "Domestic only" });
  if (draft.session?.max_recent_attempts_10m != null) {
    rules.push({ id: "attempts", label: "Recent attempts (10m)", value: `≤ ${draft.session.max_recent_attempts_10m}` });
  }
  if (draft.duplicate_check?.block_repeats_within_minutes != null) {
    rules.push({ id: "duplicate", label: "Duplicate window", value: `${draft.duplicate_check.block_repeats_within_minutes} min` });
  }
  return rules;
}

type Step = "describe" | "decomposing" | "review" | "confirm";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WALLET_ID = 0;

const PRODUCT_CATEGORIES: { label: string; value: ProductCategory }[] = [
  { label: "Books", value: "books" }, { label: "Clothing", value: "clothing" },
  { label: "Cosmetics", value: "cosmetics" }, { label: "Dining", value: "dining" },
  { label: "Electronics", value: "electronics" }, { label: "Food delivery", value: "food_delivery" },
  { label: "Fuel", value: "fuel" }, { label: "Gift cards", value: "gift_card" },
  { label: "Groceries", value: "groceries" }, { label: "Home improvement", value: "home_improvement" },
  { label: "Hotel", value: "hotel" }, { label: "Household", value: "household" },
  { label: "Membership", value: "membership" }, { label: "Sporting goods", value: "sporting_goods" },
  { label: "Subscriptions", value: "subscriptions" }, { label: "Transport", value: "transport" },
];

const requiredConfirmationFields = [
  "products.allowed_categories", "spending.per_item_purchase_price_max", "spending.currency",
  "order_terms.require_returnable", "session.trusted_devices_only", "session.domestic_only",
] as const;

const DEFAULT_POLICY: ParsedPolicyDraft = {
  raw_instructions: "",
  products: { allowed_categories: null },
  spending: { per_item_purchase_price_max: null, per_period_purchase_price_max: null, currency: null, period_in_days: null },
  merchant: { blocklist: [], allowlist: [] },
  order_terms: { require_returnable: null, require_cancellable: null },
  session: { max_recent_attempts_10m: null, trusted_devices_only: true, domestic_only: null },
  duplicate_check: { block_repeats_within_minutes: null },
  notes_for_customer: "",
};

export default function WalletPage() {
  const router = useRouter();
  const reduceMotion = !!useReducedMotion();
  const [step, setStep] = useState<Step>("describe");
  const [policyText, setPolicyText] = useState("");
  const [draftPolicy, setDraftPolicy] = useState<ParsedPolicyDraft>(DEFAULT_POLICY);
  const [fragments, setFragments] = useState<LanguageFragment[]>([]);
  const [preparedJob, setPreparedJob] = useState<ScenarioJobResponse | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [sealed, setSealed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const authorityRootRef = useRef<HTMLDivElement>(null);

  const rules = useMemo(() => draftToRules(draftPolicy), [draftPolicy]);

  const updatePolicyValue = (path: string, value: unknown) => {
    const keys = path.split(".");
    setDraftPolicy((prev) => {
      const updated = structuredClone(prev) as unknown as Record<string, unknown>;
      let current = updated;
      for (let i = 0; i < keys.length - 1; i++) {
        const next = current[keys[i]];
        if (typeof next !== "object" || next === null || Array.isArray(next)) current[keys[i]] = {};
        current = current[keys[i]] as Record<string, unknown>;
      }
      current[keys[keys.length - 1]] = value;
      return updated as unknown as ParsedPolicyDraft;
    });
  };

  const isUnknown = (path: string) => {
    const value = path.split(".").reduce<unknown>((cur, key) => {
      if (typeof cur !== "object" || cur === null) return undefined;
      return (cur as Record<string, unknown>)[key];
    }, draftPolicy);
    return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
  };

  const missingRequiredFields = requiredConfirmationFields.filter(isUnknown);

  const submitPolicy = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!policyText.trim()) return;
    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/parse-policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_id: WALLET_ID, policy_text: policyText.trim() }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to parse the policy."));
      const data = (await res.json()) as ParsePolicyResponse;
      setDraftPolicy(data.policy);
      setFragments(extractLanguageFragments(data.policy.raw_instructions, data.policy));
      setStep("decomposing");
      if (!reduceMotion) {
        setTimeout(() => setStep("review"), 1100);
      } else {
        setStep("review");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error parsing policy.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const prepareMandate = async () => {
    if (missingRequiredFields.length > 0) {
      setShowDetails(true);
      setError("A few required details still need an answer below.");
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      const policy = toWalletPolicy(draftPolicy);
      const prepareRes = await fetch(`${API_URL}/leash/mandates/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_id: WALLET_ID, policy }),
      });
      if (!prepareRes.ok) throw new Error(await readErrorMessage(prepareRes, "The Leash mandate draft could not be created."));
      const job = (await prepareRes.json()) as ScenarioJobResponse;
      setPreparedJob(job);
      setStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mandate preparation failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const grantAuthority = async () => {
    if (!preparedJob) return;
    setIsSubmitting(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/leash/jobs/${preparedJob.job_id}/confirm`, { method: "POST" });
      if (!response.ok) throw new Error(await readErrorMessage(response, "The mandate could not be confirmed or started."));
      const job = (await response.json()) as ScenarioJobResponse;
      setSealed(true);

      // Signature moment 3: capture this authority object's current
      // geometry right before navigating, so /verdict can pick it up and
      // animate FROM this exact box into its own header position - the
      // same physical object, not a new one appearing.
      if (!reduceMotion && authorityRootRef.current) {
        const Flip = await loadFlip();
        setAuthorityFlipState(Flip.getState(authorityRootRef.current));
      }

      sessionStorage.setItem(VERDICT_STORAGE_KEY, JSON.stringify({ job_id: job.job_id }));
      setTimeout(() => router.push("/verdict"), reduceMotion ? 0 : 1300);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the scenario run.");
      setSealed(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 py-8 sm:px-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-[13px] font-medium tracking-wide text-ink-2 hover:text-ink-0">
            Wallet Authority
          </Link>
          <div className="flex gap-1.5">
            {(["describe", "review", "confirm"] as const).map((s) => {
              const order = { describe: 0, decomposing: 0, review: 1, confirm: 2 }[step];
              const active = { describe: 0, review: 1, confirm: 2 }[s] <= order;
              return <span key={s} className={`h-1 w-6 rounded-full transition-colors duration-700 ${active ? "bg-authority" : "bg-white/10"}`} />;
            })}
          </div>
        </header>

        <section className="flex-1 py-10">
          <AnimatePresence mode="wait">
            {step === "describe" && (
              <IntentStep
                key="describe"
                policyText={policyText}
                setPolicyText={setPolicyText}
                onSubmit={submitPolicy}
                isSubmitting={isSubmitting}
                error={error}
              />
            )}

            {step === "decomposing" && (
              <DecomposingStep key="decomposing" raw={draftPolicy.raw_instructions} fragments={fragments} />
            )}

            {(step === "review" || step === "confirm") && (
              <motion.div key="authority" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-authority">
                  {step === "review" ? "We understood you" : `Draft ${preparedJob?.draft.draft_id}`}
                </p>

                <div ref={authorityRootRef}>
                  <AuthorityObject rules={rules} sealed={sealed} headline="Spending authority" flipId="authority-object" />
                </div>

                {step === "review" && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowDetails((v) => !v)}
                      className="mt-4 flex w-full items-center justify-between rounded-xl border border-border-hairline bg-white/[0.02] px-4 py-3 text-left text-[13px] font-medium text-ink-2 transition-colors hover:bg-white/[0.05]"
                    >
                      <span>
                        {missingRequiredFields.length > 0
                          ? `${missingRequiredFields.length} detail${missingRequiredFields.length > 1 ? "s" : ""} not specified`
                          : "Edit the details"}
                        {" ›"}
                      </span>
                      <motion.span animate={{ rotate: showDetails ? 180 : 0 }}>
                        <ChevronDown size={15} />
                      </motion.span>
                    </button>

                    <AnimatePresence initial={false}>
                      {showDetails && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                          className="overflow-hidden"
                        >
                          <DetailedEditor draftPolicy={draftPolicy} updatePolicyValue={updatePolicyValue} isUnknown={isUnknown} />
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {error && <ErrorMessage message={error} />}

                    <button
                      type="button"
                      onClick={prepareMandate}
                      disabled={isSubmitting}
                      className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-authority px-6 py-4 text-[15px] font-semibold text-[#04140d] transition-transform active:scale-[0.98] disabled:opacity-40"
                    >
                      {isSubmitting ? "Preparing…" : "Prepare authority"} <ArrowRight size={17} />
                    </button>
                  </>
                )}

                {step === "confirm" && preparedJob && (
                  <div className="mt-6">
                    <p className="text-[13px] leading-6 text-ink-2">
                      Granting this authority confirms the mandate with Leash and starts the five built-in scenarios against it.
                    </p>
                    {error && <ErrorMessage message={error} />}
                    <button
                      type="button"
                      onClick={grantAuthority}
                      disabled={isSubmitting || sealed}
                      className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-authority px-6 py-4 text-[15px] font-semibold text-[#04140d] transition-transform active:scale-[0.98] disabled:opacity-60"
                    >
                      <ShieldCheck size={17} />
                      {sealed ? "Authority sealed" : isSubmitting ? "Granting authority…" : "Grant authority"}
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>
    </main>
  );
}

function IntentStep({
  policyText,
  setPolicyText,
  onSubmit,
  isSubmitting,
  error,
}: {
  policyText: string;
  setPolicyText: (v: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  isSubmitting: boolean;
  error: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-authority">Before it spends anything</p>
      <h1 className="text-4xl font-semibold tracking-tight text-ink-0 sm:text-5xl">What can it buy for you?</h1>
      <p className="mt-4 max-w-md text-[15px] leading-6 text-ink-2">
        Say it in plain language. Every word here becomes a structured authority you review next — nothing is granted yet.
      </p>

      <form onSubmit={onSubmit} className="mt-10 space-y-5">
        <div className="relative rounded-[26px] p-[1px]">
          <div className="living-edge">
            <motion.div
              className="living-edge__dot"
              animate={{ offsetDistance: focused ? "100%" : "0%" }}
              transition={{ duration: 3, repeat: focused ? Infinity : 0, ease: "linear" }}
              style={{ background: "radial-gradient(circle, var(--authority-strong), transparent 70%)" }}
            />
          </div>
          <div className="rounded-[26px] border border-border-hairline bg-white/[0.03] p-1.5 backdrop-blur-xl">
            <textarea
              value={policyText}
              onChange={(e) => setPolicyText(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Buy running shoes under CHF 120. Require returnable items, and allow trusted devices only."
              className="min-h-40 w-full resize-none rounded-[22px] bg-transparent px-4 py-3.5 text-[16px] leading-7 text-ink-0 outline-none placeholder:text-ink-3"
              required
            />
          </div>
        </div>

        {error && <ErrorMessage message={error} />}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-3">Nothing is sent to your card until you explicitly grant authority.</p>
          <button
            type="submit"
            disabled={!policyText.trim() || isSubmitting}
            className="flex items-center justify-center gap-2 rounded-2xl bg-ink-0 px-5 py-3.5 text-sm font-semibold text-[#05060a] transition-transform active:scale-[0.98] disabled:opacity-30"
          >
            {isSubmitting ? <WaitingLabel /> : "Parse policy"}
            {!isSubmitting && <ArrowRight size={16} />}
          </button>
        </div>
      </form>
    </motion.div>
  );
}

function WaitingLabel() {
  const phrases = ["Understanding your instruction", "Structuring authority", "Checking constraints"];
  const [index, setIndex] = useState(0);
  useState(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % phrases.length), 3200);
    return () => clearInterval(id);
  });
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#05060a]/50" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-[#05060a]/80" />
      </span>
      <AnimatePresence mode="wait">
        <motion.span key={index} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.25 }}>
          {phrases[index]}…
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function DecomposingStep({ raw, fragments }: { raw: string; fragments: LanguageFragment[] }) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  fragments.forEach((f, i) => {
    if (f.start > cursor) parts.push(<span key={`t-${i}`}>{raw.slice(cursor, f.start)}</span>);
    parts.push(
      <motion.span
        key={f.id}
        layoutId={`frag-${f.id}`}
        className="rounded-md bg-authority-dim px-1 text-authority-strong"
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      >
        {f.text}
      </motion.span>,
    );
    cursor = f.end;
  });
  if (cursor < raw.length) parts.push(<span key="t-last">{raw.slice(cursor)}</span>);

  return (
    <motion.div initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="pt-6">
      <p className="text-2xl leading-relaxed text-ink-1 sm:text-3xl">{parts}</p>
    </motion.div>
  );
}

function DetailedEditor({
  draftPolicy,
  updatePolicyValue,
  isUnknown,
}: {
  draftPolicy: ParsedPolicyDraft;
  updatePolicyValue: (path: string, value: unknown) => void;
  isUnknown: (path: string) => boolean;
}) {
  const selected = new Set(draftPolicy.products?.allowed_categories ?? []);
  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-border-hairline bg-white/[0.02] p-4">
      <Field label="Allowed categories" unset={isUnknown("products.allowed_categories")}>
        <div className="flex flex-wrap gap-1.5">
          {PRODUCT_CATEGORIES.map((option) => {
            const active = selected.has(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  const values = draftPolicy.products.allowed_categories ?? [];
                  const next = active ? values.filter((v) => v !== option.value) : [...values, option.value];
                  updatePolicyValue("products.allowed_categories", next);
                }}
                className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  active ? "border-authority-line bg-authority-dim text-authority-strong" : "border-border-hairline text-ink-2 hover:border-ink-3"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Maximum per item" unset={isUnknown("spending.per_item_purchase_price_max")}>
        <div className="flex gap-2">
          <select
            value={draftPolicy.spending.currency ?? ""}
            onChange={(e) => updatePolicyValue("spending.currency", e.target.value)}
            className="rounded-lg border border-border-hairline bg-surface-2 px-2 py-2 text-[13px] font-semibold text-ink-0"
          >
            <option value="" disabled>—</option>
            {["CHF", "USD", "EUR"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            type="number"
            value={draftPolicy.spending.per_item_purchase_price_max ?? ""}
            onChange={(e) => updatePolicyValue("spending.per_item_purchase_price_max", e.target.value ? parseFloat(e.target.value) : null)}
            className="w-full rounded-lg border border-border-hairline bg-surface-2 px-3 py-2 text-right text-[14px] tabular-nums text-ink-0"
          />
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Returnable" unset={isUnknown("order_terms.require_returnable")}>
          <Tri value={draftPolicy.order_terms.require_returnable} onChange={(v) => updatePolicyValue("order_terms.require_returnable", v)} />
        </Field>
        <Field label="Cancellable" unset={isUnknown("order_terms.require_cancellable")}>
          <Tri value={draftPolicy.order_terms.require_cancellable} onChange={(v) => updatePolicyValue("order_terms.require_cancellable", v)} />
        </Field>
        <Field label="Trusted devices only" unset={isUnknown("session.trusted_devices_only")}>
          <Tri value={draftPolicy.session.trusted_devices_only} onChange={(v) => updatePolicyValue("session.trusted_devices_only", v)} allowNull={false} />
        </Field>
        <Field label="Domestic only" unset={isUnknown("session.domestic_only")}>
          <Tri value={draftPolicy.session.domestic_only} onChange={(v) => updatePolicyValue("session.domestic_only", v)} />
        </Field>
      </div>

      <Field label="Block repeats within (minutes)" unset={isUnknown("duplicate_check.block_repeats_within_minutes")}>
        <input
          type="number"
          value={draftPolicy.duplicate_check?.block_repeats_within_minutes ?? ""}
          placeholder="No limit"
          onChange={(e) => updatePolicyValue("duplicate_check.block_repeats_within_minutes", e.target.value ? parseInt(e.target.value) : null)}
          className="w-full rounded-lg border border-border-hairline bg-surface-2 px-3 py-2 text-right text-[14px] tabular-nums text-ink-0"
        />
      </Field>
    </div>
  );
}

function Field({ label, unset, children }: { label: string; unset: boolean; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-ink-2">
        {label}
        {unset && <span className="text-[10px] font-semibold uppercase tracking-wide text-review">Not set</span>}
      </p>
      {children}
    </div>
  );
}

function Tri({ value, onChange, allowNull = true }: { value: boolean | null | undefined; onChange: (v: boolean | null) => void; allowNull?: boolean }) {
  const options: { label: string; v: boolean | null }[] = [...(allowNull ? [{ label: "—", v: null }] : []), { label: "Yes", v: true }, { label: "No", v: false }];
  const current = value === undefined ? null : value;
  return (
    <div className="inline-flex rounded-lg border border-border-hairline bg-surface-2 p-0.5 text-[12px] font-semibold">
      {options.map((opt) => (
        <button
          key={String(opt.v)}
          type="button"
          onClick={() => onChange(opt.v)}
          className={`rounded-md px-2.5 py-1.5 transition-colors ${current === opt.v ? "bg-authority text-[#04140d]" : "text-ink-2 hover:text-ink-0"}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-decline/30 bg-decline-dim px-4 py-3 text-sm text-decline">
      <AlertCircle size={16} className="mt-0.5 shrink-0" /> {message}
    </p>
  );
}
