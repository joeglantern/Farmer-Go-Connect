import { County, FeaturedFarmerListDto, IdParams, PublicFarmerDto } from '@farmgo/contracts';
import { Errors, fileUrl, isYouth } from '@farmgo/core';
import { num } from '@farmgo/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../lib/guards.js';
import { ok, typed } from '../lib/route.js';

const firstName = (name: string) => name.split(' ')[0] ?? '';

type BadgeFacts = {
  dateOfBirth: Date | null;
  gender: string;
  kycStatus: string;
  farms: { isOrganic: boolean }[];
};
function badgesFor(f: BadgeFacts) {
  const out: ('youth' | 'woman_led' | 'organic' | 'verified')[] = [];
  if (isYouth(f.dateOfBirth)) out.push('youth');
  if (f.gender === 'FEMALE') out.push('woman_led');
  if (f.farms.some((x) => x.isOrganic)) out.push('organic');
  if (f.kycStatus === 'VERIFIED') out.push('verified');
  return out;
}

const OPEN = { status: { in: ['OPEN' as const, 'PARTIALLY_MATCHED' as const] }, quantityLeft: { gt: 0 } };

/** Public farmer profiles and featured farmers (B06). */
export default async function farmerRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.get(
    '/v1/farmers/featured',
    {
      schema: {
        tags: ['supply'],
        summary: 'Farmers with produce on offer, best first (rating, QA pass rate, recent activity)',
        querystring: z.object({
          county: County.optional(),
          limit: z.coerce.number().int().min(1).max(30).default(10),
        }),
        response: ok(FeaturedFarmerListDto),
      },
    },
    async (req) => {
      requireUser(req);
      const now = new Date();
      const listingWhere = { ...OPEN, availableTo: { gte: now } };
      const farmers = await app.prisma.farmerProfile.findMany({
        where: {
          user: { banned: { not: true } },
          farms: {
            some: {
              active: true,
              ...(req.query.county ? { county: req.query.county } : {}),
              listings: { some: listingWhere },
            },
          },
        },
        include: {
          user: { select: { name: true, image: true } },
          farms: {
            where: { active: true, ...(req.query.county ? { county: req.query.county } : {}) },
            include: {
              listings: { where: listingWhere, select: { createdAt: true }, orderBy: { createdAt: 'desc' } },
            },
          },
        },
        take: 300,
      });
      const ranked = farmers.map((f) => {
        const listings = f.farms.flatMap((x) => x.listings);
        const latest = Math.max(...listings.map((l) => l.createdAt.getTime()));
        const ageDays = (now.getTime() - latest) / 86_400_000;
        // New farmers without ratings start from 4 stars so they can be discovered.
        const score =
          0.4 * ((f.ratingAvg ?? 4) / 5) + 0.3 * f.qaPassRate + 0.3 * Math.max(0, 1 - ageDays / 30);
        const farm = f.farms.find((x) => x.listings.length) ?? f.farms[0]!;
        return {
          score,
          dto: {
            id: f.id,
            firstName: firstName(f.user.name),
            avatarUrl: fileUrl(f.user.image),
            farmName: farm.name,
            county: farm.county,
            photoUrl: fileUrl(farm.photoKey) ?? fileUrl(f.user.image),
            rating: f.ratingAvg,
            qaPassRate: f.qaPassRate,
            activeListings: listings.length,
            badges: badgesFor(f),
          },
        };
      });
      return ranked
        .sort((a, b) => b.score - a.score)
        .slice(0, req.query.limit)
        .map((x) => x.dto);
    },
  );

  r.get(
    '/v1/farmers/:id',
    {
      schema: {
        tags: ['supply'],
        summary: 'Public farmer profile: farms, track record, badges and produce on offer',
        params: IdParams,
        response: ok(PublicFarmerDto),
      },
    },
    async (req) => {
      requireUser(req);
      const f = await app.prisma.farmerProfile.findUnique({
        where: { id: req.params.id },
        include: {
          user: { select: { id: true, name: true, image: true, banned: true } },
          farms: { where: { active: true }, orderBy: { createdAt: 'asc' } },
        },
      });
      if (!f || f.user.banned) throw Errors.notFound('Farmer');
      const [listings, ratings] = await Promise.all([
        app.prisma.supplyListing.findMany({
          where: { ...OPEN, availableTo: { gte: new Date() }, farm: { farmerId: f.id, active: true } },
          include: { produce: true },
          orderBy: { availableFrom: 'asc' },
          take: 50,
        }),
        app.prisma.review.count({ where: { targetUserId: f.user.id } }),
      ]);
      return {
        id: f.id,
        firstName: firstName(f.user.name),
        avatarUrl: fileUrl(f.user.image),
        farms: f.farms.map((x) => ({
          id: x.id,
          name: x.name,
          county: x.county,
          ward: x.ward,
          isOrganic: x.isOrganic,
          photoUrl: fileUrl(x.photoKey),
        })),
        rating: f.ratingAvg,
        ratingsCount: ratings,
        ordersCompleted: f.ordersCompleted,
        qaPassRate: f.qaPassRate,
        onTimeRate: f.onTimeRate,
        memberSince: f.createdAt,
        badges: badgesFor(f),
        activeListings: listings.map((l) => ({
          id: l.id,
          farmId: l.farmId,
          produce: {
            id: l.produce.id,
            name: l.produce.name,
            nameSw: l.produce.nameSw,
            unit: l.produce.unit,
            imageUrl: fileUrl(l.produce.imageKey),
          },
          quantityLeft: num(l.quantityLeft),
          pricePerUnit: l.pricePerUnit,
          grade: l.grade,
          availableFrom: l.availableFrom,
          availableTo: l.availableTo,
          photoUrls: l.photos.map((k) => fileUrl(k)).filter((u): u is string => !!u),
        })),
      };
    },
  );
}
