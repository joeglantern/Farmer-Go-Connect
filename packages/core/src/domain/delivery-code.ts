import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '@farmgo/config';
import { type Language, normalizeKenyanPhone } from '@farmgo/contracts';
import type { PrismaClient } from '@farmgo/db';
import { AppError, Errors } from '../errors.js';
import { render } from '../notifications/templates.js';
import { enqueue } from '../queues.js';

/** Wrong tries allowed before the code stops working (a new code resets the count). */
export const DELIVERY_CODE_MAX_ATTEMPTS = 5;
/** Shortest gap between two codes for the same stop. */
export const DELIVERY_CODE_RESEND_MS = 30_000;

/** Peppered hash of a code, bound to its stop so a hash cannot be reused on another stop. */
function hashCode(stopId: string, code: string) {
  return createHmac('sha256', env.BETTER_AUTH_SECRET).update(`delivery-code:${stopId}:${code}`).digest('hex');
}

/** "+254712345678" becomes "+254 7** *** 678". */
export function maskPhone(phone: string): string {
  const m = phone.match(/^\+254(\d)(\d{5})(\d{3})$/);
  if (m) return `+254 ${m[1]}** *** ${m[3]}`;
  return phone.length > 3 ? `${'*'.repeat(phone.length - 3)}${phone.slice(-3)}` : '***';
}

async function loadDropoff(prisma: PrismaClient, stopId: string, driverId: string, isAdmin: boolean) {
  const stop = await prisma.delivery.findUnique({
    where: { id: stopId },
    include: {
      route: true,
      order: {
        select: {
          code: true,
          buyerOrg: { select: { profile: { select: { phone: true } } } },
          createdBy: { select: { phoneNumber: true, preferredLanguage: true } },
        },
      },
    },
  });
  if (!stop) throw Errors.notFound('Stop');
  if (!isAdmin && stop.route.driverId !== driverId) throw Errors.forbidden('This stop is not on your route');
  return stop;
}

/**
 * Proof of delivery for recipients who cannot sign: text a 4-digit code to the buyer, who reads it
 * to the driver once they have their produce. Only the hash is stored; the code is never logged.
 */
export async function sendDeliveryCode(
  prisma: PrismaClient,
  stopId: string,
  driverId: string,
  isAdmin = false,
  /** Test hook: receives the code (the API stores it for the test suite only). */
  onCode?: (code: string) => Promise<void>,
): Promise<{ sentTo: string }> {
  const stop = await loadDropoff(prisma, stopId, driverId, isAdmin);
  if (stop.kind !== 'DROPOFF') {
    throw Errors.conflict('DELIVERY_CODE_NOT_AVAILABLE', 'A delivery code is only for drop-offs');
  }
  if (stop.route.status !== 'IN_PROGRESS') {
    throw Errors.conflict('DELIVERY_CODE_NOT_AVAILABLE', 'Start the route before sending a delivery code');
  }
  if (stop.status === 'COMPLETED' || stop.status === 'FAILED' || stop.status === 'SKIPPED') {
    throw Errors.conflict('DELIVERY_CODE_NOT_AVAILABLE', 'This stop is already closed');
  }
  const raw = stop.order.buyerOrg.profile?.phone ?? stop.order.createdBy.phoneNumber;
  const phone = raw ? (normalizeKenyanPhone(raw) ?? raw) : null;
  if (!phone) {
    throw Errors.conflict('DELIVERY_CODE_NO_PHONE', 'The buyer has no phone number to send a code to');
  }

  const code = String(randomInt(0, 10_000)).padStart(4, '0');
  const now = new Date();
  // Claim the send atomically so two taps in a row cannot both send.
  const claimed = await prisma.delivery.updateMany({
    where: {
      id: stop.id,
      OR: [
        { deliveryCodeSentAt: null },
        { deliveryCodeSentAt: { lte: new Date(now.getTime() - DELIVERY_CODE_RESEND_MS) } },
      ],
    },
    data: { deliveryCodeHash: hashCode(stop.id, code), deliveryCodeSentAt: now, deliveryCodeAttempts: 0 },
  });
  if (claimed.count !== 1) {
    throw new AppError(
      'DELIVERY_CODE_TOO_SOON',
      'A code was just sent. Wait 30 seconds before sending another',
      429,
    );
  }
  const lang: Language = stop.order.createdBy.preferredLanguage === 'en' ? 'en' : 'sw';
  const { sms } = render('delivery_code', lang, { code: stop.order.code, pin: code });
  await enqueue('notify', 'sms', { to: phone, message: sms, kind: 'transactional' }, { attempts: 3 });
  if (onCode) await onCode(code);
  return { sentTo: maskPhone(phone) };
}

/**
 * Check a code the driver typed in. Runs outside the completion transaction so a wrong try is
 * counted even though the completion is refused. Throws unless the code is right.
 */
export async function verifyDeliveryCode(
  prisma: PrismaClient,
  stopId: string,
  code: string,
  driverId: string,
  isAdmin = false,
): Promise<void> {
  const stop = await loadDropoff(prisma, stopId, driverId, isAdmin);
  if (stop.kind !== 'DROPOFF' || !stop.deliveryCodeHash) {
    throw Errors.conflict('DELIVERY_CODE_NOT_SENT', 'Send the buyer a delivery code first');
  }
  if (stop.deliveryCodeAttempts >= DELIVERY_CODE_MAX_ATTEMPTS) {
    throw Errors.conflict('DELIVERY_CODE_LOCKED', 'Too many wrong codes. Send the buyer a new code');
  }
  const expected = Buffer.from(stop.deliveryCodeHash, 'hex');
  const given = Buffer.from(hashCode(stop.id, code), 'hex');
  if (expected.length === given.length && timingSafeEqual(expected, given)) return;
  const after = await prisma.delivery.update({
    where: { id: stop.id },
    data: { deliveryCodeAttempts: { increment: 1 } },
    select: { deliveryCodeAttempts: true },
  });
  if (after.deliveryCodeAttempts > DELIVERY_CODE_MAX_ATTEMPTS) {
    throw Errors.conflict('DELIVERY_CODE_LOCKED', 'Too many wrong codes. Send the buyer a new code');
  }
  throw Errors.badRequest('DELIVERY_CODE_WRONG', 'That code is not right. Ask the buyer to check the SMS');
}
