/**
 * Finds which substrings of the customer's OWN raw sentence correspond to a
 * field the real parser actually extracted, so the language->authority
 * transition can single those words out honestly. This never invents a
 * match: a field must (a) have a real, non-null/non-empty value in the
 * parsed draft, AND (b) have a plausible textual trace in the raw sentence.
 * If either is missing, that restriction is simply not highlighted - it
 * still appears normally in the structured review below, just without a
 * decomposition animation pretending it came from a specific word.
 *
 * Updated for the line-item cart schema (products.items[], spending.
 * total_price_max) merged in from origin/ui-fix - the previous category-list
 * / session / duplicate_check fields no longer exist on ParsedPolicyDraft.
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

  // Total spending cap - match the literal number as typed.
  const totalMax = draft.spending?.total_price_max;
  if (typeof totalMax === "number") {
    const variants = [String(totalMax), totalMax.toFixed(2), totalMax.toFixed(0)];
    for (const variant of variants) {
      const at = lower.indexOf(variant.toLowerCase());
      if (at !== -1) {
        push(at, variant.length, "amount", "Maximum spend", `${draft.spending.currency ?? ""} ${totalMax}`.trim());
        break;
      }
    }
  }

  // Cart line items - match the item's own name, category label, or its
  // per-item price cap if one was set.
  for (const [index, item] of (draft.products?.items ?? []).entries()) {
    if (item.name) {
      const at = lower.indexOf(item.name.toLowerCase());
      if (at !== -1) push(at, item.name.length, `item-${index}-name`, "Requested item", item.name);
    }
    if (item.category) {
      const label = CATEGORY_LABELS[item.category];
      const at = lower.indexOf(label);
      if (at !== -1) push(at, label.length, `item-${index}-category`, "Category", label);
    }
    if (typeof item.max_price_per_item === "number") {
      const variant = String(item.max_price_per_item);
      const at = lower.indexOf(variant.toLowerCase());
      if (at !== -1) {
        push(at, variant.length, `item-${index}-price`, "Per-item limit", `${draft.spending.currency ?? ""} ${item.max_price_per_item}`.trim());
      }
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

  return fragments.sort((a, b) => a.start - b.start);
}
