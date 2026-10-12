-- R489 MONTAŽA QA & PRIMOPREDAJA (GitHub issue #12, P1) — kontrolne točke
-- montaže (statusni stroj), odstopanja, korektivni ukrepi, verzionirana
-- primopredajna poročila. Podatkovno veden seznam: viri = playbook MONTAZA,
-- segmenti dvojčka (seg-N), aktivna inženirska pravila.

-- CreateTable
CREATE TABLE "MontazaCheck" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL DEFAULT 1,
    "stepId" TEXT,
    "label" TEXT NOT NULL,
    "instruction" TEXT,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "targetKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NI_ZACETO',
    "photoId" TEXT,
    "note" TEXT,
    "checkedById" TEXT,
    "checkedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MontazaCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MontazaDeviation" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "checkId" TEXT,
    "reason" TEXT NOT NULL,
    "location" TEXT,
    "targetKey" TEXT,
    "photoId" TEXT,
    "impactMaterial" BOOLEAN NOT NULL DEFAULT false,
    "impactPrice" BOOLEAN NOT NULL DEFAULT false,
    "impactSafety" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MontazaDeviation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MontazaAction" (
    "id" TEXT NOT NULL,
    "deviationId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assigneeId" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ODPRTO',
    "photoId" TEXT,
    "note" TEXT,
    "completedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MontazaAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoverReport" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "projectId" TEXT,
    "designedSnapshotId" TEXT,
    "installedSnapshotId" TEXT,
    "producedBomId" TEXT,
    "diffJson" TEXT,
    "photosJson" TEXT,
    "summary" TEXT,
    "monterConfirmedAt" TIMESTAMP(3),
    "monterConfirmedById" TEXT,
    "customerSignature" TEXT,
    "customerSignedAt" TIMESTAMP(3),
    "customerSignedBy" TEXT,
    "customerRemark" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEPOPOLNA',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandoverReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MontazaCheck_workOrderId_status_idx" ON "MontazaCheck"("workOrderId", "status");

-- CreateIndex
CREATE INDEX "MontazaDeviation_workOrderId_resolvedAt_idx" ON "MontazaDeviation"("workOrderId", "resolvedAt");

-- CreateIndex
CREATE INDEX "MontazaAction_deviationId_status_idx" ON "MontazaAction"("deviationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HandoverReport_workOrderId_version_key" ON "HandoverReport"("workOrderId", "version");

-- CreateIndex
CREATE INDEX "HandoverReport_workOrderId_idx" ON "HandoverReport"("workOrderId");

-- AddForeignKey
ALTER TABLE "MontazaCheck" ADD CONSTRAINT "MontazaCheck_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MontazaCheck" ADD CONSTRAINT "MontazaCheck_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MontazaDeviation" ADD CONSTRAINT "MontazaDeviation_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MontazaDeviation" ADD CONSTRAINT "MontazaDeviation_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "MontazaCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MontazaDeviation" ADD CONSTRAINT "MontazaDeviation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MontazaDeviation" ADD CONSTRAINT "MontazaDeviation_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MontazaAction" ADD CONSTRAINT "MontazaAction_deviationId_fkey" FOREIGN KEY ("deviationId") REFERENCES "MontazaDeviation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MontazaAction" ADD CONSTRAINT "MontazaAction_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MontazaAction" ADD CONSTRAINT "MontazaAction_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverReport" ADD CONSTRAINT "HandoverReport_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverReport" ADD CONSTRAINT "HandoverReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverReport" ADD CONSTRAINT "HandoverReport_monterConfirmedById_fkey" FOREIGN KEY ("monterConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverReport" ADD CONSTRAINT "HandoverReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
