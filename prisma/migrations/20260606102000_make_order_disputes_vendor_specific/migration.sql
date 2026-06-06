ALTER TABLE "OrderDispute" ADD COLUMN IF NOT EXISTS "vendorId" TEXT;

UPDATE "OrderDispute" dispute
SET "vendorId" = source."vendorId"
FROM (
    SELECT DISTINCT ON (order_source."orderId")
        order_source."orderId",
        order_source."vendorId"
    FROM (
        SELECT "orderId", "vendorId", 0 AS priority
        FROM "VendorPayout"
        UNION ALL
        SELECT "orderId", "vendorId", 1 AS priority
        FROM "OrderItem"
    ) order_source
    ORDER BY order_source."orderId", order_source.priority
) source
WHERE dispute."orderId" = source."orderId"
  AND dispute."vendorId" IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "OrderDispute" WHERE "vendorId" IS NULL
    ) THEN
        RAISE EXCEPTION 'Cannot make OrderDispute vendor-specific because existing disputes could not be mapped to a vendor.';
    END IF;
END $$;

ALTER TABLE "OrderDispute" ALTER COLUMN "vendorId" SET NOT NULL;

DROP INDEX IF EXISTS "OrderDispute_orderId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "OrderDispute_orderId_vendorId_key" ON "OrderDispute"("orderId", "vendorId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'OrderDispute_vendorId_fkey'
    ) THEN
        ALTER TABLE "OrderDispute" ADD CONSTRAINT "OrderDispute_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
