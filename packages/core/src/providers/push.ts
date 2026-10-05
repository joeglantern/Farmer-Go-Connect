import { env } from '@farmgo/config';
import { logger } from '../logger.js';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushTicket {
  token: string;
  ok: boolean;
  /** True when the device token is no longer valid and should be deleted. */
  invalidToken?: boolean;
  error?: string;
}

export interface PushProvider {
  readonly name: string;
  send(messages: PushMessage[]): Promise<PushTicket[]>;
}

export class ConsolePush implements PushProvider {
  readonly name = 'console';
  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    for (const m of messages)
      logger.info({ to: m.to, title: m.title, body: m.body }, 'push (console provider)');
    return messages.map((m) => ({ token: m.to, ok: true }));
  }
}

/** Expo push service (wraps FCM and APNs). */
export class ExpoPush implements PushProvider {
  readonly name = 'expo';
  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(chunk.map((m) => ({ ...m, sound: 'default', priority: 'high' }))),
      });
      const json = (await res.json()) as {
        data?: { status: 'ok' | 'error'; message?: string; details?: { error?: string } }[];
      };
      chunk.forEach((m, idx) => {
        const t = json.data?.[idx];
        tickets.push({
          token: m.to,
          ok: t?.status === 'ok',
          invalidToken: t?.details?.error === 'DeviceNotRegistered',
          error: t?.message,
        });
      });
    }
    return tickets;
  }
}

let provider: PushProvider | undefined;
export function getPushProvider(): PushProvider {
  provider ??= env.PUSH_PROVIDER === 'expo' ? new ExpoPush() : new ConsolePush();
  return provider;
}
export function setPushProvider(p: PushProvider) {
  provider = p;
}
