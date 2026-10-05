-- Human-friendly, gap-tolerant counters for codes shown to users.
CREATE SEQUENCE IF NOT EXISTS order_code_seq START 1000;
CREATE SEQUENCE IF NOT EXISTS route_code_seq START 100;
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

-- Fuzzy search on produce and input names.
CREATE INDEX IF NOT EXISTS produce_name_trgm ON "Produce" USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS produce_name_sw_trgm ON "Produce" USING gin ("nameSw" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS input_product_name_trgm ON "InputProduct" USING gin (name gin_trgm_ops);

-- Geo indexes (expression indexes over lat/lng) for PostGIS radius queries.
CREATE INDEX IF NOT EXISTS farm_geo_idx ON "Farm" USING gist ((ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography)) WHERE lat IS NOT NULL AND lng IS NOT NULL;
CREATE INDEX IF NOT EXISTS org_profile_geo_idx ON "OrgProfile" USING gist ((ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography)) WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- Data integrity guards that Prisma cannot express.
ALTER TABLE "SupplyListing" ADD CONSTRAINT listing_qty_left_nonneg CHECK ("quantityLeft" >= 0 AND "quantityLeft" <= quantity);
ALTER TABLE "DemandRequest" ADD CONSTRAINT demand_filled_nonneg CHECK ("quantityFilled" >= 0);
ALTER TABLE "Review" ADD CONSTRAINT review_rating_range CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE "Order" ADD CONSTRAINT order_amounts_nonneg CHECK (subtotal >= 0 AND total >= 0 AND commission >= 0 AND "deliveryFee" >= 0);
