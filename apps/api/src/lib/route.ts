import { ErrorBody } from '@farmgo/contracts';
import type { Prisma } from '@farmgo/db';
import type { FastifyInstance, FastifyTypeProvider } from 'fastify';
import type { $ZodType, output } from 'zod/v4/core';

/**
 * What a handler may return for a response DTO. The serializer plugin turns Date into an ISO
 * string, Decimal into a number and BigInt into a string before the DTO runs, so handlers may
 * hand back Prisma rows as they are. Enum-valued fields widen to `string` (the DTO enforces the
 * exact values at runtime); everything else keeps its shape, so a missing or misnamed field is
 * still a compile error.
 */
export type Serializable<T> = T extends string
  ? string | Date | bigint
  : T extends number
    ? number | Prisma.Decimal | bigint
    : T extends boolean
      ? boolean
      : T extends null | undefined
        ? T
        : T extends readonly (infer U)[]
          ? readonly Serializable<U>[]
          : T extends object
            ? { [K in keyof T as K extends DerivedUrlKey ? never : K]: Serializable<T[K]> } & {
                [K in keyof T as K extends DerivedUrlKey ? K : never]?: Serializable<T[K]>;
              }
            : T;

/** URL fields the serializer derives from stored keys (see plugins/serialize.ts); handlers omit them. */
type DerivedUrlKey = 'imageUrl' | 'photoUrl' | 'photoUrls' | 'podPhotoUrl' | 'signatureUrl';

export interface FarmGoTypeProvider extends FastifyTypeProvider {
  validator: this['schema'] extends $ZodType ? output<this['schema']> : unknown;
  serializer: this['schema'] extends $ZodType ? Serializable<output<this['schema']>> : unknown;
}

/** Typed router: request body/query/params and the response payload are inferred from the Zod schemas. */
export const typed = (app: FastifyInstance) => app.withTypeProvider<FarmGoTypeProvider>();
export type TypedApp = ReturnType<typeof typed>;

/**
 * Response schemas for a route: the success DTO under its status code, and the shared error
 * body for everything else. Declaring them (a) documents the route in OpenAPI, (b) strips any
 * field the DTO does not list, and (c) turns a payload that does not match into a 500 so
 * contract drift fails tests instead of reaching the app.
 */
export const ok = <T extends $ZodType>(dto: T) => ({ 200: dto, default: ErrorBody });
export const created = <T extends $ZodType>(dto: T) => ({ 201: dto, default: ErrorBody });
export const accepted = <T extends $ZodType>(dto: T) => ({ 202: dto, default: ErrorBody });
