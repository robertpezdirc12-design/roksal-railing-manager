-- R481 (issue #9 §9): WEBHOOK INTEGRACIJSKA PLAST — poslovno-dogodkovni izhod
-- za partnerje (LOČENO od notify-providers NOTIFY_WEBHOOK_URL, ki je R464
-- obvestilni kanal). Naročnina (WebhookSubscription) posluša izbrane tipe
-- dogodkov; dostava (WebhookDelivery) je OUTBOX z idempotenco
-- (@@unique([subscriptionId, eventKey]) — en dogodek = ena vrstica na
-- naročnino; retry posodablja ISTO vrstico, NE ustvarja nove).
--
-- secretHash = SHA-256 hex hasha skrivnosti — skrivnost se NE shranjuje;
-- hask je hkrati PODPISNI KLJUČ (partner izpelje isti ključ iz svoje
-- skrivnosti in preveri X-ROKSAL-Signature HMAC-SHA256).
-- events = JSON niz seznama tipov (vzorec JSON v String stolpcih — FenceRun.nodes).

-- CreateTable: WebhookSubscription — naročnina partnerja na dogodke.
CREATE TABLE "WebhookSubscription" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "events" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdById" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable: WebhookDelivery — outbox dostav (PENDING → SENT/FAILED → DEAD).
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "responseStatus" INTEGER,
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_subscriptionId_eventKey_key" ON "WebhookDelivery"("subscriptionId", "eventKey");
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");
CREATE INDEX "WebhookDelivery_subscriptionId_createdAt_idx" ON "WebhookDelivery"("subscriptionId", "createdAt");

-- AddForeignKey
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
