import { z } from 'zod';
import { Unit } from '../enums.js';
import { DemandForecastDto, PricePointDto } from './models.js';
import { IsoDateTime } from './primitives.js';

export const ProduceRefDto = z.object({ id: z.string(), name: z.string(), nameSw: z.string(), unit: Unit });

/** GET /v1/prices items */
export const PriceDto = PricePointDto.extend({ produce: ProduceRefDto });
export type PriceDto = z.infer<typeof PriceDto>;

export const PriceListDto = z.array(PriceDto);

/** GET /v1/prices/latest items */
export const LatestPriceDto = z.object({
  produceId: z.string(),
  name: z.string(),
  nameSw: z.string(),
  unit: Unit,
  county: z.string(),
  week: IsoDateTime,
  avgPrice: z.number().int(),
  minPrice: z.number().int(),
  maxPrice: z.number().int(),
  /** Previous week's average, if any. */
  prevAvg: z.number().int().nullable(),
  /** Week-on-week change in percent, one decimal. */
  changePct: z.number().nullable(),
});
export type LatestPriceDto = z.infer<typeof LatestPriceDto>;

export const LatestPriceListDto = z.array(LatestPriceDto);

/** GET /v1/forecasts items */
export const ForecastDto = DemandForecastDto.extend({ produce: ProduceRefDto });
export type ForecastDto = z.infer<typeof ForecastDto>;

export const ForecastListDto = z.array(ForecastDto);
