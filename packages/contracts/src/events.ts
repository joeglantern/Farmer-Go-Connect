/**
 * Domain event catalogue. Every state change writes one of these to the transactional
 * outbox in the same database transaction; the worker relays them to Redis pub/sub
 * (WebSockets) and to job queues (notifications, matching...).
 */
export interface DomainEvents {
  'user.onboarded': { userId: string; role: string };
  'farmer.created_by_agent': { userId: string; agentId: string };

  'demand.created': { demandId: string; buyerOrgId: string; produceId: string; county: string };
  'demand.updated': { demandId: string; buyerOrgId: string };
  'demand.cancelled': { demandId: string; buyerOrgId: string };
  'demand.aggregated': { produceId: string; county: string; week: string; totalQty: number; buyers: number };

  'supply.created': { listingId: string; farmerUserId: string; produceId: string; county: string };
  'supply.updated': { listingId: string; farmerUserId: string };
  'supply.harvest_ready': { listingId: string; farmerUserId: string };

  'match.proposed': {
    matchId: string;
    demandId: string;
    listingId: string;
    buyerOrgId: string;
    farmerUserId: string;
  };
  'match.accepted': { matchId: string; buyerOrgId: string; farmerUserId: string; orderId?: string };
  'match.rejected': { matchId: string; buyerOrgId: string; farmerUserId: string; by: 'buyer' | 'farmer' };
  'match.expired': { matchId: string; buyerOrgId: string; farmerUserId: string };

  'order.created': { orderId: string; buyerOrgId: string; farmerId: string; code: string };
  'order.status_changed': {
    orderId: string;
    code: string;
    buyerOrgId: string;
    farmerId: string;
    from: string | null;
    to: string;
    county?: string;
  };
  'order.message': {
    orderId: string;
    messageId: string;
    authorId: string;
    buyerOrgId: string;
    farmerId: string;
  };

  'qa.completed': { orderId: string; orderItemId: string; passed: boolean; inspectorId: string };

  'route.assigned': { routeId: string; driverId: string; date: string };
  'route.updated': { routeId: string; driverId: string | null };
  'delivery.location': { routeId: string; orderIds: string[]; lat: number; lng: number; at: string };
  'delivery.stop_updated': { routeId: string; stopId: string; orderId: string; status: string; kind: string };

  'payment.updated': {
    paymentId: string;
    orderId: string | null;
    checkoutId?: string | null;
    buyerOrgId: string;
    status: string;
  };
  'payout.updated': {
    payoutId: string;
    orderId: string | null;
    inputOrderId?: string | null;
    farmerId: string;
    status: string;
    amount: number;
  };
  'payout.requested': { orderId: string };
  /** An automatic or admin refund was created; the payments worker sends it. */
  'refund.requested': { paymentId: string; orderId: string };

  'dispute.opened': { disputeId: string; orderId: string; buyerOrgId: string; farmerId: string };
  'dispute.resolved': {
    disputeId: string;
    orderId: string;
    buyerOrgId: string;
    farmerId: string;
    outcome: string;
  };

  'crate.moved': { crateId: string; qrCode: string; to: string; orderId?: string };

  'input_order.created': { inputOrderId: string; supplierOrgId: string; buyerId: string };
  'input_order.status_changed': { inputOrderId: string; supplierOrgId: string; buyerId: string; to: string };

  'price.updated': { produceId: string; county: string; week: string };
  'notification.new': { notificationId: string; userId: string; title: string; body: string; type: string };
}

export type DomainEventType = keyof DomainEvents;
export type DomainEvent<T extends DomainEventType = DomainEventType> = {
  [K in T]: { type: K; payload: DomainEvents[K] };
}[T];
