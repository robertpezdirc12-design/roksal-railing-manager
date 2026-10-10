-- R467 SMART VISION (issue #8 Faza 1) — razumevanje prizora na AR posnetku.
-- sceneJson = SceneUnderstandingResult { version, elements[], edits[] }:
--   elements: zaznani elementi prizora ob zajemu (razred, status, bbox, vir)
--   edits:    popravki monterja kot OZNAČEN PODATEK (izvirnik ostaja)

ALTER TABLE "ArSnapshot" ADD COLUMN "sceneJson" TEXT;
