// Mirrors the API's response shapes (server/src/types.ts and SessionView in
// server/src/routes/sessions.ts). Duplicated rather than shared so server and web stay
// independent projects; a shared package would replace this file.

export type SessionStatus = "OPEN" | "PRICE_CHANGED" | "PAYMENT_PENDING" | "COMPLETED" | "EXPIRED";

export interface SessionView {
  id: string;
  listingId: string;
  listing: { eventName: string; section: string; row: string; quantity: number };
  status: SessionStatus;
  priceCents: number;
  pendingPriceCents?: number;
  priceDropFromCents?: number;
  expiresAt: number;
  version: number;
  orderId?: string;
  expiredReason?: "HOLD_TIMEOUT" | "LISTING_UNAVAILABLE";
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

// Every session endpoint answers with this. On errors, `session` is the latest state when
// there is one, so the UI can simply re-render.
export interface SessionResponse {
  session?: SessionView;
  error?: string;
  serverNow: number;
}

export interface Listing {
  id: string;
  eventName: string;
  section: string;
  row: string;
  quantity: number;
  priceCents: number;
}
