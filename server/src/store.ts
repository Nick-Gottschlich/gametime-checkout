import type { CheckoutSession } from './types.js';

export interface SessionStore {
  get(id: string): Promise<CheckoutSession | undefined>;
  insert(session: CheckoutSession): Promise<void>;
  /**
   * Saves `next` only if the stored session is still at `expectedVersion`, and reports whether
   * it saved. This is the single guard against two devices changing the same session at once.
   * In Postgres it would be `UPDATE ... WHERE id = $1 AND version = $2`.
   */
  compareAndSet(id: string, expectedVersion: number, next: CheckoutSession): Promise<boolean>;
}

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, CheckoutSession>();

  // Copies in and out so callers can't mutate stored state by accident — like a real DB boundary.
  async get(id: string) {
    const session = this.sessions.get(id);
    return session && structuredClone(session);
  }

  async insert(session: CheckoutSession) {
    this.sessions.set(session.id, structuredClone(session));
  }

  // No `await` between the check and the write, so in a single Node process this is atomic.
  async compareAndSet(id: string, expectedVersion: number, next: CheckoutSession) {
    const current = this.sessions.get(id);
    if (!current || current.version !== expectedVersion) return false;
    this.sessions.set(id, structuredClone(next));
    return true;
  }
}
