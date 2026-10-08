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
