export type SessionStatus =
  | 'OPEN' // hold is valid, price is current, fan can pay
  | 'PRICE_CHANGED' // price went up; fan must accept before paying
  | 'PAYMENT_PENDING' // a charge is in flight; blocks other devices from paying
  | 'COMPLETED' // terminal: order created
  | 'EXPIRED'; // terminal: hold ran out or listing is gone

export type ExpiredReason = 'HOLD_TIMEOUT' | 'LISTING_UNAVAILABLE';

export interface Listing {
  id: string;
  eventName: string;
  section: string;
  row: string;
  quantity: number;
  priceCents: number;
}

// What the checkout page shows about the tickets. Copied onto the session at creation
// so every surface can render it without a second request.
export type ListingSummary = Pick<Listing, 'eventName' | 'section' | 'row' | 'quantity'>;

export interface CheckoutSession {
  id: string;
  listingId: string;
  listing: ListingSummary;
  status: SessionStatus;
  priceCents: number; // the price the fan has agreed to pay
  pendingPriceCents?: number; // the new, higher price awaiting acceptance (PRICE_CHANGED only)
  priceDropFromCents?: number; // set when the price fell, so the UI can say "was $X"
  expiresAt: number; // epoch ms; hold deadline
  version: number; // +1 on every change; clients send it back to prove they saw the latest state
  completionKey?: string; // idempotency key of the purchase attempt that claimed this session
  paymentId?: string;
  orderId?: string;
  expiredReason?: ExpiredReason;
  lastError?: string; // e.g. "Card declined", shown after falling back to OPEN
  createdAt: number;
  updatedAt: number;
}
