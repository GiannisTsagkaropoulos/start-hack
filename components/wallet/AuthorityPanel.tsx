"use client";

/**
 * THE shared authority object. This is not "a dark panel style reused" — it's
 * the same component, fed the same policy data, rendered at the moment
 * authority is granted (end of the mandate flow) and again as the pinned
 * plane that governs every purchase-decision view afterward. If mandate
 * creation and purchase evaluation ever look like two different products,
 * it's because this component stopped being the thing both screens render.
 *
 * The invariant that matters is NOT "dark ink panel." It's: human-confirmed
 * authority stays visually stable and structurally separate from anything
 * agent/merchant/external. If a future QA pass finds a better way to satisfy
 * that invariant, this component's internals can change; what must not
 * change is that both screens render the same one.
 */
export type WalletPolicy = {
  spending?: {
    per_item_purchase_price_max?: number | null;
    currency?: string | null;
  };
  order_terms?: {
    require_returnable?: boolean | null;
    require_cancellable?: boolean | null;
  };
  session?: {
    domestic_only?: boolean | null;
    trusted_devices_only?: boolean;
  };
};

export function policyToStatements(policy: WalletPolicy): string[] {
  const statements: string[] = [];
  if (policy.order_terms?.require_returnable) statements.push("Returnable items only");
  if (policy.order_terms?.require_cancellable) statements.push("Cancellable orders only");
  if (policy.session?.trusted_devices_only) statements.push("Trusted devices only");
  if (policy.session?.domestic_only) statements.push("Domestic purchases only");
  return statements;
}

export function AuthorityPanel({
  walletId,
  policy,
  pinned = false,
  footer,
}: {
  walletId: string | number;
  policy: WalletPolicy;
  pinned?: boolean;
  footer?: React.ReactNode;
}) {
  const max = policy.spending?.per_item_purchase_price_max;
  const currency = policy.spending?.currency ?? "CHF";
  const statements = policyToStatements(policy);

  return (
    <div
      className={`bg-ink-900 text-white p-6 sm:p-8 flex flex-col justify-between ${
        pinned ? "lg:min-h-screen" : "rounded-2xl"
      }`}
    >
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-400 mb-4">
          Your authority — wallet {walletId}
        </p>
        {max ? (
          <>
            <p className="text-3xl font-bold tabular-nums">
              {currency} {Number(max).toFixed(2)}
            </p>
            <p className="text-sm text-slate-400 mb-4">maximum per item</p>
          </>
        ) : (
          <p className="text-sm text-slate-400 mb-4">No spending limit set yet</p>
        )}
        {statements.length > 0 && (
          <>
            <div className="h-px bg-white/10 mb-4" />
            {statements.map((s) => (
              <p key={s} className="text-sm text-slate-300">
                {s}
              </p>
            ))}
          </>
        )}
      </div>
      {footer && <div className="mt-8 lg:mt-0">{footer}</div>}
    </div>
  );
}
