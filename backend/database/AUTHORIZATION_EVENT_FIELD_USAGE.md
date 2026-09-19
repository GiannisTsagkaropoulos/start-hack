# Authorization-event field usage

This document compares the canonical
[`authorization_event.schema.json`](../viseca-2026/data/schemas/authorization_event.schema.json)
with `services/decision_engine.py`. The engine receives either the event itself or the
`data` member of a polling envelope.

**Important:** the engine does not run JSON-Schema validation. The upstream
caller must validate the event before evaluation. “Used” below means the field
is read by the current implementation; it does not imply every mandate needs
the resulting fact.

## Fields read by the decision path

The evaluator classifies direct authorization checks as **hard rules** and
database/history-backed checks as **soft rules**. A hard rule that does not
pass declines the authorization. When every hard rule passes but a soft rule
does not pass, the result is `step_up`; all rules passing results in `approve`.
`guidance` remains explanatory API text and is not evaluated.

| Schema field | Meaning | Control and exact rule | Conditional? |
| --- | --- | --- | --- |
| `authorization.authorization_id` | Unique identifier of this authorization request. | No rule; returned in the decision result. | No |
| `authorization.card_id` | Identifier of the card attempting the purchase. | Hard-rule input: `history.approved_merchant_transaction_count >= n` and `history.customer_device_familiar = "true"`. | Relevant history rule |
| `authorization.timestamp` | Time the purchase authorization occurred. | Hard-rule input: same two history facts; excludes later history records. | Relevant history rule |
| `authorization.billing_amount_chf` | Final purchase amount converted to Swiss francs. | Hard rule: `authorization.billing_amount_chf <= max_chf` with `scope: "purchase"` or `scope: "period"`. | Spending rule |
| `authorization.customer_device_id` | Identifier of the customer's device, when available. | Hard-rule input: `history.customer_device_familiar = "true"`. | Trusted-device rule |
| `authorization.recent_attempt_count_10m` | Number of recent authorization attempts in the prior ten minutes. | Hard rule: `authorization.recent_attempt_count_10m <= max`. | Session cap |
| `authorization.fulfillment_method` | How the order is fulfilled, for example delivery or collection. | Hard rule: `authorization.fulfillment_method in allowed_methods`. | Order-method rule |
| `authorization.order_returnable` | Whether the order can be returned; may be `unknown`. | Hard rule: `authorization.order_returnable = "true"`. | Returnable rule |
| `authorization.order_cancellable` | Whether the order can be cancelled; may be `unknown`. | Hard rule: `authorization.order_cancellable = "true"`. | Cancellable rule |
| `authorization.merchant.merchant_id` | Stable opaque identifier of the merchant. | Hard rules: `merchant_id in allowlist`, `merchant_id not_in blocklist`; also history-familiarity input. | Merchant ID/familiarity rule |
| `authorization.merchant.merchant_category` | Business-category label for the merchant. | Hard rule: `merchant_category in required_categories`. | Merchant-category rule |
| `authorization.merchant.merchant_mcc` | Four-digit merchant category code (MCC). | Hard rule: `merchant_mcc in required_mccs`. | MCC rule |
| `authorization.merchant.merchant_country` | Two-letter country code of the merchant. | Hard rule via derived fact: `authorization.merchant.is_domestic = "true"`. | Domestic-only rule |
| `authorization.items[].item_id` | Stable opaque identifier of a cart item. | Hard cart rules: `matches_requested_items = "true"`, `has_substitution = "false"`, and `has_unrequested_add_on = "false"`. | Exact-item matcher |
| `authorization.items[].item_name` | Merchant-supplied product name. | Hard cart rules: `matches_requested_items = "true"`, `has_substitution = "false"`, and `has_unrequested_add_on = "false"`. | Name-and-category matcher |
| `authorization.items[].item_category` | Product-category label for the cart item. | Hard rules: `items.item_category in/not_in ...`; also the three hard cart rules above. | Category/requested-item rule |
| `authorization.items[].quantity` | Number of units on the cart line. | Hard rule: `authorization.items.total_quantity <= max`. | Quantity-cap rule |
| `authorization.items[].item_details` | Merchant-supplied free text describing the item. | Hard cart rules above and `authorization.items.return_window_days >= min_days`. | Attribute/return-window rule |
| `mandate.hard_rules` | Machine-readable constraints approved for the mandate. | Executable-rule configuration; each entry is classified as hard or soft at evaluation time. | Required by engine |
| `mandate.uncertainty_policy` | Policy-generation metadata retained in the wire mandate. | Not used by the binary hard/soft decision tree. | No |
| `context.approved_spend_in_period_chf` | Already approved spending in the mandate's active period. | Soft-rule input: period-scoped `authorization.billing_amount_chf <= max_chf`. | Period-spending rule |

