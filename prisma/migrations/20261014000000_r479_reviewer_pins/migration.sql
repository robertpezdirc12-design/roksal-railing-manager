-- R479 (issue #9 §7 + §10 osnova): pripeti komentarji (pini) + javna delitev
-- pregleda z žetonom + GDPR soglasje za fotografije na projektu.

-- AlterTable: GDPR soglasje za objavo fotografij projekta (issue #9 §10).
-- Javne poti (portal, javni pregled) izpišejo fotografije SAMO ob VELJAVNEM
-- soglasju (pin-core.consentStatus); rok hrambe = photoConsentExpiresAt.
ALTER TABLE "Project" ADD COLUMN     "photoConsentAt" TIMESTAMP(3),
ADD COLUMN     "photoConsentExpiresAt" TIMESTAMP(3),
ADD COLUMN     "photoConsentById" TEXT;

-- CreateTable: ReviewPin — pripomba pripeta na segment/vozlišče/fotografijo
-- tekača (§7). Statusi: ODPRTO | RESENO | ZAPRT (prehodi samo naprej).
-- snapshot = JSON posnetek cilja ob nastanku (seg-N ključi se lahko premaknejo).
CREATE TABLE "ReviewPin" (
    "id" TEXT NOT NULL,
    "fenceRunId" TEXT NOT NULL,
    "authorId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "x" DECIMAL(10,2),
    "y" DECIMAL(10,2),
    "note" TEXT NOT NULL,
    "internalNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ODPRTO',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "snapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewPin_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ReviewLink — javna delitev enotnega pregleda (vzorec PortalLink:
-- žeton, rok, preklic, štetje ogledov; tempomat 60/min v skupnem rate-limit lib).
CREATE TABLE "ReviewLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "fenceRunId" TEXT NOT NULL,
    "createdById" TEXT,
    "note" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewLink_token_key" ON "ReviewLink"("token");
CREATE INDEX "ReviewPin_fenceRunId_status_idx" ON "ReviewPin"("fenceRunId", "status");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_photoConsentById_fkey" FOREIGN KEY ("photoConsentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReviewPin" ADD CONSTRAINT "ReviewPin_fenceRunId_fkey" FOREIGN KEY ("fenceRunId") REFERENCES "FenceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewPin" ADD CONSTRAINT "ReviewPin_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReviewPin" ADD CONSTRAINT "ReviewPin_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReviewLink" ADD CONSTRAINT "ReviewLink_fenceRunId_fkey" FOREIGN KEY ("fenceRunId") REFERENCES "FenceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewLink" ADD CONSTRAINT "ReviewLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
