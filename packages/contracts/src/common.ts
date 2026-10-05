import { z } from 'zod';

/** Kenyan counties (47). Used for filtering, matching and price indices. */
export const COUNTIES = [
  'Mombasa',
  'Kwale',
  'Kilifi',
  'Tana River',
  'Lamu',
  'Taita Taveta',
  'Garissa',
  'Wajir',
  'Mandera',
  'Marsabit',
  'Isiolo',
  'Meru',
  'Tharaka Nithi',
  'Embu',
  'Kitui',
  'Machakos',
  'Makueni',
  'Nyandarua',
  'Nyeri',
  'Kirinyaga',
  "Murang'a",
  'Kiambu',
  'Turkana',
  'West Pokot',
  'Samburu',
  'Trans Nzoia',
  'Uasin Gishu',
  'Elgeyo Marakwet',
  'Nandi',
  'Baringo',
  'Laikipia',
  'Nakuru',
  'Narok',
  'Kajiado',
  'Kericho',
  'Bomet',
  'Kakamega',
  'Vihiga',
  'Bungoma',
  'Busia',
  'Siaya',
  'Kisumu',
  'Homa Bay',
  'Migori',
  'Kisii',
  'Nyamira',
  'Nairobi',
] as const;
export const County = z.enum(COUNTIES);
export type County = z.infer<typeof County>;

/** Normalise Kenyan phone numbers (07.., 01.., 7.., 2547.., +2547..) to E.164 (+2547XXXXXXXX). */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  let m = digits.match(/^\+?254([17]\d{8})$/);
  if (m) return `+254${m[1]}`;
  m = digits.match(/^0([17]\d{8})$/);
  if (m) return `+254${m[1]}`;
  m = digits.match(/^([17]\d{8})$/);
  if (m) return `+254${m[1]}`;
  return null;
}

export const KenyanPhone = z.string().transform((v, ctx) => {
  const n = normalizeKenyanPhone(v);
  if (!n) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid Kenyan phone number, e.g. 0712345678' });
    return z.NEVER;
  }
  return n;
});

export const Id = z.string().min(1).max(64);
export const IdParams = z.object({ id: Id });

/** Largest amount a money column can hold (Postgres integer): KES 21,474,836.47. */
export const MAX_CENTS = 2_147_483_647;
/** Money in KES cents. KES 150.00 = 15000. */
export const Cents = z.number().int().nonnegative().max(MAX_CENTS, 'Amount is too large');
/** Quantity in the produce's unit (kg, crate, bunch...), to two decimal places. */
export const Quantity = z
  .number()
  .min(0.01, 'Quantity must be at least 0.01')
  .max(1_000_000)
  .multipleOf(0.01, 'Use at most two decimal places');

export const Lat = z.number().min(-90).max(90);
export const Lng = z.number().min(-180).max(180);
export const GeoPoint = z.object({ lat: Lat, lng: Lng });

export const IsoDate = z.coerce.date();

const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Whole years between a date of birth (its calendar date) and today in Nairobi. */
export function ageOn(dob: Date, now = new Date()): number {
  const today = new Date(now.getTime() + NAIROBI_OFFSET_MS);
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < dob.getUTCMonth() ||
    (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age--;
  return age;
}

export const MIN_AGE = 18;
export const MAX_AGE = 100;

/** A date of birth for someone aged 18 to 100 today (Nairobi calendar day). */
export const DateOfBirth = IsoDate.refine((d) => ageOn(d) >= MIN_AGE, {
  message: `You must be at least ${MIN_AGE} years old`,
}).refine((d) => ageOn(d) <= MAX_AGE, { message: `Check the year: age cannot be over ${MAX_AGE}` });

/** A query-string flag: "true"/"1" is true, "false"/"0" is false (z.coerce.boolean would read "false" as true). */
export const BoolParam = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const Pagination = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof Pagination>;

export function page<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const Ok = z.object({ ok: z.literal(true) });

export const ErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

export const ObjectKey = z.string().min(1).max(512);
export const Photos = z.array(ObjectKey).max(10).default([]);

export const Language = z.enum(['en', 'sw']);
export type Language = z.infer<typeof Language>;

/** Placeholder email for phone-only accounts (Better Auth requires an email on every user). */
export const PHONE_EMAIL_DOMAIN = 'phone.farmgo.local';
export const phoneTempEmail = (phone: string) => `${phone.replace(/\D/g, '')}@${PHONE_EMAIL_DOMAIN}`;
export const isPhoneTempEmail = (email: string) => email.endsWith(`@${PHONE_EMAIL_DOMAIN}`);
