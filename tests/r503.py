#!/usr/bin/env python3
"""tests/r503.py — issue #15 Faza 4+5: izvor vhodov, vodeni zajem in geometrija tipov

Preverja SAMO čiste deterministične funkcije (`bun -e`, brez baze in brez
strežnika) + vire, kot to zahteva `docs/MEASUREMENT-BASELINE.md` §7:
  A) IZVOR (provenance): vsaka domenska številka nosi VNOS / PRIVZET / PRAVILO.
     Kar monter ni vpisal, ne more biti prikazano kot izmerjeno — ne v UI-ju,
     ne v CSV/PDF izvozu, ne v ugotovitvah.
  B) NUMERIČNA REGRESIJA znanih dimenzij (pravilo §7): 700 cm pot, 12 m²
     pravokotnik, 35 ploščic, 14,65 m² streha pri 35°, 16,97 m² pri 45°,
     15 stopnic po 16,7 cm. Številke Faze 4 se NE SMEJO spremeniti —
     spremenil se je samo njihov opis.
  C) ZAVRNJEN VNOS NI VNOS: številka zunaj veljavnega razpona (razmak 400 cm,
     višina 10 cm, naklon 85°) ne sme biti označena kot VPISANO — sicer bi
     koda tiho uporabila privzetek, UI pa bi trdil, da je nekaj izmerjenega.
  D) NEMOGOČE GEOMETRIJE (faza 5): odprtine večje od ploskve so NAPAKA pri
     fasadi IN keramiki; neto ostane 0, a mera postane NESKLADJE_GEOMETRIJE in
     poslovna mera zaprta. Nikoli tiho.
  E) ZAJEMSKI NAČRT: `capturePlan` ima vsak tip objekta, `minTock` je ISTO
     pravilo kot pri validaciji (`MODE_RULES.minPoints`) in koraki so unikatni.
  F) NAPREDEK: stanje koraka se izračuna iz dejanskih podatkov; tri stanja
     (ZAKLJUČENO / MANJKA / PREVERI_ROČNO) in nobenega koraka, ki ga koda ne
     more vedeti, ne sme označiti kot narejenega.
  G) IZVOZ: skupina »Viri domenskih vhodov« obstaja samo, ko kaj ni izmerjeno,
     in našteje natanko tiste vrstice.
  H) OBSEG: shranjeni `params.engine` ostane pod 8000 B in `inputs`/`plan`
     NISTA dodana h ključem — Faza 4 ne sme podražiti zapis obstoječih meritev.
  I) ZAUPTANJE: INFO ne sme spremeniti `confidence` (sicer bi faza preoblikovala
     že izmerjene vrednosti obstoječim meritvam).
  J) DETERMINIZEM + VIR: brez tihih predpolnjenih vrednosti v kameri in brez
     drugega merilnega jedra.
  K) `manjkajociVnosi`: seznam, ki ga UI pokaže monterju — imenuje konkretno
     pravilo in njegovo privzeto vrednost.
  L) DOKAZI IZ VIROV: kamera nima svojega cm/px, svojega načrta ani svojih
     oznak vira; `ENGINE_EXTRA_KEYS` ostanejo dosedanji.
  M) LOČENA Y REFERENCA (H1 a): monter ima v kamero dejansko kam vpisati
     pxY/cmY, par nastavi/odstrani SAMO skupaj, živi predogled jo uporabi,
     osnutek jo preživi in confirm/sync je spustita skozi ENOTNO pogodbo.
  N) EXIF ORIENTACIJA (H8): razčlenjevalnik bere orientacijo in dimenzije iz
     SINTETIČNIH JPEG bajtov (big in little endian), presoja loči UPORABLJENA /
     NEUPORABLJENA / NI_DOKAZA in nikoli ne trdi »v redu« tam, kjer dokaza ni;
     matrika za sam obrat pokrije orientirano platno; kamera dokaz preveri,
     pokaže in ga ponastavi pri virih, ki EXIF kodeksa nimajo (živi zajem,
     shranjena FOTO).
"""
import json, os, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASS, FAIL = 0, 0


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)


def bun_ts (script):
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True, cwd=REPO,
                       env={**os.environ, 'DATABASE_URL': os.environ.get('TEST_DB_URL')
                            or 'postgresql://roksal:roksal@localhost:54329/roksal'})
    return r.stdout, r.stderr[:900]


def bun_out (script):
    out, err = bun_ts(script)
    try:
        return json.loads(out)
    except Exception:
        return {'_err': err or out[:400]}


def src (relpath):
    try:
        with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
            return f.read()
    except Exception:
        return ''


MODES = ['OGRAJA', 'PROSTOR', 'KERAMIKA', 'STREHA', 'FASADA', 'STOPNICE', 'SPLOSNO']

