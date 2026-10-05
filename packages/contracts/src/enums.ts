import { z } from 'zod';

// Mirrors the Prisma enums so clients never need to import the database package.

export const OrgType = z.enum(['BUYER', 'FARMER_GROUP', 'INPUT_SUPPLIER']);
export const BuyerCategory = z.enum([
  'HOTEL',
  'RESTAURANT',
  'GUESTHOUSE',
  'INSTITUTION',
  'CATERER',
  'HOUSEHOLD',
  'OTHER',
]);
export const PaymentTerms = z.enum(['PREPAID', 'NET_7', 'NET_14', 'NET_30']);
export const KycStatus = z.enum(['PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED']);
export const Gender = z.enum(['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED']);
export const ProduceCategory = z.enum([
  'VEGETABLE',
  'FRUIT',
  'HERB',
  'GRAIN',
  'LEGUME',
  'TUBER',
  'DAIRY',
  'POULTRY',
  'MEAT',
  'VALUE_ADDED',
  'OTHER',
]);
export const Unit = z.enum(['KG', 'CRATE', 'BUNCH', 'PIECE', 'LITRE', 'TRAY', 'BAG']);
export const ListingStatus = z.enum([
  'DRAFT',
  'OPEN',
  'PARTIALLY_MATCHED',
  'FULLY_MATCHED',
  'EXPIRED',
  'CANCELLED',
]);
export const DemandStatus = z.enum(['OPEN', 'PARTIALLY_FILLED', 'PAUSED', 'FILLED', 'EXPIRED', 'CANCELLED']);
export const MatchStatus = z.enum(['PROPOSED', 'ACCEPTED', 'REJECTED', 'EXPIRED']);
export const OrderStatus = z.enum([
  'PENDING',
  'CONFIRMED',
  'READY_FOR_QA',
  'QA_PASSED',
  'QA_REJECTED',
  'IN_TRANSIT',
  'DELIVERED',
  'DISPUTED',
  'PAID',
  'REFUNDED',
  'CANCELLED',
]);
export type OrderStatus = z.infer<typeof OrderStatus>;
export const PaymentStatus = z.enum(['UNPAID', 'PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']);
export const RouteStatus = z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export const StopKind = z.enum(['PICKUP', 'DROPOFF']);
export const StopStatus = z.enum(['PENDING', 'ARRIVED', 'COMPLETED', 'FAILED', 'SKIPPED']);
export const CrateStatus = z.enum(['IN_STOCK', 'WITH_FARMER', 'IN_TRANSIT', 'WITH_BUYER', 'LOST', 'RETIRED']);
export type CrateStatus = z.infer<typeof CrateStatus>;
export const PaymentMethod = z.enum(['MPESA_STK', 'CARD', 'INVOICE', 'BANK_TRANSFER', 'CASH']);
export const TxStatus = z.enum(['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT']);
export const InvoiceStatus = z.enum(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID']);
export const DisputeStatus = z.enum([
  'OPEN',
  'UNDER_REVIEW',
  'RESOLVED_REFUND',
  'RESOLVED_NO_REFUND',
  'CANCELLED',
]);
export const DisputeReason = z.enum(['QUALITY', 'QUANTITY', 'LATE', 'DAMAGED', 'OTHER']);
export const InputCategory = z.enum([
  'COMPOST',
  'ORGANIC_FERTILIZER',
  'SEEDLINGS',
  'BIOPESTICIDE',
  'PACKAGING',
  'OTHER',
]);
export const InputOrderStatus = z.enum([
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'DISPATCHED',
  'DELIVERED',
  'CANCELLED',
]);
export const InspectionLocation = z.enum(['FARM_GATE', 'AGGREGATION_CENTRE', 'BUYER_DOOR']);
