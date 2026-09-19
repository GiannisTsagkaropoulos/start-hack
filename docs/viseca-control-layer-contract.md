# Viseca Control Layer HTTP contract

Source verified against `C:\Users\user\Desktop\start_hack\VisecaControlLayer\api.py` and its JSON schemas on 2026-09-19. The TypeScript representation is [lib/viseca-control-layer.ts](../lib/viseca-control-layer.ts).

## Base URL

The wallet UI uses `NEXT_PUBLIC_API_URL`, defaulting to `http://localhost:8000`. The control layer enables CORS for all origins.

## Endpoints

| Method | Path | Request | Successful response |
| --- | --- | --- | --- |
| POST | `/parse-policy` | `ParsePolicyRequest` | `ParsePolicyResponse` |
| POST | `/confirm-policy` | `ConfirmPolicyRequest` | `ConfirmPolicyResponse` |

Both endpoints validate malformed request bodies with FastAPI's standard `422` response. `confirm-policy` also returns `422` when the provided v2 mandate fails semantic validation.

## Important integration finding

The current endpoints do **not** compose. `/parse-policy` returns the lightweight `ParsedPolicyDraft` shape, but `/confirm-policy` accepts the much richer `LocalMandateV2` shape. In particular, a parse result does not have `mandate_id`, `policy_version`, `cart`, `uncertainty_policy`, or `prompt_injection_defense`—all are mandatory for confirmation.

The existing wallet page passed its parse result directly to confirmation; that request would be rejected with `422` by the current control layer. The wallet now uses the explicitly typed `toLocalMandateV2` adapter before confirmation, retaining the current draft-editor experience while producing the strict confirmation body.

## Classification verdict

`database/decision_engine.py` returns `DecisionResponse` from its classifier. It is not exposed by the current FastAPI adapter, so [the verdict page](../app/verdict/page.tsx) accepts the returned JSON for display. Its exact fields are `authorization_id`, `decision`, `reason_codes`, `evidence`, and `engine_version: "rule-classifier-v2"`.