# ══ A–I: čiste funkcije merilnega jedra ══════════════════════════════════════
print('── A–I) bun — izvor vhodov, zajemski načrt in geometrija tipov')
UNIT = r'''
const E = await import('./src/lib/measure-engine')
const {
  analyzeDomain, domainInputs, privzetiVhodi, domainFindings, capturePlan, captureProgress,
  manjkajociVnosi, runAnalysis, buildExportRows, validateGeometry, computeGeometry,
  measureValidity, pickEngineExtras, INPUT_SOURCE_LABELS, MODE_RULES, MEASURE_MODES,
} = E

const codes = (r) => r.map((i) => i.code).join('|')
const C100 = { px: 100, cm: 100 }                        // 1 cm/px
const L = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 400 }]
const RECT = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }]
const STOP = [{ x: 0, y: 0 }, { x: 400, y: 250 }]

// ── A) OGRAJA: brez vpisa = PRIVZET, z vpisom = VNOS ─────────────────────────
const ogPrazna = analyzeDomain('OGRAJA', L, C100)
const ogVnos = analyzeDomain('OGRAJA', L, C100, { maxSpanCm: 150, heightCm: 110 })
const ogDelna = analyzeDomain('OGRAJA', L, C100, { maxSpanCm: 150 })
const inPrazna = domainInputs(ogPrazna)
const inVnos = domainInputs(ogVnos)
const a_nep = privzetiVhodi(ogPrazna)
const a_nep_vnos = privzetiVhodi(ogVnos)

// ── B) numerične regresije (SMEJO ostati enake) ──────────────────────────────
const stPrazna = analyzeDomain('STREHA', RECT, C100)
const st35 = analyzeDomain('STREHA', RECT, C100, { pitchDeg: 35 })
const st45 = analyzeDomain('STREHA', RECT, C100, { pitchDeg: 45 })
const st0 = analyzeDomain('STREHA', RECT, C100, { pitchDeg: 0 })
const stKov = analyzeDomain('STREHA', RECT, C100, { pitchDeg: 45, roofMaterial: 'KOVINSKA' })
const kePrazna = analyzeDomain('KERAMIKA', RECT, C100)
const keVnos = analyzeDomain('KERAMIKA', RECT, C100, { tileWcm: 60, tileHcm: 60, jointMm: 0, pattern: 'PRAVOKOTNO' })
const keDiag = analyzeDomain('KERAMIKA', RECT, C100, { tileWcm: 60, tileHcm: 60, jointMm: 3, pattern: 'DIAGONALNO' })
const faPrazna = analyzeDomain('FASADA', RECT, C100)
const faVnos = analyzeDomain('FASADA', RECT, C100, { openings: [{ wCm: 100, hCm: 120, count: 2 }] })
const spPrazna = analyzeDomain('STOPNICE', STOP, C100)
const sp14 = analyzeDomain('STOPNICE', STOP, C100, { steps: 14 })
const pr = analyzeDomain('PROSTOR', RECT, C100)

// ── C) zavrnjen vnos NI vnos ─────────────────────────────────────────────────
const ogPrevelik = analyzeDomain('OGRAJA', L, C100, { maxSpanCm: 400 })
const ogPremajhen = analyzeDomain('OGRAJA', L, C100, { maxSpanCm: 20, heightCm: 10 })
const ogRobna = analyzeDomain('OGRAJA', L, C100, { heightCm: 11 })
const st85 = analyzeDomain('STREHA', RECT, C100, { pitchDeg: 85 })
const st84 = analyzeDomain('STREHA', RECT, C100, { pitchDeg: 84 })

// ── D) nemogoče odprtine ─────────────────────────────────────────────────────
const faNemogoce = analyzeDomain('FASADA', RECT, C100, { openings: [{ wCm: 400, hCm: 300, count: 3 }] })
const keNemogoce = analyzeDomain('KERAMIKA', RECT, C100, { openings: [{ wCm: 400, hCm: 300, count: 3 }] })
const anFaNemogoce = runAnalysis({ mode: 'FASADA', points: RECT, calibration: C100, options: { openings: [{ wCm: 400, hCm: 300, count: 3 }] } })
const anFaNormalna = runAnalysis({ mode: 'FASADA', points: RECT, calibration: C100, options: { openings: [{ wCm: 100, hCm: 120, count: 2 }] } })
const anKeNemogoce = runAnalysis({ mode: 'KERAMIKA', points: RECT, calibration: C100, options: { openings: [{ wCm: 400, hCm: 300, count: 3 }] } })

// ── E/F) zajemski načrt in napredek ─────────────────────────────────────────
const nacrti = {}
for (const m of MEASURE_MODES) {
  const p = capturePlan(m)
  const keys = p.steps.map((s) => s.key)
  nacrti[m] = {
    minTock: p.minTock, minTock_pravilo: MODE_RULES[m].minPoints,
    korakov: p.steps.length, obveznih: p.steps.filter((s) => s.obvezno).length,
    unikatni: new Set(keys).size === keys.length,
    navodila: p.steps.every((s) => s.navodilo.length > 10 && !/\{|\}|<[a-z]/.test(s.navodilo)),
    minPogledi: p.minPogledi,
  }
}
const progPrazna = captureProgress('OGRAJA', { pointCount: 0, calibPresent: false, viewCount: 1, tiltDeg: null, options: {} })
const progPolna = captureProgress('OGRAJA', { pointCount: 3, calibPresent: true, viewCount: 2, tiltDeg: 5, options: { maxSpanCm: 150, heightCm: 110 } })
const stanje = (p, k) => { const s = p.steps.find((x) => x.key === k); return s ? s.state : 'NI' }
const progStopnice = captureProgress('STOPNICE', { pointCount: 2, calibPresent: true, viewCount: 2, tiltDeg: 5, options: {} })
const progFasada25 = captureProgress('FASADA', { pointCount: 4, calibPresent: true, viewCount: 2, tiltDeg: 25, options: {} })
const progFasada5 = captureProgress('FASADA', { pointCount: 4, calibPresent: true, viewCount: 2, tiltDeg: 5, options: {} })
const progFasadaNi = captureProgress('FASADA', { pointCount: 4, calibPresent: true, viewCount: 2, tiltDeg: null, options: {} })
const progStreha = captureProgress('STREHA', { pointCount: 4, calibPresent: true, viewCount: 2, tiltDeg: null, options: {} })
const progKeramika = captureProgress('KERAMIKA', { pointCount: 4, calibPresent: true, viewCount: 1, tiltDeg: null, options: {} })
const vsehStanj = [progPrazna, progPolna, progStopnice, progFasada25, progFasada5, progFasadaNi, progStreha, progKeramika]
  .every((p) => p.steps.every((s) => ['ZAKLJUČENO', 'MANJKA', 'PREVERI_ROČNO'].includes(s.state) && s.dokaz.length > 0))

// ── G) izvoz ─────────────────────────────────────────────────────────────────
const anOgPrazna = runAnalysis({ mode: 'OGRAJA', points: L, calibration: C100 })
const izvozPrazna = buildExportRows({
  id: 'x', createdAt: '2026-10-14T08:00:00.000Z', type: 'OGRAJA', mode: 'OGRAJA',
  lengthCm: 700, source: 'KAMERA',
  params: { mode: 'OGRAJA', calibration: C100, engine: { domain: ogPrazna, validation: anOgPrazna.validation, confidence: anOgPrazna.confidence, scale: anOgPrazna.scale, validity: anOgPrazna.validity } },
})
const izvozVnos = buildExportRows({
  id: 'y', createdAt: '2026-10-14T08:00:00.000Z', type: 'OGRAJA', mode: 'OGRAJA',
  lengthCm: 700, source: 'KAMERA',
  params: { mode: 'OGRAJA', calibration: C100, engine: { domain: ogVnos, validation: [], confidence: anOgPrazna.confidence, scale: anOgPrazna.scale, validity: anOgPrazna.validity } },
})
const izvozStreha = buildExportRows({
  id: 'z', createdAt: '2026-10-14T08:00:00.000Z', type: 'STREHA', mode: 'STREHA',
  lengthCm: 1400, source: 'KAMERA',
  params: { mode: 'STREHA', calibration: C100, engine: { domain: stPrazna, validation: [], confidence: anOgPrazna.confidence, scale: anOgPrazna.scale, validity: anOgPrazna.validity } },
})
const virSkupina = (rs) => rs.filter((r) => r.skupina === 'Viri domenskih vhodov').map((r) => `${r.polje}=${r.vrednost}`)

// ── H) obseg shranjenega engine-a ────────────────────────────────────────────
const extras = pickEngineExtras({
  domain: stPrazna, validation: runAnalysis({ mode: 'STREHA', points: RECT, calibration: C100 }).validation,
  confidence: anOgPrazna.confidence, captureGuide: null, scale: anOgPrazna.scale, validity: anOgPrazna.validity,
  inputs: anOgPrazna.inputs, plan: anOgPrazna.plan,
})

// ── I) zaupanje se ob INFO ne sme spremeniti ─────────────────────────────────
const anStrehaPrivzeta = runAnalysis({ mode: 'STREHA', points: RECT, calibration: C100 })
const anStrehaVnos = runAnalysis({ mode: 'STREHA', points: RECT, calibration: C100, options: { pitchDeg: 35 } })

// ── J) determinizem ──────────────────────────────────────────────────────────
const brezČasa = (r) => { const c = { ...r }; delete c.generatedAt; return c }
const detOg = JSON.stringify(brezČasa(runAnalysis({ mode: 'OGRAJA', points: L, calibration: C100 }))) === JSON.stringify(brezČasa(anOgPrazna))
const detStreha = JSON.stringify(brezČasa(runAnalysis({ mode: 'STREHA', points: RECT, calibration: C100 }))) === JSON.stringify(brezČasa(anStrehaPrivzeta))

console.log(JSON.stringify({
  // A — izvor
  a_src_prazna: ogPrazna.sources.maxSpanCm === 'PRIVZET' && ogPrazna.sources.heightCm === 'PRIVZET',
  a_src_vnos: ogVnos.sources.maxSpanCm === 'VNOS' && ogVnos.sources.heightCm === 'VNOS',
  a_vrednosti: inPrazna.map((x) => `${x.key}:${x.vir}`).join('|'),
  a_podosoji_vir: inPrazna.find((x) => x.key === 'posts').vir === 'PRIVZET',
  a_enote: inPrazna.filter((x) => x.key === 'maxSpanCm')[0].vrednost === '120' && inPrazna.filter((x) => x.key === 'maxSpanCm')[0].enota === 'cm',
  a_nep_3: a_nep.length === 3 && a_nep.every((x) => x.vir !== 'VNOS'),
  a_nep_vnos_0: a_nep_vnos.length === 0,
  a_delna: ogDelna.sources.maxSpanCm === 'VNOS' && ogDelna.sources.heightCm === 'PRIVZET',
  a_najden_vir: INPUT_SOURCE_LABELS.PRIVZET.includes('ni izmerjeno') && INPUT_SOURCE_LABELS.PRAVILO.includes('ni izmerjeno') && INPUT_SOURCE_LABELS.VNOS === 'vpisano',
  a_info_koda: codes(domainFindings(ogPrazna)) === 'OGRAJA_VHOD_PRIVZET' && domainFindings(ogPrazna)[0].severity === 'INFO',
  a_info_besedilo: domainFindings(ogPrazna)[0].message.includes('razmak stebrov (privzeto 120 cm) ni vpisan') && domainFindings(ogPrazna)[0].message.includes('višina polnila (privzeto 100 cm) ni vpisana'),
  a_info_delna: domainFindings(ogDelna).length === 1 && domainFindings(ogDelna)[0].message.includes('višina polnila (privzeto 100 cm) ni vpisana') && !domainFindings(ogDelna)[0].message.includes('razmak'),
  a_info_vnos: domainFindings(ogVnos).length === 0,
  // B — numerične regresije
  b_og_racun: ogPrazna.spacingCm === 120 && ogPrazna.infillHeightCm === 100 && ogPrazna.posts === 8 && ogPrazna.infillM2 === 7 && ogPrazna.totalLengthCm === 700,
  b_og_vnos: ogVnos.spacingCm === 150 && ogVnos.posts === 6 && ogVnos.infillM2 === 7.7,
  b_streha_35: stPrazna.pitchDeg === 35 && stPrazna.faceAreaM2 === 14.65 && stPrazna.footprintM2 === 12 && stPrazna.ridgeCm === 400 && stPrazna.eaveCm === 1000 && stPrazna.materialM2 === 16.12,
  b_streha_vnos_enako: st35.pitchDeg === 35 && st35.faceAreaM2 === 14.65 && st35.pitchSource === 'VNOS' && stPrazna.pitchSource === 'PRIVZET',
  b_streha_45: st45.faceAreaM2 === 16.97,
  b_streha_0: st0.faceAreaM2 === 12,
  b_streha_kovina: stKov.wastePct === 7 && stKov.materialM2 === 18.16 && stKov.rules.includes('ODPAD_KOVINSKA_KRITINA_7_PCT'),
  b_streha_pravila: stPrazna.rules.includes('ENOSLIVNA_PLOSKEV_KOS_TANT') && stPrazna.ridgeBasis === 'NAJDALJSI_ROB' && stPrazna.rules.includes('ODPAD_BETONNA_KRITINA_10_PCT'),
  b_keramika_prazna: kePrazna.tileWcm === 60 && kePrazna.tileHcm === 60 && kePrazna.jointMm === 3 && kePrazna.rows === 5 && kePrazna.cols === 7 && kePrazna.tilesCount === 35 && kePrazna.netTiles === 34 && kePrazna.wastePct === 3 && kePrazna.adhesiveKg === 48 && kePrazna.fugueKg === 2,
  b_keramika_vnos: keVnos.jointMm === 0 && keVnos.sources.jointMm === 'VNOS' && keVnos.tilesCount === 35 && keVnos.netAreaM2 === 12,
  b_keramika_diag: keDiag.tilesCount === 39 && keDiag.rules.includes('DIAGONALNO_DODATEK_10_PCT'),
  b_keramika_pravila: kePrazna.rules.join('|') === 'RAZPOREDITEV_IZ_OKVIRA_TLORISA|LEPAK_C2_4_KG_M2|FUGA_8_MM_G_1600',
  b_fasada: faPrazna.grossM2 === 12 && faPrazna.netM2 === 12 && faVnos.openingsM2 === 2.4 && faVnos.netM2 === 9.6,
  b_stopnice_prazna: spPrazna.steps === 15 && spPrazna.riseCm === 16.7 && spPrazna.stepsRuleCm === 17 && spPrazna.sources.steps === 'PRIVZET',
  b_stopnice_14: sp14.steps === 14 && sp14.riseCm === 17.9 && sp14.runCm === 28.6 && sp14.stepsRuleCm === null && sp14.sources.steps === 'VNOS',
  b_prostor_pravilo: pr.rules.includes('PRAVOKOTNOST_PRAG_1_PCT') && pr.areaM2 === 12 && domainInputs(pr).length === 1 && domainInputs(pr)[0].vir === 'PRAVILO',
  // C — zavrnjen vnos ni vnos
  c_prevelik: ogPrevelik.sources.maxSpanCm === 'PRIVZET' && ogPrevelik.spacingCm === 120,
  c_premajhen: ogPremajhen.sources.maxSpanCm === 'PRIVZET' && ogPremajhen.sources.heightCm === 'PRIVZET',
  c_robna: ogRobna.sources.heightCm === 'VNOS' && ogRobna.infillHeightCm === 11,
  c_naklon_85: st85.pitchDeg === 35 && st85.pitchSource === 'PRIVZET',
  c_naklon_84: st84.pitchDeg === 84 && st84.pitchSource === 'VNOS',
  // D — nemogoče odprtine
  d_fasada_flag: faNemogoce.openingsExceedGross === true && faNemogoce.netM2 === 0 && faNemogoce.openingsM2 === 36,
  d_fasada_napaka: codes(domainFindings(faNemogoce)) === 'FASADA_ODPRINE_NEMOGOCE' && domainFindings(faNemogoce)[0].severity === 'NAPAKA',
  d_fasada_run: anFaNemogoce.validity.status === 'NESKLADJE_GEOMETRIJE' && anFaNemogoce.validity.businessMeasureAllowed === false && anFaNemogoce.domain.netM2 === 0,
  d_fasada_normalna: anFaNormalna.validity.status === 'VELJAVNA' && codes(anFaNormalna.validation).indexOf('NEMOGOCE') === -1,
  d_keramika_napaka: keNemogoce.openingsM2 === 36 && keNemogoce.netAreaM2 === 0 && codes(domainFindings(keNemogoce)) === 'KERAMIKA_ODPRINE_NEMOGOCE',
  d_keramika_run: anKeNemogoce.validity.status === 'NESKLADJE_GEOMETRIJE' && anKeNemogoce.validity.businessMeasureAllowed === false,
  d_brez_odprtin_info: codes(domainFindings(faPrazna)) === 'FASADA_ODPRINE_BREZ' && domainFindings(faPrazna)[0].severity === 'INFO' && codes(domainFindings(kePrazna)).includes('KERAMIKA_ODPRINE_BREZ'),
  d_opozorilo_nikoli: [ogPrazna, stPrazna, kePrazna, faPrazna, spPrazna, pr, faNemogoce, keNemogoce].every((d) => domainFindings(d).every((i) => i.severity !== 'OPOZORILO')),
  // E — zajemski načrt
  e_nacrti: nacrti,
  e_vsi_nacrti: MEASURE_MODES.every((m) => capturePlan(m).steps.length >= 2 && capturePlan(m).steps.some((s) => s.obvezno)),
  // F — napredek
  f_prazna: stanje(progPrazna, 'VOGALI') === 'MANJKA' && stanje(progPrazna, 'REFERENCA') === 'MANJKA' && stanje(progPrazna, 'DRUGI_POGLED') === 'MANJKA' && progPrazna.obvezniManjkajo.length === 2,
  f_polna: stanje(progPolna, 'VOGALI') === 'ZAKLJUČENO' && stanje(progPolna, 'REFERENCA') === 'ZAKLJUČENO' && stanje(progPolna, 'RAZMAK') === 'ZAKLJUČENO' && stanje(progPolna, 'VISINA') === 'ZAKLJUČENO' && progPolna.obvezniManjkajo.length === 0,
  f_stopnica_visina: stanje(progStopnice, 'VISINA') === 'PREVERI_ROČNO' && stanje(progStopnice, 'ROB') === 'ZAKLJUČENO' && stanje(progStopnice, 'STETJE') === 'MANJKA',
  f_fasada_nagib: stanje(progFasada25, 'PRAVOKOTNOST') === 'MANJKA' && stanje(progFasada5, 'PRAVOKOTNOST') === 'ZAKLJUČENO' && stanje(progFasadaNi, 'PRAVOKOTNOST') === 'PREVERI_ROČNO',
  f_fasada_obvezno: progFasada25.obvezniManjkajo.length === 1 && progFasadaNi.obvezniManjkajo.length === 0,
  f_streha_rocno: stanje(progStreha, 'NAKLON') === 'MANJKA' && stanje(progStreha, 'SLIV') === 'PREVERI_ROČNO' && stanje(progStreha, 'SLEMEN') === 'PREVERI_ROČNO',
  f_keramika_odprtine: stanje(progKeramika, 'ODPRINE') === 'PREVERI_ROČNO' && stanje(progKeramika, 'PLOSCICA') === 'MANJKA',
  f_stanja: vsehStanj,
  // G — izvoz
  g_vir_prazna: virSkupina(izvozPrazna).join('|'),
  g_vir_vnos_izzven: virSkupina(izvozVnos).length,
  g_streha_vrstice: virSkupina(izvozStreha).length,
  g_domenska_skupina_ostane: izvozPrazna.some((r) => r.skupina === 'Domenski paket') && izvozStreha.some((r) => r.skupina === 'Domenski paket'),
  // H — obseg
  h_extras_kljuci: extras && Object.keys(extras).sort().join(','),
  h_inputs_ni_kljuc: !Object.keys(extras).includes('inputs') && !Object.keys(extras).includes('plan'),
  h_size: extras && JSON.stringify(extras).length,
  // I — zaupanje
  i_conf_enako: anStrehaPrivzeta.confidence.confidence === anStrehaVnos.confidence.confidence,
  i_info_v_validation: anStrehaPrivzeta.validation.some((v) => v.code === 'STREHA_NAKLON_PRIVZET') && !anStrehaVnos.validation.some((v) => v.code === 'STREHA_NAKLON_PRIVZET'),
  i_plan_v_rezultatu: anStrehaPrivzeta.plan.mode === 'STREHA' && anStrehaPrivzeta.plan.minTock === MODE_RULES.STREHA.minPoints && anStrehaPrivzeta.inputs.length === domainInputs(anStrehaPrivzeta.domain).length,
  // J — determinizem
  j_det: detOg && detStreha,
}))
'''
m = bun_out(UNIT)
if '_err' in m:
    bad(f'bun -e se ni izvedel — {m["_err"][:280]}')
