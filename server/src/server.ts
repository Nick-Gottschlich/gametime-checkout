import { buildApp } from './app.js';

const PORT = Number(process.env.PORT ?? 4000);

const app = buildApp({
  holdMs: process.env.HOLD_MS ? Number(process.env.HOLD_MS) : undefined,
  demoRoutes: process.env.NODE_ENV !== 'production',
});

// 0.0.0.0 (not localhost) so other devices on the network can reach it.
app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
  console.log(`Checkout API listening on http://localhost:${PORT}`);
});
