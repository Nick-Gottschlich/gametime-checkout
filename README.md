# Checkout Continuity

A prototype that lets a fan start a ticket checkout on one surface and finish it on another (desktop web ⇄ phone), without duplicate orders, without holding inventory forever, and without hiding a price change.

- **`server/`**: Node + TypeScript + Fastify API. The source of truth for checkout sessions. In-memory storage, with inventory and payment stubbed behind interfaces.
- **`web/`**: Next.js 16 app. A desktop checkout, a simulated mobile screen (standing in for a `gametime://checkout/:id` deep link), and a side-by-side demo page with controls that change the world around the session.

AI tool usage is documented in [AI_USAGE.md](AI_USAGE.md).

## Running it

Requires Node 20+. Use two terminals:

```bash
cd server && npm install && npm run dev     # API on http://localhost:4000
```

```bash
cd web && npm install && npm run dev        # Web on http://localhost:3000
```

Open http://localhost:3000 and click **Buy** on a listing. You'll land on `/demo/:id`, which shows the desktop and phone surfaces side by side on the same session, plus controls:

| Try | What you should see |
|---|---|
| **Price +$30** | Both surfaces switch to "price went up" within ~3s. Accept on one, and the other follows |
| **Price −$30** | Applied automatically, with "Good news: the price dropped" |
| **Next payment: declined**, then Pay | "Card declined," back to an open checkout, and you can retry |
| **Next payment: pending**, then Pay on the phone | The phone shows "Processing," the desktop "Finishing on another device." Then **Settle: approved** |
| **Sell elsewhere** | Both surfaces show "These tickets are gone" |
| **Fast-forward 10 min** | The hold expires on both surfaces |

Restarting the API resets everything (storage is in memory). Run the tests with `cd server && npm test` (30 tests).

## The checkout session state model

The server owns all session state. A client only ever holds the session **id** (which is what goes in a share link or deep link) and asks the server what's true.

```
            create (holds inventory, snapshots price)
                          │
                          ▼
  price went up   ┌──────────────┐   hold timed out / listing gone   ┌──────────┐
 ┌───────────────►│     OPEN     │──────────────────────────────────►│ EXPIRED  │
 │  ┌─────────────│              │◄───────────┐                      └──────────┘
 │  │ fan accepts └──────┬───────┘            │ payment declined            ▲
 │  │ new price          │ complete           │ (shows reason)              │
┌┴──┴──────────┐         ▼                    │                             │
│PRICE_CHANGED │  ┌─────────────────┐─────────┘   declined after hold lapsed│
└──────────────┘  │ PAYMENT_PENDING │──────────────────────────────────────┘
                  └────────┬────────┘
                           │ payment approved
                           ▼
                    ┌─────────────┐
                    │  COMPLETED  │
                    └─────────────┘
```

| Status | Meaning |
|---|---|
| `OPEN` | Hold is valid and the price is current. The fan can pay |
| `PRICE_CHANGED` | The price rose since the fan agreed to it. Payment is blocked until they accept |
| `PAYMENT_PENDING` | A charge is in progress. It blocks every other device from paying |
| `COMPLETED` | Terminal. Has an `orderId` |
| `EXPIRED` | Terminal. `expiredReason` is `HOLD_TIMEOUT` or `LISTING_UNAVAILABLE` |

Every session has a **`version`** that increments on every change. Clients send back the version they're looking at when they act.

The logic lives in [`server/src/checkout.ts`](server/src/checkout.ts) (`CheckoutService`), which has no HTTP code in it. The Fastify routes in [`server/src/routes/sessions.ts`](server/src/routes/sessions.ts) are a thin layer on top.

## How web and mobile resume the same session

| Endpoint | Purpose |
|---|---|
| `POST /sessions` | Create a session for a listing (places an inventory hold) |
| `GET /sessions/:id` | Resume: initial page load, polling, and opening a deep link all use this |
| `POST /sessions/:id/accept-price` | Accept a price increase (`{ version }`) |
| `POST /sessions/:id/complete` | Pay (`{ version, idempotencyKey }`) |

- **Resuming is just `GET /sessions/:id`.** Every read **reconciles** the session first: it checks the hold deadline, asks inventory for the current price and availability, and asks the payment provider about a pending charge. So any device that opens the session sees the same current state. Every action calls the same reconcile step before deciding anything.
- **Expiry is lazy.** There's no timer; the deadline is checked on read. The session can't drift out of sync with the clock, and expiring releases the inventory hold.
- **Each surface polls** every 3s, and immediately when the tab regains focus (the "came back from my phone" moment). Polling stops in final states and in background tabs. Responses older than what's on screen (by `version`) are ignored.
- **Each response includes `serverNow`**, so clients run the countdown on the server's clock and a device with a wrong clock still shows the right time left.
- **Mobile** is simulated at `/m/checkout/:id`, standing in for `gametime://checkout/:id`. It renders the same session with a phone layout: an action bar within thumb reach, full-width recovery buttons, and "Opened from a link" framing. A surface that didn't start a payment says "Finishing on another device" rather than showing a generic spinner.

## Stale inventory, price changes, and duplicate completion

**Stale inventory.** A session holds the tickets for 10 minutes (configurable via `HOLD_MS`). When the hold lapses, or inventory reports the listing gone, the session expires and releases the hold so other fans can buy. The hold is deliberately **not** enforced while a payment is in progress, because expiring mid-charge could take money for tickets we no longer hold. If that payment is then declined after the deadline, the session expires.

