import { env } from '@farmgo/config';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

export interface SmsResult {
  provider: string;
  messageId?: string;
  status: 'sent' | 'failed';
  cost?: string;
}

export interface SmsProvider {
  readonly name: string;
  send(to: string, message: string): Promise<SmsResult>;
}

/** Development/test provider: logs the message and keeps the last few in memory. */
export class ConsoleSms implements SmsProvider {
  readonly name = 'console';
  static readonly sent: { to: string; message: string; at: Date }[] = [];

  async send(to: string, message: string): Promise<SmsResult> {
    ConsoleSms.sent.push({ to, message, at: new Date() });
    if (ConsoleSms.sent.length > 500) ConsoleSms.sent.shift();
    logger.info({ to, message }, 'SMS (console provider)');
    return { provider: this.name, status: 'sent', messageId: `console-${Date.now()}` };
  }

  static lastTo(to: string) {
    return [...ConsoleSms.sent].reverse().find((m) => m.to === to);
  }
}

/** Africa's Talking bulk SMS API. */
export class AfricasTalkingSms implements SmsProvider {
  readonly name = 'africastalking';
  private readonly url =
    env.AT_USERNAME === 'sandbox'
      ? 'https://api.sandbox.africastalking.com/version1/messaging'
      : 'https://api.africastalking.com/version1/messaging';

  async send(to: string, message: string): Promise<SmsResult> {
    const body = new URLSearchParams({ username: env.AT_USERNAME, to, message });
    if (env.AT_SENDER_ID) body.set('from', env.AT_SENDER_ID);
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        apiKey: env.AT_API_KEY,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) throw new AppError('SMS_FAILED', `Africa's Talking responded ${res.status}`, 502);
    const json = (await res.json()) as {
      SMSMessageData?: {
        Recipients?: { status: string; messageId: string; cost: string; statusCode: number }[];
      };
    };
    const r = json.SMSMessageData?.Recipients?.[0];
    const ok = !!r && (r.statusCode === 100 || r.statusCode === 101 || r.statusCode === 102);
    if (!ok) throw new AppError('SMS_FAILED', `SMS rejected: ${r?.status ?? 'no recipient'}`, 502);
    return { provider: this.name, status: 'sent', messageId: r.messageId, cost: r.cost };
  }
}

let provider: SmsProvider | undefined;
export function getSmsProvider(): SmsProvider {
  provider ??= env.SMS_PROVIDER === 'africastalking' ? new AfricasTalkingSms() : new ConsoleSms();
  return provider;
}
export function setSmsProvider(p: SmsProvider) {
  provider = p;
}
