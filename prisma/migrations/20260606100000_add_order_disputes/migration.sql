DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderDisputeStatus') THEN
        CREATE TYPE "OrderDisputeStatus" AS ENUM (
            'OPEN',
            'VENDOR_RESPONDED',
            'UNDER_REVIEW',
            'RESOLVED_REFUND',
            'RESOLVED_RELEASE_PAYOUT',
            'REJECTED'
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "OrderDispute" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "vendorRespondedById" TEXT,
    "status" "OrderDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "vendorResponse" TEXT,
    "vendorRespondedAt" TIMESTAMP(3),
    "underReviewAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderDispute_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrderDispute_orderId_key" ON "OrderDispute"("orderId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'OrderDispute_orderId_fkey'
    ) THEN
        ALTER TABLE "OrderDispute" ADD CONSTRAINT "OrderDispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'OrderDispute_openedById_fkey'
    ) THEN
        ALTER TABLE "OrderDispute" ADD CONSTRAINT "OrderDispute_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'OrderDispute_vendorRespondedById_fkey'
    ) THEN
        ALTER TABLE "OrderDispute" ADD CONSTRAINT "OrderDispute_vendorRespondedById_fkey" FOREIGN KEY ("vendorRespondedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
