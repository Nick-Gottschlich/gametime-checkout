"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { track } from "@/lib/analytics";
import { formatCents, formatRemaining } from "@/lib/format";
import type { SessionResponse, SessionView } from "@/lib/types";

export type Surface = "desktop" | "mobile";

const POLL_MS = 3000;
const OFFLINE_NOTICE = "Couldn't reach Gametime. Check your connection and try again.";

async function postJson(url: string, body: object): Promise<SessionResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Server-rendered first with `initial`, so the event, seats, price and status are in the
// HTML before any JavaScript runs. After hydration it polls, ticks the countdown, and
// enables the buttons.
export function CheckoutView({
  initial,
  initialServerNow,
  surface,
}: {
  initial: SessionView;
  initialServerNow: number;
  surface: Surface;
}) {
  const [session, setSession] = useState(initial);
  // Server clock minus this device's clock. Null until hydrated (the server render has no
  // device clock), so it doubles as the "is hydrated" flag.
  const [clockOffset, setClockOffset] = useState<number | null>(null);
  // "Now" on the server's clock. Starts at the render time so the server HTML and the first
  // client render show the same countdown (no hydration mismatch).
  const [now, setNow] = useState(initialServerNow);
  const [busy, setBusy] = useState(false);
  const [startedHere, setStartedHere] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const id = session.id;
  const hydrated = clockOffset !== null;
  const holdActive = session.status === "OPEN" || session.status === "PRICE_CHANGED";
  const isFinal = session.status === "COMPLETED" || session.status === "EXPIRED";
  const remainingMs = Math.max(0, session.expiresAt - now);
  const holdLapsed = holdActive && remainingMs === 0;

  const apply = useCallback((body: SessionResponse) => {
    setClockOffset(body.serverNow - Date.now());
    const next = body.session;
    // Responses can arrive out of order; never let an older version overwrite a newer one.
    if (next) setSession((current) => (next.version >= current.version ? next : current));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${id}`, { cache: "no-store" });
      apply(await res.json());
    } catch {
      // Offline or server unreachable: keep the last known state; the next poll retries.
    }
  }, [id, apply]);

  // Hydration: measure clock skew against the server's render timestamp.
  useEffect(() => {
    setClockOffset(initialServerNow - Date.now());
  }, [initialServerNow]);

  useEffect(() => {
    track("checkout_state", { sessionId: id, surface, status: session.status });
  }, [id, surface, session.status]);

  // A notice describes the situation it appeared in. Once the status changes, from a poll or
  // an action's response, that situation is over, so the notice goes with it.
  useEffect(() => {
    setNotice(null);
  }, [session.status]);

  // Poll while the session can still change, and immediately when the fan returns to the tab.
  useEffect(() => {
    if (isFinal) return;
    const poll = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const interval = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener("focus", poll);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("focus", poll);
    };
  }, [isFinal, refresh]);

  // Countdown runs locally, corrected by the server clock offset.
  useEffect(() => {
    if (clockOffset === null || !holdActive) return;
    const tick = () => setNow(Date.now() + clockOffset);
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [clockOffset, holdActive]);

  // When the countdown hits zero, ask the server right away instead of waiting for a poll.
  useEffect(() => {
    if (holdLapsed) refresh();
  }, [holdLapsed, refresh]);

  async function acceptPrice() {
    setBusy(true);
    setNotice(null);
    try {
      const body = await postJson(`/api/sessions/${id}/accept-price`, { version: session.version });
      if (body.error === "VERSION_CONFLICT") setNotice("The price changed again. Review the new total.");
      apply(body);
    } catch {
      setNotice(OFFLINE_NOTICE);
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    // One key per tap. It's reused only by the automatic retry below, so if the first
    // response was lost, the server recognizes the retry as the same purchase.
    const request = { version: session.version, idempotencyKey: crypto.randomUUID() };
    const url = `/api/sessions/${id}/complete`;
    setBusy(true);
    setNotice(null);
    setStartedHere(true);
    track("pay_tapped", { sessionId: id, surface });
    try {
      let body: SessionResponse;
      try {
        body = await postJson(url, request);
      } catch {
        body = await postJson(url, request);
      }
      if (body.error === "VERSION_CONFLICT") setNotice("This checkout changed. Review the details and tap Pay again.");
      apply(body);
    } catch {
      setNotice(OFFLINE_NOTICE);
    } finally {
      setBusy(false);
    }
  }

  const disabled = !hydrated || busy;
  const timer = (
    <p className={remainingMs < 60_000 ? "timer timer--urgent" : "timer"}>
      Tickets held for <strong>{formatRemaining(remainingMs)}</strong>
    </p>
  );

  function body() {
    switch (session.status) {
      case "OPEN":
        return (
          <>
            {session.priceDropFromCents !== undefined && (
              <p className="banner banner--good">
                Good news: the price dropped from {formatCents(session.priceDropFromCents)}.
              </p>
            )}
            {session.lastError && (
              <p className="banner banner--warn">{session.lastError}. Try again or use a different card.</p>
            )}
            {timer}
            <div className="paybar">
              <div>
                <span className="muted">Total</span>
                <strong className="price">{formatCents(session.priceCents)}</strong>
              </div>
              <button className="button" disabled={disabled} onClick={pay}>
                {busy ? "Paying…" : `Pay ${formatCents(session.priceCents)}`}
              </button>
            </div>
          </>
        );

      case "PRICE_CHANGED": {
        const newPrice = session.pendingPriceCents ?? session.priceCents;
        return (
          <>
            <p className="banner banner--warn">The price went up while you were away.</p>
            <p className="price-change">
              <s>{formatCents(session.priceCents)}</s> → <strong>{formatCents(newPrice)}</strong>
            </p>
            {timer}
            <div className="paybar">
              <Link className="button button--secondary" href="/">
                Find other tickets
              </Link>
              <button className="button" disabled={disabled} onClick={acceptPrice}>
                Accept {formatCents(newPrice)}
              </button>
            </div>
          </>
        );
      }

      case "PAYMENT_PENDING":
        return (
          <div className="state">
            <div className="spinner" aria-hidden />
            <h2>{startedHere ? "Processing your payment" : "Finishing on another device"}</h2>
            <p className="muted">
              {startedHere
                ? "This can take a moment. You can safely leave this page."
                : "This purchase is being completed elsewhere. This page will update when it's done."}
            </p>
          </div>
        );

      case "COMPLETED":
        return (
          <div className="state state--good">
            <h2>You&apos;re going!</h2>
            <p>
              Order {session.orderId} · {formatCents(session.priceCents)}
            </p>
            {!startedHere && <p className="muted">Completed on another device.</p>}
          </div>
        );

      case "EXPIRED":
        return (
          <div className="state">
            <h2>{session.expiredReason === "HOLD_TIMEOUT" ? "Your hold expired" : "These tickets are gone"}</h2>
            <p className="muted">
              {session.expiredReason === "HOLD_TIMEOUT"
                ? "We released these tickets so other fans could buy them."
                : "They sold or the seller removed them while you were away."}
            </p>
            <Link className="button" href="/">
              Find other tickets
            </Link>
          </div>
        );
    }
  }

  return (
    <>
    <article className={`checkout checkout--${surface}`}>
      <header className="checkout__event">
        <p className="eyebrow">{session.listing.quantity} tickets</p>
        <h1>{session.listing.eventName}</h1>
        <p className="muted">
          Section {session.listing.section} · Row {session.listing.row}
        </p>
      </header>
      {notice && (
        <p className="banner banner--warn" role="alert">
          {notice}
        </p>
      )}
      {body()}
    </article>
    {surface === "desktop" && holdActive && (
        <aside className="handoff">
          <strong>Switch devices</strong>
          <p className="muted">
            Your tickets stay held. Open this checkout in the app:{" "}
            <Link href={`/m/checkout/${id}`}>gametime://checkout/{id.slice(0, 8)}…</Link>
          </p>
        </aside>
      )}
    </>
  );
}