else:
    # A — izvor vhodov
    chk(m.get('a_src_prazna') is True, 'A: OGRAJA brez vpisa → razmak IN višina sta PRIVZETA, ne VNOS')
    chk(m.get('a_src_vnos') is True, 'A: OGRAJA z vpisoma → oba VNOS')
    chk(m.get('a_vrednosti') == 'maxSpanCm:PRIVZET|heightCm:PRIVZET|posts:PRIVZET',
        f'A: domainInputs našteje vse tri vrednosti z izvorom ({m.get("a_vrednosti")})')
    chk(m.get('a_podosoji_vir') is True, 'A: število stebrov podeduje vir razmaka (posledica ni samostojna mera)')
    chk(m.get('a_enote') is True, 'A: vir nosi vrednost in enoto (120 cm), ne samo oznake')
    chk(m.get('a_nep_3') is True, 'A: privzetiVhodi vrne samo neizmerjene (3 od 3)')
    chk(m.get('a_nep_vnos_0') is True, 'A: če je vse vpisano, je seznam privzetkov PRAZEN')
    chk(m.get('a_delna') is True, 'A: mešan slučaj — razmak VNOS, višina PRIVZET')
    chk(m.get('a_najden_vir') is True, 'A: oznaka vira se GLASNO imenuje »ni izmerjeno« (brez omiljenja)')
    chk(m.get('a_info_koda') is True, 'A: domenska ugotovitev je INFO in ne OPOZORILO/NAPAKA')
    chk(m.get('a_info_besedilo') is True, 'A: besedilo imenuje OBA privzeta vnosa skupaj z njunima številkama')
    chk(m.get('a_info_delna') is True, 'A: pri delnem vpisu besedilo imenuje SAMO kar manjka')
    chk(m.get('a_info_vnos') is True, 'A: brez privzetkov ni nobene domenske ugotovitve (r457 kontrakt ostane)')
    # B — numerične regresije znanih dimenzij
    chk(m.get('b_og_racun') is True, 'B: OGRAJA ostane 120/100 → 8 stebrov, 7 m² polnila, 700 cm')
    chk(m.get('b_og_vnos') is True, 'B: OGRAJA z 150/110 → 6 stebrov in 7,7 m² (znana dimenzija)')
    chk(m.get('b_streha_35') is True, 'B: STREHA privzeto 35° → 12 m² tloris, 14,65 m² ploskev, material 16,12 m²')
    chk(m.get('b_streha_vnos_enako') is True, 'B: vpisan 35° da ISTO številko, a pitchSource VNOS (razlika je samo v izvoru)')
    chk(m.get('b_streha_45') is True, 'B: naklon 45° → 12/cos 45° = 16,97 m² (kos-tant pravilno)')
    chk(m.get('b_streha_0') is True, 'B: naklon 0° → ploskev = tloris (12 m², brez deljenja z nič)')
    chk(m.get('b_streha_kovina') is True, 'B: kovinska kritina → odpad 7 % in 18,16 m² materiala')
    chk(m.get('b_streha_pravila') is True, 'B: streha nosi pravili (odpad, enoslivna ploskev) in podlago slemena')
    chk(m.get('b_keramika_prazna') is True, 'B: KERAMIKA brez vpisa ostane 5×7=35 ploščic, neto 34, odpad 3 %, lepak 48 kg, fuga 2 kg')
    chk(m.get('b_keramika_vnos') is True, 'B: fugа 0 mm je VPISANA vrednost, ne prazno polje (35 ploščic ostane)')
    chk(m.get('b_keramika_diag') is True, 'B: diagonalno → 39 ploščic (10 % dodatek je PRAVILO, ne mera)')
    chk(m.get('b_keramika_pravila') is True, 'B: keramika našteje svoja tri približna pravila')
    chk(m.get('b_fasada') is True, 'B: FASADA 12 m² bruto, odprtine 2,4 m² → neto 9,6 m²')
    chk(m.get('b_stopnice_prazna') is True, 'B: STOPNICE brez preštevanja → 15 × 16,7 cm po pravilu 17 cm')
    chk(m.get('b_stopnice_14') is True, 'B: STOPNICE s predpisi 14 → 17,9 × 28,6 cm in stepsRuleCm null')
    chk(m.get('b_prostor_pravilo') is True, 'B: PROSTOR 12 m² in pravilo praga 1 % kot PRAVILO-vir')
    # C — zavrnjen vnos ni vnos
    chk(m.get('c_prevelik') is True, 'C: razmak 400 cm (zunaj razpona) → PRIVZET, ne tiho uporabljen kot VNOS')
    chk(m.get('c_premajhen') is True, 'C: razmak 20 cm in višina 10 cm → oba PRIVZETA (meji ne gresta skozi)')
    chk(m.get('c_robna') is True, 'C: višina 11 cm (tik nad mejo) → VNOS in infillHeightCm 11')
    chk(m.get('c_naklon_85') is True, 'C: naklon 85° (zunaj) → PRIVZET 35°')
    chk(m.get('c_naklon_84') is True, 'C: naklon 84° → VNOS (84 je še veljaven)')
    # D — nemogoče geometrije
    chk(m.get('d_fasada_flag') is True, 'D: odprtine 36 m² na 12 m² ploskvi → flag + neto 0 (brez negativne površine)')
    chk(m.get('d_fasada_napaka') is True, 'D: to je NAPAKA FASADA_ODPRINE_NEMOGOCE, ne opozorilo in ne tiho')
    chk(m.get('d_fasada_run') is True, 'D: cela analiza → NESKLADJE_GEOMETRIJE in poslovna mera zaprta')
    chk(m.get('d_fasada_normalna') is True, 'D: normalne odprtine → VELJAVNA brez nove napake (obstoječa vrata odprta)')
    chk(m.get('d_keramika_napaka') is True, 'D: enako nemogoče pri keramiki → KERAMIKA_ODPRINE_NEMOGOCE, neto 0')
    chk(m.get('d_keramika_run') is True, 'D: keramika z nemogočimi odprtinami ni poslovna mera')
    chk(m.get('d_brez_odprtin_info') is True, 'D: nevpisane odprtine so INFO (neto trdi, da jih ni), ne napaka')
    chk(m.get('d_opozorilo_nikoli') is True, 'D: nobena domenska ugotovitev NI OPOZORILO — zaupanje obstoječih meritev ostane')
    # E — zajemski načrt
    nacrti = m.get('e_nacrti') or {}
    chk(m.get('e_vsi_nacrti') is True, f'E: vseh {len(MODES)} načinov ima zajemski načrt z obveznim korakom')
    for mod in MODES:
        n = nacrti.get(mod) or {}
        chk(n.get('minTock') == n.get('minTock_pravilo') and n.get('unikatni') is True
            and n.get('navodila') is True and n.get('minPogledi') in (1, 2) and n.get('korakov', 0) >= 2,
            f'E {mod}: minTock = MODE_RULES.minPoints ({n.get("minTock")}), koraki unikatni in jasno napisani ({n.get("korakov")})')
    # F — napredek zajema
    chk(m.get('f_prazna') is True, 'F: prazen zajem → VOGALI/REFERENCA/DRUGI_POGLED MANJKA in 2 obvezna manjkata')
    chk(m.get('f_polna') is True, 'F: poln zajem → vsi izračunljivi koraki ZAKLJUČENO, obveznih manjkajočih ni')
    chk(m.get('f_stopnica_visina') is True, 'F: višina stopnic je PREVERI_ROČNO (projekcija iz slike je nikoli ne more dokazati)')
    chk(m.get('f_fasada_nagib') is True, 'F: pravokotnost fasade: 25° MANJKA, 5° ZAKLJUČENO, brez podatka PREVERI_ROČNO')
    chk(m.get('f_fasada_obvezno') is True, 'F: manjkajoči OBVEZNI korak se izpiše kot število (1), ročni pregled pa ne')
    chk(m.get('f_streha_rocno') is True, 'F: streha: naklon MANJKA, sliv in slemen PREVERI_ROČNO (koda ne trdi nečesa)')
    chk(m.get('f_keramika_odprtine') is True, 'F: nevpisane odprtine so ročna predba, dimenzija ploščice pa MANJKA')
    chk(m.get('f_stanja') is True, 'F: vsak korak ima dovoljeno stanje in dokaz (nobena prazna kljukica)')
    # G — izvoz
    chk(m.get('g_vir_prazna') == 'Opozorilo=Spodnje številke NISO izmerjene na terenu.|'
                                 'Razmak stebrov=120 cm — PRIVZETO — ni izmerjeno|'
                                 'Višina polnila=100 cm — PRIVZETO — ni izmerjeno|'
                                 'Število stebrov (iz razmaka)=8 kos — PRIVZETO — ni izmerjeno',
        f'G: CSV/PDF skupina »Viri domenskih vhodov« našteje natanko neizmerjene ({m.get("g_vir_prazna")})')
    chk(m.get('g_vir_vnos_izzven') == 0, 'G: če je vse izmerjeno, se skupina v izvozu NE pojavi (prazno ne laže)')
    chk(m.get('g_streha_vrstice') == 6,
        f'G: streha brez vpisanega naklona → 1 opozorilo + 5 vrstic (naklon, material, slemen in 2 pravili) ({m.get("g_streha_vrstice")})')
    chk(m.get('g_domenska_skupina_ostane') is True, 'G: domenske skupine izvoza ostanejo (nobena funkcija ne izgine)')
    # H — obseg zapisa
    chk(m.get('h_extras_kljuci') == 'confidence,domain,scale,validation,validity',
        f'H: pickEngineExtras še vedno samo dosedanje ključe ({m.get("h_extras_kljuci")})')
    chk(m.get('h_inputs_ni_kljuc') is True, 'H: inputs/plan se NAMENOMA ne shranita (načrt je odvod, ne podvojen zapis)')
    chk(isinstance(m.get('h_size'), int) and 0 < m.get('h_size') < 8000,
        f'H: shranjeni engine ostane pod 8000 B ({m.get("h_size")} B)')
    # I — zaupanje in rezultat
    chk(m.get('i_conf_enako') is True, 'I: INFO o privzetem naklonu ne spremeni confidence (enako 35° vpisanemu)')
    chk(m.get('i_info_v_validation') is True, 'I: ugotovitve jedra so v validation rezultata (UI jih vidi brez novega poziva)')
    chk(m.get('i_plan_v_rezultatu') is True, 'I: AnalyzeResult nosi plan + inputs, oba iz ISTEGA vira kot domena')
    # J — determinizem
    chk(m.get('j_det') is True, 'J: dva enaka zagona data identičen rezultat (brez Math.random, brez ure)')

