-- R480 (issue #9 §10): JAVNI VIZUALIZATOR — javna povezava vizualizatorja
-- (VizLink, vzorec ReviewLink iz R479) + STRANKIN IZBOR variante
-- (VisualizationChoice — append-only dnevnik; „pisarna ne prepisuje podatkov").
-- Vir Lead.source se razširi z 'VIZUALIZATOR' (String polje — brez enuma,
-- posodobljen je samo komentar v shemi + SOURCES v /api/crm in crm.tsx).

-- CreateTable: VizLink — javna povezava vizualizatorja (žeton, rok, preklic,
-- štetje ogledov; tempomat 60/min na žeton v skupnem rate-limit lib).
CREATE TABLE "VizLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT,
    "note" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VizLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable: VisualizationChoice — strankin izbor A/B/C z zahtevo
-- (PONUDBA | OGLED | IZMERA), kontaktom in GDPR potrditvijo. variantLabel je
-- SNAPSHOT (črka se lahko ponovno uporabi po ARHIV); brisanje vizualizacije
-- izbora NE pobriše (SetNull) — zgodovina ostane.
CREATE TABLE "VisualizationChoice" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "visualizationId" TEXT,
    "variantLabel" TEXT NOT NULL,
    "chosenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chosenVia" TEXT NOT NULL DEFAULT 'VIZUALIZATOR',
    "requestType" TEXT NOT NULL DEFAULT 'PONUDBA',
    "leadId" TEXT,
    "linkId" TEXT,
    "note" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "consentAcceptedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualizationChoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VizLink_token_key" ON "VizLink"("token");
CREATE INDEX "VisualizationChoice_projectId_chosenAt_idx" ON "VisualizationChoice"("projectId", "chosenAt");
CREATE INDEX "VisualizationChoice_visualizationId_idx" ON "VisualizationChoice"("visualizationId");
CREATE INDEX "VisualizationChoice_leadId_idx" ON "VisualizationChoice"("leadId");

-- AddForeignKey
ALTER TABLE "VizLink" ADD CONSTRAINT "VizLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VizLink" ADD CONSTRAINT "VizLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisualizationChoice" ADD CONSTRAINT "VisualizationChoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisualizationChoice" ADD CONSTRAINT "VisualizationChoice_visualizationId_fkey" FOREIGN KEY ("visualizationId") REFERENCES "PhotoVisualization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisualizationChoice" ADD CONSTRAINT "VisualizationChoice_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisualizationChoice" ADD CONSTRAINT "VisualizationChoice_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "VizLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
