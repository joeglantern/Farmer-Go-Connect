import { z } from 'zod';
import { OrderStatus } from '../enums.js';
import { InspectionDto, OrderDto, OrderItemDto, ProduceDto, SupplyListingDto } from './models.js';
import { NullableNumber, NullableString } from './primitives.js';

/** Farm details a QA officer needs to find and call the farmer. */
export const QaTaskFarmDto = z.object({
  id: z.string(),
  name: z.string(),
  county: z.string(),
  ward: NullableString,
  lat: NullableNumber,
  lng: NullableNumber,
  farmer: z.object({ user: z.object({ name: z.string(), phoneNumber: NullableString }) }),
});

/** GET /v1/qa/tasks items */
export const QaTaskDto = OrderDto.extend({
  items: z.array(
    OrderItemDto.extend({
      inspection: InspectionDto.nullable(),
      listing: SupplyListingDto.extend({ produce: ProduceDto, farm: QaTaskFarmDto }),
    }),
  ),
  buyerOrg: z.object({ name: z.string() }),
});
export type QaTaskDto = z.infer<typeof QaTaskDto>;

export const QaTaskListDto = z.array(QaTaskDto);
export type QaTaskListDto = z.infer<typeof QaTaskListDto>;

/** POST /v1/qa/inspections (201) */
export const InspectionResultDto = z.object({
  inspection: InspectionDto,
  /** The order's status after this inspection (QA_PASSED or QA_REJECTED once every item is done). */
  orderStatus: OrderStatus,
});
export type InspectionResultDto = z.infer<typeof InspectionResultDto>;

/** GET /v1/qa/inspections/:id */
export const InspectionDetailDto = InspectionDto.extend({
  orderItem: OrderItemDto.extend({ order: z.object({ id: z.string(), code: z.string() }) }),
  inspector: z.object({ id: z.string(), name: z.string() }),
});
export type InspectionDetailDto = z.infer<typeof InspectionDetailDto>;