**Price changes.**
- **Increases** move the session to `PRICE_CHANGED`. The fan sees old → new, and can't pay until they accept. Accepting requires the version they saw, so if the price rises *again* before they tap Accept, the accept is rejected and they see the newer price. **A fan can only ever agree to a price that was on their screen.**
- **Decreases** are applied automatically and shown as good news. They still bump the version, so a Pay tapped on the old, higher-price screen gets bounced to re-confirm. The fan always sees the exact amount before being charged.
- The client never sends an amount. The charge amount always comes from the session on the server.

**Duplicate completion.** Two layers:
1. **Compare-and-set claim.** Every write goes through `compareAndSet(id, expectedVersion, next)`, which saves only if nobody changed the session since it was read. `complete` moves the session to `PAYMENT_PENDING` with this check **before** calling payment. When two devices tap Pay at once, exactly one wins the claim. The other gets `409` with the latest session and never reaches the payment call. (There's a test for exactly this, and it fails if the version check is removed.)
2. **Idempotency key.** Each Pay tap generates a key. If the response is lost and the client retries with the same key, the server returns where that attempt ended up instead of charging again. The client retries once automatically on a network failure.

## What appears before hydration

Checkout pages are server components that fetch the session on the server and stream the result inside `<Suspense>`. The skeleton is the same size as the real content, so nothing shifts when it arrives. The HTML the browser receives, before any JavaScript runs, already contains the event, seats, price, hold time (`Tickets held for 10:00`), and the Pay button at its final size. The button is **disabled until hydration**, so a tap can't be silently ignored.

After hydration, the client component starts polling, ticks the countdown, and enables the actions. The countdown's first value is computed from the server's render timestamp, so the server HTML and the first client render match (no hydration mismatch). The browser reaches the API through a same-origin `/api` rewrite, so there's no CORS. Session responses are `Cache-Control: no-store`.

## Measuring whether continuity helps conversion

The prototype has a `track()` stub (it logs to the browser console) that fires on every status change and on Pay taps, always with `sessionId` and `surface`. With a real pipeline I'd also record events server-side (session created, resumed, and completed, each with surface), because client events get lost to ad blockers and closed tabs. That data answers:

- **Cross-surface completion rate:** sessions created on one surface and completed on another, versus same-surface sessions.
- **Funnel by state:** where sessions end. Expired holds, `PRICE_CHANGED` sessions abandoned instead of accepted, declines that are never retried.
- **Time to resume:** how long fans take to come back on the second surface, which informs the hold length.
- **Experiment:** roll out the handoff entry points (share link, "continue on your phone") to a random half of sessions, and compare completed orders per session started.

## Tradeoffs

- **Polling, not push.** Polling every 3s is simple and easy to reason about. Server-sent events or WebSockets would be more immediate and cheaper at scale. Correctness doesn't depend on either: the version check on every action is what keeps actions correct, and polling only keeps the screen fresh.
- **Reads have side effects.** `GET /sessions/:id` can write: expire a session, record a price change, apply a payment result. I chose this because the session was already logically in that state, and the write is idempotent. The alternative is a background sweeper, which production would still need to release holds nobody revisits.
- **Every read hits inventory.** Simple and always correct, but at scale I'd cache prices briefly or have inventory push price-change events.
- **In-memory store, single process.** `compareAndSet` is atomic only because Node runs one request's code at a time and there's no `await` between the check and the write. With multiple servers, this becomes a conditional `UPDATE ... WHERE id = $1 AND version = $2` in the database. The `SessionStore` interface is designed for that swap.
- **A price drop still costs one extra tap.** I chose "the fan always sees the exact amount" over "charge the lower price silently."
- **Duplicated types.** `web/lib/types.ts` mirrors the API's response types instead of sharing a package, so the two projects stay independent. Request types and JSON schemas in the routes are also written twice. A library like TypeBox would generate both from one definition.
- **Simulated mobile instead of a real Expo app**, to keep within the time budget.
- **Demo controls are API routes** (`/demo/*`), disabled when `NODE_ENV=production`.

## What I'd do with more time

- **A real Expo app** that handles `gametime://checkout/:id` via Expo Router and resumes the session, with native recovery states.
- **Universal links / App Links instead of a custom scheme.** A single `https://…/checkout/:id` URL opens the app when it's installed and the web checkout when it isn't. Both resume through `GET /sessions/:id`, so a shared link always lands on the same session.
- **Recover stuck payments.** If the server crashes between claiming a session and recording the charge, it stays `PAYMENT_PENDING` with no payment id. A background job would ask the provider (using the idempotency key) what happened.
- **A sweeper for abandoned holds**, plus hold timeouts in inventory itself as a safety net. Release the hold if creating the session fails after the hold was placed.
- **Payment webhooks** instead of asking the provider on each read while a payment is pending.
- **Ownership and auth.** Today anyone with a session id can act on it; the id is an unguessable UUID, but a real system would tie sessions to a fan's account.
- **Per-quantity inventory** (buy 2 of 4 seats) instead of all-or-nothing listings.
- **A "reconnecting…" indicator** after repeated poll failures, and clearing the offline notice on the next successful poll.
- **End-to-end tests** (Playwright) for the cross-surface flows, in addition to the API and state-machine tests.
