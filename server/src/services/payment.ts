export type PaymentResult =
  | { status: 'approved'; paymentId: string }
  | { status: 'pending'; paymentId: string } // e.g. bank verification; settles later
  | { status: 'declined'; reason: string };

// Stand-in for a payment provider like Stripe or Braintree.
export interface PaymentService {
  /** Real providers also dedupe on idempotencyKey; we pass it through but don't rely on it. */
  charge(request: { amountCents: number; idempotencyKey: string }): Promise<PaymentResult>;
  getStatus(paymentId: string): Promise<PaymentResult>;
}

export class FakePaymentService implements PaymentService {
  /** What the next charge() returns. Tests and the demo flip this. */
  nextOutcome: PaymentResult['status'] = 'approved';
  /** Every charge attempted — lets tests assert "exactly one charge". */
  readonly charges: { amountCents: number; idempotencyKey: string }[] = [];
  private results = new Map<string, PaymentResult>();

  async charge(request: { amountCents: number; idempotencyKey: string }): Promise<PaymentResult> {
    this.charges.push(request);
    if (this.nextOutcome === 'declined') return { status: 'declined', reason: 'Card declined' };

    const paymentId = `pay_${this.charges.length}`;
    const result = { status: this.nextOutcome, paymentId };
    this.results.set(paymentId, result);
    return result;
  }

  async getStatus(paymentId: string): Promise<PaymentResult> {
    return this.results.get(paymentId) ?? { status: 'declined', reason: 'Unknown payment' };
  }

  /** Resolves a pending payment, as the provider eventually would. */
  settle(paymentId: string, outcome: 'approved' | 'declined') {
    this.results.set(
      paymentId,
      outcome === 'approved' ? { status: 'approved', paymentId } : { status: 'declined', reason: 'Card declined' },
    );
  }
}
