import { z } from 'zod';
import { page } from '../common.js';
import { Unit } from '../enums.js';
import { DemandDto, MatchDto, ProduceDto, SupplyListingDto } from './models.js';
import { count, IsoDateTime, NullableString } from './primitives.js';

/** GET /v1/demand items */
export const DemandListItemDto = DemandDto.extend({
  produce: ProduceDto,
  _count: count('matches', 'children'),
});
export type DemandListItemDto = z.infer<typeof DemandListItemDto>;

export const DemandPageDto = page(DemandListItemDto);
export type DemandPageDto = z.infer<typeof DemandPageDto>;

/** POST and PATCH /v1/demand */
export const DemandWithProduceDto = DemandDto.extend({ produce: ProduceDto });
export type DemandWithProduceDto = z.infer<typeof DemandWithProduceDto>;

/** GET /v1/demand/:id */
export const DemandDetailDto = DemandDto.extend({
  produce: ProduceDto,
  /** Concrete instances spawned by a recurring template. */
  children: z.array(DemandDto),
  matches: z.array(
    MatchDto.extend({
      listing: SupplyListingDto.extend({
        farm: z.object({ name: z.string(), county: z.string(), ward: NullableString }),
      }),
    }),
  ),
  /** Next delivery dates for a recurring requirement (empty for one-off demand). */
  upcomingDates: z.array(IsoDateTime),
});
export type DemandDetailDto = z.infer<typeof DemandDetailDto>;

/** GET /v1/demand/board rows: aggregated and anonymised. */
export const DemandBoardRowDto = z.object({
  produceId: z.string(),
  produceName: z.string(),
  produceNameSw: z.string(),
  unit: Unit,
  county: z.string(),
  /** ISO week start date, YYYY-MM-DD. */
  week: z.string(),
  totalQty: z.number(),
  openQty: z.number(),
  buyers: z.number().int(),
  avgMaxPrice: z.number().int().nullable(),
  /** With `mine=true`: your active listings of this produce that could fill it. */
  listingIds: z.array(z.string()).optional(),
});
export type DemandBoardRowDto = z.infer<typeof DemandBoardRowDto>;

export const DemandBoardDto = z.array(DemandBoardRowDto);
export type DemandBoardDto = z.infer<typeof DemandBoardDto>;
