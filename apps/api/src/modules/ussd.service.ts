import { randomUUID } from 'node:crypto';
import { Cents, COUNTIES, normalizeKenyanPhone, phoneTempEmail, Quantity } from '@farmgo/contracts';
import { AppError, acceptMatch, demandBoard, emit, logger, rejectMatch, transitionOrder } from '@farmgo/core';
import { num, type PrismaClient } from '@farmgo/db';
import type { Redis } from 'ioredis';
import { bumpUser } from '../lib/session-cache.js';
import { createListing } from './supply.service.js';

/**
 * USSD menu for farmers on feature phones (Africa's Talking). Each request carries the whole
 * session's input as `text` ("1*3*50"); lists shown to the user are snapshotted in Redis per
 * session so the numbering stays stable while they navigate.
 */
export interface UssdRequest {
  sessionId: string;
  phoneNumber: string;
  text: string;
}

type Lang = 'en' | 'sw';
const S = {
  main: {
    sw: 'FarmGo\n1. Uza mazao\n2. Mahitaji ya wanunuzi\n3. Oda zangu\n4. Mechi mpya\n5. Bei za soko\n6. Malipo yangu\n9. English',
    en: 'FarmGo\n1. Sell produce\n2. Buyer demand\n3. My orders\n4. New matches\n5. Market prices\n6. My payments\n9. Kiswahili',
  },
  notRegistered: {
    sw: 'Karibu FarmGo\n1. Jisajili kama mkulima\n0. Toka',
    en: 'Welcome to FarmGo\n1. Register as a farmer\n0. Exit',
  },
  askName: { sw: 'Andika jina lako kamili:', en: 'Enter your full name:' },
  askCounty: { sw: 'Andika kaunti yako (mf. Kiambu):', en: 'Enter your county (e.g. Kiambu):' },
  badCounty: { sw: 'Kaunti haikupatikana. Jaribu tena.', en: 'County not found. Please try again.' },
  otherAccount: {
    sw: 'Nambari hii tayari ina akaunti ya FarmGo isiyo ya mkulima. Tafadhali tumia programu au wasiliana na FarmGo.',
    en: 'This number already has a FarmGo account that is not a farmer account. Please use the app or contact FarmGo.',
  },
  registered: {
    sw: 'Umesajiliwa! Ongeza shamba kwenye programu au kupitia wakala, kisha uza mazao hapa.',
    en: 'You are registered! Add a farm in the app or with an agent, then sell produce here.',
  },
  chooseProduce: { sw: 'Chagua zao:', en: 'Choose produce:' },
  askQty: { sw: 'Kiasi ({{unit}}):', en: 'Quantity ({{unit}}):' },
  askWhen: {
    sw: 'Itakuwa tayari lini?\n1. Leo\n2. Baada ya siku 3\n3. Baada ya wiki 1\n4. Baada ya wiki 2',
    en: 'When will it be ready?\n1. Today\n2. In 3 days\n3. In 1 week\n4. In 2 weeks',
  },
  askPrice: { sw: 'Bei kwa {{unit}} (KES):', en: 'Price per {{unit}} (KES):' },
  confirmListing: {
    sw: '{{qty}} {{unit}} {{produce}} kwa KES {{price}} tarehe {{date}}\n1. Thibitisha\n2. Ghairi',
    en: '{{qty}} {{unit}} {{produce}} at KES {{price}} on {{date}}\n1. Confirm\n2. Cancel',
  },
  listed: {
    sw: 'Mazao yameorodheshwa. Tutakutumia SMS mnunuzi akipatikana.',
    en: 'Listed. We will SMS you when a buyer is found.',
  },
  noFarm: {
    sw: 'Huna shamba bado. Ongeza shamba kwenye programu au kupitia wakala.',
    en: 'You have no farm yet. Add one in the app or with an agent.',
  },
  badQty: {
    sw: 'Kiasi si sahihi. Andika namba kati ya 0.01 na 1,000,000, mf. 50.',
    en: 'Invalid quantity. Enter a number from 0.01 to 1,000,000, e.g. 50.',
  },
  badPrice: {
    sw: 'Bei si sahihi. Andika bei kwa shilingi, angalau KES 1, mf. 60.',
    en: 'Invalid price. Enter the price in shillings, at least KES 1, e.g. 60.',
  },
  listingFailed: {
    sw: 'Hatukuweza kuorodhesha mazao haya. Angalia kiasi na bei, kisha jaribu tena.',
    en: 'We could not list this produce. Check the quantity and price, then try again.',
  },
  alreadyConfirmed: { sw: 'Oda hii tayari imethibitishwa.', en: 'This order is already confirmed.' },
  alreadyReady: {
    sw: 'Oda hii tayari iko tayari kwa ukaguzi.',
    en: 'This order is already marked ready for inspection.',
  },
  confirmFirst: {
    sw: 'Thibitisha oda kwanza, kisha iweke tayari.',
    en: 'Confirm the order first, then mark it ready.',
  },
  orderMoved: {
    sw: 'Oda hii imeshasonga mbele ({{status}}). Hakuna la kufanya.',
    en: 'This order has already moved on ({{status}}). Nothing to do.',
  },
  cancelled: { sw: 'Imeghairiwa.', en: 'Cancelled.' },
  invalid: { sw: 'Chaguo si sahihi.', en: 'Invalid choice.' },
  none: { sw: 'Hakuna kwa sasa.', en: 'Nothing right now.' },
  orderActions: {
    sw: '1. Thibitisha oda\n2. Mazao yako tayari\n0. Rudi',
    en: '1. Confirm order\n2. Harvest is ready\n0. Back',
  },
  matchActions: { sw: '1. Kubali\n2. Kataa', en: '1. Accept\n2. Reject' },
  done: { sw: 'Imefanikiwa.', en: 'Done.' },
  error: {
    sw: 'Samahani, kuna tatizo. Jaribu tena baadaye.',
    en: 'Sorry, something went wrong. Try again later.',
  },
} as const;

