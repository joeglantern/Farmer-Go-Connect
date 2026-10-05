import { randomUUID } from 'node:crypto';
import { env } from '@farmgo/config';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

export interface StkPushRequest {
  phoneNumber: string; // E.164, +2547...
  amountCents: number;
  accountReference: string; // e.g. order code
  description: string;
}

export interface StkPushResponse {
  merchantRequestId: string;
  checkoutRequestId: string;
  customerMessage: string;
}

export interface StkQueryResult {
  /** "0" success, "1032" cancelled by user, "1037" timeout, other = failed; null = still pending */
  resultCode: string | null;
  resultDesc: string;
}

export interface B2CRequest {
  phoneNumber: string;
  amountCents: number;
  remarks: string;
  occasion?: string;
}

export interface B2CResponse {
  conversationId: string;
  originatorConversationId: string;
  /** Mock provider settles synchronously; Daraja reports the result via callback. */
  immediateResult?: { resultCode: string; resultDesc: string; receipt?: string };
}

export interface MpesaProvider {
  readonly name: 'mock' | 'daraja';
  stkPush(req: StkPushRequest): Promise<StkPushResponse>;
  stkQuery(checkoutRequestId: string): Promise<StkQueryResult>;
  b2c(req: B2CRequest): Promise<B2CResponse>;
}

/** M-Pesa takes whole shillings. We round up so the platform never under-collects. */
export const centsToShillings = (cents: number) => Math.ceil(cents / 100);
/** Daraja wants 2547XXXXXXXX (no plus). */
export const toMsisdn = (e164: string) => e164.replace(/^\+/, '');

export function darajaTimestamp(d = new Date()): string {
  // Daraja expects EAT (UTC+3) in yyyyMMddHHmmss
  const eat = new Date(d.getTime() + 3 * 3600_000);
  return eat
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
}

/**
 * Local/test provider. STK pushes "succeed" when queried, except for phone numbers ending
 * in 000 (cancelled) or 999 (failed), which makes failure paths easy to exercise.
 */
export class MockMpesa implements MpesaProvider {
  readonly name = 'mock' as const;
  private readonly pending = new Map<string, string>();

  async stkPush(req: StkPushRequest): Promise<StkPushResponse> {
    const checkoutRequestId = `ws_CO_${Date.now()}_${randomUUID().slice(0, 8)}`;
    this.pending.set(checkoutRequestId, req.phoneNumber);
    logger.info({ ...req, checkoutRequestId }, 'M-Pesa STK push (mock)');
    return {
      merchantRequestId: `mock-${randomUUID()}`,
      checkoutRequestId,
      customerMessage: 'Success. Request accepted for processing',
    };
  }

  async stkQuery(checkoutRequestId: string): Promise<StkQueryResult> {
    const phone = this.pending.get(checkoutRequestId) ?? '';
    if (phone.endsWith('000')) return { resultCode: '1032', resultDesc: 'Request cancelled by user' };
    if (phone.endsWith('999'))
      return { resultCode: '1', resultDesc: 'The balance is insufficient for the transaction' };
    return { resultCode: '0', resultDesc: 'The service request is processed successfully.' };
  }

  async b2c(req: B2CRequest): Promise<B2CResponse> {
    logger.info(req, 'M-Pesa B2C payout (mock)');
    const failed = req.phoneNumber.endsWith('999');
    return {
      conversationId: `AG_${Date.now()}_${randomUUID().slice(0, 8)}`,
      originatorConversationId: randomUUID(),
      immediateResult: failed
        ? { resultCode: '2001', resultDesc: 'The initiator information is invalid.' }
        : {
            resultCode: '0',
            resultDesc: 'The service request is processed successfully.',
            receipt: `MCK${Date.now().toString(36).toUpperCase()}`,
          },
    };
  }
}

