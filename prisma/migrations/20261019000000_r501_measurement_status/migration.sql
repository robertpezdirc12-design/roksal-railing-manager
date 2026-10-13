-- R501 (issue #15 faza 2): provenienca meritve — kako dobitna je številka
--
-- Stanje IZRAČUNA strežnik (deriveMeasurementStatus v measure-engine), ne
-- odjemalec. Zaradi tega je status STOLPEC in ne ključ v params: tests/r487.py
-- drž legacy params bitno enake {photoId, source, points, calibration}, nova
-- provenienca pa sme spreminjati tudi ročni vnosi, ki params nimajo.

-- AddColumn
ALTER TABLE "Measurement" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ESTIMATED';
ALTER TABLE "Measurement" ADD COLUMN "statusNote" TEXT;

-- Backfill (pošten, brez ugibanja):
--   • ročni vnosi (brez slikovne geometrije) = MANUAL — vrednost je vpisal
--     človek in zanjo prevzel odgovornost, to je dokazano z virom;
--   • kamerni vnosi = ESTIMATED — merilo teh meritev NIKOLI ni bilo dokazano
--     (prejšnja koda je tiho uporabila rezervo 1 cm/px), zato številke niso
--     poslovna mera, dokler jih kdo ne potrdi ali ponovno izmeri.
UPDATE "Measurement"
SET "status" = CASE WHEN "source" = 'KAMERA' THEN 'ESTIMATED' ELSE 'MANUAL' END,
    "statusNote" = CASE
      WHEN "source" = 'KAMERA'
        THEN 'Zapisi pred fazo 2: merilo (px/cm) ni bilo dokazano — vrednosti so ocena, ne poslovna mera.'
      ELSE 'Ročni vnos brez slikovne geometrije — odgovornost je na vpisu.'
    END
WHERE TRUE;

-- CreateIndex
CREATE INDEX "Measurement_status_idx" ON "Measurement"("status");
