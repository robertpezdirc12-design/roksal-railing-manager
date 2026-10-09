-- R465 PREFAB ENGINE (issue #4 §3) — proizvodni elementi iz AS-PRODUCED dvojčka
-- Enota proizvodnje = segment digitalnega dvojčka (seg-N).

-- CreateTable
CREATE TABLE "ProductionElement" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "sourceSnapshotId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "lengthCm" DOUBLE PRECISION,
    "heightCm" DOUBLE PRECISION,
    "posts" INTEGER,
    "ral" TEXT,
    "produkt" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NAVRTEN',
    "note" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionElement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionElement_productionOrderId_key_key" ON "ProductionElement"("productionOrderId", "key");

-- CreateIndex
CREATE INDEX "ProductionElement_productionOrderId_idx" ON "ProductionElement"("productionOrderId");

-- AddForeignKey
ALTER TABLE "ProductionElement" ADD CONSTRAINT "ProductionElement_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionElement" ADD CONSTRAINT "ProductionElement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
