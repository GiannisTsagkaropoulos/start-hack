# Wallet and Leash control-layer contract

The wallet UI uses `NEXT_PUBLIC_API_URL`, defaulting to `http://localhost:8000`.
The team API key remains in the FastAPI process and is never sent to the browser.

## Policy parsing

`POST /parse-policy` converts the customer's text into the editable local
`ParsedPolicyDraft`. The LLM must derive at least one
`products.allowed_categories` value from the requested product. The customer
reviews that allowlist before confirmation. This draft is not a Leash mandate.

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

The deterministic classifier first enforces the confirmed product-category
allowlist against every cart line. A missing or mismatching category immediately
declines the authorization without evaluating later rules. It then enforces
event-local checks for per-item price (when the item currency matches the policy), merchant allow/block lists,
returnability, cancellability, ten-minute attempt velocity, authority status,
card status, and initiator type. It also retains the existing historical
merchant-familiarity lookup. Missing event evidence or a required currency
conversion produces `step_up`; a known hard-rule violation produces `decline`.

Period spend, trusted-device history, domestic-country resolution, duplicate
detection, and cross-currency item prices require state or reference-data
lookups and are not yet published as enforced Leash rules.
