import type { FastifyInstance, FastifyReply } from 'fastify';
import type { CheckoutError, CheckoutResult, CheckoutService } from '../checkout.js';
import type { CheckoutSession } from '../types.js';

// What clients see. The idempotency key and payment provider id are server-side bookkeeping.
export type SessionView = Omit<CheckoutSession, 'completionKey' | 'paymentId'>;

export function toView({ completionKey, paymentId, ...view }: CheckoutSession): SessionView {
  return view;
}

// Record<CheckoutError, ...> means adding a new error without a status code is a compile error.
const STATUS_BY_ERROR: Record<CheckoutError, number> = {
  NOT_FOUND: 404,
  LISTING_UNAVAILABLE: 409,
  VERSION_CONFLICT: 409,
  INVALID_STATE: 409,
};

// Request schemas. Fastify rejects anything that doesn't match with a 400 before our code
// runs. Unknown fields (say, an "amountCents" a client tries to sneak in) are stripped.
const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } },
} as const;

const createBody = {
  type: 'object',
  required: ['listingId'],
  additionalProperties: false,
  properties: { listingId: { type: 'string', minLength: 1 } },
} as const;

const acceptPriceBody = {
  type: 'object',
  required: ['version'],
  additionalProperties: false,
  properties: { version: { type: 'integer', minimum: 1 } },
} as const;

const completeBody = {
  type: 'object',
  required: ['version', 'idempotencyKey'],
  additionalProperties: false,
  properties: {
    version: { type: 'integer', minimum: 1 },
    idempotencyKey: { type: 'string', minLength: 1, maxLength: 128 },
  },
} as const;

export function registerSessionRoutes(app: FastifyInstance, deps: { checkout: CheckoutService; now: () => number }) {
  const { checkout, now } = deps;

  // Every response carries serverNow so clients can correct for their own clock being off
  // when they count down to expiresAt.
  function send(reply: FastifyReply, result: CheckoutResult, successStatus = 200) {
    // Session state changes constantly; never let a browser or CDN serve a cached copy.
    reply.header('Cache-Control', 'no-store');
    if (result.ok) {
      return reply.code(successStatus).send({ session: toView(result.session), serverNow: now() });
    }
    return reply.code(STATUS_BY_ERROR[result.error]).send({
      error: result.error,
      session: result.session && toView(result.session),
      serverNow: now(),
    });
  }

  app.post<{ Body: { listingId: string } }>('/sessions', { schema: { body: createBody } }, async (req, reply) =>
    send(reply, await checkout.create(req.body.listingId), 201),
  );

  // Initial page load, polling, and opening a shared/deep link all hit this.
  app.get<{ Params: { id: string } }>('/sessions/:id', { schema: { params: idParams } }, async (req, reply) =>
    send(reply, await checkout.resume(req.params.id)),
  );

  app.post<{ Params: { id: string }; Body: { version: number } }>(
    '/sessions/:id/accept-price',
    { schema: { params: idParams, body: acceptPriceBody } },
    async (req, reply) => send(reply, await checkout.acceptPrice(req.params.id, req.body.version)),
  );

  app.post<{ Params: { id: string }; Body: { version: number; idempotencyKey: string } }>(
    '/sessions/:id/complete',
    { schema: { params: idParams, body: completeBody } },
    async (req, reply) => send(reply, await checkout.complete(req.params.id, req.body)),
  );
}
