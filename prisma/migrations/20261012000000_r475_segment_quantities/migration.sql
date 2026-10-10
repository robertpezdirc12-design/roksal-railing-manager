-- AlterTable: vrstica BOM ← segment (issue #9 §5 — količine iz segmentov)
ALTER TABLE "BomLine" ADD COLUMN     "segmentKey" TEXT,
ADD COLUMN     "group" TEXT,
ADD COLUMN     "wastePct" DOUBLE PRECISION,
ADD COLUMN     "sourceRule" TEXT;

-- AlterTable: vloga komponente v segmentni matematiki (issue #9 §5)
ALTER TABLE "ProductComponent" ADD COLUMN     "segmentRole" TEXT;
