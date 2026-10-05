/**
 * Response DTOs: the shape of every JSON body the API returns. Routes declare them as
 * `response: { 200: XxxDto }`, which (a) documents them in OpenAPI, (b) strips any field that
 * is not listed, and (c) fails the request with 500 if the payload does not match, so a drift
 * between the database and the client contract is caught by tests, never by the app.
 *
 * Conventions: money is integer KES cents, quantities are numbers, dates are ISO-8601 strings,
 * paginated lists are `{ items, nextCursor }`.
 */
export * from './admin.js';
export * from './catalog.js';
export * from './checkout.js';
export * from './crates.js';
export * from './dashboard.js';
export * from './demand.js';
export * from './farmers.js';
export * from './favorites.js';
export * from './health.js';
export * from './inputs.js';
export * from './logistics.js';
export * from './matches.js';
export * from './me.js';
export * from './models.js';
export * from './notifications.js';
export * from './orders.js';
export * from './payments.js';
export * from './pricing.js';
export * from './primitives.js';
export * from './qa.js';
export * from './staff.js';
export * from './supply.js';
export * from './uploads.js';
