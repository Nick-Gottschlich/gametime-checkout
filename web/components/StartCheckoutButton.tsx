"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { track } from "@/lib/analytics";
import type { SessionResponse } from "@/lib/types";

export function StartCheckoutButton({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId }),
      });
      const body: SessionResponse = await res.json();
      if (!body.session) {
        setError(body.error === "LISTING_UNAVAILABLE" ? "Another fan is checking out these tickets." : "Couldn't start checkout.");
        setBusy(false);
        return;
      }
      track("checkout_started", { sessionId: body.session.id, surface: "desktop", listingId });
      router.push(`/demo/${body.session.id}`);
    } catch {
      setError("Couldn't reach the server.");
      setBusy(false);
    }
  }

  return (
    <div className="start">
      <button className="button" onClick={start} disabled={busy}>
        {busy ? "Holding tickets…" : "Buy"}
      </button>
      {error && <p className="start__error">{error}</p>}
    </div>
  );
}
