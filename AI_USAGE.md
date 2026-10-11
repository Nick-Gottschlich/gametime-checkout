# AI Usage Log

**Tool:** Claude Code (Claude Opus 5.5) as a pair programmer. The AI proposes, I decide, and nothing is committed until I can explain it myself.

## Decisions

| # | Topic | AI suggested | How I challenged / validated | Outcome |
|---|---|---|---|---|
| 1 | Problem framing | Core ideas: server-owned session state, explicit state machine, idempotent completion, server-rendered web | Mapped each to the prompt's grading criteria | Adopted |
| 2 | Backend framework | Fastify | Asked for an Express vs. Fastify comparison; chose it for built-in schema validation (API boundaries) and `inject()` (route tests), not speed | Fastify |
| 3 | Session storage | In-memory `Map` behind a `SessionStore` interface | Asked why `Map` over a plain object: a plain object inherits keys like `__proto__`, and session IDs come from user-controlled URLs | Adopted; README will note that one process is what makes it safe |
| 4 | External systems | Stub `InventoryService` / `PaymentService` | Clarified that they are dependencies, not the checkout's source of truth; the stubs let tests force price changes and declines | Adopted |
| 5 | Mobile surface | Real Expo app (offered a simulated web view as the faster option) | My call: I've shipped an Expo Router app to the App Store, so I can defend it; scoped to one resume screen | Real Expo + deep link |
| 6 | Server scaffold | `tsx` to run TS directly, Vitest for tests, `buildApp()` kept separate from `listen()` | Ran typecheck, the test suite, and a live `curl /health` | Adopted |
| 7 | State model | Sessions go `OPEN` / `PRICE_CHANGED` / `PAYMENT_PENDING` / `COMPLETED` / `EXPIRED`; expiry checked lazily; version numbers + idempotency keys guard completion | I had framed it as user and ticket lifecycles; the AI corrected this to only the session's lifecycle (browsing is pre-session, ticket state belongs to inventory) | Adopted |
| 8 | Price changes & hold | Asked me to decide | Increases need the fan's acknowledgment; decreases apply automatically with a notice; 10-minute hold, configurable | My calls |
| 9 | Mobile surface (revisited) | — | Reversed #5 to fit the 2–3 hr budget: simulated mobile route on web now, real Expo app only if time allows | Simulated view |
| 10 | Polling | Poll every ~3s and on tab focus; countdown runs on the client | I proposed loading once; the AI pushed back that cross-surface changes must be visible without a refresh. The server's version check, not polling, is what keeps actions correct | Polling |
| 11 | State machine code | `CheckoutService` (no Fastify), every write a version-checked compare-and-set, fakes with test controls, 17 transition tests | Disabled the version check on purpose: the double-purchase test failed (2 charges), so the test really guards the bug | Adopted |
| 12 | Bug in AI-written price logic | Found by the AI while walking me through `applyCurrentPrice`: after a drop then a rise, the UI would call an increase "was $150, now $140" | Wrote the failing test first (confirmed it reproduced the bug), then the one-line fix | Fixed |
| 13 | HTTP layer | Thin Fastify routes over `CheckoutService`: JSON-schema validation, error → status code map, server-only fields stripped from responses, `serverNow` + `no-store` on every response, demo-only control routes | 11 `inject()` tests plus a live curl run. The first live run hit a stale server left on the port by an earlier smoke test (a false failure); found it and reran cleanly | Adopted |
