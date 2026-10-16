#!/usr/bin/env python3
"""tests/r500.py — issue #15 Faza 1: varna geometrija (merilo, ravnina, veljavnost)

Preverja SAMO čiste deterministične funkcije (`bun -e`, brez baze in brez
strežnika) + izvore, kot to zahteva `docs/MEASUREMENT-BASELINE.md` §7:
  A) merilo: brez kalibracije ni nikakršne tihe rezerve 1 cm/px — merilo je
     NEZNANO in cm-številk ni (computeGeometry / polygonMetrics / diagonalMetrics).
  B) regresija obstoječih kontraktov (r457/r487): enotno merilo mora dati
     TOČNO iste številke (700/300/400, 12 m², 1400 cm, 35 ploščic, …).
  C) anizotropno merilo (pxY/cmY): dolžine, površine in diagonale se računajo
     po smereh — eno globalno razmerje ne velja za vse smeri (issue #15).
  D) nagib kader + razpršene smeri → eksplicitna NAPAKA MERILO_NEZADOSTNO in
     veljavnost NEZADOSTNI_PODATKI; blag nagib ali smer vzdolž reference → ne.
  E) Veljavnost po količinah: VIŠINA iz planarnega overlay-a nikoli ni
     dokazana (3D se ne trdi), površina pada ob nagibu brez Y reference.
  F) STREHA: privzeti naklon 35° mora biti označen PRIVZET, ne izmerjen (H6).
  G) capture guide: nova kontrola MERILO (stanja in razlogi).
  H) izvoz (§19): merilo + veljavnost se vidita v CSV/JSON vrsticah; stare
     meritve brez njiju ostanejo izvozljive (nobena funkcija ne izgine).
  I) determinizem: ista vhoda data identičen rezultat.
  J) vir: tiha rezerva `: 1` je iz merilnega jedra odstranjena.
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
        # R537: veliki moduli so razbiti v podmapo (modul.tsx + modul/*) —
        # statični pregled velja za celo funkcionalnost, ne samo datoteko.
        p = os.path.join(REPO, relpath)
        with open(p, encoding='utf-8') as f:
            besedilo = f.read()
        podmapa = p.rsplit('.', 1)[0]
        if os.path.isdir(podmapa):
            for ime in sorted(os.listdir(podmapa)):
                if ime.endswith(('.ts', '.tsx')):
                    with open(os.path.join(podmapa, ime), encoding='utf-8') as f:
                        besedilo += '\n' + f.read()
        return besedilo
    except Exception:
        return ''


# ══ A–G: čiste funkcije merilnega jedra ═════════════════════════════════════
print('── A–G) bun — merilo, ravnina, veljavnost (čiste funkcije)')
UNIT = r'''
const E = await import('./src/lib/measure-engine')
const {
  resolveScale, computeGeometry, polygonMetrics, diagonalMetrics, validateGeometry,
  analyzeDomain, quantityValidity, measureValidity, captureGuide, runAnalysis,
  buildExportRows, MODE_QUANTITIES, TILT_ENOTNO_MERILO_MAX_DEG,
} = E

const codes = (r) => r.map((i) => i.code)
const has = (r, c) => r.some((i) => i.code === c)

// ── vhodi ────────────────────────────────────────────────────────────────────
const C100 = { px: 100, cm: 100 }                       // 1 cm/px (r457 privzeta referenca)
const CANIS = { px: 100, cm: 100, pxY: 100, cmY: 50 }    // X 1 cm/px, Y 0,5 cm/px
const L = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 400 }]
const RECT = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }]
const HOR = [{ x: 0, y: 0 }, { x: 300, y: 0 }]
const STOP = [{ x: 0, y: 0 }, { x: 400, y: 250 }]

// ── A) brez kalibracije: merilo NEZNANO, ne tiho 1 cm/px ────────────────────
const sNeznan = resolveScale(null)
const sNicla = resolveScale({ px: 0, cm: 0 })
const gNeznan = computeGeometry(L, null)
const pNeznan = polygonMetrics(RECT, undefined)
const dNeznan = diagonalMetrics(RECT, { px: 100, cm: 0 })
const vNeznan = validateGeometry('OGRAJA', L, null)

// ── B) regresija enotnega merila (r457 / r487 številke) ─────────────────────
const g1 = computeGeometry(L, C100)
const p1 = polygonMetrics(RECT, C100)
const d1 = diagonalMetrics(RECT, C100)
const ograja = analyzeDomain('OGRAJA', L, C100, { maxSpanCm: 120, heightCm: 100 })
const keramika = analyzeDomain('KERAMIKA', RECT, C100, { tileWcm: 60, tileHcm: 60, jointMm: 3, openings: [{ wCm: 100, hCm: 120, count: 2 }] })
const prostor = analyzeDomain('PROSTOR', RECT, C100)
const stopnice = analyzeDomain('STOPNICE', STOP, C100, { steps: 14 })
const validacijaOgraja = validateGeometry('OGRAJA', L, C100)
const validacijaKeramika = validateGeometry('KERAMIKA', RECT, C100)

// ── C) anizotropno merilo: smer Y ima svoj razmerje ─────────────────────────
const gAni = computeGeometry(L, CANIS)
const pAni = polygonMetrics(RECT, CANIS)
const dAni = diagonalMetrics(RECT, CANIS)
const sAni = resolveScale(CANIS)

// ── D/E) nagib, razpršenost smeri in veljavnost po količinah ────────────────
const sT25 = resolveScale(C100, { tiltDeg: 25, spreadDeg: null })
const sT5 = resolveScale(C100, { tiltDeg: 5, spreadDeg: 90 })
const sT25Iso = resolveScale(C100, { tiltDeg: 25, spreadDeg: 4 })
const sAniT25 = resolveScale(CANIS, { tiltDeg: 25, spreadDeg: 90 })
const razpr = computeGeometry(L, C100, { tiltDeg: 25 }).scale.directionSpreadDeg
const napakaNagib = validateGeometry('OGRAJA', L, C100, { tiltDeg: 25 })
const brezNapakeVzdolz = validateGeometry('OGRAJA', HOR, C100, { tiltDeg: 25 })
const brezNapakeYRef = validateGeometry('OGRAJA', L, CANIS, { tiltDeg: 25 })
const veljNagib = measureValidity({ scale: computeGeometry(L, C100, { tiltDeg: 25 }).scale, measured: MODE_QUANTITIES.OGRAJA, issues: napakaNagib })
const veljPredpostavka = measureValidity({ scale: resolveScale(C100), measured: MODE_QUANTITIES.OGRAJA, issues: [] })
const visina = quantityValidity(resolveScale(C100, { tiltDeg: 5 }), ['VISINA'])
const visinaAni = quantityValidity(resolveScale(CANIS, { tiltDeg: 25 }), ['VISINA'])
const ploscinaNagnjena = quantityValidity(resolveScale(C100, { tiltDeg: 25, spreadDeg: 90 }), ['PLOSCEVINA'])
const kotNagnjen = quantityValidity(computeGeometry(L, C100, { tiltDeg: 25 }).scale, ['DOLZINA', 'KOT'])
const analizaStopnice = runAnalysis({ mode: 'STOPNICE', points: STOP, calibration: C100, options: { steps: 14 } })
const analizaOgraja = runAnalysis({ mode: 'OGRAJA', points: L, calibration: C100, options: { maxSpanCm: 120, heightCm: 100 } })
const analizaNiKalibracije = runAnalysis({ mode: 'OGRAJA', points: L, calibration: { px: 0, cm: 0 } })

// ── F) STREHA: privzeti naklon je označen PRIVZET (H6) ──────────────────────
const strehaPrivzeta = analyzeDomain('STREHA', RECT, C100)
const strehaVnos = analyzeDomain('STREHA', RECT, C100, { pitchDeg: 35 })
const streha45 = analyzeDomain('STREHA', RECT, C100, { pitchDeg: 45 })

// ── G) capture guide: kontrola MERILO ───────────────────────────────────────
const stanje = (args) => { const g = captureGuide(args); const c = g.checks.find((x) => x.code === 'MERILO'); return { s: c ? c.state : 'NI', d: c ? c.detail : '', status: g.status } }
const gBrezRef = stanje({ quality: null, calibPresent: false, viewCount: 1 })
const gNiNagiba = stanje({ quality: null, calibPresent: true, viewCount: 2 })
const gPravokoten = stanje({ quality: null, calibPresent: true, viewCount: 2, scale: sT5 })
const gNagnjenRazprs = stanje({ quality: null, calibPresent: true, viewCount: 2, scale: computeGeometry(L, C100, { tiltDeg: 25 }).scale })
const gNagnjenVzdolz = stanje({ quality: null, calibPresent: true, viewCount: 2, scale: sT25 })
const gAnizotropen = stanje({ quality: null, calibPresent: true, viewCount: 2, scale: sAniT25 })

// ── H) izvoz: merilo + veljavnost v vrsticah ────────────────────────────────
const izvoz = buildExportRows({
  id: 'x', createdAt: '2026-10-13T08:00:00.000Z', type: 'OGRAJA', mode: 'OGRAJA',
  lengthCm: 500, source: 'KAMERA',
  params: { mode: 'OGRAJA', calibration: CANIS, engine: { domain: ograja, validation: napakaNagib, scale: sAni, validity: veljNagib } },
})
const izvozStary = buildExportRows({ id: 'y', createdAt: '2026-10-13T08:00:00.000Z', type: 'OGRAJA', lengthCm: 250, params: null })
const vrstice = (rs) => rs.filter((r) => r.skupina === 'Merilo').map((r) => `${r.polje}=${r.vrednost}`)

// ── I) determinizem: ista vhoda → enak izhod (brez časovne oznake) ──────────
const brezČasa = (r) => { const c = { ...r }; delete c.generatedAt; return c }
const detA = JSON.stringify(brezČasa(analizaOgraja)) === JSON.stringify(brezČasa(runAnalysis({ mode: 'OGRAJA', points: L, calibration: C100, options: { maxSpanCm: 120, heightCm: 100 } })))

console.log(JSON.stringify({
  // A
  a_neznan_known: sNeznan.known === false && sNeznan.cmPerPxX === null && sNeznan.basis === 'NEZNANO',
  a_neznan_reason: sNeznan.reasons.length === 1 && sNeznan.reasons[0].includes('NE izračunajo'),
  a_nicla_known: sNicla.known === false,
  a_geo_zero: gNeznan.totalLengthCm === 0 && gNeznan.cmPerPx === null && gNeznan.segments.length === 0 && gNeznan.scale.known === false,
  a_poly_zero: pNeznan.areaM2 === 0 && pNeznan.perimeterCm === 0 && pNeznan.scale.known === false,
  a_diag_empty: dNeznan.length === 0,
  a_valid_napaka: has(vNeznan, 'MANJKA_KALIBRACIJA') && vNeznan.length === 1,
  a_run_nezadostni: analizaNiKalibracije.validity.status === 'NEZADOSTNI_PODATKI'
    && analizaNiKalibracije.validity.businessMeasureAllowed === false
    && analizaNiKalibracije.geometry.totalLengthCm === 0,
  // B — r457/r487 regresija
  b_total700: g1.totalLengthCm === 700,
  b_segi: g1.segments.map((s) => s.lengthCm).join(',') === '300,400',
  b_vogal90: g1.corners.length === 1 && g1.corners[0].interiorDeg === 90,
  b_enotno: g1.cmPerPx === 1 && g1.bbox.wCm === 300 && g1.bbox.hCm === 400,
  b_visina_dy: g1.segments[1].heightDiffCm === 400 && g1.segments[1].horizontalCm === 0,
  b_ploscevina12: p1.areaM2 === 12 && p1.perimeterCm === 1400 && p1.closureCm === 300,
  b_diag500: d1.map((d) => d.lengthCm).join(',') === '500,500',
  b_stebri8: ograja.posts === 8 && ograja.spacingCm === 120 && ograja.handrailM === 7 && ograja.infillM2 === 7,
  b_keramika: [keramika.rows, keramika.cols, keramika.tilesCount, keramika.cuts, keramika.netTiles, keramika.wastePct, keramika.adhesiveKg].join(',') === '5,7,35,5,27,30,39',
  b_prostor: prostor.areaM2 === 12 && prostor.rectangleOk === true,
  b_stopnice: stopnice.steps === 14 && stopnice.riseCm === 17.9 && stopnice.runCm === 28.6 && stopnice.angleDeg === 32 && stopnice.heightDiffCm === 250,
  b_validacija_prazna: validacijaOgraja.length === 0 && validacijaKeramika.length === 0,
  // C — anizotropno
  c_basis: sAni.basis === 'ANIZOTROPNO' && sAni.isotropicProven === true && sAni.cmPerPxX === 1 && sAni.cmPerPxY === 0.5,
  c_dolzina500: gAni.totalLengthCm === 500 && gAni.segments.map((s) => s.lengthCm).join(',') === '300,200',
  c_cmPerPxNull: gAni.cmPerPx === null,
  c_visina200: gAni.segments[1].heightDiffCm === 200,
  c_ploscevina6: pAni.areaM2 === 6 && pAni.perimeterCm === 1100,
  c_diag: dAni.length === 2 && dAni[0].lengthCm === 427.2 && dAni[1].lengthCm === 427.2,
  c_napaka_ne: has(brezNapakeYRef, 'MERILO_NEZADOSTNO') === false,
  // D — nagib in razpršenost smeri
  d_prag: TILT_ENOTNO_MERILO_MAX_DEG === 10,
  d_smeri90: razpr === 90,
  d_t25_basis: sT25.basis === 'ENOTNO_BREZ_DOKAZA' && sT25.isotropicProven === false && sT25.reasons.join(' ').includes('25'),
  d_t5_dokaz: sT5.basis === 'ENOTNO_Z_DOKAZOM' && sT5.isotropicProven === true,
  d_t25_iso: sT25Iso.isotropicProven === true,
  d_napaka: has(napakaNagib, 'MERILO_NEZADOSTNO') && napakaNagib.find((i) => i.code === 'MERILO_NEZADOSTNO').severity === 'NAPAKA',
  d_vzdolz_brez: has(brezNapakeVzdolz, 'MERILO_NEZADOSTNO') === false,
  d_velj_nagib: veljNagib.status === 'NEZADOSTNI_PODATKI' && veljNagib.businessMeasureAllowed === false,
  d_velj_predpostavka: veljPredpostavka.status === 'VELJAVNA' && veljPredpostavka.businessMeasureAllowed === true
    && veljPredpostavka.quantities.every((q) => q.state === 'PREDPOSTAVKA'),
  d_run_napaka: has(analizaOgraja.validation, 'ZUNAJ_OBMOCJA') === false && analizaOgraja.validity.status === 'VELJAVNA',
  // E — količine
  e_visina_nikoli: visina.length === 1 && visina[0].state === 'NEZADOSTNI_PODATKI' && visina[0].note.includes('projekcija'),
  e_visina_ani: visinaAni[0].state === 'NEZADOSTNI_PODATKI',
  e_ploscevina_nagnjena: ploscinaNagnjena[0].state === 'NEZADOSTNI_PODATKI',
  // KOT pri razpršenih smereh ne sme trditi, da je "blizu reference".
  e_kot_nagnjen: kotNagnjen.length === 2 && kotNagnjen.every((q) => q.state === 'NEZADOSTNI_PODATKI'),
  // besedila, ki jih bere monter: decimalna vejica, ne pika
  d_komka: sT25.reasons[0].includes('10,3 %') && !/\d\.\d/.test(sT25.reasons.join(' ')),
  e_stopnice_height_basis: stopnice.heightBasis === 'PROJEKCIJA_SLIKE',
  e_stopnice_validity: analizaStopnice.validity.status === 'NEZADOSTNI_PODATKI'
    && analizaStopnice.validity.businessMeasureAllowed === false
    && analizaStopnice.domain.riseCm === 17.9,
  e_analyze_ima_polji: typeof analizaOgraja.scale === 'object' && typeof analizaOgraja.validity === 'object'
    && analizaOgraja.geometry.scale.known === true,
  // F — streha
  f_privzeta: strehaPrivzeta.pitchDeg === 35 && strehaPrivzeta.pitchSource === 'PRIVZET' && strehaPrivzeta.footprintM2 === 12 && strehaPrivzeta.faceAreaM2 === 14.65,
  f_vnos: strehaVnos.pitchSource === 'VNOS' && strehaVnos.faceAreaM2 === 14.65,
  f_45: streha45.pitchSource === 'VNOS' && streha45.faceAreaM2 === 16.97 && streha45.materialM2 === Math.round(16.97 * 1.1 * 100) / 100,
  f_slemen: strehaPrivzeta.ridgeCm === 400 && strehaPrivzeta.eaveCm === 1000,
  // G — capture guide MERILO
  g_brez_ref: gBrezRef.s === 'NEZADOSTNO' && gBrezRef.status === 'NEZADOSTNO',
  g_ni_nagiba: gNiNagiba.s === 'DOBRO' && gNiNagiba.status === 'DOBRO' && gNiNagiba.d.includes('predpostavka'),
  g_pravokoten: gPravokoten.s === 'DOBRO' && gPravokoten.d.includes('pravokoten'),
  g_nagnjen_razprs: gNagnjenRazprs.s === 'NEZADOSTNO',
  g_nagnjen_vzdolz: gNagnjenVzdolz.s === 'OPOZORILO',
  g_anizotropen: gAnizotropen.s === 'DOBRO' && gAnizotropen.d.includes('X in Y'),
  // H — izvoz
  h_merilo_vrstice: vrstice(izvoz).join('|'),
  h_veljavnost: izvoz.filter((r) => r.skupina === 'Veljavnost').map((r) => `${r.polje}=${r.vrednost}`).join('|'),
  h_velj_kolicine: izvoz.filter((r) => r.skupina === 'Veljavnost' && r.polje !== 'Status meritve' && r.polje !== 'Poslovna mera dovoljena').length,
  h_stary_brez: vrstice(izvozStary).length === 0 && izvozStary.filter((r) => r.skupina === 'Veljavnost').length === 0 && izvozStary.some((r) => r.polje === 'Dolžina'),
  // I
  det: detA,
}))
'''
m = bun_out(UNIT)
if '_err' in m:
    bad(f'bun -e se ni izvedel — {m["_err"][:280]}')
else:
    # A
    chk(m.get('a_neznan_known') is True, 'A: brez kalibracije → merilo NEZNANO (cmPerPxX null)')
    chk(m.get('a_neznan_reason') is True, 'A: razlog pravilno pravi, da se cm-vrednosti NE izračunajo (brez tihe rezerve)')
    chk(m.get('a_nicla_known') is True, 'A: px=0/cm=0 → enako NEZNANO (brez deljenja z nič)')
    chk(m.get('a_geo_zero') is True, 'A: computeGeometry brez merila → 0 cm in cmPerPx null (NE 1 cm/px)')
    chk(m.get('a_poly_zero') is True, 'A: polygonMetrics brez merila → površina/obseg 0')
    chk(m.get('a_diag_empty') is True, 'A: diagonalMetrics brez merila → prazen seznam')
    chk(m.get('a_valid_napaka') is True, 'A: validacija javi MANJKA_KALIBRACIJA in nič drugega')
    chk(m.get('a_run_nezadostni') is True, 'A: runAnalysis → NEZADOSTNI_PODATKI in poslovna mera zaprta')
    # B
    chk(m.get('b_total700') is True, 'B regresija: L-pot 700 cm pri 1 cm/px')
    chk(m.get('b_segi') is True, 'B regresija: segmenta 300 + 400 cm')
    chk(m.get('b_vogal90') is True, 'B regresija: vogal 90°')
    chk(m.get('b_enotno') is True, 'B: enotno merilo → cmPerPx 1 in okvir 300×400')
    chk(m.get('b_visina_dy') is True, 'B: višinska razlika/dolžina vzdolž osi ostaneta enaka')
    chk(m.get('b_ploscevina12') is True, 'B regresija: pravokotnik 12 m², obseg 1400 cm, zaklepalka 300 cm')
    chk(m.get('b_diag500') is True, 'B regresija: diagonali 500 + 500 cm')
    chk(m.get('b_stebri8') is True, 'B regresija: OGRAJA stebri 8, razmak 120, ročnik 7 m, polnilo 7 m²')
    chk(m.get('b_keramika') is True, 'B regresija: KERAMIKA 5×7=35 ploščic, rezi 5, neto 27, odpad 30 %, lepak 39 kg')
    chk(m.get('b_prostor') is True, 'B regresija: PROSTOR 12 m² in pravokotnost DA')
    chk(m.get('b_stopnice') is True, 'B regresija: STOPNICE 14 × (17,9 / 28,6), nagib 32°, višina 250 cm')
    chk(m.get('b_validacija_prazna') is True, 'B regresija: r457 OGRAJA/KERAMIKA ostajata brez ugotovitev')
    # C
    chk(m.get('c_basis') is True, 'C: pxY/cmY → baza ANIZOTROPNO, X 1 cm/px in Y 0,5 cm/px')
    chk(m.get('c_dolzina500') is True, 'C: enaka L-pot z Y-merilom 0,5 → 300 + 200 = 500 cm (ne 700)')
    chk(m.get('c_cmPerPxNull') is True, 'C: pri različnima smernima meriloma NI eno cmPerPx')
    chk(m.get('c_visina200') is True, 'C: navpični segment 400 px → 200 cm (smer Y)')
    chk(m.get('c_ploscevina6') is True, 'C: površina 400×150 cm = 6 m², obseg 1100 cm')
    chk(m.get('c_diag') is True, 'C: diagonali 427,2 cm (pravokotnik velja tudi anizotropno)')
    chk(m.get('c_napaka_ne') is True, 'C: z ločeno Y referenco nagib NE javi MERILO_NEZADOSTNO')
    # D
    chk(m.get('d_prag') is True, 'D: prag enotnega merila = 10° nagiba')
    chk(m.get('d_smeri90') is True, 'D: razpršenost smeri L-poti = 90°')
    chk(m.get('d_t25_basis') is True, 'D: nagib 25° brez dokaza → ENOTNO_BREZ_DOKAZA, pravokotnost ni dokazana')
    chk(m.get('d_t5_dokaz') is True, 'D: nagib 5° → ENOTNO_Z_DOKAZOM (pravokoten kader)')
    chk(m.get('d_t25_iso') is True, 'D: nagib 25° samo vzdolž reference (razpršenost 4°) → dokazano veljavno')
    chk(m.get('d_napaka') is True, 'D: nagib 25° + razpršene smeri → NAPAKA MERILO_NEZADOSTNO')
    chk(m.get('d_vzdolz_brez') is True, 'D: vodoravna pot z nagibom 25° → brez te napake (obstoječa vrata ostanejo)')
    chk(m.get('d_velj_nagib') is True, 'D: veljavnost ob napaki merila → NEZADOSTNI_PODATKI, poslovna mera zaprta')
    chk(m.get('d_velj_predpostavka') is True, 'D: brez podatka o nagibu → VELJAVNA, a vse količine PREDPOSTAVKA')
    chk(m.get('d_run_napaka') is True, 'D: r457 OGRAJA analiza ostane VELJAVNA brez novih ugotovitev')
    # E
    chk(m.get('e_visina_nikoli') is True, 'E: VIŠINA iz planarnega overlay-a je vedno NEZADOSTNI_PODATKI (slika je projekcija, ne mera višine)')
    chk(m.get('e_visina_ani') is True, 'E: tudi z anizotropnim merilom višina iz slike ni dokazana')
    chk(m.get('e_ploscevina_nagnjena') is True, 'E: površina pri nagibu 25° brez Y reference → NEZADOSTNI_PODATKI')
    chk(m.get('e_kot_nagnjen') is True, 'E: koti pri razpršenih smereh niso lažno blizu reference → NEZADOSTNI_PODATKI')
    chk(m.get('d_komka') is True, 'E: razlogi za monterja uporabljajo decimalno vejico (10,3 %, ne 10.3)')
    chk(m.get('e_stopnice_height_basis') is True, 'E: STOPNICE nosijo heightBasis = PROJEKCIJA_SLIKE')
    chk(m.get('e_stopnice_validity') is True, 'E: STOPNICE ostanejo 17,9 cm vzpon, a poslovna mera je zaprta (manjka višina)')
    chk(m.get('e_analyze_ima_polji') is True, 'E: AnalyzeResult nosi scale + validity (in geometry.scale)')
    # F
    chk(m.get('f_privzeta') is True, 'F: STREHA brez vhisa → pitchSource PRIVZET, 35° in 14,65 m² (številka nespremenjena)')
    chk(m.get('f_vnos') is True, 'F: izrecen vnos 35° → pitchSource VNOS')
    chk(m.get('f_45') is True, 'F: vnos 45° → 16,97 m² in material z odpadom')
    chk(m.get('f_slemen') is True, 'F regresija: slemen 400 cm, robovi 1000 cm')
    # G
    chk(m.get('g_brez_ref') is True, 'G: brez reference → MERILO NEZADOSTNO in vodnik NEZADOSTNO')
    chk(m.get('g_ni_nagiba') is True, 'G: brez podatka o nagibu → MERILO DOBRO z izrecno predpostavko (r457 ostane DOBRO)')
    chk(m.get('g_pravokoten') is True, 'G: pravokoten kader → MERILO DOBRO (pravokoten)')
    chk(m.get('g_nagnjen_razprs') is True, 'G: nagib + razpršene smeri → MERILO NEZADOSTNO')
    chk(m.get('g_nagnjen_vzdolz') is True, 'G: nagib samo vzdolž reference → MERILO OPOZORILO')
    chk(m.get('g_anizotropen') is True, 'G: ločeni merili X in Y → MERILO DOBRO')
    # H
    merilo_txt = m.get('h_merilo_vrstice') or ''
    chk('Baza merila=ANIZOTROPNO' in merilo_txt and 'cm/px (smer Y)=0,5' in merilo_txt, f'H: izvoz nosi baza + obe merili ({merilo_txt})')
    chk('Pravokotnost dokazana=DA' in merilo_txt, 'H: izvoz pove, ali je pravokotnost dokazana')
    velj_txt = m.get('h_veljavnost') or ''
    chk('Status meritve=NEZADOSTNI_PODATKI' in velj_txt and 'Poslovna mera dovoljena=NE' in velj_txt, f'H: izvoz nosi status in vrata poslovne mere ({velj_txt})')
    chk(m.get('h_velj_kolicine') == 2, f'H: izvoz našteje posamezne količine (OGRAJA: dolžina + kot) ({m.get("h_velj_kolicine")})')
    chk(m.get('h_stary_brez') is True, 'H: stara meritev brez scale/validity se izvozi nespremenjeno (nobena funkcija ne izgine)')
    # I
    chk(m.get('det') is True, 'I: determinizem — ista vhoda data identičen rezultat (brez časovne oznake)')

# ══ J) vir: tiha rezerva in prekrivanje jedra ═══════════════════════════════
print('── J) vir (source grep)')
lib = src('src/lib/measure-engine.ts')
chk('calib.px > 0 ? calib.cm / calib.px : 1' not in lib, 'LIB: tiha rezerva merila 1 cm/px je odstranjena')
chk('calib.px > 0 ? calib.cm / calib.px : 1' not in lib and lib.count('function resolveScale') == 1,
    'LIB: ENA definicija merila (resolveScale) — ne trije ločeni izračuni')
chk('MERILO_NEZADOSTNO' in lib, 'LIB: eksplicitna koda napake za napačno merilo')
chk('export function quantityValidity' in lib and 'export function measureValidity' in lib,
    'LIB: veljavnost je izvožena (uporabljata jo strežnik in UI)')
conf = src('src/app/api/measurement/confirm/route.ts')
chk("from '@/lib/measure-engine'" in conf and 'deriveProvenance(' in conf and 'pickEngineExtras(' in conf
    and 'calib.cm / calib.px' not in conf and 'cm / px : 1' not in conf,
    'CONFIRM: dolžine in merilo dobi iz obstoječega jedra (brez paralelnega izračuna merila)')
# R501 (issue #15 faza 2): preskok scale/validity v params je sel v jedro
# (`pickEngineExtras`) — ruta je ne sme več ponavljati po vrsticah.
chk('picked.scale = src.scale' in lib and 'picked.validity = src.validity' in lib,
    'LIB: merilo in veljavnost preživita v params (revizija/izvoz) — ena pot, v jedru')
an = src('src/app/api/measure-engine/analyze/route.ts')
# R501 (issue #15 faza 2): analiza nima več LASTNE `parseCalib` — ločena Y
# referenca se zdaj sprejema v ENOTNI pogodbi jedra (`parseCalibration`), ki jo
# upstream dokazuje C (c_basis: pxY/cmY → ANIZOTROPNO). Ruta mora dokazano
# uporabljati to pogodbo; sicer bi imel analyze svoj robni primer.
chk('parseCalibration' in an and 'function parseCalib' not in an
    and 'pxY' in lib and 'cmY' in lib,
    'ANALYZE: ločena Y referenca je sprejeta po HTTP (parse v enotni pogodbi jedra)')
k = src('src/components/roksal/modules/meritve-kamera.tsx')
chk('analysis.validity' in k and 'analysis.scale' in k, 'KAMERA UI: pošlje scale + validity in ju prikaže')
chk('KOLICINA_LABEL' in k and 'NEZADOSTNI_PODATKI' in k, 'KAMERA UI: monter vidi, katera količina je dokazana')
# R501 (issue #15 faza 2): UI nima več LASTNE interpretacije reference —
# merilo in geometrijo dobi iz jedra (prej je bil tam `view.calib.cm / view.calib.px`).
chk('computeGeometry(' in k and 'resolveScale(' in k and 'view.calib.cm / view.calib.px' not in k,
    'KAMERA UI: izračun v živo gre prek enotnega jedra (ne lastne delitve cm/px)')
chk('merilaPasus' in k and 'calc.scale' in k, 'KAMERA UI: pošteno besedilo o merilu (dokazano / predpostavka) je prikazano')
# R501: nobena plast ne sme več imeti svojega zapisa istega merila.
for rel in ('src/app/api/sync/route.ts', 'src/app/api/railing-layout/route.ts',
            'src/app/api/measurements/route.ts', 'src/components/roksal/modules/meritve-kamera.tsx'):
    s = src(rel)
    chk('calib.px > 0' not in s and 'calib.cm / calib.px' not in s and 'cm / view.calib.px' not in s,
        f'ENOTNO MERILO: {rel} ne računa več svojega cm/px')

print(f'\n══ R500 (issue #15 faza 1): {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL else 0)
