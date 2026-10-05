import { env } from '@farmgo/config';
import { ensureBuckets, fileUrl, putObject, storageHealthy } from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toPlain } from '../src/plugins/serialize.js';
import {
  call,
  closeApp,
  days,
  emailUser,
  makeApp,
  nextPhone,
  phoneUser,
  produceId,
  type Session,
} from './helpers.js';

const PUBLIC_BASE = (env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT).replace(/\/$/, '');
const API = env.API_URL.replace(/\/$/, '');

/** B02: every image field in every DTO carries a ready-to-load URL or null. */
describe('file URLs', () => {
  describe('fileUrl and the serializer', () => {
    it('builds public, private and pass-through URLs', () => {
      expect(fileUrl('produce-photos/u1/a.jpg')).toBe(`${PUBLIC_BASE}/farmgo-produce-photos/u1/a.jpg`);
      expect(fileUrl('avatars/u1/me.png')).toBe(`${PUBLIC_BASE}/farmgo-avatars/u1/me.png`);
      expect(fileUrl('chat/u1/c.jpg')).toBe(`${API}/v1/files/chat/u1/c.jpg`);
      expect(fileUrl('proof-of-delivery/d1/p.jpg')).toBe(`${API}/v1/files/proof-of-delivery/d1/p.jpg`);
      expect(fileUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
      expect(fileUrl(null)).toBeNull();
      expect(fileUrl('not-a-bucket/x/y.jpg')).toBeNull();
    });

    it('adds a URL beside every stored key, keeping null for missing files', () => {
      const out = toPlain({
        imageKey: null,
        stop: { podPhotoKey: 'proof-of-delivery/d/p.jpg', signatureKey: null },
        photos: ['chat/u/1.jpg', 'chat/u/2.jpg'],
        user: { name: 'Amina', image: 'avatars/u/a.jpg' },
      }) as Record<string, any>;
      expect(out.imageUrl).toBeNull();
      expect(out.stop.podPhotoUrl).toBe(`${API}/v1/files/proof-of-delivery/d/p.jpg`);
      expect(out.stop.signatureUrl).toBeNull();
      expect(out.photoUrls).toEqual([`${API}/v1/files/chat/u/1.jpg`, `${API}/v1/files/chat/u/2.jpg`]);
      expect(out.user.imageUrl).toBe(`${PUBLIC_BASE}/farmgo-avatars/u/a.jpg`);
    });
  });

  describe('through the API', () => {
    let app: FastifyInstance;
    let admin: Session;
    let buyer: Session;
    let outsider: Session;
    let farmer: Session;
    let farmId: string;
    let listingId: string;
    let orderId: string;

    beforeAll(async () => {
      app = await makeApp();
      admin = await emailUser(app, 'admin');
      buyer = await emailUser(app, undefined, 'Files Buyer');
      outsider = await emailUser(app, undefined, 'Nosy Buyer');
      farmer = await phoneUser(app, nextPhone());
      for (const [s, name] of [
        [buyer, 'Files Hotel'],
        [outsider, 'Other Hotel'],
      ] as const) {
        await call(app, s, 'POST', '/v1/onboarding/buyer', {
          businessName: name,
          buyerCategory: 'HOTEL',
          county: 'Nairobi',
        });
      }
      await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
        name: 'Photo Farmer',
        county: 'Kiambu',
        farm: {
          name: 'Photo Farm',
          county: 'Kiambu',
          photoKey: `produce-photos/${farmer.userId}/farm.jpg`,
        },
      });
      farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
      listingId = (
        await call(app, farmer, 'POST', '/v1/supply', {
          farmId,
          produceId: await produceId(app, 'spinach'),
          quantity: 50,
          pricePerUnit: 3000,
          availableFrom: days(0),
          availableTo: days(5),
          photos: [`produce-photos/${farmer.userId}/1.jpg`, `produce-photos/${farmer.userId}/2.jpg`],
        })
      ).body.id;
      orderId = (await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity: 5 })).body.id;
    });
    afterAll(async () => closeApp(app));

    it('farm photos, listing photos and produce images', async () => {
      const farms = await call(app, farmer, 'GET', '/v1/farms');
      expect(farms.body[0].photoUrl).toBe(`${PUBLIC_BASE}/farmgo-produce-photos/${farmer.userId}/farm.jpg`);

      const listing = await call(app, buyer, 'GET', `/v1/supply/${listingId}`);
      expect(listing.body.photoUrls).toEqual([
        `${PUBLIC_BASE}/farmgo-produce-photos/${farmer.userId}/1.jpg`,
        `${PUBLIC_BASE}/farmgo-produce-photos/${farmer.userId}/2.jpg`,
      ]);
      expect(listing.body.farm.photoUrl).toMatch(/farm\.jpg$/);
      expect(listing.body.farm).not.toHaveProperty('photoKey');
      // No catalog image yet: null, not a placeholder (the app draws its own fallback).
      expect(listing.body.produce.imageUrl).toBeNull();

      const kale = await produceId(app, 'kale');
      const patched = await call(app, admin, 'PATCH', `/v1/produce/${kale}`, {
        imageKey: `produce-photos/${admin.userId}/kale.jpg`,
      });
      expect(patched.body.imageUrl).toBe(`${PUBLIC_BASE}/farmgo-produce-photos/${admin.userId}/kale.jpg`);
    });

    it('refuses a farm photo uploaded by someone else', async () => {
      const r = await call(app, farmer, 'PATCH', `/v1/farms/${farmId}`, {
        photoKey: `produce-photos/${buyer.userId}/stolen.jpg`,
      });
      expect(r.status).toBe(403);
    });

    it('avatars', async () => {
      await call(app, buyer, 'PATCH', '/v1/me', { image: `avatars/${buyer.userId}/me.jpg` });
      const me = await call(app, buyer, 'GET', '/v1/me');
      expect(me.body.user.imageUrl).toBe(`${PUBLIC_BASE}/farmgo-avatars/${buyer.userId}/me.jpg`);
      const farmerMe = await call(app, farmer, 'GET', '/v1/me');
      expect(farmerMe.body.user.imageUrl).toBeNull();
    });

    it('private chat photos go through /v1/files with an access check', async () => {
      const key = `chat/${buyer.userId}/crate.jpg`;
      const msg = await call(app, buyer, 'POST', `/v1/orders/${orderId}/messages`, {
        body: 'Is this the right crate?',
        photos: [key],
      });
      expect(msg.status).toBe(201);
      expect(msg.body.photoUrls).toEqual([`${API}/v1/files/${key}`]);

      const asFarmer = await call(app, farmer, 'GET', `/v1/files/${key}`);
      expect(asFarmer.status).toBe(302);
      expect(asFarmer.raw.headers.location).toMatch(/X-Amz-Signature=/);
      expect(asFarmer.raw.headers.location).toContain('/farmgo-chat/');

      expect((await call(app, outsider, 'GET', `/v1/files/${key}`)).status).toBe(403);
      expect((await call(app, null, 'GET', `/v1/files/${key}`)).status).toBe(401);
      expect((await call(app, buyer, 'GET', '/v1/files/nonsense')).status).toBe(404);
    });

    it('public files redirect to their stable URL', async () => {
      const key = `produce-photos/${farmer.userId}/1.jpg`;
      const r = await call(app, outsider, 'GET', `/v1/files/${key}`);
      expect(r.status).toBe(302);
      expect(r.raw.headers.location).toBe(`${PUBLIC_BASE}/farmgo-produce-photos/${farmer.userId}/1.jpg`);
    });

    it('public buckets can be read without credentials', async () => {
      if (!(await storageHealthy())) {
        console.warn('object storage is not running; skipping the bucket policy check');
        return;
      }
      await ensureBuckets();
      const key = 'produce-photos/test-suite/policy-check.txt';
      await putObject(key, 'ok', 'text/plain');
      const res = await fetch(fileUrl(key)!);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ok');
      const priv = await fetch(`${PUBLIC_BASE}/farmgo-chat/${buyer.userId}/crate.jpg`);
      expect(priv.status).toBe(403);
    });
  });
});
