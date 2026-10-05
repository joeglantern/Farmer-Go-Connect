-- CreateIndex
CREATE INDEX "input_product_name_trgm" ON "InputProduct" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "produce_name_trgm" ON "Produce" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "produce_name_sw_trgm" ON "Produce" USING GIN ("nameSw" gin_trgm_ops);
