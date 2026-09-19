"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ShieldCheck,
} from "lucide-react";
import {
  ParsePolicyResponse,
  ParsedPolicyDraft,
  ProductCategory,
  ScenarioJobResponse,
  VERDICT_STORAGE_KEY,
  WalletPolicy,
  readErrorMessage,
} from "@/lib/viseca-control-layer";

function toWalletPolicy(draft: ParsedPolicyDraft): WalletPolicy {
  return {
    raw_instructions: draft.raw_instructions,
    products: {
      allowed_categories: draft.products.allowed_categories ?? [],
    },
    spending: {
      per_item_purchase_price_max: draft.spending.per_item_purchase_price_max as number,
      per_period_purchase_price_max: draft.spending.per_period_purchase_price_max,
      currency: draft.spending.currency as WalletPolicy["spending"]["currency"],
      period_in_days: draft.spending.period_in_days,
    },
    merchant: {
      blocklist: draft.merchant.blocklist ?? [],
      allowlist: draft.merchant.allowlist ?? [],
    },
    order_terms: {
      require_returnable: draft.order_terms.require_returnable,
      require_cancellable: draft.order_terms.require_cancellable,
    },
    session: {
      max_recent_attempts_10m: draft.session.max_recent_attempts_10m,
      trusted_devices_only: draft.session.trusted_devices_only as boolean,
      domestic_only: draft.session.domestic_only,
    },
    duplicate_check: {
      block_repeats_within_minutes: draft.duplicate_check?.block_repeats_within_minutes ?? null,
    },
    notes_for_customer: draft.notes_for_customer ?? "",
  };
}

type Step = "describe" | "review" | "confirm";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WALLET_ID = 0;

const PRODUCT_CATEGORIES: { label: string; value: ProductCategory }[] = [
  { label: "Books", value: "books" },
  { label: "Clothing", value: "clothing" },
  { label: "Cosmetics", value: "cosmetics" },
  { label: "Dining", value: "dining" },
  { label: "Electronics", value: "electronics" },
  { label: "Food delivery", value: "food_delivery" },
  { label: "Fuel", value: "fuel" },
  { label: "Gift cards", value: "gift_card" },
  { label: "Groceries", value: "groceries" },
  { label: "Home improvement", value: "home_improvement" },
  { label: "Hotel", value: "hotel" },
  { label: "Household", value: "household" },
  { label: "Membership", value: "membership" },
  { label: "Sporting goods", value: "sporting_goods" },
  { label: "Subscriptions", value: "subscriptions" },
  { label: "Transport", value: "transport" },
];

const requiredConfirmationFields = [
  "products.allowed_categories",
  "spending.per_item_purchase_price_max",
  "spending.currency",
  "order_terms.require_returnable",
  "session.trusted_devices_only",
  "session.domestic_only",
] as const;

const DEFAULT_POLICY: ParsedPolicyDraft = {
  raw_instructions: "",
  products: { allowed_categories: null },
  spending: {
    per_item_purchase_price_max: null,
    per_period_purchase_price_max: null,
    currency: null,
    period_in_days: null,
  },
  merchant: { blocklist: [], allowlist: [] },
  order_terms: { require_returnable: null, require_cancellable: null },
  session: {
    max_recent_attempts_10m: null,
    trusted_devices_only: true,
    domestic_only: null,
  },
  duplicate_check: { block_repeats_within_minutes: null },
  notes_for_customer: "",
};

const STEP_INDEX: Record<Step, number> = { describe: 0, review: 1, confirm: 2 };

