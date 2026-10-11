import { describe, expect, it } from 'vitest';
import { CheckoutService } from '../src/checkout.js';
import { FakeInventoryService } from '../src/services/inventory.js';
import { FakePaymentService } from '../src/services/payment.js';
import { InMemorySessionStore } from '../src/store.js';
import type { CheckoutSession } from '../src/types.js';

const HOLD_MS = 10 * 60 * 1000;
const LISTING = {
  id: 'listing-1',
  eventName: 'Warriors vs. Lakers',
  section: '112',
  row: 'F',
  quantity: 2,
  priceCents: 15000,
};

function setup() {
  let now = 1_000_000;
  const inventory = new FakeInventoryService([LISTING]);
  const payment = new FakePaymentService();
  const checkout = new CheckoutService({
    store: new InMemorySessionStore(),
    inventory,
    payment,
    now: () => now,
    holdMs: HOLD_MS,
  });
  const advance = (ms: number) => {
    now += ms;
  };
  return { checkout, inventory, payment, advance };
}

// Creates a session and returns it, failing the test if creation didn't succeed.
async function createSession(checkout: CheckoutService): Promise<CheckoutSession> {
  const result = await checkout.create(LISTING.id);
  if (!result.ok) throw new Error(`create failed: ${result.error}`);
  return result.session;
}

describe('creating a session', () => {
  it('starts OPEN with the listing price and a hold deadline', async () => {
    const { checkout } = setup();
    const session = await createSession(checkout);

    expect(session.status).toBe('OPEN');
    expect(session.priceCents).toBe(15000);
    expect(session.expiresAt).toBe(1_000_000 + HOLD_MS);
    expect(session.listing.eventName).toBe('Warriors vs. Lakers');
  });

  it('fails while another session holds the listing', async () => {
    const { checkout } = setup();
    await createSession(checkout);

    const second = await checkout.create(LISTING.id);
    expect(second).toMatchObject({ ok: false, error: 'LISTING_UNAVAILABLE' });
  });
});

