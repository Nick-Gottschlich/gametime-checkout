import type { FastifyInstance } from 'fastify';
import type { CheckoutService } from '../checkout.js';
import type { FakeInventoryService } from '../services/inventory.js';
import type { FakePaymentService } from '../services/payment.js';

// Demo-only controls that simulate the outside world changing around a session.
// They exist so the UI can trigger each state transition on demand; production has no equivalent.
export function registerDemoRoutes(
  app: FastifyInstance,
  deps: {
    checkout: CheckoutService;
    inventory: FakeInventoryService;
    payment: FakePaymentService;
    clock: { offsetMs: number };
  },
) {
  const { checkout, inventory, payment, clock } = deps;

  app.get('/demo/listings', async () => ({ listings: inventory.allListings() }));

  app.post<{ Params: { id: string }; Body: { priceCents: number } }>(
    '/demo/listings/:id/price',
    {
      schema: {
        body: {
          type: 'object',
          required: ['priceCents'],
          properties: { priceCents: { type: 'integer', minimum: 1 } },
        },
      },
    },
    async (req) => {
      inventory.setPrice(req.params.id, req.body.priceCents);
      return { ok: true };
    },
  );

  // Simulates the listing selling on another platform or the seller pulling it.
  app.post<{ Params: { id: string } }>('/demo/listings/:id/remove', async (req) => {
    inventory.remove(req.params.id);
    return { ok: true };
  });

  app.post<{ Body: { outcome: 'approved' | 'pending' | 'declined' } }>(
    '/demo/payment/next-outcome',
    {
      schema: {
        body: {
          type: 'object',
          required: ['outcome'],
          properties: { outcome: { enum: ['approved', 'pending', 'declined'] } },
        },
      },
    },
    async (req) => {
      payment.nextOutcome = req.body.outcome;
      return { ok: true };
    },
  );

  // Plays the payment provider finishing a pending charge.
  app.post<{ Params: { id: string }; Body: { outcome: 'approved' | 'declined' } }>(
    '/demo/sessions/:id/settle-payment',
    {
      schema: {
        body: {
          type: 'object',
          required: ['outcome'],
          properties: { outcome: { enum: ['approved', 'declined'] } },
        },
      },
    },
    async (req, reply) => {
      const result = await checkout.resume(req.params.id);
      if (!result.ok || !result.session.paymentId) return reply.code(409).send({ error: 'NO_PENDING_PAYMENT' });
      payment.settle(result.session.paymentId, req.body.outcome);
      return { ok: true };
    },
  );

  // Fast-forwards the server clock so expiry can be shown without waiting 10 minutes.
  app.post<{ Body: { ms: number } }>(
    '/demo/clock/advance',
    {
      schema: {
        body: { type: 'object', required: ['ms'], properties: { ms: { type: 'integer', minimum: 1 } } },
      },
    },
    async (req) => {
      clock.offsetMs += req.body.ms;
      return { offsetMs: clock.offsetMs };
    },
  );
}
