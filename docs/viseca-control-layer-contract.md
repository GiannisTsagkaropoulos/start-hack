# Wallet and Leash control-layer contract

The wallet UI uses `NEXT_PUBLIC_API_URL`, defaulting to `http://localhost:8000`.
The team API key remains in the FastAPI process and is never sent to the browser.

## Policy parsing

`POST /parse-policy` converts the customer's text into the editable local
`ParsedPolicyDraft`. This is the review UI's input and is not a Leash mandate.

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

The existing deterministic classifier enforces the CHF per-purchase ceiling and
the optional prior-merchant requirement. Only those supported checks are
published as Leash hard rules. Other fields remain in the editable local policy
but must not be presented as enforced production checks until the classifier is
extended to evaluate them.
