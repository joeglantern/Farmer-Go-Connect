/**
 * Seed the database with the produce catalog and (outside production) a demo marketplace:
 * an admin, staff, a hotel buyer, farmers with farms and listings, demand and crates.
 *
 *   pnpm db:seed            catalog + demo data (development)
 *   SEED_DEMO=false pnpm db:seed   catalog only
 *
 * Demo sign-ins (password "farmgo-demo-2026" for email accounts):
 *   admin@farmgo.test (admin) · buyer@serena.test (hotel buyer) · household@farmgo.test (household buyer)
 *   farmers sign in by phone OTP: +254711000001 .. +254711000004 (codes are logged in dev)
 */
import { randomUUID } from 'node:crypto';
import { createAuth } from '@farmgo/auth';
import { env, isProd } from '@farmgo/config';
import { phoneTempEmail } from '@farmgo/contracts';
import { newCrateCode, SETTING_DEFAULTS } from '@farmgo/core';
import { prisma } from '@farmgo/db';
import { PRODUCE } from './catalog.js';
import { seedDevOwner } from './dev-owner.js';

const DEMO_PASSWORD = 'farmgo-demo-2026';
// Demo accounts never reach a live service: in production they need TESTER_STACK=true and SEED_DEMO=true.
const seedDemo = isProd
  ? env.TESTER_STACK && process.env.SEED_DEMO === 'true'
  : process.env.SEED_DEMO !== 'false';
const days = (n: number) => new Date(Date.now() + n * 86_400_000);

const auth = createAuth({
  prisma,
  sendOtp: async () => undefined,
  sendEmail: async () => undefined,
});

async function emailUser(email: string, name: string, role: string, extra: Record<string, unknown> = {}) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  const res = await auth.api.signUpEmail({ body: { email, password: DEMO_PASSWORD, name } });
  return prisma.user.update({ where: { id: res.user.id }, data: { role, emailVerified: true, ...extra } });
}

async function phoneUser(phone: string, name: string, role: string, county: string) {
  return prisma.user.upsert({
    where: { phoneNumber: phone },
    create: {
      id: randomUUID(),
      name,
      email: phoneTempEmail(phone),
      phoneNumber: phone,
      phoneNumberVerified: true,
      role,
      county,
    },
    update: {},
  });
}

async function seedCatalog() {
  for (const p of PRODUCE) {
    await prisma.produce.upsert({
      where: { slug: p.slug },
      create: p,
      update: { name: p.name, nameSw: p.nameSw },
    });
  }
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    await prisma.platformSetting.upsert({
      where: { key },
      create: { key, value: value as object },
      update: {},
    });
  }
  console.log(`done: catalog: ${PRODUCE.length} produce, ${Object.keys(SETTING_DEFAULTS).length} settings`);
}

