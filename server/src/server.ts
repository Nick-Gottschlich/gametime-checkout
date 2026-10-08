import { buildApp } from './app.js';

const PORT = Number(process.env.PORT ?? 4000);

const app = buildApp();

// 0.0.0.0 (not localhost) so the Expo app on a phone or simulator can reach it over the LAN.
app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
  console.log(`Checkout API listening on http://localhost:${PORT}`);
});