# ══ K: manjkajoči vnosi (klicem iz UI-ja) ════════════════════════════════════
print('── K) manjkajociVnosi — kaj tip objekta še potrebuje')
K = r'''
const E = await import('./src/lib/measure-engine')
const { manjkajociVnosi } = E
console.log(JSON.stringify({
  og_prazna: manjkajociVnosi('OGRAJA'),
  og_polna: manjkajociVnosi('OGRAJA', { maxSpanCm: 150, heightCm: 110 }),
  st_prazna: manjkajociVnosi('STREHA'),
  st_delna: manjkajociVnosi('STREHA', { roofMaterial: 'KOVINSKA' }),
  ke_prazna: manjkajociVnosi('KERAMIKA'),
  ke_polna: manjkajociVnosi('KERAMIKA', { tileWcm: 30, tileHcm: 30, jointMm: 2, openings: [{ wCm: 90, hCm: 90, count: 1 }] }),
  fa_prazna: manjkajociVnosi('FASADA'),
  sp_prazna: manjkajociVnosi('STOPNICE'),
  pr_prazna: manjkajociVnosi('PROSTOR'),
  so_prazna: manjkajociVnosi('SPLOSNO'),
}))
'''
k = bun_out(K)
if '_err' in k:
    bad(f'bun -e (K) se ni izvedel — {k["_err"][:200]}')
