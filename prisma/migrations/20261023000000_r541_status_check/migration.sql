-- R541: CHECK omejitve statusnih polj (revizija v1.58.0: »brez CHECK/enum
-- omejitev statusov«). Množice = unija dokumentiranih komentarjev sheme ∪ vseh
-- pisnih krajev v kodi ∪ dejanskih vrednosti v bazi (inventura R541-a).
-- Prisma DSL ne pozna CHECK constraintov — ročna dopolnitev migracije je
-- dokumentirana pot; prisma migrate dev jih ne odstrani (ne-modelirani objekti).
-- Vzorec: <Tabela>_<stolpec>_check.

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_status_check" CHECK ("status" IN ('NOV', 'KONTAKTIRAN', 'KVALIFIKACIJAN', 'IZGUBLJEN', 'PRETVORJEN'));
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_stage_check" CHECK ("stage" IN ('KVALIFIKACIJA', 'PONUDBA', 'POGAJANJA', 'ZMAGOVALNA', 'IZGUBLJENA'));
ALTER TABLE "Project" ADD CONSTRAINT "Project_status_check" CHECK ("status" IN ('NACRT', 'AKTIVNI', 'TEREN', 'ZAKLJUCEN', 'ARHIV'));
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_status_check" CHECK ("status" IN ('OSNUTEK', 'POSLAN', 'SPREJET', 'ZAVRNJEN', 'ZAKLENJEN'));
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_status_check" CHECK ("status" IN ('OSNUTEK', 'IZDAN', 'DELNO_PLACAN', 'PLACAN', 'ZAPRT'));
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_status_check" CHECK ("status" IN ('NAPROGRAMIRAN', 'V_TEKU', 'V_ZAJEMU', 'V_PREVERI', 'ZAKLJUCEN'));
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_status_check" CHECK ("status" IN ('ESTIMATED', 'AUTO_SUGGESTED', 'MANUAL', 'CALIBRATED', 'VERIFIED', 'CONFIRMED', 'INVALIDATED'));
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_status_check" CHECK ("status" IN ('NA_VOLJO', 'IZPOSOJENO', 'V_SERVISU', 'POKVARJENO'));
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_status_check" CHECK ("status" IN ('NAVRTEN', 'V_IZDELAVI', 'DOKONCAN', 'ODPOSLAN'));
ALTER TABLE "ProductionElement" ADD CONSTRAINT "ProductionElement_status_check" CHECK ("status" IN ('NAVRTEN', 'REZANJE', 'IZDELAVA', 'POVRSINA', 'DOKONCAN'));
ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_status_check" CHECK ("status" IN ('AKTIVNA', 'POTEKLA', 'PREKINJENA'));
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_status_check" CHECK ("status" IN ('NOVA', 'V_OBRAVNAVI', 'ZAKLJUCENA', 'ZAVRNJENA'));
ALTER TABLE "ServiceCase" ADD CONSTRAINT "ServiceCase_status_check" CHECK ("status" IN ('PREVERITEV', 'ODOBRENA', 'V_SERVISU', 'ZAKLJUCEN', 'ZAVRNJENA'));
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_status_check" CHECK ("status" IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED'));
ALTER TABLE "MaterialOrder" ADD CONSTRAINT "MaterialOrder_status_check" CHECK ("status" IN ('PRIPRAVA', 'POSLANO', 'PREJETO', 'PREKINJENO'));
ALTER TABLE "ProductAsset" ADD CONSTRAINT "ProductAsset_status_check" CHECK ("status" IN ('VERIFIED', 'NEEDS_REVIEW', 'MISSING', 'NOT_AUTHORIZED'));
ALTER TABLE "Bom" ADD CONSTRAINT "Bom_status_check" CHECK ("status" IN ('OSNUTEK', 'POTRJEN', 'REZERVIRAN', 'PORABLJEN', 'PREKLICAN'));
ALTER TABLE "ProjectPackage" ADD CONSTRAINT "ProjectPackage_status_check" CHECK ("status" IN ('POVPRAŠEVANJE', 'IZMERA', 'KONFIGURACIJA', 'PONUDBA', 'POTRJENO', 'REZERVIRANO', 'V_IZDELAVI', 'DOSTAVLJENO', 'MONTIRANO', 'PREDANO'));
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_status_check" CHECK ("status" IN ('AKTIVNA', 'PORABLJENA', 'PREKLICANA'));
ALTER TABLE "PickingList" ADD CONSTRAINT "PickingList_status_check" CHECK ("status" IN ('PRIPRAVLJENA', 'V_ZAKLJUCEVANJU', 'ZAKLJUCENA', 'PREKLICANA'));
ALTER TABLE "MontazaCheck" ADD CONSTRAINT "MontazaCheck_status_check" CHECK ("status" IN ('NI_ZACETO', 'V_REDU', 'NAPAKA', 'NI_RELEVANTNO', 'CAKA_PREVERJANJE'));
ALTER TABLE "MontazaAction" ADD CONSTRAINT "MontazaAction_status_check" CHECK ("status" IN ('ODPRTO', 'V_OBRAVNAVI', 'ODRAVLJENO', 'PREVERJENO'));
ALTER TABLE "HandoverReport" ADD CONSTRAINT "HandoverReport_status_check" CHECK ("status" IN ('ZAKLJUCENA', 'POGOJNA', 'NEPOPOLNA'));
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_status_check" CHECK ("status" IN ('NACRTOVANO', 'PRIPRAVLJENO', 'NATOVARJENO', 'NA_POTI', 'DOSTAVLJENO', 'PREKLICANA'));
ALTER TABLE "PhotoVisualization" ADD CONSTRAINT "PhotoVisualization_status_check" CHECK ("status" IN ('OSNUTEK', 'IZBRANA', 'ARHIV'));
ALTER TABLE "PlaybookDef" ADD CONSTRAINT "PlaybookDef_status_check" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'RETIRED'));
ALTER TABLE "PlaybookRun" ADD CONSTRAINT "PlaybookRun_status_check" CHECK ("status" IN ('V_TEKU', 'ZAKLJUCEN', 'PREKINJEN'));
ALTER TABLE "PlaybookStepRun" ADD CONSTRAINT "PlaybookStepRun_status_check" CHECK ("status" IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'NI_PRIMERNO', 'BLOKIRANO', 'NEUSPESNO'));
ALTER TABLE "FenceRun" ADD CONSTRAINT "FenceRun_status_check" CHECK ("status" IN ('OSNUTEK', 'PREGLED', 'POTRJEN', 'ARHIV'));
ALTER TABLE "FenceSegment" ADD CONSTRAINT "FenceSegment_status_check" CHECK ("status" IN ('ESTIMATED', 'AUTO_SUGGESTED', 'MANUAL', 'CALIBRATED', 'VERIFIED', 'CONFIRMED'));
ALTER TABLE "ReviewPin" ADD CONSTRAINT "ReviewPin_status_check" CHECK ("status" IN ('ODPRTO', 'RESENO', 'ZAPRT'));
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_status_check" CHECK ("status" IN ('PENDING', 'SENT', 'FAILED', 'DEAD'));
ALTER TABLE "CaptureSession" ADD CONSTRAINT "CaptureSession_status_check" CHECK ("status" IN ('V_TEKU', 'ZAKLJUCEN', 'PREKINJEN'));
ALTER TABLE "CaptureReference" ADD CONSTRAINT "CaptureReference_status_check" CHECK ("status" IN ('AKTIVNA', 'KONFLIKT', 'ZAVRACENA'));
ALTER TABLE "GeoReference" ADD CONSTRAINT "GeoReference_status_check" CHECK ("status" IN ('AKTIVNA', 'KONFLIKT', 'ZAVRACENA'));
ALTER TABLE "LoopClosure" ADD CONSTRAINT "LoopClosure_status_check" CHECK ("status" IN ('LOOP_CLOSED', 'LOOP_WARNING', 'LOOP_FAILED'));
