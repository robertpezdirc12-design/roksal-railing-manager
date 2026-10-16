-- R535 (revizija analize): indeksi na vročih zunanjih ključih + potek deljenih meritev.
--
-- 1. shareExpiresAt: nova povezava jm- poteče po 30 dneh (prej NIKOLI ni potekla —
--    odstopanje od SECRETS.md „časovno omejene"). Stare povezave (null) veljajo
--    do preklica — združljivost nazaj, brez uničenja obstoječih deljenih povezav.
--    Preverja /api/public/measure; nastavlja /api/measurements/[id]/share (POST).
--
-- 2. Indeksi: PostgreSQL NE ustvari indeksov na FK sam — vsako branje po vezavi
--    (nalog → projekt, plačilo → račun, dogodek → nalog …) je bilo polno
--    pregledovanje. AuditLog (prilagajoča se tabela) je bil BREZ indeksov
--    povsem — vsak pregled revizije po uporabniku/projektu = seq scan.
--
--    Poimena sledijo Prisma konvenciji (Model_polje_idx), da se shema
--    (prisma/schema.prisma @@index) in migracija ne razhajata.

ALTER TABLE "Measurement" ADD COLUMN "shareExpiresAt" TIMESTAMP(3);

CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Project_customerId_idx" ON "Project"("customerId");
CREATE INDEX "Quote_projectId_idx" ON "Quote"("projectId");
CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");
CREATE INDEX "Quote_packageId_idx" ON "Quote"("packageId");
CREATE INDEX "Invoice_projectId_idx" ON "Invoice"("projectId");
CREATE INDEX "Invoice_quoteId_idx" ON "Invoice"("quoteId");
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");
CREATE INDEX "WorkOrder_projectId_idx" ON "WorkOrder"("projectId");
CREATE INDEX "WorkOrder_assigneeId_idx" ON "WorkOrder"("assigneeId");
CREATE INDEX "WorkOrderEvent_workOrderId_idx" ON "WorkOrderEvent"("workOrderId");
CREATE INDEX "Measurement_projectId_idx" ON "Measurement"("projectId");
CREATE INDEX "Measurement_workOrderId_idx" ON "Measurement"("workOrderId");
CREATE INDEX "StockLot_itemId_idx" ON "StockLot"("itemId");
CREATE INDEX "EquipmentCheckout_equipmentId_idx" ON "EquipmentCheckout"("equipmentId");
CREATE INDEX "QcCheck_productionOrderId_idx" ON "QcCheck"("productionOrderId");
CREATE INDEX "Warranty_projectId_idx" ON "Warranty"("projectId");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX "AuditLog_projectId_createdAt_idx" ON "AuditLog"("projectId", "createdAt");
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");
CREATE INDEX "Product_familyId_idx" ON "Product"("familyId");
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");
CREATE INDEX "ProductComponent_productId_idx" ON "ProductComponent"("productId");
CREATE INDEX "ProductComponent_itemId_idx" ON "ProductComponent"("itemId");
CREATE INDEX "Bom_productId_idx" ON "Bom"("productId");
CREATE INDEX "BomLine_bomId_idx" ON "BomLine"("bomId");
CREATE INDEX "BomLine_itemId_idx" ON "BomLine"("itemId");
CREATE INDEX "ProjectPackage_projectId_idx" ON "ProjectPackage"("projectId");