export default function WalletPage() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState<Step>("describe");
  const [policyText, setPolicyText] = useState("");
  const [draftPolicy, setDraftPolicy] = useState<ParsedPolicyDraft>(DEFAULT_POLICY);
  const [preparedJob, setPreparedJob] = useState<ScenarioJobResponse | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const updatePolicyValue = (path: string, value: unknown) => {
    const keys = path.split(".");
    setDraftPolicy((prev) => {
      const updated = structuredClone(prev) as unknown as Record<string, unknown>;
      let current = updated;
      for (let i = 0; i < keys.length - 1; i++) {
        const next = current[keys[i]];
        if (typeof next !== "object" || next === null || Array.isArray(next)) {
          current[keys[i]] = {};
        }
        current = current[keys[i]] as Record<string, unknown>;
      }
      current[keys[keys.length - 1]] = value;
      return updated as unknown as ParsedPolicyDraft;
    });
  };

  const isUnknown = (path: string) => {
    const value = path.split(".").reduce<unknown>((current, key) => {
      if (typeof current !== "object" || current === null) return undefined;
      return (current as Record<string, unknown>)[key];
    }, draftPolicy);

    return (
      value === null ||
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    );
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
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error parsing policy.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const prepareMandate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (missingRequiredFields.length > 0) {
      setError("Please answer every field marked Required before confirming the policy.");
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

      if (!prepareRes.ok) {
        throw new Error(await readErrorMessage(prepareRes, "The Leash mandate draft could not be created."));
      }

      const job = (await prepareRes.json()) as ScenarioJobResponse;
      setPreparedJob(job);
      setStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mandate preparation failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmAndRun = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!preparedJob) return;

    setIsSubmitting(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/leash/jobs/${preparedJob.job_id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "The mandate could not be confirmed or started."));
      }

      const job = (await response.json()) as ScenarioJobResponse;
      sessionStorage.setItem(VERDICT_STORAGE_KEY, JSON.stringify({ job_id: job.job_id }));
      router.push("/verdict");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the scenario run.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-surface-0">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 py-8 sm:px-8">
        <PageHeader step={step} />

        <section className="flex-1 py-8 sm:py-12">
          <AnimatePresence mode="wait">
            {step === "describe" && (
              <DescribeStep
                key="describe"
                policyText={policyText}
                setPolicyText={setPolicyText}
                onSubmit={submitPolicy}
                isSubmitting={isSubmitting}
                error={error}
                reduceMotion={!!reduceMotion}
              />
            )}

            {step === "review" && (
              <ReviewStep
                key="review"
                rawInstructions={draftPolicy.raw_instructions}
                draftPolicy={draftPolicy}
                updatePolicyValue={updatePolicyValue}
                isUnknown={isUnknown}
                onSubmit={prepareMandate}
                onBack={() => setStep("describe")}
                isSubmitting={isSubmitting}
                error={error}
                reduceMotion={!!reduceMotion}
              />
            )}

            {step === "confirm" && preparedJob && (
              <ConfirmStep
                key="confirm"
                job={preparedJob}
                onSubmit={confirmAndRun}
                onBack={() => {
                  setPreparedJob(null);
                  setStep("review");
                }}
                isSubmitting={isSubmitting}
                error={error}
                reduceMotion={!!reduceMotion}
              />
            )}
          </AnimatePresence>
        </section>
      </div>
    </main>
  );
}

function PageHeader({ step }: { step: Step }) {
  return (
    <header className="flex items-center justify-between">
      <Link href="/" className="text-[15px] font-semibold tracking-tight text-ink-1">
        Wallet<span className="text-authority">Authority</span>
      </Link>
      <div className="flex items-center gap-2">
        {(["describe", "review", "confirm"] as Step[]).map((s) => (
          <div key={s} className="flex items-center gap-2">
            <span
              className={`h-1.5 w-6 rounded-full transition-colors duration-500 ${
                STEP_INDEX[s] <= STEP_INDEX[step] ? "bg-authority" : "bg-border-strong"
              }`}
            />
          </div>
        ))}
      </div>
    </header>
  );
}

const stepTransition = { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const };