/** Safaricom Daraja API. */
export class DarajaMpesa implements MpesaProvider {
  readonly name = 'daraja' as const;
  private token?: { value: string; expiresAt: number };
  private readonly base =
    env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const basic = Buffer.from(`${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`).toString('base64');
    const res = await fetch(`${this.base}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!res.ok) throw new AppError('MPESA_AUTH_FAILED', `Daraja auth failed (${res.status})`, 502);
    const json = (await res.json()) as { access_token: string; expires_in: string };
    this.token = { value: json.access_token, expiresAt: Date.now() + Number(json.expires_in) * 1000 };
    return this.token.value;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as T & { errorMessage?: string };
    if (!res.ok) {
      throw new AppError(
        'MPESA_REQUEST_FAILED',
        json.errorMessage ?? `Daraja ${path} failed (${res.status})`,
        502,
      );
    }
    return json;
  }

  private password(timestamp: string) {
    return Buffer.from(`${env.MPESA_SHORTCODE}${env.MPESA_PASSKEY}${timestamp}`).toString('base64');
  }

  private callback(path: string) {
    return `${env.MPESA_CALLBACK_BASE_URL}/webhooks/mpesa/${path}?token=${encodeURIComponent(env.MPESA_CALLBACK_TOKEN)}`;
  }

  async stkPush(req: StkPushRequest): Promise<StkPushResponse> {
    const Timestamp = darajaTimestamp();
    const msisdn = toMsisdn(req.phoneNumber);
    const res = await this.post<{
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResponseCode: string;
      ResponseDescription: string;
      CustomerMessage: string;
    }>('/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: env.MPESA_SHORTCODE,
      Password: this.password(Timestamp),
      Timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: centsToShillings(req.amountCents),
      PartyA: msisdn,
      PartyB: env.MPESA_SHORTCODE,
      PhoneNumber: msisdn,
      CallBackURL: this.callback('stk'),
      AccountReference: req.accountReference.slice(0, 12),
      TransactionDesc: req.description.slice(0, 13),
    });
    if (res.ResponseCode !== '0') throw new AppError('MPESA_STK_REJECTED', res.ResponseDescription, 502);
    return {
      merchantRequestId: res.MerchantRequestID,
      checkoutRequestId: res.CheckoutRequestID,
      customerMessage: res.CustomerMessage,
    };
  }

  async stkQuery(checkoutRequestId: string): Promise<StkQueryResult> {
    const Timestamp = darajaTimestamp();
    try {
      const res = await this.post<{ ResultCode?: string; ResultDesc?: string }>(
        '/mpesa/stkpushquery/v1/query',
        {
          BusinessShortCode: env.MPESA_SHORTCODE,
          Password: this.password(Timestamp),
          Timestamp,
          CheckoutRequestID: checkoutRequestId,
        },
      );
      return { resultCode: res.ResultCode ?? null, resultDesc: res.ResultDesc ?? '' };
    } catch (err) {
      // Daraja returns 500 "The transaction is being processed" while the prompt is still open.
      if (err instanceof AppError && /being processed/i.test(err.message)) {
        return { resultCode: null, resultDesc: err.message };
      }
      throw err;
    }
  }

  async b2c(req: B2CRequest): Promise<B2CResponse> {
    const originatorConversationId = randomUUID();
    const res = await this.post<{
      ConversationID: string;
      OriginatorConversationID: string;
      ResponseCode: string;
      ResponseDescription: string;
    }>('/mpesa/b2c/v3/paymentrequest', {
      OriginatorConversationID: originatorConversationId,
      InitiatorName: env.MPESA_B2C_INITIATOR,
      SecurityCredential: env.MPESA_B2C_SECURITY_CREDENTIAL,
      CommandID: 'BusinessPayment',
      Amount: Math.floor(req.amountCents / 100), // never overpay on payouts
      PartyA: env.MPESA_B2C_SHORTCODE,
      PartyB: toMsisdn(req.phoneNumber),
      Remarks: req.remarks.slice(0, 100),
      QueueTimeOutURL: this.callback('b2c/timeout'),
      ResultURL: this.callback('b2c/result'),
      Occasion: (req.occasion ?? '').slice(0, 100),
    });
    if (res.ResponseCode !== '0') throw new AppError('MPESA_B2C_REJECTED', res.ResponseDescription, 502);
    return {
      conversationId: res.ConversationID,
      originatorConversationId: res.OriginatorConversationID ?? originatorConversationId,
    };
  }
}

let provider: MpesaProvider | undefined;
export function getMpesa(): MpesaProvider {
  provider ??= env.MPESA_PROVIDER === 'daraja' ? new DarajaMpesa() : new MockMpesa();
  return provider;
}
export function setMpesa(p: MpesaProvider) {
  provider = p;
}

// ─── Callback payload parsing ────────────────────────────────

export interface StkCallback {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: string;
  resultDesc: string;
  amount?: number;
  receipt?: string;
  phoneNumber?: string;
}

export function parseStkCallback(body: unknown): StkCallback | null {
  const cb = (body as { Body?: { stkCallback?: Record<string, unknown> } })?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== 'string') return null;
  const items = ((cb.CallbackMetadata as { Item?: { Name: string; Value?: unknown }[] })?.Item ?? []).reduce<
    Record<string, unknown>
  >((acc, i) => {
    acc[i.Name] = i.Value;
    return acc;
  }, {});
  return {
    merchantRequestId: String(cb.MerchantRequestID ?? ''),
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode: String(cb.ResultCode),
    resultDesc: String(cb.ResultDesc ?? ''),
    amount: items.Amount !== undefined ? Number(items.Amount) : undefined,
    receipt: items.MpesaReceiptNumber !== undefined ? String(items.MpesaReceiptNumber) : undefined,
    phoneNumber: items.PhoneNumber !== undefined ? `+${items.PhoneNumber}` : undefined,
  };
}

export interface B2CResult {
  conversationId: string;
  originatorConversationId: string;
  resultCode: string;
  resultDesc: string;
  receipt?: string;
}

export function parseB2CResult(body: unknown): B2CResult | null {
  const r = (body as { Result?: Record<string, unknown> })?.Result;
  if (!r || typeof r.ConversationID !== 'string') return null;
  return {
    conversationId: r.ConversationID,
    originatorConversationId: String(r.OriginatorConversationID ?? ''),
    resultCode: String(r.ResultCode),
    resultDesc: String(r.ResultDesc ?? ''),
    receipt: r.TransactionID ? String(r.TransactionID) : undefined,
  };
}
