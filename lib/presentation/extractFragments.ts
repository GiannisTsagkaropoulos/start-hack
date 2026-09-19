/**
 * Finds which substrings of the customer's OWN raw sentence correspond to a
 * field the real parser actually extracted, so the language->authority
 * transition can single those words out honestly. This never invents a
 * match: a field must (a) have a real, non-null/non-empty value in the
 * parsed draft, AND (b) have a plausible textual trace in the raw sentence.
 * If either is missing, that restriction is simply not highlighted - it
 * still appears normally in the structured review below, just without a
 * decomposition animation pretending it came from a specific word.
 */
import { ParsedPolicyDraft, ProductCategory } from "@/lib/viseca-control-layer";

export type LanguageFragment = {
  id: string;
  start: number;
  end: number;
  text: string;
  destinationLabel: string;
  destinationValue: string;
};

const CATEGORY_LABELS: Record<ProductCategory, string> = {
  books: "books",
  clothing: "clothing",
  cosmetics: "cosmetics",
  dining: "dining",
  electronics: "electronics",
  food_delivery: "food delivery",
  fuel: "fuel",
  gift_card: "gift card",
  groceries: "groceries",
  home_improvement: "home improvement",
  hotel: "hotel",
  household: "household",
  membership: "membership",
  sporting_goods: "sporting goods",
  subscriptions: "subscriptions",
  transport: "transport",
};

function findAll(haystackLower: string, needleLower: string): number[] {
  if (!needleLower) return [];
  const hits: number[] = [];
  let from = 0;
  while (true) {
    const at = haystackLower.indexOf(needleLower, from);
    if (at === -1) break;
    hits.push(at);
    from = at + needleLower.length;
  }
  return hits;
}

export function extractLanguageFragments(raw: string, draft: ParsedPolicyDraft): LanguageFragment[] {
  const lower = raw.toLowerCase();
  const fragments: LanguageFragment[] = [];
  const taken: Array<[number, number]> = [];

  const overlaps = (start: number, end: number) => taken.some(([s, e]) => start < e && end > s);

  const push = (start: number, length: number, id: string, destinationLabel: string, destinationValue: string) => {
    const end = start + length;
    if (overlaps(start, end)) return;
    taken.push([start, end]);
    fragments.push({ id, start, end, text: raw.slice(start, end), destinationLabel, destinationValue });
  };

  // Amount - match the literal number as typed (integer or decimal).
  const amount = draft.spending?.per_item_purchase_price_max;
  if (typeof amount === "number") {
    const variants = [String(amount), amount.toFixed(2), amount.toFixed(0)];
    for (const variant of variants) {
      const at = lower.indexOf(variant.toLowerCase());
      if (at !== -1) {
        push(at, variant.length, "amount", "Maximum per item", `${draft.spending.currency ?? ""} ${amount}`.trim());
        break;
      }
    }
  }

  // Product categories - match the human label if it appears verbatim.
  for (const category of draft.products?.allowed_categories ?? []) {
    const label = CATEGORY_LABELS[category];
    const at = lower.indexOf(label);
    if (at !== -1) {
      push(at, label.length, `category-${category}`, "Allowed category", label);
    }
  }

  // Order requirements.
  if (draft.order_terms?.require_returnable) {
    for (const needle of ["returnable", "return"]) {
      const at = lower.indexOf(needle);
      if (at !== -1) {
        push(at, needle.length, "returnable", "Order requirement", "Returnable");
        break;
      }
    }
  }
  if (draft.order_terms?.require_cancellable) {
    for (const needle of ["cancellable", "cancelable", "cancel"]) {
      const at = lower.indexOf(needle);
      if (at !== -1) {
        push(at, needle.length, "cancellable", "Order requirement", "Cancellable");
        break;
      }
    }
  }

  // Session / security.
  if (draft.session?.trusted_devices_only) {
    for (const needle of ["trusted device", "trusted devices", "device"]) {
      const at = lower.indexOf(needle);
      if (at !== -1) {
        push(at, needle.length, "trusted-device", "Session", "Trusted devices only");
        break;
      }
    }
  }
  if (draft.session?.domestic_only) {
    for (const needle of ["domestic", "switzerland", "swiss"]) {
      const at = lower.indexOf(needle);
      if (at !== -1) {
        push(at, needle.length, "domestic", "Session", "Domestic only");
        break;
      }
    }
  }

  // Duplicate check.
  if (draft.duplicate_check?.block_repeats_within_minutes) {
    for (const needle of ["repeat", "duplicate", "again"]) {
      const hits = findAll(lower, needle);
      if (hits.length) {
        push(hits[0], needle.length, "duplicate", "Duplicate window", `${draft.duplicate_check.block_repeats_within_minutes} min`);
        break;
      }
    }
  }

  return fragments.sort((a, b) => a.start - b.start);
}