function DescribeStep({
  policyText,
  setPolicyText,
  onSubmit,
  isSubmitting,
  error,
  reduceMotion,
}: {
  policyText: string;
  setPolicyText: (v: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  isSubmitting: boolean;
  error: string;
  reduceMotion: boolean;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
      transition={stepTransition}
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-authority">
        Before your agent can spend anything
      </p>
      <h1 className="text-3xl font-semibold tracking-tight text-ink-1 sm:text-4xl">
        What can it buy for you?
      </h1>
      <p className="mt-3 max-w-md text-[15px] leading-6 text-ink-3">
        Describe the purchase in plain language. Every word here becomes a
        structured authority you review next — nothing is granted yet.
      </p>

      <form onSubmit={onSubmit} className="mt-10 space-y-5">
        <motion.div
          layoutId="composer-surface"
          className="rounded-2xl border bg-surface-1 p-1.5 shadow-[0_1px_2px_rgba(20,22,27,0.04)]"
          animate={{
            borderColor: focused ? "var(--authority)" : "var(--border-subtle)",
            boxShadow: focused
              ? "0 0 0 4px var(--authority-tint), 0 1px 2px rgba(20,22,27,0.04)"
              : "0 1px 2px rgba(20,22,27,0.04)",
          }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          <motion.textarea
            layoutId="composer-text"
            value={policyText}
            onChange={(e) => setPolicyText(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Buy running shoes under CHF 120. Require returnable items, and allow trusted devices only."
            className="min-h-40 w-full resize-none rounded-xl bg-transparent px-4 py-3.5 text-[16px] leading-6 text-ink-1 outline-none placeholder:text-ink-3/70"
            required
          />
        </motion.div>

        {error && <ErrorMessage message={error} />}

        <div className="flex flex-col-reverse items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-3">
            Nothing is sent to your card until you explicitly grant authority.
          </p>
          <button
            type="submit"
            disabled={!policyText.trim() || isSubmitting}
            className="group flex shrink-0 items-center justify-center gap-2 rounded-xl bg-ink-1 px-5 py-3.5 text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30 sm:py-3"
          >
            {isSubmitting ? <WaitingLabel /> : "Parse policy"}
            {!isSubmitting && (
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            )}
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
      <span className="relative flex h-3.5 w-3.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/60" />
        <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-white/90" />
      </span>
      <AnimatePresence mode="wait">
        <motion.span
          key={index}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25 }}
        >
          {phrases[index]}…
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-decline-tint-border bg-decline-tint px-4 py-3 text-sm text-decline"
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" /> {message}
    </p>
  );
}

/* ---------------------------------------------------------------------- */
/* Review step                                                             */
/* ---------------------------------------------------------------------- */

function ReviewStep({
  rawInstructions,
  draftPolicy,
  updatePolicyValue,
  isUnknown,
  onSubmit,
  onBack,
  isSubmitting,
  error,
  reduceMotion,
}: {
  rawInstructions: string;
  draftPolicy: ParsedPolicyDraft;
  updatePolicyValue: (path: string, value: unknown) => void;
  isUnknown: (path: string) => boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
  isSubmitting: boolean;
  error: string;
  reduceMotion: boolean;
}) {
  const groups = useMemo(
    () => [
      { key: "products", title: "Products" },
      { key: "spending", title: "Spending" },
      { key: "order_terms", title: "Order requirements" },
      { key: "session", title: "Session & security" },
      { key: "duplicate_check", title: "Duplicates" },
    ],
    [],
  );

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0 }}
      transition={stepTransition}
    >
      {/* Signature transition 1 continuation: the composer surface/text share
          layoutId with the describe step, so Motion morphs the same element
          from a full-height textarea into this compact "your words" quote. */}
      <motion.div
        layoutId="composer-surface"
        className="rounded-2xl border border-border-subtle bg-surface-1 p-5"
        transition={{ duration: reduceMotion ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-3">Your words</p>
        <motion.p layoutId="composer-text" className="mt-2 text-[15px] leading-6 text-ink-1">
          {rawInstructions || "—"}
        </motion.p>
      </motion.div>

      <div className="mt-3 flex items-center gap-2 text-xs font-medium text-ink-3">
        <ArrowRight size={13} className="text-authority" />
        What we understood — edit anything before granting authority.
      </div>

      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        <StaggerGroup reduceMotion={reduceMotion}>
          {groups.map((group, i) => (
            <StaggerItem key={group.key} index={i} reduceMotion={reduceMotion}>
              {group.key === "products" && (
                <PropertyGroup title="Products" attention={isUnknown("products.allowed_categories")}>
                  <MultiSelectRow
                    label="Allowed categories"
                    hint="Every cart item must match one of these"
                    values={draftPolicy.products?.allowed_categories ?? []}
                    options={PRODUCT_CATEGORIES}
                    onChange={(values) => updatePolicyValue("products.allowed_categories", values)}
                    required
                    unset={isUnknown("products.allowed_categories")}
                  />
                </PropertyGroup>
              )}

              {group.key === "spending" && (
                <PropertyGroup
                  title="Spending"
                  attention={[
                    "spending.per_item_purchase_price_max",
                    "spending.currency",
                  ].some(isUnknown)}
                >
                  <PropertyRow
                    label="Maximum per item"
                    unset={isUnknown("spending.per_item_purchase_price_max")}
                    required
                  >
                    <MoneyInput
                      value={draftPolicy.spending?.per_item_purchase_price_max}
                      currency={draftPolicy.spending?.currency}
                      onValue={(v) => updatePolicyValue("spending.per_item_purchase_price_max", v)}
                      onCurrency={(c) => updatePolicyValue("spending.currency", c)}
                    />
                  </PropertyRow>
                  <PropertyRow
                    label="Maximum per period"
                    unset={isUnknown("spending.per_period_purchase_price_max")}
                  >
                    <NumberField
                      value={draftPolicy.spending?.per_period_purchase_price_max}
                      placeholder="No limit"
                      onChange={(v) => updatePolicyValue("spending.per_period_purchase_price_max", v)}
                    />
                  </PropertyRow>
                  <PropertyRow label="Period length (days)" unset={isUnknown("spending.period_in_days")}>
                    <NumberField
                      value={draftPolicy.spending?.period_in_days}
                      placeholder="—"
                      onChange={(v) => updatePolicyValue("spending.period_in_days", v ? Math.trunc(v) : null)}
                    />
                  </PropertyRow>
                </PropertyGroup>
              )}

              {group.key === "order_terms" && (
                <PropertyGroup title="Order requirements" attention={isUnknown("order_terms.require_returnable")}>
                  <PropertyRow label="Returnable" unset={isUnknown("order_terms.require_returnable")} required>
                    <TriToggle
                      value={draftPolicy.order_terms?.require_returnable}
                      onChange={(v) => updatePolicyValue("order_terms.require_returnable", v)}
                      trueLabel="Required"
                      falseLabel="No preference"
                    />
                  </PropertyRow>
                  <PropertyRow label="Cancellable" unset={isUnknown("order_terms.require_cancellable")}>
                    <TriToggle
                      value={draftPolicy.order_terms?.require_cancellable}
                      onChange={(v) => updatePolicyValue("order_terms.require_cancellable", v)}
                      trueLabel="Required"
                      falseLabel="No preference"
                    />
                  </PropertyRow>
                </PropertyGroup>
              )}

              {group.key === "session" && (
                <PropertyGroup
                  title="Session & security"
                  attention={["session.trusted_devices_only", "session.domestic_only"].some(isUnknown)}
                >
                  <PropertyRow label="Trusted devices only" unset={isUnknown("session.trusted_devices_only")} required>
                    <TriToggle
                      value={draftPolicy.session?.trusted_devices_only}
                      onChange={(v) => updatePolicyValue("session.trusted_devices_only", v)}
                      trueLabel="Yes"
                      falseLabel="No"
                      allowNull={false}
                    />
                  </PropertyRow>
                  <PropertyRow label="Domestic purchases only" unset={isUnknown("session.domestic_only")} required>
                    <TriToggle
                      value={draftPolicy.session?.domestic_only}
                      onChange={(v) => updatePolicyValue("session.domestic_only", v)}
                      trueLabel="Yes"
                      falseLabel="No"
                    />
                  </PropertyRow>
                  <PropertyRow label="Recent-attempt limit (10 min)" unset={isUnknown("session.max_recent_attempts_10m")}>
                    <NumberField
                      value={draftPolicy.session?.max_recent_attempts_10m}
                      placeholder="No limit"
                      onChange={(v) => updatePolicyValue("session.max_recent_attempts_10m", v ? Math.trunc(v) : null)}
                    />
                  </PropertyRow>
                </PropertyGroup>
              )}

              {group.key === "duplicate_check" && (
                <PropertyGroup title="Duplicates">
                  <PropertyRow
                    label="Block repeats within (minutes)"
                    unset={isUnknown("duplicate_check.block_repeats_within_minutes")}
                  >
                    <NumberField
                      value={draftPolicy.duplicate_check?.block_repeats_within_minutes}
                      placeholder="No limit"
                      onChange={(v) =>
                        updatePolicyValue("duplicate_check.block_repeats_within_minutes", v ? Math.trunc(v) : null)
                      }
                    />
                  </PropertyRow>
                </PropertyGroup>
              )}
            </StaggerItem>
          ))}
        </StaggerGroup>

        {error && <ErrorMessage message={error} />}

        <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1 sm:py-2.5"
          >
            <ArrowLeft size={16} /> Edit words
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center justify-center gap-2 rounded-xl bg-authority px-5 py-3.5 text-sm font-semibold text-white transition-transform hover:bg-authority-strong active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 sm:py-3"
          >
            {isSubmitting ? "Creating draft…" : "Prepare authority"} <Check size={16} />
          </button>
        </div>
      </form>
    </motion.div>
  );
}

function StaggerGroup({ children, reduceMotion }: { children: React.ReactNode; reduceMotion: boolean }) {
  return (
    <motion.div
      initial={reduceMotion ? false : "hidden"}
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: reduceMotion ? 0 : 0.05 } } }}
      className="space-y-3"
    >
      {children}
    </motion.div>
  );
}

