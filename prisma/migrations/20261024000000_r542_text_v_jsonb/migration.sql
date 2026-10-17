-- R542: pretvorba JSON-v-TEXT stolpcev v pravi jsonb tip (odprta točka iz
-- analize/R540 sinteze). Prisma DSL pozna Json tip, a so bila polja ob
-- nastanku deklarirana kot String — podatki so 100 % veljavni JSON (inventura
-- R542-a: 0/44 neveljavnih vrednosti, 0 praznih nizov, 28/44 tabel praznih),
-- zato je pretvorba v eni migraciji varna. Vzorec sledi ročni migraciji R541
-- (Prisma DSL ročno dopolnjena migracija; migrate dev je ne razveljavi).
-- NULL se ohrani (NULLIF varovalka pretvori le morebitni prazen niz v NULL),
-- NOT NULL ohranjenost zagotavlja ALTER TYPE (obvezni stolpci imajo vse
-- vrednosti veljavne). IZKLJUČENA ostajata: "WebhookDelivery"."payload"
-- (HMAC podpis nad dobesednimi bajti) in "Setting"."value" (skalarni KV).

ALTER TABLE "Measurement" ALTER COLUMN "params" TYPE jsonb USING (NULLIF("params",'')::jsonb);
ALTER TABLE "MeasurementVersion" ALTER COLUMN "data" TYPE jsonb USING (NULLIF("data",'')::jsonb);
ALTER TABLE "CatalogVersion" ALTER COLUMN "data" TYPE jsonb USING (NULLIF("data",'')::jsonb);
ALTER TABLE "AuditLog" ALTER COLUMN "detail" TYPE jsonb USING (NULLIF("detail",'')::jsonb);
ALTER TABLE "NotificationEvent" ALTER COLUMN "payload" TYPE jsonb USING (NULLIF("payload",'')::jsonb);
ALTER TABLE "JobRun" ALTER COLUMN "detail" TYPE jsonb USING (NULLIF("detail",'')::jsonb);
ALTER TABLE "RuleVersion" ALTER COLUMN "oldValue" TYPE jsonb USING (NULLIF("oldValue",'')::jsonb);
ALTER TABLE "RuleVersion" ALTER COLUMN "newValue" TYPE jsonb USING (NULLIF("newValue",'')::jsonb);
ALTER TABLE "SyncOp" ALTER COLUMN "result" TYPE jsonb USING (NULLIF("result",'')::jsonb);
ALTER TABLE "Product" ALTER COLUMN "tech" TYPE jsonb USING (NULLIF("tech",'')::jsonb);
ALTER TABLE "ProductVariant" ALTER COLUMN "tech" TYPE jsonb USING (NULLIF("tech",'')::jsonb);
ALTER TABLE "ProjectPackage" ALTER COLUMN "calcJson" TYPE jsonb USING (NULLIF("calcJson",'')::jsonb);
ALTER TABLE "HandoverReport" ALTER COLUMN "diffJson" TYPE jsonb USING (NULLIF("diffJson",'')::jsonb);
ALTER TABLE "HandoverReport" ALTER COLUMN "photosJson" TYPE jsonb USING (NULLIF("photosJson",'')::jsonb);
ALTER TABLE "ArSnapshot" ALTER COLUMN "analysis" TYPE jsonb USING (NULLIF("analysis",'')::jsonb);
ALTER TABLE "ArSnapshot" ALTER COLUMN "params" TYPE jsonb USING (NULLIF("params",'')::jsonb);
ALTER TABLE "ArSnapshot" ALTER COLUMN "sceneJson" TYPE jsonb USING (NULLIF("sceneJson",'')::jsonb);
ALTER TABLE "VizProject" ALTER COLUMN "params" TYPE jsonb USING (NULLIF("params",'')::jsonb);
ALTER TABLE "PhotoVisualization" ALTER COLUMN "renderParams" TYPE jsonb USING (NULLIF("renderParams",'')::jsonb);
ALTER TABLE "PhotoVisualizationVersion" ALTER COLUMN "data" TYPE jsonb USING (NULLIF("data",'')::jsonb);
ALTER TABLE "PlaybookDef" ALTER COLUMN "definition" TYPE jsonb USING (NULLIF("definition",'')::jsonb);
ALTER TABLE "PlaybookRun" ALTER COLUMN "context" TYPE jsonb USING (NULLIF("context",'')::jsonb);
ALTER TABLE "PlaybookRun" ALTER COLUMN "handoff" TYPE jsonb USING (NULLIF("handoff",'')::jsonb);
ALTER TABLE "PlaybookStepRun" ALTER COLUMN "evidence" TYPE jsonb USING (NULLIF("evidence",'')::jsonb);
ALTER TABLE "FenceRun" ALTER COLUMN "calibration" TYPE jsonb USING (NULLIF("calibration",'')::jsonb);
ALTER TABLE "FenceRun" ALTER COLUMN "terrain" TYPE jsonb USING (NULLIF("terrain",'')::jsonb);
ALTER TABLE "FenceRun" ALTER COLUMN "nodes" TYPE jsonb USING (NULLIF("nodes",'')::jsonb);
ALTER TABLE "FenceRun" ALTER COLUMN "quality" TYPE jsonb USING (NULLIF("quality",'')::jsonb);
ALTER TABLE "FenceRunVersion" ALTER COLUMN "data" TYPE jsonb USING (NULLIF("data",'')::jsonb);
ALTER TABLE "ReviewPin" ALTER COLUMN "snapshot" TYPE jsonb USING (NULLIF("snapshot",'')::jsonb);
ALTER TABLE "WebhookSubscription" ALTER COLUMN "events" TYPE jsonb USING (NULLIF("events",'')::jsonb);
ALTER TABLE "CaptureSession" ALTER COLUMN "device" TYPE jsonb USING (NULLIF("device",'')::jsonb);
ALTER TABLE "CaptureSession" ALTER COLUMN "outdoor" TYPE jsonb USING (NULLIF("outdoor",'')::jsonb);
ALTER TABLE "CaptureSession" ALTER COLUMN "plan" TYPE jsonb USING (NULLIF("plan",'')::jsonb);
ALTER TABLE "CaptureSession" ALTER COLUMN "state" TYPE jsonb USING (NULLIF("state",'')::jsonb);
ALTER TABLE "CaptureSession" ALTER COLUMN "coverage" TYPE jsonb USING (NULLIF("coverage",'')::jsonb);
ALTER TABLE "CaptureSession" ALTER COLUMN "drift" TYPE jsonb USING (NULLIF("drift",'')::jsonb);
ALTER TABLE "CapturePhoto" ALTER COLUMN "quality" TYPE jsonb USING (NULLIF("quality",'')::jsonb);
ALTER TABLE "DigitalTwinSnapshot" ALTER COLUMN "data" TYPE jsonb USING (NULLIF("data",'')::jsonb);
ALTER TABLE "DigitalTwinSnapshot" ALTER COLUMN "sources" TYPE jsonb USING (NULLIF("sources",'')::jsonb);
ALTER TABLE "Registration" ALTER COLUMN "points" TYPE jsonb USING (NULLIF("points",'')::jsonb);
ALTER TABLE "Registration" ALTER COLUMN "transform" TYPE jsonb USING (NULLIF("transform",'')::jsonb);
