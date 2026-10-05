import { env } from '@farmgo/config';
import type { DB } from '@farmgo/db';

/**
 * Runtime-tunable business settings, stored in PlatformSetting and editable by admins.
 * Env vars provide the defaults so a fresh install works without seeding.
 */
export const SETTING_DEFAULTS = {
  /** Commission taken from the farmer's payout, in basis points (800 = 8%). */
  commissionBps: env.PLATFORM_COMMISSION_BPS,
  /** Flat delivery fee charged to the buyer per order, in cents. */
  deliveryFeeCents: env.DEFAULT_DELIVERY_FEE_CENTS,
  /** Maximum farm-to-buyer distance considered by the matching engine. */
  matchRadiusKm: env.MATCH_RADIUS_KM,
  /** How long a proposed match waits for both sides before expiring. */
  matchExpiryHours: 48,
  /** Pay farmers for invoice (NET terms) orders before the buyer settles. */
  prefinanceInvoiceOrders: false,
  /** Window after delivery in which a buyer may raise a dispute. */
  disputeWindowHours: 48,
  /** Deposit charged per reusable crate that is not returned. */
  crateDepositCents: 50_000,
  /** Days a crate may stay with a buyer before a return reminder is sent. */
  crateReturnDays: 7,
  /** Seconds before an unanswered STK push is checked with Daraja. */
  stkCheckDelaySeconds: 60,
  /** Days ahead recurring demand is expanded into concrete requests. */
  recurringHorizonDays: 14,
  /** Matching score weights. */
  matchWeights: { distance: 0.35, price: 0.25, reliability: 0.2, freshness: 0.1, inclusion: 0.1 },
  /** Delivery windows buyers choose at checkout (Africa/Nairobi). */
  deliveryWindows: ['06:00-08:00', '08:00-10:00', '10:00-12:00', '14:00-16:00'],
  /** Orders placed before this hour (Nairobi) can be delivered the next day. */
  nextDayCutoffHour: 16,
  /** Supplier products at or below this stock count as low stock. */
  lowStockThreshold: 5,
};

export type Settings = typeof SETTING_DEFAULTS;
export type SettingKey = keyof Settings;

const cache = new Map<SettingKey, { value: unknown; at: number }>();
const TTL_MS = 30_000;

export async function getSetting<K extends SettingKey>(db: DB, key: K): Promise<Settings[K]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Settings[K];
  const row = await db.platformSetting.findUnique({ where: { key } });
  const value = (row?.value ?? SETTING_DEFAULTS[key]) as Settings[K];
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function getAllSettings(db: DB): Promise<Settings> {
  const rows = await db.platformSetting.findMany();
  const out = { ...SETTING_DEFAULTS } as Record<string, unknown>;
  for (const r of rows) if (r.key in out) out[r.key] = r.value;
  return out as Settings;
}

export async function setSetting<K extends SettingKey>(
  db: DB,
  key: K,
  value: Settings[K],
  updatedBy?: string,
) {
  await db.platformSetting.upsert({
    where: { key },
    create: { key, value: value as object, updatedBy },
    update: { value: value as object, updatedBy },
  });
  cache.delete(key);
}

export function isSettingKey(key: string): key is SettingKey {
  return key in SETTING_DEFAULTS;
}

export function clearSettingsCache() {
  cache.clear();
}
