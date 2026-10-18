-- R564 (issue #24): URADNI CENIK — življenjski cikel cenika + vir cen ponudbe.
--
-- PriceList.status: DEMO (seed/import tehnične vrednosti — NISO poslovno
--   odobrene) | DRAFT | PENDING_APPROVAL | APPROVED (izrecna odobritev prek
--   PATCH /api/price-lists/[id], ki zapiše approvedById/approvedAt/source in
--   poveča version — vsak prehod V APPROVED je nova odobrena različica).
-- Quote.priceCheck: NEPREVERJENO (vrstica brez razpoznavnega vira cene) |
--   DEMO (vir v neodobrenem ceniku) | APPROVED (vse vrstice iz odobrenega
--   cenika) — izračuna ga strežnik OB IZDELAVI ponudbe (price-approval-core);
--   POSLAN/SPREJET brez APPROVED zahteva izrecen priceOverride.reason
--   (quotes.approve), podpis (sign) pa je brez APPROVED povsem zavrnjen.
-- Quote.priceSnapshot: fiksiran snapshot cenika ob izdelavi (različice
--   seznamov, vezava vrstica→pravilo, DDV, popust) — kasnejša sprememba
--   cenika NE spremeni stare ponudbe (issue #24 točka 5).

-- AlterTable: PriceList — statusi življenjskega cikla + odobritev + vir
ALTER TABLE "PriceList" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'DEMO',
                          ADD COLUMN "approvedById" TEXT,
                          ADD COLUMN "approvedAt" TIMESTAMP(3),
                          ADD COLUMN "source" TEXT,
                          ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable: Quote — vir cen + snapshot
ALTER TABLE "Quote" ADD COLUMN "priceCheck" TEXT NOT NULL DEFAULT 'NEPREVERJENO',
                     ADD COLUMN "priceSnapshot" JSONB;

-- AddForeignKey: odobritelj cenika (umik odobritve ob brisanju uporabnika = SET NULL)
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