describe('resuming from a second surface', () => {
  it('returns the same session state to any device that has the id', async () => {
    const { checkout } = setup();
    const created = await createSession(checkout);

    const resumed = await checkout.resume(created.id);
    expect(resumed).toEqual({ ok: true, session: created });
  });

  it('returns NOT_FOUND for an unknown id', async () => {
    const { checkout } = setup();
    expect(await checkout.resume('nope')).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});

describe('expiration', () => {
  it('expires once the hold deadline passes, and releases the tickets', async () => {
    const { checkout, advance } = setup();
    const session = await createSession(checkout);

    advance(HOLD_MS);
    const resumed = await checkout.resume(session.id);
    expect(resumed.session).toMatchObject({ status: 'EXPIRED', expiredReason: 'HOLD_TIMEOUT' });

    // Released: someone else can now start checkout on the same listing.
    expect((await checkout.create(LISTING.id)).ok).toBe(true);
  });

  it('expires when the listing sells elsewhere', async () => {
    const { checkout, inventory } = setup();
    const session = await createSession(checkout);

    inventory.remove(LISTING.id);
    const resumed = await checkout.resume(session.id);
    expect(resumed.session).toMatchObject({ status: 'EXPIRED', expiredReason: 'LISTING_UNAVAILABLE' });
  });
});

describe('price changes', () => {
  it('blocks payment on a price increase until the fan accepts it', async () => {
    const { checkout, inventory, payment } = setup();
    const session = await createSession(checkout);

    inventory.setPrice(LISTING.id, 18000);
    const resumed = await checkout.resume(session.id);
    expect(resumed.session).toMatchObject({ status: 'PRICE_CHANGED', priceCents: 15000, pendingPriceCents: 18000 });

    const blocked = await checkout.complete(session.id, { version: resumed.session!.version, idempotencyKey: 'k1' });
    expect(blocked).toMatchObject({ ok: false, error: 'INVALID_STATE' });
    expect(payment.charges).toHaveLength(0);

    const accepted = await checkout.acceptPrice(session.id, resumed.session!.version);
    expect(accepted.session).toMatchObject({ status: 'OPEN', priceCents: 18000 });

    const completed = await checkout.complete(session.id, { version: accepted.session!.version, idempotencyKey: 'k2' });
    expect(completed.session?.status).toBe('COMPLETED');
    expect(payment.charges).toEqual([{ amountCents: 18000, idempotencyKey: 'k2' }]);
  });

  it('applies a price decrease automatically and remembers the old price', async () => {
    const { checkout, inventory } = setup();
    const session = await createSession(checkout);

    inventory.setPrice(LISTING.id, 12000);
    const resumed = await checkout.resume(session.id);
    expect(resumed.session).toMatchObject({ status: 'OPEN', priceCents: 12000, priceDropFromCents: 15000 });
  });

  it('drops the "price fell" notice once the price rises again', async () => {
    const { checkout, inventory } = setup();
    const session = await createSession(checkout);

    inventory.setPrice(LISTING.id, 12000);
    await checkout.resume(session.id);
    inventory.setPrice(LISTING.id, 14000); // back up, though still under the original $150
    const resumed = await checkout.resume(session.id);
    expect(resumed.session).toMatchObject({ status: 'PRICE_CHANGED', pendingPriceCents: 14000 });

    const accepted = await checkout.acceptPrice(session.id, resumed.session!.version);
    expect(accepted.session).toMatchObject({ status: 'OPEN', priceCents: 14000, priceDropFromCents: undefined });
  });

  it('rejects accepting a price the fan never saw', async () => {
    const { checkout, inventory } = setup();
    const session = await createSession(checkout);

    inventory.setPrice(LISTING.id, 18000);
    const firstLook = (await checkout.resume(session.id)).session!;
    inventory.setPrice(LISTING.id, 20000); // rises again before the fan taps Accept
    const accepted = await checkout.acceptPrice(session.id, firstLook.version);

    expect(accepted).toMatchObject({ ok: false, error: 'VERSION_CONFLICT' });
    expect(accepted.session?.pendingPriceCents).toBe(20000);
  });
});

describe('completing a purchase', () => {
  it('completes, and every device then sees COMPLETED', async () => {
    const { checkout } = setup();
    const session = await createSession(checkout);

    const completed = await checkout.complete(session.id, { version: session.version, idempotencyKey: 'k1' });
    expect(completed.session).toMatchObject({ status: 'COMPLETED', orderId: expect.any(String) });

    const otherDevice = await checkout.resume(session.id);
    expect(otherDevice.session?.status).toBe('COMPLETED');
  });

  it('rejects a stale version without charging', async () => {
    const { checkout, inventory, payment } = setup();
    const session = await createSession(checkout);

    inventory.setPrice(LISTING.id, 12000); // drop bumps the version
    const result = await checkout.complete(session.id, { version: session.version, idempotencyKey: 'k1' });

    expect(result).toMatchObject({ ok: false, error: 'VERSION_CONFLICT' });
    expect(payment.charges).toHaveLength(0);
  });

  it('charges exactly once when two devices tap Buy at the same moment', async () => {
    const { checkout, payment } = setup();
    const session = await createSession(checkout);

    const [laptop, phone] = await Promise.all([
      checkout.complete(session.id, { version: session.version, idempotencyKey: 'laptop' }),
      checkout.complete(session.id, { version: session.version, idempotencyKey: 'phone' }),
    ]);

    expect([laptop.ok, phone.ok].sort()).toEqual([false, true]);
    expect(payment.charges).toHaveLength(1);
  });

  it('treats a retry with the same idempotency key as the same purchase', async () => {
    const { checkout, payment } = setup();
    const session = await createSession(checkout);

    const first = await checkout.complete(session.id, { version: session.version, idempotencyKey: 'k1' });
    const retry = await checkout.complete(session.id, { version: session.version, idempotencyKey: 'k1' });

    expect(retry).toEqual(first);
    expect(payment.charges).toHaveLength(1);
  });

  it('returns to OPEN with an error on decline, and a new attempt can succeed', async () => {
    const { checkout, payment } = setup();
    const session = await createSession(checkout);

    payment.nextOutcome = 'declined';
    const declined = await checkout.complete(session.id, { version: session.version, idempotencyKey: 'k1' });
    expect(declined.session).toMatchObject({ status: 'OPEN', lastError: 'Card declined' });

    payment.nextOutcome = 'approved';
    const retried = await checkout.complete(session.id, { version: declined.session!.version, idempotencyKey: 'k2' });
    expect(retried.session).toMatchObject({ status: 'COMPLETED', lastError: undefined });
  });
});

describe('pending payment', () => {
  it('locks out other devices until the payment settles', async () => {
    const { checkout, payment } = setup();
    const session = await createSession(checkout);

    payment.nextOutcome = 'pending';
    const pending = await checkout.complete(session.id, { version: session.version, idempotencyKey: 'laptop' });
    expect(pending.session?.status).toBe('PAYMENT_PENDING');

    const phone = await checkout.complete(session.id, { version: pending.session!.version, idempotencyKey: 'phone' });
    expect(phone).toMatchObject({ ok: false, error: 'INVALID_STATE' });

    payment.settle(pending.session!.paymentId!, 'approved');
    const resumed = await checkout.resume(session.id);
    expect(resumed.session?.status).toBe('COMPLETED');
    expect(payment.charges).toHaveLength(1);
  });

  it('does not expire the hold while a payment is in flight', async () => {
    const { checkout, payment, advance } = setup();
    const session = await createSession(checkout);

    payment.nextOutcome = 'pending';
    const pending = await checkout.complete(session.id, { version: session.version, idempotencyKey: 'k1' });

    advance(HOLD_MS * 2);
    expect((await checkout.resume(session.id)).session?.status).toBe('PAYMENT_PENDING');

    payment.settle(pending.session!.paymentId!, 'approved');
    expect((await checkout.resume(session.id)).session?.status).toBe('COMPLETED');
  });

  it('expires if a pending payment is declined after the hold lapsed', async () => {
    const { checkout, payment, advance } = setup();
    const session = await createSession(checkout);

    payment.nextOutcome = 'pending';
    const pending = await checkout.complete(session.id, { version: session.version, idempotencyKey: 'k1' });

    advance(HOLD_MS);
    payment.settle(pending.session!.paymentId!, 'declined');
    expect((await checkout.resume(session.id)).session).toMatchObject({ status: 'EXPIRED', expiredReason: 'HOLD_TIMEOUT' });
  });
});
