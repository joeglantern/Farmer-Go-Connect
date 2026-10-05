import { timingSafeEqual } from 'node:crypto';
import { env, isProd } from '@farmgo/config';
import { ErrorBody } from '@farmgo/contracts';
import {
  applyPayoutOutcome,
  applyStkOutcome,
  checkCardStatus,
  getCard,
  getMpesa,
  logger,
  MockCard,
  parseB2CResult,
  parseStkCallback,
} from '@farmgo/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { typed } from '../lib/route.js';
import { UssdHandler } from './ussd.service.js';

const ACCEPTED = { ResultCode: 0, ResultDesc: 'Accepted' };

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * M-Pesa callbacks must carry our secret token, and (when configured) come from Safaricom's
 * published IP ranges.
 */
function mpesaAuthorized(req: FastifyRequest): boolean {
  const token = (req.query as { token?: string }).token ?? '';
  if (!safeEqual(token, env.MPESA_CALLBACK_TOKEN)) return false;
  if (env.MPESA_ALLOWED_IPS.length && !env.MPESA_ALLOWED_IPS.includes(req.ip)) return false;
  return true;
}

/** USSD callbacks must carry our secret (set in the Africa's Talking callback URL) and, when configured, come from AT's IPs. */
function ussdAuthorized(req: FastifyRequest): boolean {
  const token = (req.query as { token?: string }).token ?? '';
  if (!safeEqual(token, env.AT_USSD_TOKEN)) return false;
  if (env.AT_ALLOWED_IPS.length && !env.AT_ALLOWED_IPS.includes(req.ip)) return false;
  return true;
}

/** SMS delivery reports carry their own secret (AT_DLR_TOKEN in the registered URL) and the same IP rule. */
function dlrAuthorized(req: FastifyRequest): boolean {
  const token = (req.query as { token?: string }).token ?? '';
  if (!safeEqual(token, env.AT_DLR_TOKEN)) return false;
  if (env.AT_ALLOWED_IPS.length && !env.AT_ALLOWED_IPS.includes(req.ip)) return false;
  return true;
}

