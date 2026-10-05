import { randomUUID } from 'node:crypto';
import { env } from '@farmgo/config';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

/**
 * Card (and wallet) payments through a hosted checkout page. The buyer is sent to `redirectUrl`,
 * pays there, and the provider notifies us (IPN). We never trust the notification alone: every
 * result is confirmed with the provider's status API before money is applied.
 */
export interface CardCheckoutRequest {
  /** Our reference, unique per attempt (the Payment id). */
  reference: string;
  amountCents: number;
  description: string;
  /** Where the provider sends the buyer's browser afterwards. */
  callbackUrl: string;
  email?: string | null;
  phoneNumber?: string | null;
  name?: string | null;
}

export interface CardCheckoutResponse {
  trackingId: string;
  redirectUrl: string;
}

export type CardStatus = 'COMPLETED' | 'FAILED' | 'PENDING' | 'REVERSED';

export interface CardStatusResult {
  status: CardStatus;
  description: string;
  amountCents?: number;
  confirmationCode?: string;
}

export interface CardProvider {
  readonly name: 'mock' | 'pesapal' | 'disabled';
  createCheckout(req: CardCheckoutRequest): Promise<CardCheckoutResponse>;
  getStatus(trackingId: string): Promise<CardStatusResult>;
}

// ─── Pesapal API 3.0 ─────────────────────────────────────────

const PESAPAL_BASE = {
  sandbox: 'https://cybqa.pesapal.com/pesapalv3',
  live: 'https://pay.pesapal.com/v3',
} as const;

class PesapalCard implements CardProvider {
  readonly name = 'pesapal' as const;
  private token: { value: string; expiresAt: number } | null = null;
  private readonly base = PESAPAL_BASE[env.PESAPAL_ENV];

  private async auth(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const res = await fetch(`${this.base}/api/Auth/RequestToken`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        consumer_key: env.PESAPAL_CONSUMER_KEY,
        consumer_secret: env.PESAPAL_CONSUMER_SECRET,
      }),
    });
    const body = (await res.json()) as { token?: string; expiryDate?: string; error?: unknown };
    if (!res.ok || !body.token) {
      logger.error({ status: res.status, error: body.error }, 'pesapal: auth failed');
      throw new AppError('CARD_UNAVAILABLE', 'Card payments are not available right now. Try M-Pesa.', 502);
    }
    const expiresAt = body.expiryDate ? Date.parse(body.expiryDate) : Date.now() + 4 * 60_000;
    this.token = { value: body.token, expiresAt };
    return body.token;
  }

  async createCheckout(req: CardCheckoutRequest): Promise<CardCheckoutResponse> {
    const token = await this.auth();
    const res = await fetch(`${this.base}/api/Transactions/SubmitOrderRequest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        id: req.reference,
        currency: 'KES',
        amount: Number((req.amountCents / 100).toFixed(2)),
        description: req.description.slice(0, 100),
        callback_url: req.callbackUrl,
        notification_id: env.PESAPAL_IPN_ID,
        billing_address: {
          email_address: req.email ?? undefined,
          phone_number: req.phoneNumber?.replace(/^\+/, '') ?? undefined,
          first_name: req.name ?? undefined,
        },
      }),
    });
    const body = (await res.json()) as { order_tracking_id?: string; redirect_url?: string; error?: unknown };
    if (!res.ok || !body.order_tracking_id || !body.redirect_url) {
      logger.error({ status: res.status, error: body.error }, 'pesapal: order request failed');
      throw new AppError('CARD_UNAVAILABLE', 'Card payments are not available right now. Try M-Pesa.', 502);
    }
    return { trackingId: body.order_tracking_id, redirectUrl: body.redirect_url };
  }

  async getStatus(trackingId: string): Promise<CardStatusResult> {
    const token = await this.auth();
    const res = await fetch(
      `${this.base}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(trackingId)}`,
      { headers: { accept: 'application/json', authorization: `Bearer ${token}` } },
    );
    const body = (await res.json()) as {
      status_code?: number;
      payment_status_description?: string;
      amount?: number;
      confirmation_code?: string;
    };
    // status_code: 0 invalid (not paid yet), 1 completed, 2 failed, 3 reversed.
    const status: CardStatus =
      body.status_code === 1
        ? 'COMPLETED'
        : body.status_code === 2
          ? 'FAILED'
          : body.status_code === 3
            ? 'REVERSED'
            : 'PENDING';
    return {
      status,
      description: body.payment_status_description ?? status,
      amountCents: body.amount !== undefined ? Math.round(body.amount * 100) : undefined,
      confirmationCode: body.confirmation_code,
    };
  }
}

// ─── Mock (development and tests) ────────────────────────────

/**
 * Settles as soon as the status is checked. A description containing "decline" fails, so tests and
 * the app can exercise the failure path.
 */
export class MockCard implements CardProvider {
  readonly name = 'mock' as const;
  private readonly orders = new Map<string, CardCheckoutRequest>();

  async createCheckout(req: CardCheckoutRequest): Promise<CardCheckoutResponse> {
    const trackingId = `mock-card-${randomUUID()}`;
    this.orders.set(trackingId, req);
    return { trackingId, redirectUrl: `${env.API_URL}/dev/card/${trackingId}` };
  }

  /** The return address of a mock checkout (the development stand-in page sends the buyer there). */
  callbackFor(trackingId: string): string | null {
    const order = this.orders.get(trackingId);
    return order
      ? `${order.callbackUrl}${order.callbackUrl.includes('?') ? '&' : '?'}OrderTrackingId=${trackingId}`
      : null;
  }

  async getStatus(trackingId: string): Promise<CardStatusResult> {
    const order = this.orders.get(trackingId);
    if (!order) return { status: 'PENDING', description: 'Unknown order' };
    if (/decline/i.test(order.description)) return { status: 'FAILED', description: 'Card declined' };
    return {
      status: 'COMPLETED',
      description: 'Completed',
      amountCents: order.amountCents,
      confirmationCode: `MCK${trackingId.slice(-6).toUpperCase()}`,
    };
  }
}

class DisabledCard implements CardProvider {
  readonly name = 'disabled' as const;
  async createCheckout(): Promise<CardCheckoutResponse> {
    throw new AppError(
      'PAYMENT_METHOD_UNAVAILABLE',
      'Card payments are not available. Pay with M-Pesa.',
      400,
    );
  }
  async getStatus(): Promise<CardStatusResult> {
    return { status: 'PENDING', description: 'Card payments are disabled' };
  }
}

let provider: CardProvider | undefined;
export function getCard(): CardProvider {
  provider ??=
    env.CARD_PROVIDER === 'pesapal'
      ? new PesapalCard()
      : env.CARD_PROVIDER === 'mock'
        ? new MockCard()
        : new DisabledCard();
  return provider;
}
export function setCard(p: CardProvider) {
  provider = p;
}
export const cardEnabled = () => getCard().name !== 'disabled';