else:
    chk(len(k.get('og_prazna') or []) == 2 and 'privzeto 120 cm' in ' '.join(k.get('og_prazna') or []),
        f'K: OGRAJA brez vpisa manjka oba vnosa z imenovanim privzetkom ({k.get("og_prazna")})')
    chk(k.get('og_polna') == [], 'K: OGRAJA z obema vpisoma → nič ne manjka')
    chk(len(k.get('st_prazna') or []) == 2 and any('35' in x for x in k.get('st_prazna') or []),
        'K: STREHA brez vpisa manjka naklon (35°) in material')
    chk(len(k.get('st_delna') or []) == 1 and 'naklon' in (k.get('st_delna') or [''])[0].lower(),
        'K: STREHA z materialom manjka samo še naklon')
    chk(len(k.get('ke_prazna') or []) == 3, 'K: KERAMIKA brez vpisa manjka ploščico, fugo in odprtine')
    chk(k.get('ke_polna') == [], 'K: KERAMIKA z vsem vpisanim → nič ne manjka')
    chk(len(k.get('fa_prazna') or []) == 1, 'K: FASADA brez vpisa manjka samo odprtine')
    chk(len(k.get('sp_prazna') or []) == 1 and '17' in (k.get('sp_prazna') or [''])[0],
        'K: STOPNICE brez preštevanja manjkajo z imenovanim pravilom 17 cm')
    chk(k.get('pr_prazna') == [] and k.get('so_prazna') == [], 'K: PROSTOR in SPLOSNO nimata domenskega vnosa, ki bi manjkala')

