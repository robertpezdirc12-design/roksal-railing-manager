-- R493 (issue #6): originalna produktna gradiva z dokumentirano provenienco
CREATE TABLE "ProductAsset" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "variantSku" TEXT,
    "kind" TEXT NOT NULL,
    "orientation" TEXT,
    "view" TEXT,
    "colorName" TEXT,
    "colorApprox" TEXT,
    "filePath" TEXT,
    "cdnUrl" TEXT,
    "sourceUrl" TEXT,
    "sha256" TEXT,
    "bytes" INTEGER,
    "sourceName" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "permission" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductAsset_productId_idx" ON "ProductAsset"("productId");
CREATE INDEX "ProductAsset_status_idx" ON "ProductAsset"("status");
CREATE INDEX "ProductAsset_kind_idx" ON "ProductAsset"("kind");

-- AddForeignKey
ALTER TABLE "ProductAsset" ADD CONSTRAINT "ProductAsset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