async function seedDemoData() {
  const produce = Object.fromEntries((await prisma.produce.findMany()).map((p) => [p.slug, p]));

  // Staff
  await emailUser('admin@farmgo.test', 'EYAAM Admin', 'admin', { county: 'Nairobi' });
  await seedDevOwner(auth);
  await emailUser('qa@farmgo.test', 'Wanjiru QA', 'qa_officer', { county: 'Kiambu' });
  await emailUser('driver@farmgo.test', 'Otieno Driver', 'driver', {
    county: 'Nairobi',
    phoneNumber: '+254722000010',
  });
  const agent = await emailUser('agent@farmgo.test', 'Kamau Agent', 'agent', { county: 'Kiambu' });

  // Buyers: a Nairobi hotel on prepaid terms, a restaurant on NET_14, and a household. A household's
  // organization is personal: named after the person, prepaid, never on credit.
  const buyers = [
    {
      email: 'buyer@serena.test',
      name: 'Grace Muthoni',
      business: 'Serena Demo Hotel',
      category: 'HOTEL' as const,
      terms: 'PREPAID' as const,
      lat: -1.2921,
      lng: 36.8219,
    },
    {
      email: 'chef@javahouse.test',
      name: 'Peter Njoroge',
      business: 'Mama Oliech Demo Restaurant',
      category: 'RESTAURANT' as const,
      terms: 'NET_14' as const,
      lat: -1.2833,
      lng: 36.8167,
    },
    {
      email: 'household@farmgo.test',
      name: 'Akinyi Odhiambo',
      business: 'Akinyi Odhiambo',
      category: 'HOUSEHOLD' as const,
      terms: 'PREPAID' as const,
      lat: -1.2906,
      lng: 36.7837,
    },
  ];
  const PHONES: Record<string, string> = {
    'buyer@serena.test': '+254733000001',
    'chef@javahouse.test': '+254733000002',
    'household@farmgo.test': '+254733000003',
  };
  const buyerOrgs: string[] = [];
  for (const b of buyers) {
    const user = await emailUser(b.email, b.name, 'buyer', {
      county: 'Nairobi',
      phoneNumber: PHONES[b.email],
    });
    let member = await prisma.member.findFirst({ where: { userId: user.id } });
    if (!member) {
      const org = await prisma.organization.create({
        data: {
          id: randomUUID(),
          name: b.business,
          slug: b.business.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        },
      });
      member = await prisma.member.create({
        data: { id: randomUUID(), organizationId: org.id, userId: user.id, role: 'owner' },
      });
      await prisma.orgProfile.create({
        data: {
          organizationId: org.id,
          type: 'BUYER',
          buyerCategory: b.category,
          county: 'Nairobi',
          town: 'Nairobi',
          address: b.category === 'HOUSEHOLD' ? 'Kilimani' : 'Nairobi CBD',
          lat: b.lat,
          lng: b.lng,
          paymentTerms: b.terms,
          verified: b.category !== 'HOUSEHOLD',
          creditLimit: b.terms === 'PREPAID' ? 0 : 50_000_000,
        },
      });
    }
    buyerOrgs.push(member.organizationId);
  }

  // Farmers (phone-only accounts, as most smallholders will have), onboarded by the agent
  const farmers = [
    {
      phone: '+254711000001',
      name: 'Mary Wambui',
      county: 'Kiambu',
      gender: 'FEMALE' as const,
      dob: '1998-04-12',
      farm: 'Wambui Greens',
      lat: -1.1714,
      lng: 36.8356,
    },
    {
      phone: '+254711000002',
      name: 'John Kariuki',
      county: 'Kiambu',
      gender: 'MALE' as const,
      dob: '1979-09-02',
      farm: 'Kariuki Farm',
      lat: -1.05,
      lng: 36.9,
    },
    {
      phone: '+254711000003',
      name: 'Faith Achieng',
      county: "Murang'a",
      gender: 'FEMALE' as const,
      dob: '2001-01-20',
      farm: 'Achieng Youth Agri',
      lat: -0.7839,
      lng: 37.04,
    },
    {
      phone: '+254711000004',
      name: 'Samuel Mutua',
      county: 'Machakos',
      gender: 'MALE' as const,
      dob: '1994-07-30',
      farm: 'Mutua Orchards',
      lat: -1.5177,
      lng: 37.2634,
    },
  ];
  const listingsPlan: Record<string, { slug: string; qty: number; price: number; inDays: number }[]> = {
    '+254711000001': [
      { slug: 'kale', qty: 300, price: 2_500, inDays: 0 },
      { slug: 'spinach', qty: 200, price: 3_000, inDays: 2 },
      { slug: 'coriander', qty: 150, price: 1_500, inDays: 1 },
    ],
    '+254711000002': [
      { slug: 'tomatoes', qty: 800, price: 8_000, inDays: 5 },
      { slug: 'potatoes', qty: 1500, price: 5_500, inDays: 0 },
      { slug: 'cabbage', qty: 400, price: 4_000, inDays: 3 },
    ],
    '+254711000003': [
      { slug: 'tomatoes', qty: 500, price: 7_500, inDays: 7 },
      { slug: 'french-beans', qty: 250, price: 12_000, inDays: 4 },
      { slug: 'capsicum', qty: 120, price: 15_000, inDays: 6 },
    ],
    '+254711000004': [
      { slug: 'mangoes', qty: 2000, price: 2_000, inDays: 10 },
      { slug: 'avocados', qty: 1500, price: 1_500, inDays: 3 },
      { slug: 'green-grams', qty: 600, price: 14_000, inDays: 0 },
    ],
  };
  for (const f of farmers) {
    const user = await phoneUser(f.phone, f.name, 'farmer', f.county);
    const profile = await prisma.farmerProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        gender: f.gender,
        dateOfBirth: new Date(f.dob),
        mpesaNumber: f.phone,
        onboardedById: agent.id,
        kycStatus: 'VERIFIED',
      },
      update: {},
    });
    let farm = await prisma.farm.findFirst({ where: { farmerId: profile.id } });
    farm ??= await prisma.farm.create({
      data: {
        farmerId: profile.id,
        name: f.farm,
        county: f.county,
        lat: f.lat,
        lng: f.lng,
        acreage: 2.5,
        isOrganic: f.gender === 'FEMALE',
      },
    });
    if ((await prisma.supplyListing.count({ where: { farmId: farm.id } })) === 0) {
      for (const l of listingsPlan[f.phone] ?? []) {
        const p = produce[l.slug]!;
        await prisma.supplyListing.create({
          data: {
            farmId: farm.id,
            produceId: p.id,
            quantity: l.qty,
            quantityLeft: l.qty,
            grade: 'A',
            pricePerUnit: l.price,
            availableFrom: days(l.inDays),
            availableTo: days(l.inDays + 10),
          },
        });
      }
    }
  }

  // Buyer demand: a weekly tomato requirement and some one-off needs
  const hotel = buyerOrgs[0]!;
  const hotelOwner = (await prisma.member.findFirstOrThrow({ where: { organizationId: hotel } })).userId;
  if ((await prisma.demandRequest.count({ where: { buyerOrgId: hotel } })) === 0) {
    await prisma.demandRequest.createMany({
      data: [
        {
          buyerOrgId: hotel,
          createdById: hotelOwner,
          produceId: produce.tomatoes!.id,
          quantity: 150,
          minGrade: 'A',
          maxPricePerUnit: 9_000,
          neededBy: days(7),
          recurrence: 'FREQ=WEEKLY;BYDAY=MO',
          county: 'Nairobi',
          deliveryLat: -1.2921,
          deliveryLng: 36.8219,
          notes: 'Firm, ripe, for salads',
        },
        {
          buyerOrgId: hotel,
          createdById: hotelOwner,
          produceId: produce.kale!.id,
          quantity: 80,
          neededBy: days(2),
          county: 'Nairobi',
          deliveryLat: -1.2921,
          deliveryLng: 36.8219,
        },
        {
          buyerOrgId: hotel,
          createdById: hotelOwner,
          produceId: produce.avocados!.id,
          quantity: 400,
          maxPricePerUnit: 2_000,
          neededBy: days(4),
          county: 'Nairobi',
          deliveryLat: -1.2921,
          deliveryLng: 36.8219,
        },
      ],
    });
  }

  // Green inputs supplier
  const supplier = await emailUser('compost@greenyouth.test', 'Brian Green', 'input_supplier', {
    county: 'Kiambu',
  });
  if (!(await prisma.member.findFirst({ where: { userId: supplier.id } }))) {
    const org = await prisma.organization.create({
      data: { id: randomUUID(), name: 'Green Youth Compost Demo', slug: 'green-youth-compost-demo' },
    });
    await prisma.member.create({
      data: { id: randomUUID(), organizationId: org.id, userId: supplier.id, role: 'owner' },
    });
    await prisma.orgProfile.create({
      data: { organizationId: org.id, type: 'INPUT_SUPPLIER', county: 'Kiambu', verified: true },
    });
    await prisma.inputProduct.createMany({
      data: [
        {
          supplierOrgId: org.id,
          name: 'Vermicompost 50kg',
          category: 'COMPOST',
          unit: 'BAG',
          pricePerUnit: 150_000,
          stock: 200,
          county: 'Kiambu',
        },
        {
          supplierOrgId: org.id,
          name: 'Organic foliar feed 1L',
          category: 'ORGANIC_FERTILIZER',
          unit: 'LITRE',
          pricePerUnit: 45_000,
          stock: 120,
          county: 'Kiambu',
        },
        {
          supplierOrgId: org.id,
          name: 'Tomato seedlings (tray of 100)',
          category: 'SEEDLINGS',
          unit: 'TRAY',
          pricePerUnit: 80_000,
          stock: 60,
          county: 'Kiambu',
        },
      ],
    });
  }

  // Reusable crates
  if ((await prisma.crate.count()) === 0) {
    await prisma.crate.createMany({
      data: Array.from({ length: 50 }, () => ({ qrCode: newCrateCode(), depositCents: 50_000 })),
    });
  }

  console.log(
    'done: demo data: admin, qa, driver, agent, 3 buyers (one a household), 4 farmers, 12 listings, 3 demand requests, 1 supplier, 50 crates',
  );
  console.log(`  email sign-in password: ${DEMO_PASSWORD}`);
}

async function main() {
  console.log(`Seeding ${env.DATABASE_URL.replace(/:[^:@/]+@/, ':****@')}`);
  await seedCatalog();
  if (seedDemo) await seedDemoData();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