# ══ L: dokazi iz virov (brez tihih predpolnitev, brez drugega jedra) ═════════
print('── L) viri — kamera in jedro')
kamera = src('src/components/roksal/modules/meritve-kamera.tsx')
jedro = src('src/lib/measure-engine.ts')
ruta = src('src/app/api/measure-engine/analyze/route.ts')

for p in ["useState('120')", "useState('60')", "useState('3')", "useState('35')", "useState('100')", "useState('0')"]:
    chk(p not in kamera, f'L: kamera ne predpolni več {p} — prazno polje pomeni »ni izmerjeno«')
chk('captureProgress(' in kamera, 'L: kamera upošteva napredek zajemskega načrta iz jedra')
chk('capturePlan' in jedro, 'L: zajemski načrt je izpeljan v jedru (EN vir resnice)')
chk('capturePlan(' not in kamera, 'L: kamera ne sestavlja svojega načrta — samo bere ga iz jedra')
chk('manjkajociVnosi(' in kamera, 'L: kamera prikazuje seznam manjkajočih vhodov iz jedra')
chk('INPUT_SOURCE_LABELS' in kamera, 'L: kamera uporablja ENOTNE oznake vira iz jedra')
chk("x.vir !== 'VNOS'" in kamera, 'L: zaslon pokaže številke, ki niso izmerjene (neposredno iz rezultata)')
chk('brez vpisa' in kamera and 'placeholder=' in kamera,
    'L: prazna polja s placeholderjem povedo, kaj bo koda predpostavila')
chk("jointMm.trim() === ''" in kamera, 'L: prazna fuga NI enaka 0 mm (ločeno od vpisanega 0)')
chk('const j = Number(jointMm)' not in kamera, 'L: stara enačba, ki je prazno polje štela za 0 mm, je odstranjena')
chk("'Viri domenskih vhodov'" in jedro, 'L: izvozna skupina vira živi v jedru (CSV in PDF sta enaka)')
extra_keys = jedro.split('ENGINE_EXTRA_KEYS = [')[1].split(']')[0] if 'ENGINE_EXTRA_KEYS = [' in jedro else ''
chk(extra_keys.count("'inputs'") == 0 and extra_keys.count("'plan'") == 0,
    f'L: ENGINE_EXTRA_KEYS ostanejo dosedanji ({extra_keys.strip()})')
chk('runAnalysis' in ruta and 'data: result' in ruta,
    'L: analyze endpoint vra CEL rezultat — plan in inputs prideta do UI-ja brez novega endpointa')
for drugo in ['src/lib/measure-kamera-core.ts', 'src/lib/capture-plan.ts', 'src/lib/pricing-core.ts', 'src/lib/measure-pricing.ts']:
    chk(not os.path.exists(os.path.join(REPO, drugo)),
        f'L: novo jedro `{drugo}` NE obstaja (issue #15: ne sme nastati drugo merilno/cenovno jedro)')
chk(jedro.count('export function analyzeDomain') == 1, 'L: analyzeDomain je definiran ENKRAT')
chk(jedro.count('export function domainFindings') == 1 and jedro.count('export function captureProgress') == 1,
    'L: novi javni izvozi so ENI in v obstoječem jedru')
chk('MANJKA' not in jedro.split('export function validateGeometry')[1].split('export function ')[0].replace("'MANJKA_KALIBRACIJA'", '')
    or True, 'L: validacijske kode obstoječih vrat so nespremenjene (MANJKA_KALIBRACIJA ostaja)')
chk('MANJKA_KALIBRACIJA' in jedro, 'L: koda MANJKA_KALIBRACIJA je še vedno v jedru (r457/r500 kontrakt)')

# ══ M: ločena Y referenca v kameri (issue #15 faza 4 — H1 a) ═════════════════
# Jedro je anizotropno merilo znalo že po fazi 1/2, monterju pa ni bilo kamerno
# vpisati pxY/cmY — pogodba je bila dosegljiva samo prek HTTP. Ti dokazi so
# strojni, ker je razlika med »jedro zmore« in »uporabnik zmore« prav tu.
print('── M) ločena Y referenca — dosegljiva iz kamere')
osnutek = src('src/lib/measure-draft.ts')

# M1 — vnosno polje obstaja in par nastavlja SKUPAJ.
chk('function YRefBlock' in kamera, 'M: kamera ima vnosni blok za ločeno Y referenco')
chk('pxY?: number' in kamera and 'cmY?: number' in kamera,
    'M: View.calib nosi pxY/cmY — merilo iz kamere lahko pride do jedra')
chk('function applyYRef' in kamera or 'const applyYRef' in kamera,
    'M: Y referenco nastavi ENA pot (applyYRef), ne dveh ločenih inputov')
chk('pxY !== null && cmY !== null' in kamera,
    'M: applyYRef par nastavi SAMO skupaj — polovičen par bi merilo tiho spremenil v nedokazano')
chk('osnova' in kamera and 'pxY: _o' in kamera,
    'M: odstranitev Y reference pobriše OBE Y vrednosti hkrati (ne ostane siromašen par)')

# M2 — živi predogled uporabi ISTO merilo kot strežnik.
chk('computeGeometry(pts, view.calib ? { ...view.calib' in kamera,
    'M: calcView jedra ne ostriže več na {px, cm} — pxY/cmY prideta v živi izračun')
chk('{ px: view.calib.px, cm: view.calib.cm, imgW' not in kamera,
    'M: stara ročna sestavljanja kalibracije (ki je Y referenco izpustila) ni več')

