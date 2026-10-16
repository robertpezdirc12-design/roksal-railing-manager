-- DropIndex
DROP INDEX "FenceRunVersion_fenceRunId_version_idx";

-- DropIndex
DROP INDEX "MeasurementVersion_measurementId_version_idx";

-- DropIndex
DROP INDEX "PhotoVisualizationVersion_visualizationId_version_idx";

-- DropIndex
DROP INDEX "Registration_sessionId_version_idx";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RateLimitEntry" (
    "bucket" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "RateLimitEntry_pkey" PRIMARY KEY ("bucket","windowStart")
);

-- CreateIndex
CREATE INDEX "RateLimitEntry_windowStart_idx" ON "RateLimitEntry"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "FenceRunVersion_fenceRunId_version_key" ON "FenceRunVersion"("fenceRunId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "MeasurementVersion_measurementId_version_key" ON "MeasurementVersion"("measurementId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoVisualizationVersion_visualizationId_version_key" ON "PhotoVisualizationVersion"("visualizationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_sessionId_version_key" ON "Registration"("sessionId", "version");

