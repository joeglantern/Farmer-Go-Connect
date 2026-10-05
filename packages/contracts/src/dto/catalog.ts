import { z } from 'zod';
import { FarmDto, FarmerProfileDto, ProduceDto, SupplyListingDto } from './models.js';

// ─── Farms ────────────────────────────────────────────────────

/** GET /v1/farms/:id: the farm, its farmer profile and recent listings. */
export const FarmDetailDto = FarmDto.extend({
  farmer: FarmerProfileDto,
  listings: z.array(SupplyListingDto.extend({ produce: ProduceDto })),
});
export type FarmDetailDto = z.infer<typeof FarmDetailDto>;

// ─── Produce catalog ──────────────────────────────────────────

export const ProduceListDto = z.array(ProduceDto);
export type ProduceListDto = z.infer<typeof ProduceListDto>;