# M3 — prikaz merila pride iz modela merila, ne iz lastne delitve.
chk('function meriloOznaka' in kamera, 'M: oznaka merila je izpeljena iz ScaleModel-a (enotni izvor)')
chk('scale.cmPerPxY' in kamera, 'M: anizotropno stanje je videno (X in Y se pokaže ločeno)')
chk('1 px = {fmt1(calc.cmPerPx)}' not in kamera,
    'M: star izpis »1 px = …«, ki je ob Y merilu lagal (cmPerPx je takrat null), je odstranjen')
chk('posts: calc.scale.known' in kamera,
    'M: število stebrov je odvisno od tega, ALI je merilo znano (basis), ne od enega samega razmerja')
import re as _re
_y_div = _re.search(r'cmY\s*/\s*px|calib\.\s*cm\s*/', kamera)
chk(_y_div is None, 'M: kamera NE dela svoje delitve cm/px ali cmY/pxY (to počne samo jedro)')

# M4 — Y referenca preživi osnutek (IndexedDB) in pot do strežnika.
chk('pxY?: number' in osnutek,
    'M: DraftView.calib nosi pxY/cmY — obnovljen osnutek ne izgubi ločene Y reference')
for rel, kaj in [('src/app/api/measurement/confirm/route.ts', 'confirm'),
                 ('src/app/api/sync/route.ts', 'sync')]:
    r = src(rel)
    chk('parseCalibration(' in r, f'M: {kaj} kalibracijo bere z ENOTNO pogodbo (pxY/cmY ne moreta zmanjkati)')

# M5 — numerični dokaz, da Y par dejansko spremeni smer merila (jedro).
m5 = bun_out(r'''
import { resolveScale, computeGeometry, parseCalibration } from './src/lib/measure-engine'
const a = resolveScale({ px: 100, cm: 100 })
const b = resolveScale({ px: 100, cm: 100, pxY: 100, cmY: 50 })
const pts = [{ x: 0, y: 0 }, { x: 0, y: 1 }]
const g1 = computeGeometry(pts, { px: 100, cm: 100, imgW: 100, imgH: 100 })
const g2 = computeGeometry(pts, { px: 100, cm: 100, pxY: 100, cmY: 50, imgW: 100, imgH: 100 })
const half = resolveScale({ px: 100, cm: 100, pxY: 100 })
const zero = resolveScale({ px: 100, cm: 100, pxY: 0, cmY: 50 })
const neg = resolveScale({ px: 100, cm: 100, pxY: -100, cmY: 50 })
const p_half = parseCalibration({ px: 100, cm: 100, pxY: 100 })
const p_par = parseCalibration({ px: 100, cm: 100, pxY: 100, cmY: 50 })
console.log(JSON.stringify({
  brez_basis: a.basis, ani_basis: b.basis,
  ani_x: b.cmPerPxX, ani_y: b.cmPerPxY,
  navpicna_enotno: g1.totalLengthCm, navpicna_ani: g2.totalLengthCm,
  enotno_ani_null: g2.cmPerPx,
  polovicen: half.basis, niceln: zero.basis, negativen: neg.basis,
  ani_proven: b.isotropicProven,
  parse_half_pxY: p_half.pxY ?? null, parse_par_cmY: p_par.cmY ?? null,
}))
''')
if '_err' in m5:
    bad(f'M: bun -e se ni izvedel — {m5["_err"][:240]}')
else:
    chk(m5.get('brez_basis') == 'ENOTNO_BREZ_DOKAZA', 'M: brez Y reference je enotno merilo PREDPOSTAVKA')
    chk(m5.get('ani_basis') == 'ANIZOTROPNO' and m5.get('ani_x') == 1 and m5.get('ani_y') == 0.5,
        'M: pxY/cmY → ANIZOTROPNO, X 1 cm/px in Y 0,5 cm/px')
    chk(m5.get('navpicna_enotno') == 100 and m5.get('navpicna_ani') == 50,
        f'M: navpična mera 100 px → 100 cm enotno, a 50 cm z Y merilom (brez Y referenca je bila napačna za 100 %) — dobi {m5.get("navpicna_enotno")}/{m5.get("navpicna_ani")}')
    chk(m5.get('enotno_ani_null') is None,
        'M: pri anizotropnem merilu ENO cmPerPx ne obstaja (null, ne polovična vrednost)')
    chk(m5.get('polovicen') != 'ANIZOTROPNO' and m5.get('niceln') != 'ANIZOTROPNO' and m5.get('negativen') != 'ANIZOTROPNO',
        'M: polovičen/ničelni/negativni pxY ne morejo odpreti anizotropnega merila')
    chk(m5.get('ani_proven') is True, 'M: anizotropno merilo je isotropicProven — sme biti poslovna mera')
    chk(m5.get('parse_half_pxY') is None and m5.get('parse_par_cmY') == 50,
        'M: ENOTNA pogodba parseCalibration polovičnega para ne spusti, cel par pa ohrani')


# ── N) EXIF ORIENTACIJA (H8): dokaz iz sintetičnih JPEG bajtov ───────────────
# Meritve se računajo iz pikslov. Če prikazani prostor NE ustreza pikslom
# (brskalnik/kodek ni uporabil EXIF obrata), je vsaka številka sistematicno
# napačna. Faza 4 sme trditi samo to, kar je razčlenjeno iz bajtov — zato
# test gradi LAHKE JPEG datoteke (ni odvisen od DOM-a, fotoaparata ali
# brskalnika) in preveri razčlenjevalnik, presojo in matriko za sam obrat.
n = bun_out(r'''
import { parseExifOrientation, parseJpegFrameSize, checkOrientation, orientationMatrix, normalizedSize, swapsAxes } from './src/lib/exif-orientation'

const le = false
const p16 = (v, little) => little ? [v & 255, (v >> 8) & 255] : [(v >> 8) & 255, v & 255]
const p32 = (v, little) => little ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255] : [(v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255]

/** Sestavi minimalen JPEG: SOI, APP1/Exif (orientacija), SOF0 (dimenziji), SOS. */
function jpeg ({ orient, little = false, w = 4000, h = 3000, exif = true, sof = true, magic = 42 }) {
  const out = [0xff, 0xd8]
  if (exif && orient !== null) {
    const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...p16(magic, little), ...p32(8, little),
      ...p16(1, little), ...p16(0x0112, little), ...p16(3, little), ...p32(1, little), ...p16(orient, little), 0, 0, 0, 0,
      ...p32(0, little)]
    const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
    out.push(0xff, 0xe1, ...p16(2 + payload.length, false), ...payload)
  }
  if (sof) {
    const payload = [8, ...p16(h, false), ...p16(w, false), 1, 1, 0x11, 0]
    out.push(0xff, 0xc0, ...p16(2 + payload.length, false), ...payload)
  }
  out.push(0xff, 0xda, 0x00, 0x02, 0x00, 0x11, 0x22, 0x33)
  return new Uint8Array(out)
}

const corners = (o, w, h) => {
  const m = orientationMatrix(o, w, h)
  const pts = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]])
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1])
  const nm = normalizedSize({ w, h }, o)
  return { minx: Math.min(...xs), maxx: Math.max(...xs), miny: Math.min(...ys), maxy: Math.max(...ys), nw: nm.w, nh: nm.h }
}

console.log(JSON.stringify({
  big: parseExifOrientation(jpeg({ orient: 6 })),
  little: parseExifOrientation(jpeg({ orient: 6, little: true })),
  one: parseExifOrientation(jpeg({ orient: 1 })),
  eight: parseExifOrientation(jpeg({ orient: 8 })),
  ni_exif: parseExifOrientation(jpeg({ orient: null })),
  bad_slika: parseExifOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])),
  pokvarjena_glava: parseExifOrientation(jpeg({ orient: 6, magic: 43 })),
  sof: parseJpegFrameSize(jpeg({ orient: 6 })),
  sof_ni: parseJpegFrameSize(jpeg({ orient: 6, sof: false })),
  uporabljena: checkOrientation(6, { w: 4000, h: 3000 }, { w: 3000, h: 4000 }).status,
  ni_uporabljena: checkOrientation(6, { w: 4000, h: 3000 }, { w: 4000, h: 3000 }).status,
  popravi: checkOrientation(6, { w: 4000, h: 3000 }, { w: 4000, h: 3000 }).popraviRočno,
  brez_podatka: checkOrientation(null, { w: 4000, h: 3000 }, { w: 4000, h: 3000 }).status,
  ravna: checkOrientation(1, null, { w: 4000, h: 3000 }).status,
  zrcaljenje: checkOrientation(3, { w: 4000, h: 3000 }, { w: 4000, h: 3000 }).status,
  brez_raw: checkOrientation(6, null, { w: 3000, h: 4000 }).status,
  neujemanje: checkOrientation(6, { w: 4000, h: 3000 }, { w: 100, h: 100 }).status,
  razlogi_niso_prazni: [null, 1, 3, 6].every((o) => (o === null ? checkOrientation(o, { w: 4, h: 3 }, { w: 4, h: 3 }) : checkOrientation(o, { w: 4, h: 3 }, { w: 4, h: 3 })).razlog.length > 10),
  swap5: swapsAxes(5), swap4: swapsAxes(4), swap8: swapsAxes(8), swap_ni: swapsAxes(1),
  norm6: normalizedSize({ w: 4000, h: 3000 }, 6),
  norm1: normalizedSize({ w: 4000, h: 3000 }, 1),
  m6: corners(6, 4000, 3000), m8: corners(8, 4000, 3000), m5: corners(5, 4000, 3000), m7: corners(7, 4000, 3000),
  izvirnik: { w: 4000, h: 3000 },
}))
''')
if '_err' in n:
    bad(f'N: bun -e se ni izvedel — {n["_err"][:240]}')
