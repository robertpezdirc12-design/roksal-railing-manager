-- AlterTable: popust na celotno ponudbo (issue #9 §5 — R476)
-- DDV se izračuna iz osnove PO popustu: vat = (subtotal − discount) × 22 %.
ALTER TABLE "Quote" ADD COLUMN     "discountPct" DECIMAL(5,2),
ADD COLUMN     "discount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable: primerjalni paketi (issue #9 §5 — R476)
-- tier = STANDARD | BOLJSI | PREMIUM (null = ni del primerjave);
-- compareCode skupina primerjave (en projekt, enoličen nivo znotraj skupine).
ALTER TABLE "ProjectPackage" ADD COLUMN     "tier" TEXT,
ADD COLUMN     "compareCode" TEXT;
