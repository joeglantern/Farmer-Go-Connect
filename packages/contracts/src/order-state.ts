import type { OrderStatus } from './enums.js';

/**
 * Order state machine. This is the single definition of which transitions exist and
 * who may trigger them; the API enforces it and clients use it to show valid actions.
 *
 *   PENDING → CONFIRMED → READY_FOR_QA → QA_PASSED → IN_TRANSIT → DELIVERED → PAID
 *                                      ↘ QA_REJECTED               ↘ DISPUTED → PAID | REFUNDED | DELIVERED
 *   PENDING | CONFIRMED | READY_FOR_QA → CANCELLED
 *   READY_FOR_QA → CONFIRMED only through "undo harvest ready", before any inspection (not a
 *   normal action, so it is not listed below)
 */
export type TransitionActor = 'buyer' | 'farmer' | 'qa' | 'driver' | 'admin' | 'system';

export interface TransitionRule {
  to: OrderStatus;
  actors: readonly TransitionActor[];
}

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly TransitionRule[]> = {
  PENDING: [
    { to: 'CONFIRMED', actors: ['farmer', 'admin', 'system'] },
    { to: 'CANCELLED', actors: ['buyer', 'farmer', 'admin', 'system'] },
  ],
  CONFIRMED: [
    { to: 'READY_FOR_QA', actors: ['farmer', 'admin', 'system'] },
    { to: 'CANCELLED', actors: ['buyer', 'farmer', 'admin'] },
  ],
  READY_FOR_QA: [
    { to: 'QA_PASSED', actors: ['qa', 'admin', 'system'] },
    { to: 'QA_REJECTED', actors: ['qa', 'admin', 'system'] },
    { to: 'CANCELLED', actors: ['admin'] },
  ],
  QA_PASSED: [{ to: 'IN_TRANSIT', actors: ['driver', 'admin', 'system'] }],
  QA_REJECTED: [],
  IN_TRANSIT: [{ to: 'DELIVERED', actors: ['driver', 'admin', 'system'] }],
  DELIVERED: [
    { to: 'PAID', actors: ['admin', 'system'] },
    { to: 'DISPUTED', actors: ['buyer', 'admin'] },
  ],
  DISPUTED: [
    { to: 'PAID', actors: ['admin', 'system'] },
    { to: 'REFUNDED', actors: ['admin', 'system'] },
    // Resolved without (full) refund: back to normal settlement.
    { to: 'DELIVERED', actors: ['admin', 'system'] },
  ],
  PAID: [],
  REFUNDED: [],
  CANCELLED: [],
};

export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  'QA_REJECTED',
  'PAID',
  'REFUNDED',
  'CANCELLED',
];

export function canTransition(from: OrderStatus, to: OrderStatus, actor: TransitionActor): boolean {
  return ORDER_TRANSITIONS[from].some((r) => r.to === to && r.actors.includes(actor));
}

export function allowedTransitions(from: OrderStatus, actor: TransitionActor): OrderStatus[] {
  return ORDER_TRANSITIONS[from].filter((r) => r.actors.includes(actor)).map((r) => r.to);
}

/** Orders still in motion: the "Active" tab. Everything else is "Past". */
export const ACTIVE_ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'READY_FOR_QA',
  'QA_PASSED',
  'IN_TRANSIT',
  'DELIVERED',
  'DISPUTED',
] as const satisfies readonly OrderStatus[];
