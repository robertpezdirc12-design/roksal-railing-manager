// src/lib/vlm-experiment.ts — R563 (issue #23): IZOLACIJA VLM IZ MERILNEGA TOKA.
//
// Načelo (issue #23): OBICAJNO merjenje — zajem, kalibracija z referenco,
// večtočkovno označevanje, preverjanje, potrditev, kosovnica, ponudba — deluje
// BREZ ZAI/kljuca in BREZ omrežnega prenosa fotografije zunanjemu modelu.
// VLM zaznava (/api/measurement/detect) je LOČEN EKSPERIMENT, ki je privzeto
// IZKLOPLJEN in se vklopi SAMO z izrecnim env:
//
//     ROKSAL_VLM_EXPERIMENT=1
//
// Vklop je izrecno privoljenje, da se fotografija pošlje zunanjemu modelu
// (glm-4.6v prek z-ai-web-dev-sdk, SAMO backend). Brez env → fail-closed 503.
//
// AR modul (/api/ar/analyze, /api/ar/inspect, /api/ar/analyze-multi) je
// NAMENOMO izven te mere: to so izrecne uporabniške akcije v AR delovnem
// prostoru (R454/R558–R561), ne del običajnega merilnega toka.

/** Ime env spremenljivke, ki vklopi VLM eksperiment v merilnem toku. */
export const VLM_EXPERIMENT_ENV = 'ROKSAL_VLM_EXPERIMENT'

/** Model, ki ga eksperiment uporablja (izrecno dokumentirano v UI). */
export const VLM_EXPERIMENT_MODEL = 'glm-4.6v'

/** Fail-closed preverjanje: SAMO dobesedno '1' vklopi eksperiment. */
export function vlmExperimentVklopljen (): boolean {
  return process.env[VLM_EXPERIMENT_ENV] === '1'
}

/** Kratek odkritosno jasen opis za UI (kaj se zgodi ob vklopu). */
export const VLM_EXPERIMENT_NOTE =
  'Eksperiment: fotografija se pošlje zunanjemu modelu (glm-4.6v) prek strežnika. ' +
  'Predlogi točk ostanejo PREDLOG — nikoli potrjena mera brez vaše kalibracije.'

/** Napaka 503, ko je eksperiment izklopljen (privzeto). */
export const VLM_IZKLOPLJEN_NASLOV = 'Samodejna zaznava (VLM) je izklopljena.'

/** Navodilo iz 503 — merjenje brez VLM je popolnoma podprto. */
export const VLM_IZKLOPLJEN_NAVODILO =
  'Merjenje deluje v celoti brez VLM: točke označite ročno, kalibrirajte z referenco. ' +
  `Vklop eksperimenta: ${VLM_EXPERIMENT_ENV}=1 (izrecno privoljenje za pošiljanje fotografije zunanjemu modelu).`