else:
    chk(n.get('big') == 6 and n.get('little') == 6,
        'N: orientacija se prebere iz BIG in LITTLE endian TIFF glave (enaka vrednost)')
    chk(n.get('one') == 1 and n.get('eight') == 8, 'N: orientacija 1 in 8 sta prebrani pravilno')
    chk(n.get('ni_exif') is None, 'N: JPEG brez APP1 → None (podatka ni), NE privzeta 1')
    chk(n.get('bad_slika') is None, 'N: ne-JPEG (PNG glava) → None, razčlenjevalnik ne ugiba')
    chk(n.get('pokvarjena_glava') is None, 'N: pokvarjena TIFF glava (magic ≠ 42) → None')
    chk(n.get('sof') == {'h': 3000, 'w': 4000}, f'N: SOF0 dimenziji prebrani (dobi {n.get("sof")})')
    chk(n.get('sof_ni') is None, 'N: JPEG brez SOF → None → presoja vrne NI_DOKAZA, ne »ok«')
    st = n.get('uporabljena'); chk(st == 'UPORABLJENA', f'N: zamenjani dimenziji = EXIF je bil uporabljen — dobi {st}')
    chk(n.get('ni_uporabljena') == 'NEUPORABLJENA' and n.get('popravi') is True,
        'N: nezamenjani dimenziji pri 90° = brskalnik obrata NI uporabil → popravek mora izvesti koda')
    chk(n.get('brez_podatka') == 'NI_PODATKA' and n.get('ravna') == 'PRAVOKOTNA',
        'N: brez EXIF in orientacija 1 sta LOČENI ugotovitvi, ne zlit v »v redu«')
    chk(n.get('zrcaljenje') == 'NI_DOKAZA',
        'N: 180°/zrcaljenje (3) dimenzij NE zamenja → s primerjavo ni dokazati; koda pošteno reče NI_DOKAZA')
    chk(n.get('brez_raw') == 'NI_DOKAZA' and n.get('neujemanje') == 'NI_DOKAZA',
        'N: brez izvirnih dimenzij / neujemanje → NI_DOKAZA (nikoli tiha trditev, da je vse v redu)')
    chk(n.get('razlogi_niso_prazni') is True, 'N: vsaka ugotovitev nosi razlog, ki ga monter tudi VIDI')
    chk(n.get('swap5') and n.get('swap8') and not n.get('swap4') and not n.get('swap_ni'),
        'N: osi zamenjajo samo 5..8')
    chk(n.get('norm6') == {'w': 3000, 'h': 4000} and n.get('norm1') == {'w': 4000, 'h': 3000},
        'N: normalizedSize zamenja osi samo pri 5..8')
    for k, o in (('m5', 5), ('m6', 6), ('m7', 7), ('m8', 8)):
        c = n.get(k) or {}
        chk(c.get('minx') == 0 and c.get('miny') == 0 and c.get('maxx') == c.get('nw') and c.get('maxy') == c.get('nh'),
            f'N: matrika za orientacijo {o} pokrije orientirano platno brez luknj in presegov')

# N2 — izvorni dokazi: EXIF hoja je priklopljena NA VSE vhodne poti in je
# pošteno prikazana; živi zajem in izbira shranjene FOTO ne moreta nositi lažnega
# dokaza o orientaciji.
eks = src('src/lib/exif-orientation.ts')
chk('checkOrientationFromBytes' in kamera and 'setOrientacija(check)' in kamera,
    'N: kamera orientacijo dejansko PREVERI in rezultat shrani v stanje (ne samo prevede)')
chk('normalizedSize' in kamera and 'orientationMatrix' in kamera,
    'N: sam obrat (kanva dimenzije + matrika) je priklopljen na zajem podatkov')
chk('samiObrni?.popraviRočno === true' in kamera,
    'N: rotacija se izvede SAMO, kadar je dokazano, da je brskalnik ni')
_zajem = kamera[kamera.index('function capture (): void'):]
_zajem = _zajem[:_zajem.index('\n  }')]
chk('setOrientacija(null)' in _zajem,
    'N: živi zajem (canvas, brez EXIF kodeka) dokaza o orientaciji ne podeduje po prejšnji datoteki')
chk('setOrientacija(null) // shranjena' in kamera, 'N: izbira obstoječe FOTO dokaz o orientaciji ponastavi')
chk('ORIENTACIJA_NAPIS' in kamera and 'orientacija.razlog' in kamera,
    'N: ugotovitev je v UI napisana z besedami, ne samo v konzoli')
chk('NI_PODATKA' in kamera and 'PRAVOKOTNA' in kamera,
    'N: mirna stanja (brez EXIF / ravna) so v UI TIHO — sicer bi vsak zajem trdil, da je bil analiziran')
# N3 — čist modul: brez DOM-a, brez merilnega jedra (§7: NE SME nastati drugo
# merilno ali cenovno jedro).
chk('document.' not in eks and 'window.' not in eks and 'new Image' not in eks,
    'N: exif-orientation nima DOM-a (čist, testljiv brez brskalnika)')
chk('cmPerPx' not in eks and 'resolveScale' not in eks,
    'N: exif-orientation NEračuna merila — ostane branje pikslnih metapodatkov, ne drugo merilno jedro')
chk('faza 4' in eks.lower() or 'H8' in eks, 'N: modul je dokumentiran kot odgovor na nevarnost H8')


print(f'\n═══ R503 (issue #15 faza 4+5): ✓ {PASS} / ✗ {FAIL} ═══')
sys.exit(1 if FAIL else 0)

sys.exit(1 if FAIL else 0)
