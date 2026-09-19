"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertCircle, ArrowRight, ChevronDown, Plus, ShieldCheck, Trash2 } from "lucide-react";
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

/* ------------------------------------------------------------------ */
/* Functional logic - identical to ui-fix's wallet page (new schema).  */
/* ------------------------------------------------------------------ */

function toWalletPolicy(draft: ParsedPolicyDraft): WalletPolicy {
  return {
    raw_instructions: draft.raw_instructions,
    products: {
      items: (draft.products.items ?? []).map((item) => ({
        name: item.name as string,
        category: item.category as ProductCategory,
        quantity: item.quantity as number,
        max_price_per_item: item.max_price_per_item ?? null,
      })),
    },
    spending: {
      total_price_max: draft.spending.total_price_max ?? null,
      currency: draft.spending.currency as WalletPolicy["spending"]["currency"],
      period_in_days: draft.spending.period_in_days ?? null,
    },
    merchant: { blocklist: draft.merchant.blocklist ?? [], allowlist: draft.merchant.allowlist ?? [] },
    order_terms: {
      require_returnable: draft.order_terms.require_returnable ?? true,
      require_cancellable: draft.order_terms.require_cancellable ?? true,
    },
    notes_for_customer: draft.notes_for_customer ?? "",
  };
}

type DraftItem = NonNullable<ParsedPolicyDraft["products"]["items"]>[number];

function getMissingRequiredFields(policy: ParsedPolicyDraft): string[] {
  const missing: string[] = [];
  const items = policy.products.items ?? [];
  if (items.length === 0) missing.push("products.items");
  items.forEach((item, index) => {
    if (!item.name?.trim()) missing.push(`products.items.${index}.name`);
    if (!item.category) missing.push(`products.items.${index}.category`);
    if (!item.quantity || item.quantity < 1) missing.push(`products.items.${index}.quantity`);
  });
  const hasItemLimit = items.some((item) => item.max_price_per_item !== null);
  if (policy.spending.total_price_max === null && !hasItemLimit) missing.push("spending.total_price_max_or_item_limit");
  if (!policy.spending.currency) missing.push("spending.currency");
  if (policy.spending.period_in_days !== null && policy.spending.total_price_max === null) missing.push("spending.total_price_max");
  return missing;
}

const DEFAULT_POLICY: ParsedPolicyDraft = {
  raw_instructions: "",
  products: { items: null },
  spending: { total_price_max: null, currency: null, period_in_days: null },
  merchant: { blocklist: [], allowlist: [] },
  order_terms: { require_returnable: true, require_cancellable: true },
  notes_for_customer: "",
};

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

/* Presentation-only: derives the authority object's chips from real draft state. */
function draftToRules(draft: ParsedPolicyDraft): AuthorityRule[] {
  const rules: AuthorityRule[] = [];
  const cur = draft.spending?.currency ?? "";
  (draft.products?.items ?? []).forEach((item, i) => {
    if (item.name || item.category) {
      const qty = item.quantity && item.quantity > 1 ? `${item.quantity}× ` : "";
      const cap = item.max_price_per_item != null ? ` · ≤ ${cur} ${item.max_price_per_item}`.trimEnd() : "";
      rules.push({ id: `item-${i}`, label: item.category ?? "Item", value: `${qty}${item.name ?? item.category ?? ""}${cap}` });
    }
  });
  if (draft.spending?.total_price_max != null) {
    const period = draft.spending.period_in_days ? ` per ${draft.spending.period_in_days} days` : "";
    rules.push({ id: "amount", label: `Maximum spend${period}`, value: `${cur} ${draft.spending.total_price_max}`.trim() });
  }
  if (draft.order_terms?.require_returnable) rules.push({ id: "returnable", label: "Order", value: "Must be returnable" });
  if (draft.order_terms?.require_cancellable) rules.push({ id: "cancellable", label: "Order", value: "Must be cancellable" });
  if (draft.merchant?.allowlist?.length) rules.push({ id: "allow", label: "Only from", value: draft.merchant.allowlist.join(", ") });
  if (draft.merchant?.blocklist?.length) rules.push({ id: "block", label: "Never from", value: draft.merchant.blocklist.join(", ") });
  return rules;
}

