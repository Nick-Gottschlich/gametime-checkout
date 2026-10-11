import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const LISTING_ID = 'gsw-lal-112'; // from DEMO_LISTINGS, $150

function setup() {
  const app = buildApp({ now: () => 1_000_000, holdMs: 10 * 60 * 1000 });

  const post = (url: string, payload: object = {}) => app.inject({ method: 'POST', url, payload });
  const get = (url: string) => app.inject({ method: 'GET', url });

  async function createSession() {
    const res = await post('/sessions', { listingId: LISTING_ID });
    return res.json().session;
  }

  return { post, get, createSession };
}

describe('POST /sessions', () => {
  it('creates a session and returns it with the server time', async () => {
    const { post } = setup();
    const res = await post('/sessions', { listingId: LISTING_ID });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ session: { status: 'OPEN', priceCents: 15000 }, serverNow: 1_000_000 });
  });

  it('rejects a body without a listingId', async () => {
    const { post } = setup();
    expect((await post('/sessions', {})).statusCode).toBe(400);
  });

  it('returns 409 when the listing is already held', async () => {
    const { post, createSession } = setup();
    await createSession();

    const res = await post('/sessions', { listingId: LISTING_ID });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('LISTING_UNAVAILABLE');
  });
});

describe('GET /sessions/:id', () => {
  it('returns the session without server-only fields, and forbids caching', async () => {
    const { post, get, createSession } = setup();
    const session = await createSession();
    await post(`/sessions/${session.id}/complete`, { version: session.version, idempotencyKey: 'k1' });

    const res = await get(`/sessions/${session.id}`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json().session.status).toBe('COMPLETED');
    expect(res.json().session).not.toHaveProperty('completionKey');
    expect(res.json().session).not.toHaveProperty('paymentId');
  });

  it('returns 404 for an unknown session', async () => {
    const { get } = setup();
    expect((await get('/sessions/nope')).statusCode).toBe(404);
  });
});

describe('POST /sessions/:id/complete', () => {
  it('rejects a request without an idempotency key', async () => {
    const { post, createSession } = setup();
    const session = await createSession();

    const res = await post(`/sessions/${session.id}/complete`, { version: session.version });
    expect(res.statusCode).toBe(400);
  });

  it('ignores a client-supplied amount instead of trusting it', async () => {
    const { post, createSession } = setup();
    const session = await createSession();

    const res = await post(`/sessions/${session.id}/complete`, {
      version: session.version,
      idempotencyKey: 'k1',
      amountCents: 1,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().session).toMatchObject({ status: 'COMPLETED', priceCents: 15000 });
  });

  it('returns 409 with the latest session when the price went up', async () => {
    const { post, createSession } = setup();
    const session = await createSession();
    await post(`/demo/listings/${LISTING_ID}/price`, { priceCents: 18000 });

    const res = await post(`/sessions/${session.id}/complete`, { version: session.version, idempotencyKey: 'k1' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: 'INVALID_STATE',
      session: { status: 'PRICE_CHANGED', pendingPriceCents: 18000 },
    });
  });
});

describe('POST /sessions/:id/accept-price', () => {
  it('accepts the new price so checkout can continue', async () => {
    const { post, get, createSession } = setup();
    const session = await createSession();
    await post(`/demo/listings/${LISTING_ID}/price`, { priceCents: 18000 });
    const changed = (await get(`/sessions/${session.id}`)).json().session;

    const res = await post(`/sessions/${session.id}/accept-price`, { version: changed.version });
    expect(res.statusCode).toBe(200);
    expect(res.json().session).toMatchObject({ status: 'OPEN', priceCents: 18000 });
  });
});

describe('demo controls', () => {
  it('fast-forwarding the clock expires the session', async () => {
    const { post, get, createSession } = setup();
    const session = await createSession();

    await post('/demo/clock/advance', { ms: 10 * 60 * 1000 });
    const res = await get(`/sessions/${session.id}`);
    expect(res.json().session).toMatchObject({ status: 'EXPIRED', expiredReason: 'HOLD_TIMEOUT' });
  });

  it('settling a pending payment completes the session', async () => {
    const { post, get, createSession } = setup();
    const session = await createSession();

    await post('/demo/payment/next-outcome', { outcome: 'pending' });
    const pending = await post(`/sessions/${session.id}/complete`, { version: session.version, idempotencyKey: 'k1' });
    expect(pending.json().session.status).toBe('PAYMENT_PENDING');

    await post(`/demo/sessions/${session.id}/settle-payment`, { outcome: 'approved' });
    expect((await get(`/sessions/${session.id}`)).json().session.status).toBe('COMPLETED');
  });
});
