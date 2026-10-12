"use client";

import Link from "next/link";
import { useState } from "react";
import type { SessionView } from "@/lib/types";

type PaymentOutcome = "approved" | "pending" | "declined";

// Simulates the outside world changing while the fan is mid-checkout. Calls the API's
// demo-only routes; the two surfaces pick up the change on their next poll.
export function DemoControls({ sessionId }: { sessionId: string }) {
  const [log, setLog] = useState("Change something below, then watch both surfaces update within ~3 seconds.");
  const [nextOutcome, setNextOutcome] = useState<PaymentOutcome>("approved");

  async function currentSession(): Promise<SessionView> {
    const res = await fetch(`/api/sessions/${sessionId}`, { cache: "no-store" });
    const body = await res.json();
    if (!body.session) throw new Error("Session not found");
    return body.session;
  }

  async function demoPost(path: string, body: object = {}) {
    const res = await fetch(`/api/demo${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
  }

  async function run(label: string, action: () => Promise<void>) {
    try {
      await action();
      setLog(`✓ ${label}`);
    } catch (error) {
      setLog(`✗ ${label}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }

  const changePrice = (deltaCents: number) =>
    run(`Price ${deltaCents > 0 ? "+" : "−"}$${Math.abs(deltaCents) / 100}`, async () => {
      const session = await currentSession();
      const base = session.pendingPriceCents ?? session.priceCents;
      await demoPost(`/listings/${session.listingId}/price`, { priceCents: Math.max(100, base + deltaCents) });
    });

  const setOutcome = (outcome: PaymentOutcome) =>
    run(`Next payment will be ${outcome}`, async () => {
      await demoPost("/payment/next-outcome", { outcome });
      setNextOutcome(outcome);
    });

  return (
    <section className="controls">
      <div className="controls__head">
        <h1>Checkout continuity demo</h1>
        <Link href="/">← Listings</Link>
      </div>
      <div className="controls__groups">
        <div>
          <h2>Inventory</h2>
          <button onClick={() => changePrice(3000)}>Price +$30</button>
          <button onClick={() => changePrice(-3000)}>Price −$30</button>
          <button
            onClick={() =>
              run("Listing sold elsewhere", async () => {
                const session = await currentSession();
                await demoPost(`/listings/${session.listingId}/remove`);
              })
            }
          >
            Sell elsewhere
          </button>
        </div>
        <div>
          <h2>Next payment</h2>
          {(["approved", "pending", "declined"] as const).map((outcome) => (
            <button key={outcome} aria-pressed={nextOutcome === outcome} onClick={() => setOutcome(outcome)}>
              {outcome}
            </button>
          ))}
        </div>
        <div>
          <h2>Pending payment</h2>
          {(["approved", "declined"] as const).map((outcome) => (
            <button
              key={outcome}
              onClick={() =>
                run(`Settled as ${outcome}`, () => demoPost(`/sessions/${sessionId}/settle-payment`, { outcome }))
              }
            >
              Settle: {outcome}
            </button>
          ))}
        </div>
        <div>
          <h2>Time</h2>
          <button onClick={() => run("Skipped ahead 10 minutes", () => demoPost("/clock/advance", { ms: 10 * 60 * 1000 }))}>
            Fast-forward 10 min
          </button>
        </div>
      </div>
      <p className="controls__log" aria-live="polite">
        {log}
      </p>
    </section>
  );
}
