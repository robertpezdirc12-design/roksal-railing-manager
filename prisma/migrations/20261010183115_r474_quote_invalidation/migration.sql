-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "packageId" TEXT,
ADD COLUMN     "staleAt" TIMESTAMP(3),
ADD COLUMN     "staleReason" TEXT;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ProjectPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