type Step = "describe" | "decomposing" | "review" | "confirm";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WALLET_ID = 0;

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
  const missingRequiredFields = getMissingRequiredFields(draftPolicy);

  const updateSpending = (field: keyof ParsedPolicyDraft["spending"], value: unknown) =>
    setDraftPolicy((p) => ({ ...p, spending: { ...p.spending, [field]: value } }));
  const updateOrderTerms = (field: keyof ParsedPolicyDraft["order_terms"], value: boolean) =>
    setDraftPolicy((p) => ({ ...p, order_terms: { ...p.order_terms, [field]: value } }));

  const updateItem = (index: number, field: keyof DraftItem, value: DraftItem[keyof DraftItem]) => {
    setDraftPolicy((previous) => {
      const items = [...(previous.products.items ?? [])];
      items[index] = { ...items[index], [field]: value };
      return { ...previous, products: { items } };
    });
  };
  const addItem = () =>
    setDraftPolicy((previous) => ({
      ...previous,
      products: { items: [...(previous.products.items ?? []), { name: "", category: null, quantity: null, max_price_per_item: null }] },
    }));
  const removeItem = (index: number) =>
    setDraftPolicy((previous) => ({
      ...previous,
      products: { items: (previous.products.items ?? []).filter((_, i) => i !== index) },
    }));

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
      // Hold the decomposed sentence long enough to actually read which words
      // became authority before the structured view takes over.
      if (!reduceMotion) setTimeout(() => setStep("review"), 2200);
      else setStep("review");
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
      const prepareRes = await fetch(`${API_URL}/leash/mandates/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_id: WALLET_ID, policy: toWalletPolicy(draftPolicy) }),
      });
      if (!prepareRes.ok) throw new Error(await readErrorMessage(prepareRes, "The Leash mandate draft could not be created."));
      setPreparedJob((await prepareRes.json()) as ScenarioJobResponse);
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
              <IntentStep key="describe" policyText={policyText} setPolicyText={setPolicyText} onSubmit={submitPolicy} isSubmitting={isSubmitting} error={error} />
            )}

            {step === "decomposing" && <DecomposingStep key="decomposing" raw={draftPolicy.raw_instructions} fragments={fragments} />}

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
                          <DetailedEditor
                            draft={draftPolicy}
                            updateItem={updateItem}
                            addItem={addItem}
                            removeItem={removeItem}
                            updateSpending={updateSpending}
                            updateOrderTerms={updateOrderTerms}
                          />
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

/* ------------------------------------------------------------------ */
/* Presentation components                                             */
/* ------------------------------------------------------------------ */

function IntentStep({
  policyText, setPolicyText, onSubmit, isSubmitting, error,
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
              placeholder="Buy running shoes under CHF 120. Require returnable items."
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
        initial={{ backgroundColor: "rgba(61,220,151,0)", color: "var(--ink-1)" }}
        animate={{ backgroundColor: "rgba(61,220,151,0.16)", color: "var(--authority-strong)" }}
        transition={{ delay: 0.35 + i * 0.28, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-md px-1"
      >
        {f.text}
      </motion.span>,
    );
    cursor = f.end;
  });
  if (cursor < raw.length) parts.push(<span key="t-last">{raw.slice(cursor)}</span>);
  return (
    <motion.div initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="pt-6">
      <p className="mb-5 text-xs font-semibold uppercase tracking-[0.22em] text-authority">Reading your words</p>
      <p className="text-2xl leading-relaxed text-ink-1 sm:text-3xl">{parts}</p>
    </motion.div>
  );
}

function DetailedEditor({
  draft, updateItem, addItem, removeItem, updateSpending, updateOrderTerms,
}: {
  draft: ParsedPolicyDraft;
  updateItem: (index: number, field: keyof DraftItem, value: DraftItem[keyof DraftItem]) => void;
  addItem: () => void;
  removeItem: (index: number) => void;
  updateSpending: (field: keyof ParsedPolicyDraft["spending"], value: unknown) => void;
  updateOrderTerms: (field: keyof ParsedPolicyDraft["order_terms"], value: boolean) => void;
}) {
  const items = draft.products.items ?? [];
  const hasItemLimit = items.some((i) => i.max_price_per_item !== null);
  const needsMonetaryLimit = draft.spending.total_price_max === null && !hasItemLimit;
  const inputCls = "w-full rounded-lg border border-border-hairline bg-surface-2 px-3 py-2 text-[13.5px] text-ink-0 outline-none focus:border-authority";

  return (
    <div className="mt-3 space-y-4 rounded-2xl border border-border-hairline bg-white/[0.02] p-4">
      <div>
        <p className="mb-2 flex items-center gap-2 text-[12px] font-medium text-ink-2">
          Requested items
          {items.length === 0 && <span className="text-[10px] font-semibold uppercase tracking-wide text-review">Required</span>}
        </p>
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={index} className="grid gap-2 rounded-xl border border-border-hairline bg-surface-1 p-3 sm:grid-cols-[1fr_1fr_80px_110px_auto]">
              <input value={item.name ?? ""} placeholder="Item name" onChange={(e) => updateItem(index, "name", e.target.value)} className={inputCls} />
              <select value={item.category ?? ""} onChange={(e) => updateItem(index, "category", (e.target.value || null) as DraftItem["category"])} className={inputCls}>
                <option value="">Category</option>
                {PRODUCT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <input type="number" min={1} value={item.quantity ?? ""} placeholder="Qty" onChange={(e) => updateItem(index, "quantity", e.target.value ? parseInt(e.target.value) : null)} className={`${inputCls} tabular-nums`} />
              <input type="number" value={item.max_price_per_item ?? ""} placeholder="Max / item" onChange={(e) => updateItem(index, "max_price_per_item", e.target.value ? parseFloat(e.target.value) : null)} className={`${inputCls} tabular-nums`} />
              <button type="button" onClick={() => removeItem(index)} aria-label="Remove item" className="flex items-center justify-center rounded-lg px-2 text-ink-3 hover:bg-decline-dim hover:text-decline">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addItem} className="mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-medium text-authority-strong hover:bg-authority-dim">
          <Plus size={14} /> Add another item
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Total spend limit" unset={needsMonetaryLimit}>
          <input type="number" value={draft.spending.total_price_max ?? ""} placeholder="No total limit" onChange={(e) => updateSpending("total_price_max", e.target.value ? parseFloat(e.target.value) : null)} className={`${inputCls} text-right tabular-nums`} />
        </Field>
        <Field label="Currency" unset={!draft.spending.currency}>
          <select value={draft.spending.currency ?? ""} onChange={(e) => updateSpending("currency", e.target.value || null)} className={inputCls}>
            <option value="">—</option>
            {["CHF", "USD", "EUR"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Period (days)" unset={false}>
          <input type="number" value={draft.spending.period_in_days ?? ""} placeholder="—" onChange={(e) => updateSpending("period_in_days", e.target.value ? parseInt(e.target.value) : null)} className={`${inputCls} text-right tabular-nums`} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Returnable" unset={false}>
          <Toggle value={draft.order_terms.require_returnable ?? true} onChange={(v) => updateOrderTerms("require_returnable", v)} />
        </Field>
        <Field label="Cancellable" unset={false}>
          <Toggle value={draft.order_terms.require_cancellable ?? true} onChange={(v) => updateOrderTerms("require_cancellable", v)} />
        </Field>
      </div>
    </div>
  );
}

function Field({ label, unset, children }: { label: string; unset: boolean; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-ink-2">
        {label}
        {unset && <span className="text-[10px] font-semibold uppercase tracking-wide text-review">Required</span>}
      </p>
      {children}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-border-hairline bg-surface-2 p-0.5 text-[12px] font-semibold">
      {[{ label: "Required", v: true }, { label: "No preference", v: false }].map((opt) => (
        <button key={String(opt.v)} type="button" onClick={() => onChange(opt.v)} className={`rounded-md px-2.5 py-1.5 transition-colors ${value === opt.v ? "bg-authority text-[#04140d]" : "text-ink-2 hover:text-ink-0"}`}>
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