const t = (k: keyof typeof S, lang: Lang, vars: Record<string, string | number> = {}) =>
  (S[k][lang] as string).replace(/\{\{(\w+)\}\}/g, (_, v: string) => String(vars[v] ?? ''));

const CON = (s: string) => `CON ${s}`;
const END = (s: string) => `END ${s}`;
const kes = (cents: number) => Math.round(cents / 100).toLocaleString('en-KE');
const WHEN_DAYS = [0, 3, 7, 14];

export class UssdHandler {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
  ) {}

  private async snapshot<T>(sessionId: string, key: string, load: () => Promise<T[]>): Promise<T[]> {
    const k = `ussd:${sessionId}:${key}`;
    const cached = await this.redis.get(k);
    if (cached) return JSON.parse(cached) as T[];
    const rows = await load();
    await this.redis.set(k, JSON.stringify(rows), 'EX', 180);
    return rows;
  }

  private async langOf(phoneNumber: string): Promise<Lang> {
    const phone = normalizeKenyanPhone(phoneNumber);
    if (!phone) return 'sw';
    const u = await this.prisma.user.findUnique({
      where: { phoneNumber: phone },
      select: { preferredLanguage: true },
    });
    return u?.preferredLanguage === 'en' ? 'en' : 'sw';
  }

  async handle(req: UssdRequest): Promise<string> {
    try {
      return await this.route(req);
    } catch (err) {
      logger.error({ err, sessionId: req.sessionId }, 'ussd error');
      const lang = await this.langOf(req.phoneNumber).catch(() => 'sw' as const);
      return END(t('error', lang));
    }
  }

  private async route(req: UssdRequest): Promise<string> {
    const phone = normalizeKenyanPhone(req.phoneNumber);
    if (!phone) return END('Invalid phone number');
    const input = req.text ? req.text.split('*') : [];
    const user = await this.prisma.user.findUnique({
      where: { phoneNumber: phone },
      include: { farmerProfile: { include: { farms: { where: { active: true } } } } },
    });
    const lang: Lang = user?.preferredLanguage === 'en' ? 'en' : 'sw';

    // Only a brand-new number or a fresh, not-yet-onboarded account may register as a farmer here;
    // a buyer, supplier or staff account is never converted (or renamed) from USSD.
    if (!user?.farmerProfile) {
      if (user && !['user', 'farmer'].includes(user.role ?? 'user')) return END(t('otherAccount', lang));
      return this.register(input, phone, lang, user?.id);
    }

    const [choice, ...rest] = input;
    if (choice === undefined) return CON(t('main', lang));
    switch (choice) {
      case '1':
        return this.sell(req.sessionId, rest, user.id, user.farmerProfile, lang);
      case '2':
        return this.demand(user.county, lang);
      case '3':
        return this.orders(req.sessionId, rest, user.id, lang);
      case '4':
        return this.matches(req.sessionId, rest, user.id, lang);
      case '5':
        return this.prices(req.sessionId, rest, user.county, lang);
      case '6':
        return this.payouts(user.id, lang);
      case '9': {
        const next = lang === 'sw' ? 'en' : 'sw';
        await this.prisma.user.update({ where: { id: user.id }, data: { preferredLanguage: next } });
        await bumpUser(this.redis, user.id);
        return END(next === 'en' ? 'Language set to English.' : 'Lugha imewekwa Kiswahili.');
      }
      default:
        return END(t('invalid', lang));
    }
  }

  private async register(
    input: string[],
    phone: string,
    lang: Lang,
    existingUserId?: string,
  ): Promise<string> {
    const [choice, name, countyText] = input;
    if (choice === undefined) return CON(t('notRegistered', lang));
    if (choice !== '1') return END('Asante / Thank you');
    if (!name) return CON(t('askName', lang));
    if (!countyText) return CON(t('askCounty', lang));
    const county = COUNTIES.find(
      (c) => c.toLowerCase().replace(/[^a-z]/g, '') === countyText.toLowerCase().replace(/[^a-z]/g, ''),
    );
    if (!county) return END(t('badCounty', lang));
    await this.prisma.$transaction(async (tx) => {
      const user = existingUserId
        ? await tx.user.update({
            where: { id: existingUserId },
            data: { role: 'farmer', name: name.trim(), county },
          })
        : await tx.user.create({
            data: {
              id: randomUUID(),
              name: name.trim(),
              email: phoneTempEmail(phone),
              phoneNumber: phone,
              phoneNumberVerified: true,
              role: 'farmer',
              county,
              preferredLanguage: lang,
            },
          });
      await tx.farmerProfile.create({ data: { userId: user.id, mpesaNumber: phone } });
      await emit(tx, 'user.onboarded', { userId: user.id, role: 'farmer' }, user.id);
    });
    if (existingUserId) await bumpUser(this.redis, existingUserId);
    return END(t('registered', lang));
  }

  private async sell(
    sessionId: string,
    input: string[],
    userId: string,
    profile: { farms: { id: string }[] },
    lang: Lang,
  ): Promise<string> {
    const farm = profile.farms[0];
    if (!farm) return END(t('noFarm', lang));
    const produce = await this.snapshot(sessionId, 'produce', async () =>
      (
        await this.prisma.produce.findMany({ where: { active: true }, orderBy: { name: 'asc' }, take: 9 })
      ).map((p) => ({
        id: p.id,
        name: lang === 'sw' ? p.nameSw : p.name,
        unit: p.unit.toLowerCase(),
      })),
    );
    const [pick, qtyText, whenText, priceText, confirm] = input;
    if (pick === undefined)
      return CON(`${t('chooseProduce', lang)}\n${produce.map((p, i) => `${i + 1}. ${p.name}`).join('\n')}`);
    const p = produce[Number(pick) - 1];
    if (!p) return END(t('invalid', lang));
    if (qtyText === undefined) return CON(t('askQty', lang, { unit: p.unit }));
    const qty = Number(qtyText);
    // Same limits as CreateListingInput, with a message the farmer can act on (QA-029).
    if (!Quantity.safeParse(qty).success) return END(t('badQty', lang));
    if (whenText === undefined) return CON(t('askWhen', lang));
    const days = WHEN_DAYS[Number(whenText) - 1];
    if (days === undefined) return END(t('invalid', lang));
    if (priceText === undefined) return CON(t('askPrice', lang, { unit: p.unit }));
    const price = Number(priceText);
    // Whole shillings of at least 1: a feature-phone keypad has no decimal point anyway.
    if (!Number.isFinite(price) || price < 1 || !Cents.positive().safeParse(Math.round(price * 100)).success)
      return END(t('badPrice', lang));
    const from = new Date(Date.now() + days * 86_400_000);
    if (confirm === undefined) {
      return CON(
        t('confirmListing', lang, {
          qty,
          unit: p.unit,
          produce: p.name,
          price,
          date: from.toISOString().slice(0, 10),
        }),
      );
    }
    if (confirm !== '1') return END(t('cancelled', lang));
    const fullFarm = await this.prisma.farm.findUniqueOrThrow({
      where: { id: farm.id },
      include: { farmer: true },
    });
    try {
      await createListing(this.prisma, fullFarm, {
        farmId: farm.id,
        produceId: p.id,
        quantity: qty,
        pricePerUnit: Math.round(price * 100),
        availableFrom: from,
        availableTo: new Date(from.getTime() + 7 * 86_400_000),
        photos: [],
        status: 'OPEN',
      });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      logger.info({ code: err.code, userId }, 'ussd listing refused');
      return END(t('listingFailed', lang));
    }
    return END(t('listed', lang));
  }

  private async demand(county: string | null, lang: Lang): Promise<string> {
    const rows = (await demandBoard(this.prisma, { county: county ?? undefined, weeks: 2 })).slice(0, 5);
    if (!rows.length) return END(t('none', lang));
    return END(
      rows
        .map(
          (r) =>
            `${lang === 'sw' ? r.produceNameSw : r.produceName}: ${r.openQty} ${r.unit.toLowerCase()} (${r.week})`,
        )
        .join('\n'),
    );
  }

  private async orders(sessionId: string, input: string[], userId: string, lang: Lang): Promise<string> {
    const orders = await this.snapshot(sessionId, 'orders', async () =>
      (
        await this.prisma.order.findMany({
          where: {
            farmerId: userId,
            status: { in: ['PENDING', 'CONFIRMED', 'READY_FOR_QA', 'QA_PASSED', 'IN_TRANSIT'] },
          },
          orderBy: { deliveryDate: 'asc' },
          take: 5,
        })
      ).map((o) => ({
        id: o.id,
        code: o.code,
        status: o.status,
        date: o.deliveryDate.toISOString().slice(0, 10),
        total: o.subtotal,
      })),
    );
    const [pick, action] = input;
    if (!orders.length) return END(t('none', lang));
    if (pick === undefined)
      return CON(orders.map((o, i) => `${i + 1}. ${o.code} ${o.status} ${o.date}`).join('\n'));
    const o = orders[Number(pick) - 1];
    if (!o) return END(t('invalid', lang));
    if (action === undefined) return CON(`${o.code}: KES ${kes(o.total)}\n${t('orderActions', lang)}`);
    const to = action === '1' ? 'CONFIRMED' : action === '2' ? 'READY_FOR_QA' : null;
    if (!to) return END(t('cancelled', lang));
    try {
      await this.prisma.$transaction((tx) =>
        transitionOrder(tx, { orderId: o.id, to, actor: 'farmer', actorId: userId, note: 'Via USSD' }),
      );
    } catch (err) {
      if (!(err instanceof AppError) || err.code !== 'ORDER_INVALID_TRANSITION') throw err;
      // Tell the farmer where the order stands instead of a generic error (QA-030).
      const now = (await this.prisma.order.findUnique({ where: { id: o.id }, select: { status: true } }))
        ?.status;
      if (to === 'CONFIRMED' && (now === 'CONFIRMED' || now === 'READY_FOR_QA'))
        return END(t('alreadyConfirmed', lang));
      if (to === 'READY_FOR_QA' && now === 'READY_FOR_QA') return END(t('alreadyReady', lang));
      if (to === 'READY_FOR_QA' && now === 'PENDING') return END(t('confirmFirst', lang));
      return END(t('orderMoved', lang, { status: now ?? '' }));
    }
    return END(t('done', lang));
  }

  private async matches(sessionId: string, input: string[], userId: string, lang: Lang): Promise<string> {
    const matches = await this.snapshot(sessionId, 'matches', async () =>
      (
        await this.prisma.match.findMany({
          where: {
            status: 'PROPOSED',
            farmerAcceptedAt: null,
            expiresAt: { gt: new Date() },
            listing: { farm: { farmer: { userId } } },
          },
          include: { listing: { include: { produce: true } }, demand: true },
          take: 5,
          orderBy: { createdAt: 'desc' },
        })
      ).map((m) => ({
        id: m.id,
        label: `${num(m.quantity)} ${m.listing.produce.unit.toLowerCase()} ${lang === 'sw' ? m.listing.produce.nameSw : m.listing.produce.name} @KES ${kes(m.pricePerUnit)} ${m.demand.neededBy.toISOString().slice(0, 10)}`,
      })),
    );
    const [pick, action] = input;
    if (!matches.length) return END(t('none', lang));
    if (pick === undefined) return CON(matches.map((m, i) => `${i + 1}. ${m.label}`).join('\n'));
    const m = matches[Number(pick) - 1];
    if (!m) return END(t('invalid', lang));
    if (action === undefined) return CON(`${m.label}\n${t('matchActions', lang)}`);
    if (action === '1') await this.prisma.$transaction((tx) => acceptMatch(tx, m.id, 'farmer', userId));
    else if (action === '2') await this.prisma.$transaction((tx) => rejectMatch(tx, m.id, 'farmer'));
    else return END(t('invalid', lang));
    return END(t('done', lang));
  }

  private async prices(
    sessionId: string,
    input: string[],
    county: string | null,
    lang: Lang,
  ): Promise<string> {
    const produce = await this.snapshot(sessionId, 'price-produce', async () =>
      (
        await this.prisma.produce.findMany({ where: { active: true }, orderBy: { name: 'asc' }, take: 9 })
      ).map((p) => ({
        id: p.id,
        name: lang === 'sw' ? p.nameSw : p.name,
        unit: p.unit.toLowerCase(),
      })),
    );
    const [pick] = input;
    if (pick === undefined)
      return CON(`${t('chooseProduce', lang)}\n${produce.map((p, i) => `${i + 1}. ${p.name}`).join('\n')}`);
    const p = produce[Number(pick) - 1];
    if (!p) return END(t('invalid', lang));
    const point =
      (county &&
        (await this.prisma.pricePoint.findFirst({
          where: { produceId: p.id, county },
          orderBy: { week: 'desc' },
        }))) ||
      (await this.prisma.pricePoint.findFirst({ where: { produceId: p.id }, orderBy: { week: 'desc' } }));
    if (!point) return END(t('none', lang));
    return END(
      `${p.name} (${point.county}, ${point.week.toISOString().slice(0, 10)}): KES ${kes(point.avgPrice)}/${p.unit} (${kes(point.minPrice)}-${kes(point.maxPrice)})`,
    );
  }

  private async payouts(userId: string, lang: Lang): Promise<string> {
    const rows = await this.prisma.payout.findMany({
      where: { farmerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 3,
      include: { order: true },
    });
    if (!rows.length) return END(t('none', lang));
    return END(
      rows
        .map(
          (p) =>
            `${p.order?.code ?? ''}: KES ${kes(p.amount)} ${p.status}${p.mpesaReceipt ? ` ${p.mpesaReceipt}` : ''}`,
        )
        .join('\n'),
    );
  }
}
