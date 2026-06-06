DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'VendorPayout'
          AND column_name = 'availableAt'
          AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE "VendorPayout" ALTER COLUMN "availableAt" DROP NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'VendorPayout'
          AND column_name = 'disputeWindowClosesAt'
          AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE "VendorPayout" ALTER COLUMN "disputeWindowClosesAt" DROP NOT NULL;
    END IF;
END $$;
