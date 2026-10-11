import Fastify from 'fastify';
import { CheckoutService } from './checkout.js';
import { registerDemoRoutes } from './routes/demo.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { DEMO_LISTINGS } from './seed.js';
import { FakeInventoryService } from './services/inventory.js';
import { FakePaymentService } from './services/payment.js';
import { InMemorySessionStore } from './store.js';
import type { Listing } from './types.js';

export interface AppOptions {
  now?: () => number;
  holdMs?: number;
  listings?: Listing[];
  demoRoutes?: boolean;
}

// Builds the app without starting it, so tests can call routes via app.inject()
// without opening a network port. server.ts is the only place that calls listen().
export function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: false });

  // The demo's fast-forward button shifts this offset; it's always 0 otherwise.
  const clock = { offsetMs: 0 };
  const baseNow = options.now ?? Date.now;
  const now = () => baseNow() + clock.offsetMs;

  // The one place the real pieces get wired together. Swapping a fake for a real
  // service means changing a line here, not in checkout.ts.
  const inventory = new FakeInventoryService(options.listings ?? DEMO_LISTINGS);
  const payment = new FakePaymentService();
  const checkout = new CheckoutService({
    store: new InMemorySessionStore(),
    inventory,
    payment,
    now,
    holdMs: options.holdMs,
  });

  app.get('/health', async () => ({ ok: true }));
  registerSessionRoutes(app, { checkout, now });
  if (options.demoRoutes ?? true) registerDemoRoutes(app, { checkout, inventory, payment, clock });

  return app;
}
