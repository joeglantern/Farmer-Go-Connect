import {
  AgentDashboardDto,
  BuyerDashboardDto,
  DriverDashboardDto,
  FarmerDashboardDto,
  QaDashboardDto,
  SupplierDashboardDto,
} from '@farmgo/contracts';
import { getSetting, nairobiDate, nairobiDayStart } from '@farmgo/core';
import { num } from '@farmgo/db';
import type { FastifyInstance } from 'fastify';
import { requireFarmer, requireOrg, requirePermission, requireRole, requireUser } from '../lib/guards.js';
import { ok, typed } from '../lib/route.js';
import { describeFavorites } from './favorites.routes.js';

/** First instant of the current calendar month in Nairobi. */
const monthStart = (now = new Date()) => nairobiDayStart(`${nairobiDate(now).slice(0, 7)}-01`);
const CLOSED = ['PAID', 'REFUNDED', 'CANCELLED', 'QA_REJECTED'] as const;

/** One call per role home screen (B10). */
export default async function dashboardRoutes(app: FastifyInstance) {
  const r = typed(app);
  const db = app.prisma;

  r.get(
    '/v1/dashboard/farmer',
    {
      schema: {
        tags: ['me'],
        summary: 'Farmer home: listings, orders, sales and what needs doing',
        response: ok(FarmerDashboardDto),
      },
    },
    async (req) => {
      const { user, profile } = await requireFarmer(req);
      const since = monthStart();
      const now = new Date();
      const [
        activeListings,
        ordersAll,
        ordersMonth,
        paidAll,
        paidMonth,
        matchesWaiting,
        toConfirm,
        harvests,
        payoutsPending,
      ] = await Promise.all([
        db.supplyListing.count({
          where: {
            farm: { farmerId: profile.id },
            status: { in: ['OPEN', 'PARTIALLY_MATCHED'] },
            availableTo: { gte: now },
          },
        }),
        db.order.count({ where: { farmerId: user.id } }),
        db.order.count({ where: { farmerId: user.id, createdAt: { gte: since } } }),
        db.payout.aggregate({ where: { farmerId: user.id, status: 'SUCCESS' }, _sum: { amount: true } }),
        db.payout.aggregate({
          where: { farmerId: user.id, status: 'SUCCESS', createdAt: { gte: since } },
          _sum: { amount: true },
        }),
        db.match.count({
          where: {
            status: 'PROPOSED',
            farmerAcceptedAt: null,
            expiresAt: { gt: now },
            listing: { farm: { farmerId: profile.id } },
          },
        }),
        db.order.count({ where: { farmerId: user.id, status: 'PENDING' } }),
        // Confirmed orders to harvest in the next 48 hours.
        db.order.count({
          where: {
            farmerId: user.id,
            status: 'CONFIRMED',
            deliveryDate: { lte: new Date(now.getTime() + 48 * 3600_000) },
          },
        }),
        db.payout.count({ where: { farmerId: user.id, status: 'PENDING' } }),
      ]);
      const [pendingPayoutSum, unpaidOrders] = await Promise.all([
        db.payout.aggregate({ where: { farmerId: user.id, status: 'PENDING' }, _sum: { amount: true } }),
        db.order.findMany({
          where: {
            farmerId: user.id,
            payout: null,
            status: {
              in: ['CONFIRMED', 'READY_FOR_QA', 'QA_PASSED', 'IN_TRANSIT', 'DELIVERED', 'DISPUTED', 'PAID'],
            },
          },
          select: { subtotal: true, acceptedSubtotal: true, commission: true },
        }),
      ]);
      const onTheWay =
        (pendingPayoutSum._sum.amount ?? 0) +
        unpaidOrders.reduce((s, o) => s + Math.max(0, (o.acceptedSubtotal ?? o.subtotal) - o.commission), 0);
      return {
        activeListings,
        ordersReceived: { allTime: ordersAll, thisMonth: ordersMonth },
        sales: { allTimeCents: paidAll._sum.amount ?? 0, thisMonthCents: paidMonth._sum.amount ?? 0 },
        rating: profile.ratingAvg,
        qaPassRate: profile.qaPassRate,
        actions: {
          matchesWaiting,
          ordersToConfirm: toConfirm,
          harvestsDue48h: harvests,
          payoutsPending,
          payoutsPendingCents: onTheWay,
        },
      };
    },
  );

  r.get(
    '/v1/dashboard/buyer',
    {
      schema: {
        tags: ['me'],
        summary: 'Buyer activity: orders, spend, active orders, requirements',
        response: ok(BuyerDashboardDto),
      },
    },
    async (req) => {
      requirePermission(req, { order: ['read'] });
      const { orgId } = await requireOrg(req, 'BUYER');
      const since = monthStart();
      const now = new Date();
      const user = requireUser(req);
      const [totalOrders, spend, active, matchesWaiting, demand, invoices, favs] = await Promise.all([
        db.order.count({ where: { buyerOrgId: orgId } }),
        db.order.aggregate({
          where: {
            buyerOrgId: orgId,
            createdAt: { gte: since },
            status: { notIn: ['CANCELLED', 'QA_REJECTED'] },
          },
          _sum: { total: true },
        }),
        db.order.findMany({
          where: { buyerOrgId: orgId, status: { notIn: [...CLOSED] } },
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { farmer: { select: { name: true } } },
        }),
        db.match.count({
          where: {
            status: 'PROPOSED',
            buyerAcceptedAt: null,
            expiresAt: { gt: now },
            demand: { buyerOrgId: orgId },
          },
        }),
        db.demandRequest.findMany({
          where: {
            buyerOrgId: orgId,
            status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
            neededBy: { gte: now },
            NOT: { recurrence: { not: null }, parentId: null },
          },
          orderBy: { neededBy: 'asc' },
          take: 3,
          include: { produce: { select: { name: true } } },
        }),
        db.invoice.findMany({
          where: { buyerOrgId: orgId, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } },
          select: { total: true, amountPaid: true },
        }),
        db.favorite.findMany({
          where: { userId: user.id, kind: { in: ['CATEGORY', 'FARMER'] } },
          orderBy: { createdAt: 'desc' },
          take: 6,
        }),
      ]);
      const favorites = await describeFavorites(db, favs);
      return {
        totalOrders,
        thisMonthSpend: spend._sum.total ?? 0,
        activeOrders: active.map((o) => ({
          id: o.id,
          code: o.code,
          status: o.status,
          total: o.total,
          deliveryDate: o.deliveryDate,
          farmerName: o.farmer.name,
        })),
        matchesWaiting,
        upcomingRequirements: demand.map((d) => ({
          id: d.id,
          produceName: d.produce.name,
          quantity: num(d.quantity) - num(d.quantityFilled),
          neededBy: d.neededBy,
        })),
        invoicesDue: {
          count: invoices.length,
          amountCents: invoices.reduce((s, i) => s + (i.total - i.amountPaid), 0),
        },
        favorites,
      };
    },
  );

  r.get(
    '/v1/dashboard/supplier',
    {
      schema: { tags: ['inputs'], summary: 'Green-input supplier home', response: ok(SupplierDashboardDto) },
    },
    async (req) => {
      requirePermission(req, { input: ['sell'] });
      const { orgId } = await requireOrg(req, 'INPUT_SUPPLIER');
      const since = monthStart();
      const mine = { product: { supplierOrgId: orgId } };
      const lowStockAt = await getSetting(db, 'lowStockThreshold');
      const [activeProducts, lowStock, toHandle, monthOrders, monthSales, paidOut] = await Promise.all([
        db.inputProduct.count({ where: { supplierOrgId: orgId, active: true } }),
        db.inputProduct.count({ where: { supplierOrgId: orgId, active: true, stock: { lte: lowStockAt } } }),
        db.inputOrder.count({ where: { ...mine, status: { in: ['PENDING', 'ACCEPTED'] } } }),
        db.inputOrder.count({ where: { ...mine, createdAt: { gte: since } } }),
        db.inputOrder.aggregate({
          where: { ...mine, createdAt: { gte: since }, status: { notIn: ['REJECTED', 'CANCELLED'] } },
          _sum: { total: true },
        }),
        db.payout.aggregate({ where: { inputOrder: mine, status: 'SUCCESS' }, _sum: { amount: true } }),
      ]);
      return {
        activeProducts,
        lowStockProducts: lowStock,
        lowStockThreshold: lowStockAt,
        ordersToHandle: toHandle,
        ordersThisMonth: monthOrders,
        salesThisMonthCents: monthSales._sum.total ?? 0,
        paidOutAllTimeCents: paidOut._sum.amount ?? 0,
      };
    },
  );

  r.get(
    '/v1/dashboard/agent',
    {
      schema: {
        tags: ['me'],
        summary: 'Field agent home: farmers onboarded, listings created',
        response: ok(AgentDashboardDto),
      },
    },
    async (req) => {
      const agent = requireRole(req, 'agent');
      const since = monthStart();
      const mine = { farm: { farmer: { onboardedById: agent.id } } };
      const [farmersAll, farmersMonth, listingsAll, listingsMonth, pendingKyc] = await Promise.all([
        db.farmerProfile.count({ where: { onboardedById: agent.id } }),
        db.farmerProfile.count({ where: { onboardedById: agent.id, createdAt: { gte: since } } }),
        db.supplyListing.count({ where: mine }),
        db.supplyListing.count({ where: { ...mine, createdAt: { gte: since } } }),
        db.farmerProfile.count({
          where: { onboardedById: agent.id, kycStatus: { in: ['PENDING', 'SUBMITTED'] } },
        }),
      ]);
      return {
        farmersOnboarded: { allTime: farmersAll, thisMonth: farmersMonth },
        listingsCreated: { allTime: listingsAll, thisMonth: listingsMonth },
        pendingKyc,
      };
    },
  );

  r.get(
    '/v1/dashboard/driver',
    {
      schema: {
        tags: ['logistics'],
        summary: "Driver home: today's routes and the next stop",
        response: ok(DriverDashboardDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { route: ['drive'] });
      const todayDate = new Date(nairobiDate(new Date()));
      const routes = await db.route.findMany({
        where: {
          driverId: user.id,
          OR: [
            { date: todayDate },
            { status: 'IN_PROGRESS' },
            { status: 'PLANNED', date: { lt: todayDate } },
          ],
        },
        include: { stops: { orderBy: { sequence: 'asc' } } },
        orderBy: { date: 'asc' },
      });
      return {
        routes: routes.map((rt) => {
          const next = rt.stops.find((s) => s.status === 'PENDING' || s.status === 'ARRIVED');
          return {
            id: rt.id,
            code: rt.code,
            status: rt.status,
            county: rt.county,
            stopsTotal: rt.stops.length,
            stopsDone: rt.stops.filter((s) => ['COMPLETED', 'FAILED', 'SKIPPED'].includes(s.status)).length,
            distanceKm: rt.distanceKm,
            nextStop: next ? { id: next.id, kind: next.kind, address: next.address } : null,
          };
        }),
      };
    },
  );

  r.get(
    '/v1/dashboard/qa',
    {
      schema: {
        tags: ['qa'],
        summary: 'QA home: inspections waiting per county',
        response: ok(QaDashboardDto),
      },
    },
    async (req) => {
      requirePermission(req, { qa: ['read'] });
      const since = monthStart();
      const [byCounty, today, month] = await Promise.all([
        db.$queryRawUnsafe<{ county: string; n: number }[]>(
          `SELECT f.county, COUNT(DISTINCT o.id)::int AS n
             FROM "Order" o JOIN "OrderItem" i ON i."orderId" = o.id
             JOIN "SupplyListing" l ON l.id = i."listingId" JOIN "Farm" f ON f.id = l."farmId"
            WHERE o.status = 'READY_FOR_QA'
            GROUP BY f.county ORDER BY n DESC, f.county`,
        ),
        db.qualityInspection.count({
          where: { inspectedAt: { gte: nairobiDayStart(nairobiDate(new Date())) } },
        }),
        db.qualityInspection.groupBy({
          by: ['passed'],
          where: { inspectedAt: { gte: since } },
          _count: { _all: true },
        }),
      ]);
      const total = month.reduce((s, m) => s + m._count._all, 0);
      const passed = month.find((m) => m.passed)?._count._all ?? 0;
      return {
        tasksByCounty: byCounty.map((c) => ({ county: c.county, tasks: c.n })),
        inspectedToday: today,
        passRateThisMonth: total ? Math.round((passed / total) * 1000) / 10 : null,
      };
    },
  );
}