export default async function webhookRoutes(app: FastifyInstance) {
  const r = typed(app);
  const ussd = new UssdHandler(app.prisma, app.redis);

  r.post(
    '/webhooks/mpesa/stk',
    { schema: { tags: ['webhooks'], summary: 'Daraja STK push result' }, config: { rateLimit: false } },
    async (req, reply) => {
      if (!mpesaAuthorized(req)) return reply.status(403).send({ ResultCode: 1, ResultDesc: 'Forbidden' });
      const cb = parseStkCallback(req.body);
      if (!cb) {
        logger.warn({ body: req.body }, 'unreadable STK callback');
        return ACCEPTED;
      }
      let { resultCode, resultDesc } = cb;
      // Never trust a success callback alone: confirm it with Daraja before releasing goods.
      if (resultCode === '0' && getMpesa().name === 'daraja') {
        const check = await getMpesa()
          .stkQuery(cb.checkoutRequestId)
          .catch(() => null);
        if (check?.resultCode !== '0') {
          logger.warn(
            { cb, check },
            'STK success callback not confirmed by status query; leaving for reconcile',
          );
          return ACCEPTED;
        }
        resultCode = check.resultCode;
        resultDesc = check.resultDesc || resultDesc;
      }
      await applyStkOutcome(app.prisma, {
        checkoutRequestId: cb.checkoutRequestId,
        resultCode,
        resultDesc,
        receipt: cb.receipt,
        amountShillings: cb.amount,
        raw: req.body,
      });
      return ACCEPTED;
    },
  );

  r.post(
    '/webhooks/mpesa/b2c/result',
    { schema: { tags: ['webhooks'], summary: 'Daraja B2C payout result' }, config: { rateLimit: false } },
    async (req, reply) => {
      if (!mpesaAuthorized(req)) return reply.status(403).send({ ResultCode: 1, ResultDesc: 'Forbidden' });
      const res = parseB2CResult(req.body);
      if (res) {
        await applyPayoutOutcome(app.prisma, {
          conversationId: res.conversationId,
          resultCode: res.resultCode,
          resultDesc: res.resultDesc,
          receipt: res.receipt,
          raw: req.body,
        });
      }
      return ACCEPTED;
    },
  );

  r.post(
    '/webhooks/mpesa/b2c/timeout',
    { schema: { tags: ['webhooks'], summary: 'Daraja B2C queue timeout' }, config: { rateLimit: false } },
    async (req, reply) => {
      if (!mpesaAuthorized(req)) return reply.status(403).send({ ResultCode: 1, ResultDesc: 'Forbidden' });
      const res = parseB2CResult(req.body);
      if (res) {
        await applyPayoutOutcome(app.prisma, {
          conversationId: res.conversationId,
          resultCode: 'TIMEOUT',
          resultDesc: 'Queue timeout',
          raw: req.body,
        });
      }
      return ACCEPTED;
    },
  );

  r.post(
    '/webhooks/ussd',
    {
      schema: {
        tags: ['webhooks'],
        summary: "Africa's Talking USSD session step (callback URL must include ?token=AT_USSD_TOKEN)",
        body: z.object({
          sessionId: z.string(),
          serviceCode: z.string().optional(),
          phoneNumber: z.string(),
          text: z.string().default(''),
        }),
      },
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      if (!ussdAuthorized(req)) return reply.status(403).type('text/plain').send('END Forbidden');
      const out = await ussd.handle(req.body);
      return reply.type('text/plain').send(out);
    },
  );

  r.post(
    '/webhooks/sms/delivery-report',
    {
      schema: {
        tags: ['webhooks'],
        summary: "Africa's Talking SMS delivery report (callback URL must include ?token=AT_DLR_TOKEN)",
        body: z
          .object({
            id: z.string(),
            status: z.string(),
            phoneNumber: z.string().optional(),
            failureReason: z.string().optional(),
          })
          .passthrough(),
      },
      config: { rateLimit: { max: 600, timeWindow: '1 minute', keyGenerator: (req) => `dlr:${req.ip}` } },
      // Checked before the body is parsed, so strangers learn nothing about the expected shape.
      onRequest: async (req, reply) => {
        if (!dlrAuthorized(req)) return reply.status(403).send({ ok: false });
      },
    },
    async (req) => {
      if (req.body.status !== 'Success') {
        const { id, status, failureReason } = req.body;
        logger.warn({ report: { id, status, failureReason } }, 'SMS not delivered');
      }
      return { ok: true as const };
    },
  );

  // ─── Card payments (Pesapal IPN and the buyer's return) ─────────────────
  // The IPN carries no secret, so it is only a hint: the payment is confirmed with the provider's
  // status API (checkCardStatus) before anything is applied.
  const pesapalIpn = async (req: FastifyRequest) => {
    const src = { ...(req.query as Record<string, string>), ...((req.body as Record<string, string>) ?? {}) };
    const trackingId = src.OrderTrackingId ?? '';
    const payment = trackingId
      ? await app.prisma.payment.findUnique({ where: { checkoutRequestId: trackingId } })
      : null;
    if (payment?.method === 'CARD') await checkCardStatus(app.prisma, payment.id);
    else logger.warn({ trackingId }, 'pesapal IPN for unknown payment');
    return {
      orderNotificationType: src.OrderNotificationType ?? 'IPNCHANGE',
      orderTrackingId: trackingId,
      orderMerchantReference: src.OrderMerchantReference ?? '',
      status: payment ? 200 : 500,
    };
  };
  app.get(
    '/webhooks/pesapal',
    { schema: { tags: ['webhooks'], summary: 'Pesapal IPN (GET)' }, config: { rateLimit: false } },
    pesapalIpn,
  );
  app.post(
    '/webhooks/pesapal',
    { schema: { tags: ['webhooks'], summary: 'Pesapal IPN (POST)' }, config: { rateLimit: false } },
    pesapalIpn,
  );

  r.get(
    '/v1/payments/card-return',
    {
      schema: {
        tags: ['payments'],
        summary: 'Where the card page sends the buyer back: confirms the payment, then opens the app',
        description:
          'Redirects to farmgo://payment-return?paymentId=&status= (or the web app with app=web). ' +
          'The app then reads the order or checkout as usual.',
        querystring: z.object({
          paymentId: z.string().max(64),
          OrderTrackingId: z.string().max(100).optional(),
          app: z.enum(['native', 'web']).optional(),
        }),
        response: { 302: z.null().describe('Back to the app'), default: ErrorBody },
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const payment = await app.prisma.payment.findUnique({ where: { id: req.query.paymentId } });
      if (
        payment?.method === 'CARD' &&
        (!req.query.OrderTrackingId || req.query.OrderTrackingId === payment.checkoutRequestId)
      ) {
        await checkCardStatus(app.prisma, payment.id);
      }
      const after = payment ? await app.prisma.payment.findUnique({ where: { id: payment.id } }) : null;
      const qs = `paymentId=${encodeURIComponent(req.query.paymentId)}&status=${after?.status ?? 'UNKNOWN'}`;
      const target =
        req.query.app === 'web'
          ? `${env.WEB_URL.replace(/\/$/, '')}/payment-return?${qs}`
          : `${env.MOBILE_SCHEME}payment-return?${qs}`;
      return reply.redirect(target, 302);
    },
  );

  // Development only: a stand-in for the provider's hosted page when CARD_PROVIDER=mock.
  if (!isProd) {
    app.get('/dev/card/:trackingId', { schema: { hide: true } }, async (req, reply) => {
      const card = getCard();
      const back =
        card instanceof MockCard ? card.callbackFor((req.params as { trackingId: string }).trackingId) : null;
      if (!back) return reply.status(404).type('text/plain').send('Unknown mock card checkout');
      return reply
        .type('text/html')
        .send(
          `<!doctype html><meta name="viewport" content="width=device-width"><title>Test card payment</title>` +
            `<body style="font-family:sans-serif;padding:24px"><h1>Test card payment</h1>` +
            `<p>This stands in for the card page in development. No money moves.</p>` +
            `<p><a href="${back}" style="font-size:20px">Pay now</a></p></body>`,
        );
    });
  }
}
