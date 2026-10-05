import { ErrorBody, FileUrlDto, PresignDto, PresignGetInput, PresignInput } from '@farmgo/contracts';
import {
  Errors,
  fileUrl,
  makeObjectKey,
  objectExists,
  PRIVATE_BUCKETS,
  parseObjectKey,
  presignGet,
  presignPut,
} from '@farmgo/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireUser, roleOf } from '../lib/guards.js';
import { ok, typed } from '../lib/route.js';

const STAFF = ['admin', 'qa_officer', 'agent', 'driver'];

/**
 * Photos and documents referenced in requests must have been uploaded by the caller
 * (staff may attach any), and must exist in storage.
 */
export async function assertOwnKeys(req: FastifyRequest, keys: string[]): Promise<void> {
  const user = requireUser(req);
  const staff = STAFF.includes(roleOf(user));
  for (const key of keys) {
    const parsed = parseObjectKey(key);
    if (!parsed) throw Errors.badRequest('INVALID_FILE', `Unknown file ${key}`);
    if (!staff && parsed.ownerId !== user.id)
      throw Errors.forbidden('You can only attach files you uploaded');
    if (process.env.SKIP_UPLOAD_CHECK !== '1' && !(await objectExists(key))) {
      throw Errors.badRequest('FILE_NOT_UPLOADED', 'Upload the file before attaching it');
    }
  }
}

/** Who may read a private file: the uploader, staff, or a party to the order it belongs to. */
async function canRead(req: FastifyRequest, key: string): Promise<boolean> {
  const user = requireUser(req);
  const parsed = parseObjectKey(key);
  if (!parsed) return false;
  if (!PRIVATE_BUCKETS.includes(parsed.bucket)) return true;
  if (parsed.bucket === 'kyc') {
    if (parsed.ownerId === user.id || roleOf(user) === 'admin') return true;
    if (roleOf(user) !== 'agent') return false;
    // The agent who onboarded this farmer may see the ID they helped submit.
    const fp = await req.server.prisma.farmerProfile.findFirst({
      where: { nationalIdKey: key, onboardedById: user.id },
      select: { id: true },
    });
    return !!fp;
  }
  if (parsed.ownerId === user.id || STAFF.includes(roleOf(user))) return true;
  const prisma = req.server.prisma;
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { stops: { some: { OR: [{ podPhotoKey: key }, { signatureKey: key }] } } },
        { items: { some: { inspection: { photos: { has: key } } } } },
        { messages: { some: { photos: { has: key } } } },
        { disputes: { some: { photos: { has: key } } } },
      ],
    },
    select: { farmerId: true, buyerOrgId: true },
    take: 5,
  });
  // Evidence on a problem reported for a green-input order: the buyer and the supplier's members.
  const inputDispute = await prisma.dispute.findFirst({
    where: { inputOrderId: { not: null }, photos: { has: key } },
    select: { inputOrder: { select: { buyerId: true, product: { select: { supplierOrgId: true } } } } },
  });
  if (inputDispute?.inputOrder) {
    if (inputDispute.inputOrder.buyerId === user.id) return true;
    const member = await prisma.member.findFirst({
      where: { organizationId: inputDispute.inputOrder.product.supplierOrgId, userId: user.id },
    });
    if (member) return true;
  }
  for (const o of orders) {
    if (o.farmerId === user.id) return true;
    const member = await prisma.member.findFirst({
      where: { organizationId: o.buyerOrgId, userId: user.id },
    });
    if (member) return true;
  }
  return false;
}

export default async function uploadRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.post(
    '/v1/uploads/presign',
    {
      schema: {
        tags: ['uploads'],
        summary: 'Get a URL to upload a photo or document directly to storage',
        description:
          'PUT the file to `url` with the returned headers, then send `key` in the related request.',
        body: PresignInput,
        response: ok(PresignDto),
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req) => {
      const user = requireUser(req);
      if (req.body.bucket === 'qa-evidence' && !['qa_officer', 'admin'].includes(roleOf(user))) {
        throw Errors.forbidden('Only QA officers upload inspection evidence');
      }
      const key = makeObjectKey(req.body.bucket, user.id, req.body.contentType);
      const put = await presignPut(key, req.body.contentType, req.body.size);
      return { key, ...put };
    },
  );

  r.post(
    '/v1/uploads/url',
    {
      schema: {
        tags: ['uploads'],
        summary: 'Get a short-lived URL to view a file',
        body: PresignGetInput,
        response: ok(FileUrlDto),
      },
    },
    async (req) => {
      if (!(await canRead(req, req.body.key))) throw Errors.forbidden('You cannot view this file');
      return { url: await presignGet(req.body.key), expiresIn: 900 };
    },
  );

  // The `*Url` fields in responses point here for private files (chat photos, proof of delivery,
  // QA evidence, KYC). Public files redirect to their stable storage URL.
  app.get(
    '/v1/files/*',
    {
      schema: {
        tags: ['uploads'],
        summary: 'Open a stored file (redirects to a short-lived URL after an access check)',
        params: z.object({ '*': z.string().min(1).max(512) }),
        response: {
          302: z.null().describe('Redirect: the file is at the Location header'),
          default: ErrorBody,
        },
      },
      config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const key = (req.params as { '*': string })['*'];
      if (!parseObjectKey(key)) throw Errors.notFound('File');
      if (!(await canRead(req, key))) throw Errors.forbidden('You cannot view this file');
      const target = PRIVATE_BUCKETS.includes(parseObjectKey(key)!.bucket)
        ? await presignGet(key)
        : fileUrl(key)!;
      // Presigned URLs expire, so the redirect itself must not be cached for long.
      reply.header('cache-control', 'private, max-age=300');
      return reply.redirect(target, 302);
    },
  );
}
