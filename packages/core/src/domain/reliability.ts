import type { PrismaClient } from '@farmgo/db';

/**
 * Recompute each farmer's reliability stats used by the matching engine:
 * completed orders, QA pass rate, on-time delivery rate and average rating.
 * New farmers keep optimistic defaults (1.0) until they have history.
 */
export async function refreshReliability(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<
    {
      userId: string;
      completed: bigint;
      inspected: bigint;
      passed: bigint;
      delivered: bigint;
      onTime: bigint;
      rating: number | null;
    }[]
  >(
    `SELECT fp."userId",
            (SELECT COUNT(*) FROM "Order" o WHERE o."farmerId" = fp."userId" AND o.status IN ('DELIVERED','PAID')) AS completed,
            (SELECT COUNT(*) FROM "QualityInspection" q JOIN "OrderItem" i ON i.id = q."orderItemId"
               JOIN "Order" o ON o.id = i."orderId" WHERE o."farmerId" = fp."userId") AS inspected,
            (SELECT COUNT(*) FROM "QualityInspection" q JOIN "OrderItem" i ON i.id = q."orderItemId"
               JOIN "Order" o ON o.id = i."orderId" WHERE o."farmerId" = fp."userId" AND q.passed) AS passed,
            (SELECT COUNT(*) FROM "Delivery" d JOIN "Order" o ON o.id = d."orderId"
               WHERE o."farmerId" = fp."userId" AND d.kind = 'DROPOFF' AND d.status = 'COMPLETED') AS delivered,
            (SELECT COUNT(*) FROM "Delivery" d JOIN "Order" o ON o.id = d."orderId"
               WHERE o."farmerId" = fp."userId" AND d.kind = 'DROPOFF' AND d.status = 'COMPLETED'
                 AND d."completedAt" < (o."deliveryDate"::date + interval '1 day')) AS "onTime",
            (SELECT AVG(r.rating)::float FROM "Review" r WHERE r."targetUserId" = fp."userId") AS rating
       FROM "FarmerProfile" fp`,
  );
  for (const r of rows) {
    const inspected = Number(r.inspected);
    const delivered = Number(r.delivered);
    await prisma.farmerProfile.update({
      where: { userId: r.userId },
      data: {
        ordersCompleted: Number(r.completed),
        qaPassRate: inspected ? Number(r.passed) / inspected : 1,
        onTimeRate: delivered ? Number(r.onTime) / delivered : 1,
        ratingAvg: r.rating,
      },
    });
  }
  return rows.length;
}