The engine also receives a separate `history` argument. In live use, the
caller must provide it from trusted authorization-history data; it is not read
from `context.recent_authorizations`.

## Fields currently not read

| Schema field | Meaning |
| --- | --- |
| `type` | Event kind; this schema fixes it to `authorization.request`. |
| `request_id` / `deadline_at` | Polling request identifier and the deadline for returning a decision. |
| `authorization.source_authorization_id` | Identifier in the source authorization system. |
| `authorization.scenario_id` / `replay_order` | Fixture scenario identity and order for offline replay. |
| `authorization.mandate_id` / `profile_id` / `initiator_type` | Authorization-side mandate, profile, and actor identifiers. |
| `authorization.amount` / `currency` | Original charged amount and its original currency. |
| `authorization.items_subtotal` / `delivery_fee` | Item-only amount and delivery charge before their billing-total combination. |
| `authorization.channel` | Purchase channel, such as ecommerce, in-store, recurring, or ATM. |
| `authorization.authority_status` / `card_status_at_attempt` | Status of the relevant authority and card at purchase time. |
| `authorization.spend_in_period_before_chf` | Source-provided earlier spending for the period; the engine instead uses trusted context. |
| `authorization.delivery_by` | Expected delivery date, if applicable. |
| `authorization.related_authorization_id` / `related_authorization_status` | Linked authorization and its outcome, if one exists. |
| `authorization.purchase_description` | Free-text description of the overall purchase. |
| `authorization.merchant.merchant_name` / `merchant_city` | Human-readable merchant name and city. |
| `authorization.merchant.availability` / `recurring_capable` | Where the merchant trades and whether it supports recurring payments. |
| `authorization.items[].line_no` | Position of the item in the cart. |
| `authorization.items[].unit_price` / `currency` | Per-unit price and its currency. |
| `mandate.mandate_id` / `status` / `customer_id` / `card_id` / `profile_id` | Identity and lifecycle metadata of the active mandate. |
| `mandate.instruction` | Human-readable customer instruction recorded with the mandate. |
| `context.recent_authorizations[]` | Compact recent-authorization summaries: ID, time, merchant, billed amount, and status. |
| `runtime.received_at` / `history_window_minutes` / `context_basis` | Receipt time and metadata explaining how runtime context was prepared. |

## Derived facts

The engine turns the read fields into a deliberately small fact allowlist:

| Derived fact | Inputs |
| --- | --- |
| `authorization.items.count` | Number of `authorization.items` entries |
| `authorization.items.total_quantity` | Sum of `authorization.items[].quantity` |
| `authorization.items.return_window_days` | Shortest return period parsed from every `item_details`; unknown if any item lacks one |
| `authorization.merchant.is_domestic` | `merchant_country == "CH"` |
| `authorization.cart.*` | The event items plus the separately supplied local v2 policy |
| `history.approved_merchant_transaction_count` | Event card, merchant, timestamp, and trusted history; soft rule |
| `history.customer_device_familiar` | Event card, device, timestamp, and trusted history; soft rule |
| `context.minutes_since_similar_approved_purchase` | Always unknown in the current implementation; a configured duplicate-purchase check steps up |
