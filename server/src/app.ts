import Fastify from 'fastify';

// Builds the app without starting it, so tests can call routes via app.inject()
// without opening a network port. server.ts is the only place that calls listen().
export function buildApp() {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ ok: true }));

  return app;
}
