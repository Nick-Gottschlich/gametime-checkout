import { randomUUID } from 'node:crypto';
import type { InventoryService } from './services/inventory.js';
import type { PaymentResult, PaymentService } from './services/payment.js';
import type { SessionStore } from './store.js';
import type { CheckoutSession, ExpiredReason } from './types.js';

export const DEFAULT_HOLD_MS = 10 * 60 * 1000;

export type CheckoutError =
  | 'NOT_FOUND'
  | 'LISTING_UNAVAILABLE'
  | 'VERSION_CONFLICT' // the client acted on an outdated view of the session
  | 'INVALID_STATE'; // the action isn't allowed from the session's current status

// Failures carry the latest session when there is one, so the client can just re-render.
export type CheckoutResult =
  | { ok: true; session: CheckoutSession }
  | { ok: false; error: CheckoutError; session?: CheckoutSession };

export interface CheckoutDeps {
  store: SessionStore;
  inventory: InventoryService;
  payment: PaymentService;
  now?: () => number; // injectable so tests can fast-forward time
  holdMs?: number;
}

const ok = (session: CheckoutSession): CheckoutResult => ({ ok: true, session });
const fail = (error: CheckoutError, session?: CheckoutSession): CheckoutResult => ({ ok: false, error, session });

export class CheckoutService {
  private store: SessionStore;
  private inventory: InventoryService;
  private payment: PaymentService;
  private now: () => number;
  private holdMs: number;

  constructor(deps: CheckoutDeps) {
    this.store = deps.store;
    this.inventory = deps.inventory;
    this.payment = deps.payment;
    this.now = deps.now ?? Date.now;
    this.holdMs = deps.holdMs ?? DEFAULT_HOLD_MS;
  }

