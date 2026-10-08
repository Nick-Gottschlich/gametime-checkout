import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('health check', () => {
  it('responds ok', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
