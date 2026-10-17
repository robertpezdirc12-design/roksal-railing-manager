-- R543: CSP POROČILA V BAZO — opazovalno obdobje Report-Only glave (R536)
-- postane IZMERLJIVO. Do zdaj je vsako poročilo brskalnika (report-uri
-- /api/csp-report) šlo SAMO v zgoščeno vrstico dnevnika — po enem tednu
-- opazovanja ni bilo mogoče pregledati, kaj se na produkciji dejansko krši
-- (raziskava R543-a: ključna ovira za preklop v enforce način).
--
-- Vrstica = diagnostični dnevnik, ne poslovni podatek: vzdrževalno opravilo
-- csp-gc (src/lib/jobs.ts, dnevni cron) briše vrstice starejše od 7 dni.
-- raw = CELO telo poročila kot jsonb OBJEKT (konvencija R542 — ne niz).
-- Sprejemna točka je javna (brskalnik pošilja brez naših žetonov) in že
-- zaščitena s tempomatom 30/min (bucket 'csp-report', R536) — shranjevanje
-- ne more postati vektor zaplavljanja čez to mejo.

-- CreateTable
CREATE TABLE "CspReport" (
    "id" TEXT NOT NULL,
    "documentUri" TEXT NOT NULL,
    "violatedDirective" TEXT NOT NULL,
    "blockedUri" TEXT,
    "raw" JSONB NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CspReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CspReport_createdAt_idx" ON "CspReport"("createdAt");