  async create(listingId: string): Promise<CheckoutResult> {
    const listing = await this.inventory.getListing(listingId);
    if (!listing) return fail('LISTING_UNAVAILABLE');

    const id = randomUUID();
    if (!(await this.inventory.hold(listingId, id))) return fail('LISTING_UNAVAILABLE');

    const now = this.now();
    const session: CheckoutSession = {
      id,
      listingId,
      listing: { eventName: listing.eventName, section: listing.section, row: listing.row, quantity: listing.quantity },
      status: 'OPEN',
      priceCents: listing.priceCents,
      expiresAt: now + this.holdMs,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.insert(session);
    return ok(session);
  }

  /**
   * Loads a session and brings it up to date (expiry, price, payment status).
   * Every read and action goes through here, so every device sees the same current state.
   */
  async resume(id: string): Promise<CheckoutResult> {
    const session = await this.store.get(id);
    if (!session) return fail('NOT_FOUND');
    return ok(await this.reconcile(session));
  }

  async acceptPrice(id: string, version: number): Promise<CheckoutResult> {
    const resumed = await this.resume(id);
    if (!resumed.ok) return resumed;
    const session = resumed.session;

    if (session.status !== 'PRICE_CHANGED' || session.pendingPriceCents === undefined) {
      return fail('INVALID_STATE', session);
    }
    if (session.version !== version) return fail('VERSION_CONFLICT', session);

    const next = await this.transition(session, {
      status: 'OPEN',
      priceCents: session.pendingPriceCents,
      pendingPriceCents: undefined,
    });
    return next ? ok(next) : this.conflict(id);
  }

  async complete(id: string, request: { version: number; idempotencyKey: string }): Promise<CheckoutResult> {
    const resumed = await this.resume(id);
    if (!resumed.ok) return resumed;
    const session = resumed.session;

    // The same purchase attempt retried (e.g. after a network blip): report where it
    // ended up instead of charging again.
    if (session.completionKey === request.idempotencyKey) return ok(session);

    if (session.status !== 'OPEN') return fail('INVALID_STATE', session);
    if (session.version !== request.version) return fail('VERSION_CONFLICT', session);

    // Claim the session *before* charging. If another device claimed it first, this save
    // fails and we never reach the payment call.
    const pending = await this.transition(session, {
      status: 'PAYMENT_PENDING',
      completionKey: request.idempotencyKey,
      lastError: undefined,
    });
    if (!pending) return this.conflict(id);

    const result = await this.payment.charge({ amountCents: pending.priceCents, idempotencyKey: request.idempotencyKey });
    return ok(await this.applyPaymentResult(pending, result));
  }

  private async reconcile(session: CheckoutSession): Promise<CheckoutSession> {
    switch (session.status) {
      case 'COMPLETED':
      case 'EXPIRED':
        return session;

      case 'PAYMENT_PENDING':
        // No paymentId yet means the charge request itself is still in flight.
        // Note the hold deadline is deliberately not enforced here: expiring mid-charge
        // could take the fan's money for tickets we no longer hold.
        if (!session.paymentId) return session;
        return this.applyPaymentResult(session, await this.payment.getStatus(session.paymentId));

      case 'OPEN':
      case 'PRICE_CHANGED': {
        if (this.now() >= session.expiresAt) return this.expire(session, 'HOLD_TIMEOUT');
        const listing = await this.inventory.getListing(session.listingId);
        if (!listing) return this.expire(session, 'LISTING_UNAVAILABLE');
        return this.applyCurrentPrice(session, listing.priceCents);
      }
    }
  }

  private async applyCurrentPrice(session: CheckoutSession, currentCents: number): Promise<CheckoutSession> {
    if (currentCents > session.priceCents) {
      // Increase: block payment until the fan explicitly accepts the new price, and drop any
      // earlier "price fell" notice so an increase is never framed as a discount.
      if (session.status === 'PRICE_CHANGED' && session.pendingPriceCents === currentCents) return session;
      return this.save(session, {
        status: 'PRICE_CHANGED',
        pendingPriceCents: currentCents,
        priceDropFromCents: undefined,
      });
    }

    if (currentCents < session.priceCents) {
      // Decrease: apply it automatically and keep the old price so the UI can show the drop.
      return this.save(session, {
        status: 'OPEN',
        priceCents: currentCents,
        pendingPriceCents: undefined,
        priceDropFromCents: session.priceDropFromCents ?? session.priceCents,
      });
    }

    // Back to the agreed price (e.g. an increase was reverted before the fan saw it).
    if (session.status === 'PRICE_CHANGED') {
      return this.save(session, { status: 'OPEN', pendingPriceCents: undefined });
    }
    return session;
  }

  private async applyPaymentResult(session: CheckoutSession, result: PaymentResult): Promise<CheckoutSession> {
    switch (result.status) {
      case 'pending':
        if (session.paymentId === result.paymentId) return session;
        return this.save(session, { paymentId: result.paymentId });

      case 'approved': {
        const next = await this.transition(session, {
          status: 'COMPLETED',
          paymentId: result.paymentId,
          orderId: `ord_${randomUUID().slice(0, 8)}`,
        });
        if (!next) return this.latest(session.id);
        await this.inventory.markSold(session.listingId);
        return next;
      }

      case 'declined':
        // The hold wasn't enforced during payment, so it may have lapsed in the meantime.
        if (this.now() >= session.expiresAt) return this.expire(session, 'HOLD_TIMEOUT');
        return this.save(session, { status: 'OPEN', paymentId: undefined, lastError: result.reason });
    }
  }

  private async expire(session: CheckoutSession, reason: ExpiredReason): Promise<CheckoutSession> {
    const next = await this.transition(session, {
      status: 'EXPIRED',
      expiredReason: reason,
      pendingPriceCents: undefined,
    });
    if (!next) return this.latest(session.id);
    // Release only after the save succeeds: if another request changed the session first
    // (say, started payment), releasing the hold here would be wrong.
    await this.inventory.release(session.listingId, session.id);
    return next;
  }

  /** Applies changes as a new version. Returns null if someone else changed the session first. */
  private async transition(
    session: CheckoutSession,
    changes: Partial<CheckoutSession>,
  ): Promise<CheckoutSession | null> {
    const next = { ...session, ...changes, version: session.version + 1, updatedAt: this.now() };
    return (await this.store.compareAndSet(session.id, session.version, next)) ? next : null;
  }

  /** For background updates during reconcile: if we lose a race, the winner's version is newer anyway. */
  private async save(session: CheckoutSession, changes: Partial<CheckoutSession>): Promise<CheckoutSession> {
    return (await this.transition(session, changes)) ?? this.latest(session.id);
  }

  private async latest(id: string): Promise<CheckoutSession> {
    const session = await this.store.get(id);
    if (!session) throw new Error(`Session ${id} disappeared`);
    return session;
  }

  private async conflict(id: string): Promise<CheckoutResult> {
    return fail('VERSION_CONFLICT', await this.latest(id));
  }
}
