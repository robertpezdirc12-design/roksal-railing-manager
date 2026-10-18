'use client'

// MONTAŽA QA & PRIMOPREDAJA — R489 (GitHub issue #12, P1).
// Del montažnega poteka na nalogu (Danes), vzporedno obstoječemu preprostemu
// kontrolnemu seznamu (R444) — NE nadomesti ga:
//   • MontazaQaSection — statusne kontrolne točke iz virov (playbook MONTAŽA +
//     segmenti tekača + inženirska pravila), odstopanja, korektivni ukrepi;
//   • HandoverSection — verzionirano primopredajno poročilo: primerjava
//     načrtovano/izvedeno, fotografije, potrditev monterja + podpis stranke
//     (ZABELEŽENA potrditev — ne kvalificiran e-podpis), izvoz PDF.
// Mobile-first (390 px), ena roka, brez prekrivanja merilnih kontrol.
//
// R549: ta datoteka je VSTOPNA (javni API za danes-detail ostaja isti).
// Gradniki živijo v poddatotekah: shared (tipi + tok ukrepov), kontrola,
// odstopanja, primopredaja (+ podpisna tablica) — bajtno-identični premiki,
// brez spremembe obnašanja (recept R546–R548).

export { MontazaQaSection } from './montaza-qa-kontrola'
export { HandoverSection } from './montaza-qa-primopredaja'
export type { QaActionRow, QaDeviationRow, QaCheckRow, HandoverRow } from './montaza-qa-shared'