function StaggerItem({
  children,
  index,
  reduceMotion,
}: {
  children: React.ReactNode;
  index: number;
  reduceMotion: boolean;
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: reduceMotion ? 0 : 10 },
        show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: index * 0.02 } },
      }}
    >
      {children}
    </motion.div>
  );
}

function PropertyGroup({
  title,
  attention = false,
  children,
}: {
  title: string;
  attention?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border transition-colors ${
        attention ? "border-review-tint-border bg-review-tint" : "border-border-subtle bg-surface-1"
      }`}
    >
      <div className="flex items-center justify-between px-5 pt-4">
        <h3 className="text-[13px] font-semibold text-ink-1">{title}</h3>
        {attention && (
          <span className="rounded-full bg-review px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            Needs input
          </span>
        )}
      </div>
      <div className="divide-y divide-border-subtle/70 px-5 pb-1 pt-2">{children}</div>
    </div>
  );
}

function PropertyRow({
  label,
  unset,
  required = false,
  children,
}: {
  label: string;
  unset: boolean;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <label className="flex items-center gap-2 text-[13.5px] font-medium text-ink-2">
        {label}
        {required && unset && (
          <span className="rounded-full bg-review/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-review">
            Required
          </span>
        )}
        {!required && unset && (
          <span className="text-[11px] font-medium text-ink-3">Not set</span>
        )}
      </label>
      <div className="sm:w-56">{children}</div>
    </div>
  );
}

function MoneyInput({
  value,
  currency,
  onValue,
  onCurrency,
}: {
  value: number | null | undefined;
  currency: string | null | undefined;
  onValue: (v: number | null) => void;
  onCurrency: (c: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <select
        value={currency ?? ""}
        onChange={(e) => onCurrency(e.target.value)}
        className="rounded-lg border border-border-strong bg-surface-1 px-2 py-2 text-[13px] font-semibold text-ink-1 outline-none focus:border-authority"
      >
        <option value="" disabled>
          —
        </option>
        {["CHF", "USD", "EUR"].map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input
        type="number"
        inputMode="decimal"
        value={value ?? ""}
        placeholder="120.00"
        onChange={(e) => onValue(e.target.value ? parseFloat(e.target.value) : null)}
        className="w-full rounded-lg border border-border-strong bg-surface-1 px-3 py-2 text-right text-[14px] tabular-nums outline-none focus:border-authority"
      />
    </div>
  );
}

function NumberField({
  value,
  placeholder,
  onChange,
}: {
  value: number | null | undefined;
  placeholder: string;
  onChange: (v: number | null) => void;
}) {
  return (
    <input
      type="number"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : null)}
      className="w-full rounded-lg border border-border-strong bg-surface-1 px-3 py-2 text-right text-[14px] tabular-nums outline-none focus:border-authority"
    />
  );
}

function TriToggle({
  value,
  onChange,
  trueLabel,
  falseLabel,
  allowNull = true,
}: {
  value: boolean | null | undefined;
  onChange: (v: boolean | null) => void;
  trueLabel: string;
  falseLabel: string;
  allowNull?: boolean;
}) {
  const options: { label: string; v: boolean | null }[] = [
    ...(allowNull ? [{ label: "Not set", v: null }] : []),
    { label: trueLabel, v: true },
    { label: falseLabel, v: false },
  ];
  const current = value === undefined ? null : value;

  return (
    <div className="inline-flex rounded-lg border border-border-strong bg-surface-1 p-0.5 text-[12px] font-semibold">
      {options.map((opt) => {
        const active = current === opt.v;
        return (
          <button
            key={String(opt.v)}
            type="button"
            onClick={() => onChange(opt.v)}
            className={`relative rounded-md px-2.5 py-1.5 transition-colors ${
              active ? "text-white" : "text-ink-3 hover:text-ink-1"
            }`}
          >
            {active && (
              <motion.span
                layoutId={`toggle-${trueLabel}-${falseLabel}`}
                className="absolute inset-0 rounded-md bg-authority"
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              />
            )}
            <span className="relative">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function MultiSelectRow({
  label,
  hint,
  values,
  options,
  onChange,
  required = false,
  unset,
}: {
  label: string;
  hint: string;
  values: ProductCategory[];
  options: { label: string; value: ProductCategory }[];
  onChange: (values: ProductCategory[]) => void;
  required?: boolean;
  unset: boolean;
}) {
  const selected = new Set(values);
  return (
    <div className="py-3">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-[13.5px] font-medium text-ink-2">{label}</p>
        {required && unset && (
          <span className="rounded-full bg-review/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-review">
            Required
          </span>
        )}
      </div>
      <p className="mb-3 text-[12px] text-ink-3">{hint}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = selected.has(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                const next = active
                  ? values.filter((v) => v !== option.value)
                  : [...values, option.value];
                onChange(next);
              }}
              className={`rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                active
                  ? "border-authority bg-authority-tint text-authority-strong"
                  : "border-border-strong bg-surface-1 text-ink-2 hover:border-ink-3"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Confirm step                                                            */
/* ---------------------------------------------------------------------- */

function ConfirmStep({
  job,
  onSubmit,
  onBack,
  isSubmitting,
  error,
  reduceMotion,
}: {
  job: ScenarioJobResponse;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
  isSubmitting: boolean;
  error: string;
  reduceMotion: boolean;
}) {
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
      transition={stepTransition}
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-authority">
        Draft {job.draft.draft_id}
      </p>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-1 sm:text-3xl">
        Grant this authority
      </h1>
      <p className="mt-3 max-w-md text-[14px] leading-6 text-ink-3">
        The service is healthy and this draft has not been activated yet.
        Granting authority confirms the mandate with Leash and starts the
        five built-in scenarios against it.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <div className="rounded-2xl border border-border-subtle bg-surface-1 p-5">
          <h3 className="text-[13px] font-semibold text-ink-1">Instruction</h3>
          <p className="mt-2 text-[14px] leading-6 text-ink-2">{job.draft.instruction}</p>

          <h3 className="mt-6 text-[13px] font-semibold text-ink-1">Compiled checks</h3>
          <div className="mt-3 space-y-2">
            {job.draft.hard_rules.map((rule, index) => (
              <motion.div
                key={`${rule.field}-${index}`}
                initial={reduceMotion ? false : { opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: reduceMotion ? 0 : index * 0.05, duration: 0.3 }}
                className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-2.5 font-mono text-[12.5px]"
              >
                <span className="text-ink-1">{rule.field}</span>
                <span className="text-ink-3">
                  {rule.operator} {String(rule.value)} {rule.currency ?? ""}
                </span>
              </motion.div>
            ))}
          </div>
        </div>

        {error && <ErrorMessage message={error} />}

        <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1 sm:py-2.5"
          >
            <ArrowLeft size={16} /> Edit authority
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center justify-center gap-2 rounded-xl bg-authority px-6 py-3.5 text-sm font-semibold text-white transition-transform hover:bg-authority-strong active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ShieldCheck size={16} />
            {isSubmitting ? "Granting authority…" : "Grant authority"}
          </button>
        </div>
      </form>
    </motion.div>
  );
}
