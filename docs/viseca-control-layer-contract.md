# Wallet and Leash control-layer contract

The wallet UI uses `NEXT_PUBLIC_API_URL`, defaulting to `http://localhost:8000`.
The team API key remains in the FastAPI process and is never sent to the browser.

## Policy parsing

`POST /parse-policy` converts the customer's text into the editable local
`ParsedPolicyDraft`. The LLM emits one `products.items` entry per requested
object, preserving its name, product category, cumulative quantity allowance, and optional
unit-price limit. The customer reviews each item before confirmation. A policy
must contain either a shared `spending.total_price_max` or at least one item
unit-price limit; a shared total means the current basket when
`period_in_days` is absent and a rolling cumulative limit when it is present.
Currency is mandatory whenever the policy contains monetary controls.
Returnability and cancellability default to `true` when the instruction omits
them. Session restrictions and duplicate-purchase configuration are not part of
the current policy contract. This draft is not a Leash mandate.

## Production scenario workflow

The browser-facing endpoints below orchestrate the documented Leash calls:

| Local endpoint | Leash calls and behavior |
| --- | --- |
| `POST /leash/mandates/prepare` | `GET /healthz`, `GET /v1/bootstrap`, `GET /v1/reference-data`, then `POST /v1/mandates`. Returns the unconfirmed draft for customer review. |
| `POST /leash/jobs/{job_id}/confirm` | `POST /v1/mandates/{draft_id}/confirm`, then starts the background scenario worker. |
| `GET /leash/jobs/{job_id}` | Returns current status and every classification grouped by scenario. The verdict page polls this endpoint. |
| `POST /leash/jobs/{job_id}/authorizations/{authorization_id}/resolve` | Sends a real customer approve/decline answer to `POST /v1/authorizations/{authorization_id}/resolve`. |

For each scenario returned by bootstrap, the worker calls
`POST /v1/scenario-runs`, checks `GET /v1/scenario-runs/{run_id}`, long-polls
`GET /v1/decision-requests/next?wait=25`, evaluates every delivered event, and
submits `POST /v1/authorizations/{authorization_id}/decision` before the
deadline. HTTP 204 means that the worker checks run progress and polls again.

`step_up` remains pending and visible on the verdict page while the worker keeps
polling. Only a customer's explicit action invokes `/resolve`. Jobs are kept in
FastAPI process memory for this demo; Leash is the authoritative persistent
store, so restarting FastAPI requires starting a fresh UI job.

## Current classifier scope

The deterministic classifier first enforces each cart item's confirmed product
category. A mismatching category immediately declines the authorization without
evaluating later rules. Basket line count and array position are not mandate
constraints: matching lines are grouped by requested item instead. It then
enforces item identity, cumulative quantity, optional unit-price limits using
the supplied fixed FX rates, shared basket totals, merchant allow/block lists,
returnability, subscription cancellability, authority status, card status, and
initiator type. Cancellability is skipped
for every non-subscription product, even if its event uses the literal
`"unknown"` rather than omitting the field.

The classifier also counts earlier transactions for the merchant across every
user and card. Fewer than three transactions, or unavailable history, produces
`step_up` for customer approval; it is not an automatic rejection. Missing
evidence for other checks or a required currency conversion also produces
`step_up`; a known hard-rule violation produces `decline`.

For a rolling-period total, the classifier sums approved historical purchases
and refunds for the mandate customer within the requested window, adds
`context.approved_spend_in_period_chf` from earlier approved decisions in the
current scenario, and finally adds the current basket. It converts this CHF
total into the policy currency using `data/fx_rates.csv`. Missing history,
scenario context, or conversion data produces `step_up`; exceeding the total is
a hard decline.

Item quantity is tracked separately from basket line count. For each requested
item, the classifier sums quantities from purchases finalized as approved in
the current scenario and adds the current authorization quantity. The purchase
that would take this total above the mandate allowance is declined; declined or
still-pending purchases do not consume the allowance.
