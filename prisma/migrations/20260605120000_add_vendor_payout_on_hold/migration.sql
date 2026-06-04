DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PayoutStatus') THEN
        CREATE TYPE "PayoutStatus" AS ENUM ('ON_HOLD', 'PENDING', 'PAID', 'FAILED');
    END IF;
END $$;

ALTER TYPE "PayoutStatus" ADD VALUE IF NOT EXISTS 'ON_HOLD';

CREATE TABLE IF NOT EXISTS "VendorPayout" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "grossAmount" DECIMAL(10,2) NOT NULL,
    "platformFee" DECIMAL(10,2) NOT NULL,
    "payoutAmount" DECIMAL(10,2) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'ON_HOLD',
    "holdReason" TEXT,
    "availableAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorPayout_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "VendorPayout" ADD COLUMN IF NOT EXISTS "holdReason" TEXT;
ALTER TABLE "VendorPayout" ADD COLUMN IF NOT EXISTS "availableAt" TIMESTAMP(3);

ALTER TABLE "VendorPayout" ALTER COLUMN "status" SET DEFAULT 'ON_HOLD';

CREATE UNIQUE INDEX IF NOT EXISTS "VendorPayout_orderId_vendorId_key" ON "VendorPayout"("orderId", "vendorId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'VendorPayout_vendorId_fkey'
    ) THEN
        ALTER TABLE "VendorPayout" ADD CONSTRAINT "VendorPayout_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'VendorPayout_orderId_fkey'
    ) THEN
        ALTER TABLE "VendorPayout" ADD CONSTRAINT "VendorPayout_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
