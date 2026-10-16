#!/usr/bin/env python3
"""tests/r501.py — R501 (issue #15 Faza 2): ENOTNA kalibracijska pogodba +
STREŽNIŠKI statusi meritev (provenienca).

Kaj dokazuje (po točkah issue #15, faza 2):
  A) ENOTNA POGODBA (bun, čiste funkcije): `parseCalibration`,
     `parseEnginePoints`, `pointsForStorage`, `calibrationForParams`,
     `viewForStorage`, `consolidateViews` — ena pravila za mrežno in offline
     pot. Ena pravila za mrežno in offline pot: polovična Y referenca se NE
     more vseliti v merilo; neveljavna točka se ne more vseliti v zapis.
  B) LESTVICA IZRAČUNA (bun): `deriveProvenance` iz ISTIH vhodov vedno isto
     stanje — ESTIMATED (merilo ni dokazano) / AUTO_SUGGESTED (samo predlogi) /
     MANUAL (ročni popravek z razlogom) / CALIBRATED / VERIFIED (pogledi se
     strinjajo). Odjemalčeva trditev o statusu NI vir.
  C) fail-closed vrata: `measurementStatusAllowsBusiness` — neznano/prazno/
     ESTIMATED/AUTO_SUGGESTED/INVALIDATED → NE.
  D) RBAC (HTTP): brez žetona 401; pisarniški prehod brez quotes.approve 403.
  E) POTRDITEV (HTTP /api/measurement/confirm): stanje + razlog prideta v
     zapis, params.provenance (različica pogodbe) in verzija v1; kamera brez
     kalibracije = OCENA (ne MANUAL — migracija je tako nazaj napolnila);
     nerešen konflikt pogledov mrežna pot ZAVRNE (409) in meritev NE nastane.
  F) OFFLINE (/api/sync, kind=foto): ISTO stanje kot mrežna pot; konflikt
     pogledov > 15 % BREZ ročnega popravka → CONFLICT in meritev NI ustvarjena
     (terenska vrata ne more zaobiti z oddajo, ko pade signal); sosednji OK op
     v isti vrsti ostane shranjen.
  G) VRATA BOM: paket na meritvi ESTIMATED → 409; po pisarniški potrditvi
     (CONFIRMED) ista zahteva VEČ ni 409; po razveljavitvi (INVALIDATED) spet
     409. Potrditev je SAM prehod stanja (brez drugih polj) — isti poziv, ki ga
     uporablja provenienčna plošča v UI.
  H) PISARNIŠKI PREHODI: neznan status 400; ročno nastavljivo samo CONFIRMED/
     INVALIDATED (400); INVALIDATED brez razloga 400; geometrija + status v
     istem zahtevku 400; monter 403; admin 200.
  I) PRERAČUN: nova geometrija vrne potrjeno mero na strežniško stanje;
     številka brez geometrije na kamerinem zapisu → MANUAL; odvisni paketi/
     ponudbe dobijo ponovno validacijo (meta.invalidiran).
  J) IZVOZ + JAVNA POVEZAVA: CSV nosi skupino Provenienca (stanje, poslovna
     mera DA/NE, obrazložitev); javna povezava pokaže SAMO ovojno oznako
     (statusLabel), nikoli interne statusNote; preklic povezave → 404.
  K) UI-nizi (source grep): nobena plast nima več lastnega ulomka cm/px
     (negiran regex), kamera računa iz jedra, meritve.tsx ima provenienčno
     ploščo, fence-run uvozi lestvico iz jedra (brez podvojene tabele metod),
     PATCH pa prehod stanja šteje KOT sprememba (pražen patch šele za tem).
  L) Idempotentno čiščenje ×2 (direktno prek Prisma).

Ne sme ustvariti drugega merilnega ali cenovnega jedra — zato A/B/C preverjajo
IZVOŽENA imena iz `src/lib/measure-engine.ts` in pričakujejo, da je tam vse.
"""
import json, os, re, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R501-TEST'
PASS, FAIL = 0, 0


def callj (method, path, token=None, body=None, timeout=40):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode('utf-8', 'replace'))
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode('utf-8', 'replace'))
        except Exception: return e.code, {}
    except Exception as e:
        return 0, {'error': str(e)}


def callraw (method, path, token=None, body=None, timeout=40):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode('utf-8', 'replace'), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace'), dict(e.headers)
    except Exception as e:
        return 0, str(e), {}


def login (email, pw):
    s, d = callj('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s}'
    return d['token']


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)


def bun_ts (script):
    env_url = os.environ.get('DATABASE_URL') or ''
    if not env_url.startswith(('postgresql://', 'postgres://')):
        env_url = ''
    db_url = os.environ.get('TEST_DB_URL') or env_url or 'postgresql://roksal:roksal@localhost:54329/roksal'
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       cwd=REPO, env={**os.environ, 'DATABASE_URL': db_url})
    return r.stdout, r.stderr[:800]


def bun_out (script):
    out, err = bun_ts(script)
    try: return json.loads(out)
    except Exception: return {'_err': err or out[:400]}


def read_src (relpath):
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


def src_has (relpath, needle):
    try:
        return needle in read_src(relpath)
    except Exception:
        return False


def src_lacks (relpath, pattern):
    """regex NE sme zasesti nobene sledi (enotnost interpretacije)."""
    try:
        return re.search(pattern, read_src(relpath)) is None
    except Exception:
        return False


def meas_row (mid):
    out, _ = bun_ts(f"""
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
p.measurement.findUnique({{where:{{id:'{mid}'}},select:{{status:true,statusNote:true,params:true,source:true,type:true,lengthCm:true}}}}).then(r=>{{
console.log(JSON.stringify(r));return p.$disconnect()}})""")
    try: return json.loads(out)
    except Exception: return {}


print('══ R501 — enotna kalibracijska pogodba + strežniški statusi (issue #15 faza 2) ══')

# ══ A/B/C) merilno jedro: čiste funkcije, brez baze in strežnika ════════════
print('── A/B/C) bun — pogodba, lestvica statusov, fail-closed vrata')
UNIT = r'''
const E = await import('./src/lib/measure-engine')
const {
  parseCalibration, calibrationForParams, calibrationToParams, parseEnginePoints, pointsForStorage,
  viewForStorage, viewLengthCm, consolidateViews, deriveProvenance, deriveMeasurementStatus,
  provenanceForParams, measurementStatusAllowsBusiness, MEASUREMENT_STATUSES, MEASUREMENT_STATUS_LABELS,
  CALIB_CONTRACT_VERSION, resolveScale, segmentLadderProvenance, photoRecordProvenance,
} = E

const C = { px: 800, cm: 200, imgW: 1600, imgH: 1200 }          // 0,25 cm/px
const P = [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }]              // 1280 px → 320 cm
const V_OK = [{ points: [{ x: 0.2, y: 0.5 }, { x: 0.98, y: 0.5 }], calibration: { px: 624, cm: 156, imgW: 1600, imgH: 1200 } }]
const V_BAD = [{ points: P, calibration: { px: 800, cm: 400, imgW: 1600, imgH: 1200 } }]
const con = (views, manual) => consolidateViews({ primaryPoints: P, primaryCalibration: C, views, manualOverride: !!manual, conflictPct: 15 })

// ── A) ENOTNA pogodba ───────────────────────────────────────────────────────
const kalBrez = parseCalibration(null)
const kalNicla = parseCalibration({ px: 0, cm: 200 })
const kalVelik = parseCalibration({ px: 800, cm: 2000000 })
const kalParcialnoY = parseCalibration({ px: 800, cm: 200, pxY: 400 })            // brez cmY
const kalParY = parseCalibration({ px: 800, cm: 200, pxY: 400, cmY: 100 })
const kalMetodaNeznana = parseCalibration({ px: 800, cm: 200, method: 'VESOLJE', refObject: '  vrata 110  ' })
const dokument = calibrationForParams({ px: 0, cm: 120, method: 'MARKER', refObject: 'vhodna plošča' })
const dokumentBrez = calibrationForParams('ne objekt')
const tocke = pointsForStorage([{ x: 0.1, y: 0.2, src: 'PREDLOG', label: '  a ' }, { x: NaN, y: 0 }, { x: 1e9, y: 0 }, 'x'])
const tockePrazne = pointsForStorage([{ x: NaN, y: NaN }])
const pogled = viewForStorage({ photoId: 'p1', points: P, calibration: C })
const dolzina = viewLengthCm(P, C)
const dolzinaBrezKalibracije = viewLengthCm(P, null)

// ── B) LESTVICA: stanje iz podatkov, ne iz trditve ──────────────────────────
const provBrezKalibracije = deriveProvenance({ points: P, calibration: null, legacyType: 'OGRAJA' })
const provTockeNiKalibracije = deriveProvenance({ points: P, calibration: { px: 0, cm: 0 }, legacyType: 'OGRAJA' })
const provNicel = deriveProvenance({ points: null, calibration: null, legacyType: 'OGRAJA' })
const provPredlogi = deriveProvenance({ points: P.map((p) => ({ ...p, src: 'PREDLOG' })), calibration: C, legacyType: 'OGRAJA' })
const provRocniPopravek = deriveProvenance({ points: P, calibration: C, legacyType: 'OGRAJA', manualOverride: true })
const provKalibrirano = deriveProvenance({ points: P, calibration: C, legacyType: 'OGRAJA' })
const strinjanje = con(V_OK, false)
const provPreverjeno = deriveProvenance({
  points: P, calibration: C, legacyType: 'OGRAJA',
  viewsAgreeing: strinjanje.multiView !== null && strinjanje.multiView.count >= 2 && !strinjanje.multiView.conflict,
})
const provY = deriveProvenance({ points: P, calibration: { ...C, pxY: 400, cmY: 100 }, legacyType: 'OGRAJA' })
const zapis = provenanceForParams({
  status: provKalibrirano.status, reason: provKalibrirano.reason,
  scale: provKalibrirano.scale, calibration: parseCalibration(C),
})

// ── C) fail-closed vrata ────────────────────────────────────────────────────
const vratBlokirane = MEASUREMENT_STATUSES.filter((s) => !measurementStatusAllowsBusiness(s))
const vratNeznan = measurementStatusAllowsBusiness('KARKOLI') || measurementStatusAllowsBusiness(null) || measurementStatusAllowsBusiness('')

// ── determinizem: isti vhodi → isti izračun (obe poti, mrežna in offline) ───
const ponovitev = deriveProvenance({ points: P, calibration: C, legacyType: 'OGRAJA' })
const parita = JSON.stringify({ s: ponovitev.status, r: ponovitev.reason, sc: ponovitev.scale })
  === JSON.stringify({ s: provKalibrirano.status, r: provKalibrirano.reason, sc: provKalibrirano.scale })
const brezTrditve = deriveMeasurementStatus({ fromImage: true, scale: resolveScale(C), validity: { status: 'VELJAVNA', reasons: [], quantities: [], businessMeasureAllowed: true }, manualOverride: false })

// ── agregat tekača in fotozapis (ustvarjalne poti brez slikovnih točk) ─────
const lestvica = segmentLadderProvenance(['CALIBRATED', 'MANUAL', 'MANUAL'])
const lestvicaNeznan = segmentLadderProvenance(['CALIBRATED', 'KARKOLI'])
const lestvicaPrazen = segmentLadderProvenance([])
const lestvicaVsiPotrjeni = segmentLadderProvenance(['CONFIRMED', 'VERIFIED'])
const fotoZapis = photoRecordProvenance()

console.log(JSON.stringify({
  a_kal_brez: kalBrez === null && kalNicla === null && kalVelik === null,
  a_kal_parcialnoY: kalParcialnoY.pxY === undefined && kalParcialnoY.cmY === undefined,
  a_kal_parY: kalParY.pxY === 400 && kalParY.cmY === 100,
  a_kal_metoda: kalMetodaNeznana.method === undefined && kalMetodaNeznana.refObject === 'vrata 110',
  a_dokument: dokument !== null && dokument.px === undefined && dokument.cm === 120 && dokument.method === 'MARKER',
  a_dokument_brez: dokumentBrez === null,
  a_tocke: tocke.length === 1 && tocke[0].src === 'PREDLOG' && tocke[0].label === 'a' && tocke[0].x === 0.1,
  a_tocke_1e9_ven: tocke.every((p) => p.x !== 1e9),
  a_tocke_prazne: tockePrazne === null,
  a_pogled: pogled !== null && pogled.photoId === 'p1' && pogled.calibration.imgW === 1600,
  a_dolzina: dolzina === 320 && dolzinaBrezKalibracije === null,
  a_par_pogledov_ok: con(V_OK, false).conflict === false && con(V_OK, false).multiView.count === 2,
  a_par_pogledov_ni: con([], false).multiView === null,
  a_konflikt: con(V_BAD, false).conflict === true && con(V_BAD, false).blocked === true,
  a_konflikt_rocno: con(V_BAD, true).conflict === true && con(V_BAD, true).blocked === false && con(V_BAD, true).multiView.manualOverride === true && con(V_BAD, true).multiView.conflict === true,
  b_brez_kalibracije: provBrezKalibracije.status,
  b_nicelna_kalibracija: provTockeNiKalibracije.status,
  b_nikel: provNicel.status,
  b_predlogi: provPredlogi.status,
  b_rocni_popravek: provRocniPopravek.status,
  b_kalibrirano: provKalibrirano.status,
  b_preverjeno: provPreverjeno.status,
  b_anizotropno: provY.status,
  b_kalibrirano_dokaz: provKalibrirano.scale.isotropicProven === false && provKalibrirano.scale.basis === 'ENOTNO_BREZ_DOKAZA',
  b_preverjeno_dokaz: provPreverjeno.scale.basis === 'ENOTNO_BREZ_DOKAZA',
  b_zapis_v: zapis.v,
  b_zapis_polja: ['status', 'reason', 'basis', 'isotropicProven', 'cmPerPxX', 'cmPerPxY', 'method', 'refObject'].filter((k) => k in zapis).sort().join(','),
  b_skupna_lestvica: MEASUREMENT_STATUSES.join(',') === 'ESTIMATED,AUTO_SUGGESTED,MANUAL,CALIBRATED,VERIFIED,CONFIRMED,INVALIDATED',
  b_besede: MEASUREMENT_STATUS_LABELS.ESTIMATED.includes('ni dokazano') && MEASUREMENT_STATUS_LABELS.CONFIRMED.length > 0,
  c_blokirane: vratBlokirane.join(','),
  c_neznan: vratNeznan,
  d_parita: parita,
  d_brez_trditve: brezTrditve.status,
  e_lestvica: lestvica.status,
  e_lestvica_razlog: lestvica.reason,
  e_lestvica_neznan: lestvicaNeznan.status,
  e_lestvica_neznan_razlog: lestvicaNeznan.reason,
  e_lestvica_prazen: lestvicaPrazen.status,
  e_lestvica_vsak: lestvicaVsiPotrjeni.status,
  e_foto: fotoZapis.status,
  e_foto_vrata: measurementStatusAllowsBusiness(fotoZapis.status),
}))
'''
m = bun_out(UNIT)
if '_err' in m:
    bad(f'bun -e se ni izvedel — {m["_err"][:300]}')
else:
    # A) pogodba
    chk(m.get('a_kal_brez') is True, 'A: parseCalibration zavrni null / px=0 / cm>100 m (merilo NEZNANO)')
    chk(m.get('a_kal_parcialnoY') is True, 'A: polovična Y referenca (pxY brez cmY) NE vstopi v merilo')
    chk(m.get('a_kal_parY') is True, 'A: par pxY/cmY ohrani anizotropno merilo')
    chk(m.get('a_kal_metoda') is True, 'A: neznana metoda pade ven, referenčni objekt se očisti (80 znakov)')
    chk(m.get('a_dokument') is True, 'A: nepopolna kalibracija ostane DOKUMENT (metoda/ref), px pa ne — merilo je neznano')
    chk(m.get('a_dokument_brez') is True, 'A: ne-objekt kalibracije → null (brez tihega zapisa)')
    chk(m.get('a_tocke') is True, 'A: pointsForStorage vrže neveljavne točke (NaN, |koordinata| > 1e6), label/src ostaneta')
    chk(m.get('a_tocke_1e9_ven') is True, 'A: absurden koordinat (1e9) NE vstopi v zapis — geometrija je vedno razumna')
    chk(m.get('a_tocke_prazne') is True, 'A: samo neveljavne točke → null (zapis brez geometrije)')
    chk(m.get('a_pogled') is True, 'A: viewForStorage = enaka oblika pogleda za mrežno in offline pot')
    chk(m.get('a_dolzina') is True, 'A: viewLengthCm 320 cm iz točk+kalibracije; brez kalibracije → null')
    chk(m.get('a_par_pogledov_ok') is True, 'A: strinjanje pogledov → count 2, conflict false')
    chk(m.get('a_par_pogledov_ni') is True, 'A: < 2 izmerljivih dolžin → brez konsolidacije (nihče ne izmislí povprečja)')
    chk(m.get('a_konflikt') is True, 'A: razpršenost > 15 % → conflict true IN vrata zaprta (blocked)')
    chk(m.get('a_konflikt_rocno') is True, 'A: ročni popravek JE veljavna rešitev — vrata odprta (blocked false), konflikt pa OSTANE viden (conflict true)')
    # B) lestvica
    chk(m.get('b_brez_kalibracije') == 'ESTIMATED', f"B: točke brez kalibracije → ESTIMATED (ne MANUAL!) — ({m.get('b_brez_kalibracije')})")
    chk(m.get('b_nicelna_kalibracija') == 'ESTIMATED', f"B: px/cm = 0 → ESTIMATED ({m.get('b_nicelna_kalibracija')})")
    chk(m.get('b_nikel') == 'MANUAL', f"B: brez slikovnih podatkov → MANUAL (ročni vnos) ({m.get('b_nikel')})")
    chk(m.get('b_predlogi') == 'AUTO_SUGGESTED', f"B: samo VLM predlogi → AUTO_SUGGESTED ({m.get('b_predlogi')})")
    chk(m.get('b_rocni_popravek') == 'MANUAL', f"B: ročni popravek z razlogom → MANUAL ({m.get('b_rocni_popravek')})")
    chk(m.get('b_kalibrirano') == 'CALIBRATED', f"B: veljavna kalibracija → CALIBRATED ({m.get('b_kalibrirano')})")
    chk(m.get('b_preverjeno') == 'VERIFIED', f"B + dva strinjajoča pogleda → VERIFIED ({m.get('b_preverjeno')})")
    chk(m.get('b_anizotropno') == 'CALIBRATED', f"B: ločena Y referenca → CALIBRATED ({m.get('b_anizotropno')})")
    chk(m.get('b_kalibrirano_dokaz') is True, 'B: brez dokaza o pravokotnosti je merilo zapisano kot PREDPOSTAVKA (isotropicProven false)')
    chk(m.get('b_preverjeno_dokaz') is True, 'B: strinjanje pogledov NI dokaz pravokotnosti — osnova merila ostane enaka')
    chk(m.get('b_zapis_v') == 'kalibracija/2.0', f"B: params.provenance nosi verzijo pogodbe ({m.get('b_zapis_v')})")
    chk(m.get('b_zapis_polja') == 'basis,cmPerPxX,cmPerPxY,isotropicProven,reason,status',
        f"B: zapis provenience = status+razlog+model merila ({m.get('b_zapis_polja')})")
    chk(m.get('b_skupna_lestvica') is True, 'B: ENA lestvica statusov (isti nabor kot SegmentStatus v fence-run)')
    chk(m.get('b_besede') is True, 'B: oznake za uporabnika so izvožene iz jedra (ne po vseh poteh posebej)')
    # C) vrata
    chk(m.get('c_blokirane') == 'ESTIMATED,AUTO_SUGGESTED,INVALIDATED',
        f"C: poslovno zaprta stanja ({m.get('c_blokirane')})")
    chk(m.get('c_neznan') is False, 'C: fail-closed — neznano/prazno stanje NIKOLI ni poslovna mera')
    # D) determinizem
    chk(m.get('d_parita') is True, 'D: isti vhodi → enak izračun (mrežna in offline pot si delita jedro)')
    chk(m.get('d_brez_trditve') == 'CALIBRATED', 'D: status izračuna jedro, ne odjemalec')
    # D-bis) agregat tekača in fotozapis (ustvarjalne poti brez slikovnih točk)
    chk(m.get('e_lestvica') == 'MANUAL', f"D2: najšibkejši člen odloča (CALIBRATED+2×MANUAL → MANUAL) — ({m.get('e_lestvica')})")
    chk('2/3' in str(m.get('e_lestvica_razlog')), f"D2: razlog pove, koliko segmentov drži nazaj — ({m.get('e_lestvica_razlog')})")
    chk(m.get('e_lestvica_neznan') == 'ESTIMATED', f"D2: stanje izven lestvice pade na ESTIMATED (fail-closed) — ({m.get('e_lestvica_neznan')})")
    chk('KARKOLI' in str(m.get('e_lestvica_neznan_razlog')), 'D2: razlog imenuje nepravo stanje, ne molči')
    chk(m.get('e_lestvica_prazen') == 'ESTIMATED', 'D2: tekač brez segmentov ni mera')
    chk(m.get('e_lestvica_vsak') == 'VERIFIED', f"D2: CONFIRMED+VERIFIED → VERIFIED (najšibkejši, ne povprečje) — ({m.get('e_lestvica_vsak')})")
    chk(m.get('e_foto') == 'ESTIMATED', 'D2: fotozapis brez geometrije = ocena')
    chk(m.get('e_foto_vrata') is False, 'D2: fotozapis NE sme v poslovno mero (BOM vrata zaprta)')

# ══════════════════════════════ HTTP ═════════════════════════════════════════
print('── prijava: admin / monter')
admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')

print('── D) RBAC (fail-closed)')
s, _ = callj('PATCH', '/api/measurements/ni-takega-id', body={'status': 'CONFIRMED'})
chk(s == 401, f'brez žetona 401 ({s})')

projects = callj('GET', '/api/projects', admin)[1]
PROJ_ID = (projects.get('data') or [{}])[0].get('id')
chk(bool(PROJ_ID), f'projekt za testne zapise najden ({PROJ_ID})')

# ENOTNA POGODBA čez HTTP (issue #15 faza 2): /analyze je neko imel svoj
# `parseCalib`. Test mora dokazovati OBNAŠANJE prek endpointa, ne le besedila
# v datoteki — ločena Y referenca sme preživeti pot HTTP → jedro.
sa, da_ = callj('POST', '/api/measure-engine/analyze', monter, {
    'mode': 'OGRAJA',
    'points': [{'x': 0.1, 'y': 0.5}, {'x': 0.9, 'y': 0.5}],
    'calibration': {'px': 800, 'cm': 200, 'pxY': 800, 'cmY': 100, 'imgW': 1600, 'imgH': 1200, 'method': 'MARKER'},
})
sc = (da_.get('data') or {}).get('scale') or {}
chk(sa == 200, f'analyze: kalibracija iz ENOTNE pogodbe je sprejeta po HTTP ({sa})')
chk(sc.get('basis') == 'ANIZOTROPNO' and sc.get('cmPerPxX') == 0.25 and sc.get('cmPerPxY') == 0.125,
    f'analyze: ločena Y referenca preživi pot do jedra ({sc.get("basis")} / X {sc.get("cmPerPxX")} / Y {sc.get("cmPerPxY")})')

PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q='
s, d = callj('POST', '/api/measurements', monter, {
    'type': 'FOTO', 'projectId': PROJ_ID, 'location': f'{TAG} teren',
    'params': json.dumps({'photo': PHOTO}), 'note': f'{TAG} foto osnova'})
chk(s == 201, f'FOTO osnova ustvarjena ({s})')
photo_id = d.get('data', {}).get('id')
foto_row = meas_row(photo_id)
chk(foto_row.get('status') == 'ESTIMATED',
    f'FOTO brez geometrije = OCENA (ne poslovna mera): {foto_row.get("status")}')

PTS = [{'x': 0.1, 'y': 0.5}, {'x': 0.9, 'y': 0.5}]
CAL = {'px': 800, 'cm': 200, 'imgW': 1600, 'imgH': 1200}
V_OK = [{'points': [{'x': 0.2, 'y': 0.5}, {'x': 0.98, 'y': 0.5}],
         'calibration': {'px': 624, 'cm': 156, 'imgW': 1600, 'imgH': 1200}}]
V_BAD = [{'points': PTS, 'calibration': {'px': 800, 'cm': 400, 'imgW': 1600, 'imgH': 1200}}]


class _Delete:
    pass


_DELETE = _Delete()


def potrdi (label, extra):
    """Mrežna pot potrditve (UI kamere) — osnovni vhodi + dodatki.
    Vrednost _DELETE poljo iz osnovnega telesa izpusti (brez kalibracije)."""
    body = {'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 320, 'location': f'{TAG} {label}',
            'projectId': PROJ_ID, 'note': f'{TAG} {label}', 'points': PTS, 'calibration': CAL}
    for k, v in extra.items():
        if v is _DELETE:
            body.pop(k, None)
        else:
            body[k] = v
    return callj('POST', '/api/measurement/confirm', monter, body)


print('── E) potrjevanje: stanje izračuna strežnik')
s0, d0 = potrdi('brez kalibracije', {'calibration': None})
chk(s0 == 201, f'potrditev brez kalibracije → 201 ({s0})')
ID_NIK = d0.get('data', {}).get('id')
row = meas_row(ID_NIK)
chk(d0.get('data', {}).get('status') == 'ESTIMATED',
    f'brez kalibracije: strežnik vrne ESTIMATED ({d0.get("data", {}).get("status")})')
chk(row.get('status') == 'ESTIMATED' and (row.get('statusNote') or '').strip() != '',
    f'stanje + razlog zapišeta v DB ({row.get("status")} / {str(row.get("statusNote"))[:60]})')
prv = (json.loads(row.get('params') or '{}')).get('provenance') or {}
chk(prv.get('v') == 'kalibracija/2.0' and prv.get('status') == 'ESTIMATED' and prv.get('basis') == 'NEZNANO',
    f'params.provenance = strežniški izračun z verzijo pogodbe ({prv})')

s1, d1 = potrdi('kalibrirano', {})
chk(s1 == 201, f'potrditev s kalibracijo → 201 ({s1})')
ID_KAL = d1.get('data', {}).get('id')
chk(d1.get('data', {}).get('status') == 'CALIBRATED',
    f'dokazano merilo px/cm → CALIBRATED ({d1.get("data", {}).get("status")})')
ver = callj('GET', f'/api/measurements/{ID_KAL}/verzije', admin)[1]
v1 = [v for v in (ver.get('data') or []) if v.get('version') == 1]
chk(bool(v1) and 'CALIBRATED' in (v1[0].get('data') or ''),
    'verzija v1 nosi stanje (zgodovina je revizijska sled)')

s2, d2 = potrdi('pogledi', {'lengthCm': 316, 'views': V_OK})
ID_VER = d2.get('data', {}).get('id')
chk(s2 == 201 and d2.get('data', {}).get('status') == 'VERIFIED',
    f'dva strinjajoča pogleda → VERIFIED ({s2} / {d2.get("data", {}).get("status")})')

s3, d3 = potrdi('predlogi', {'lengthCm': 300, 'points': [
    {'x': 0.1, 'y': 0.5, 'src': 'PREDLOG'}, {'x': 0.9, 'y': 0.5, 'src': 'PREDLOG'}]})
chk(s3 == 201 and d3.get('data', {}).get('status') == 'AUTO_SUGGESTED',
    f'samo VLM predlogi → AUTO_SUGGESTED ({d3.get("data", {}).get("status")})')
ID_PRED = d3.get('data', {}).get('id')

s4, d4 = potrdi('popravek', {'lengthCm': 330,
                             'manualOverride': {'computedLengthCm': 320, 'reason': 'trak se je ob robu rahlo dvignil'}})
chk(s4 == 201 and d4.get('data', {}).get('status') == 'MANUAL',
    f'ročni popravek z razlogom → MANUAL ({d4.get("data", {}).get("status")})')
ID_ROC = d4.get('data', {}).get('id')

s5, d5 = potrdi('konflikt', {'views': V_BAD})
chk(s5 == 409 and 'Pogledi' in json.dumps(d5, ensure_ascii=False),
    f'nerešen konflikt pogledov mrežna pot ZAVRNE (409) — ({s5})')
chk(bool(d5.get('data', {}).get('id')) is False, 'zavrnjena potrditev ne ustvari mere')

print('── F) offline sinhronizacija: ISTA logika + terenska vrata')
DEV = 'r501-offline-dev'
# terenski ope morajo imeti vezavo (nalog ALI projekt) — sicer sync zavrne že
# pred poslovno logiko, kar bi maskiralo pravzaprav preizkušano
WO = None
for w in (callj('GET', '/api/nalog', monter)[1].get('data') or []):
    WO = w.get('id')
    if WO: break
chk(bool(WO) or bool(PROJ_ID), f'offline ope imajo vezavo (nalog={WO} ali projekt={PROJ_ID})')


def sync_foto (op_id, extra):
    # terenska vezava: nalog, kadar ga monter ima; sicer projekt
    place = {'workOrderId': WO} if WO else {'projectId': PROJ_ID}
    payload = {'deviceId': DEV, 'ops': [{'opId': op_id, 'kind': 'foto', 'payload': {
        'dataUrl': PHOTO, 'type': 'OGRAJA', 'lengthCm': 320,
        'location': f'{TAG} offline {op_id}', 'note': f'{TAG} offline {op_id}',
        'points': PTS, 'calibration': CAL, **place, **extra}}]}
    return callj('POST', '/api/sync', monter, payload)


s, d = sync_foto('r501-ok-1', {})
res = (d.get('data', {}).get('results') or [{}])[0]
chk(s == 200 and res.get('status') == 'OK', f'offline meritve s kalibracijo → OK ({s} / {res.get("status")})')
offline_id = (((res.get('data') or {}).get('measurement')) or {}).get('id')
row = meas_row(offline_id) if offline_id else {}
chk(row.get('status') == 'CALIBRATED',
    f'offline dobi ISTO stanje kot mrežna pot ({row.get("status")})')
chk((json.loads(row.get('params') or '{}')).get('provenance', {}).get('v') == 'kalibracija/2.0',
    'offline zapis nosi isto verzijo kalibracijske pogodbe')

s, d = sync_foto('r501-conf-1', {'views': V_BAD})
res = (d.get('data', {}).get('results') or [{}])[0]
chk(res.get('status') == 'CONFLICT' and 'Pogledi' in (res.get('error') or ''),
    f'konflikt pogledov na terenu → CONFLICT ({res.get("status")})')
s, d = sync_foto('r501-conf-1', {'views': V_BAD})
chk((d.get('data', {}).get('results') or [{}])[0].get('status') == 'CONFLICT',
    'isti opId ostane CONFLICT (ni tiho shranjen ob ponovni oddaji)')
if offline_id:
    st = callj('GET', f'/api/measurements/{offline_id}', monter)[1].get('data') or {}
    chk(st.get('lengthCm') == 320, f'ok: sosednji OK zapis je shranjen (konflikt ne zaustavi vrste) — dolzina {st.get("lengthCm")}')
n_conf = bun_ts(f"""
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
p.measurement.count({{where:{{note:{{contains:'{TAG} offline r501-conf-1'}}}}}}).then(n=>{{console.log(n);return p.$disconnect()}})""")[0]
chk(n_conf.strip() == '0', f'zaradi konflikta v DB NI nobene meritve (0 tiho shranjenih konfliktov) — {n_conf.strip()}')

s, d = sync_foto('r501-conf-2', {'views': V_BAD, 'manualOverride': {'computedLengthCm': 320, 'reason': 'meritev s trakom na kraju'}})
res = (d.get('data', {}).get('results') or [{}])[0]
chk(res.get('status') == 'OK', f'konflikt + ročni popravek z razlogom → OK (veljavna rešitev, ne zaobid)')
mo_id = (((res.get('data') or {}).get('measurement')) or {}).get('id')
mo_row = meas_row(mo_id) if mo_id else {}
chk(mo_row.get('status') == 'MANUAL', f'rešitev konflikta je ročna odgovornost → MANUAL ({mo_row.get("status")})')
chk('multiView' in (mo_row.get('params') or '') and 'conflict' in (mo_row.get('params') or ''),
    'konflikt ostane VIDEN v params (revizija), ne izgine z rešitvijo')

s, d = sync_foto('r501-nikal-1', {'calibration': None})
res = (d.get('data', {}).get('results') or [{}])[0]
nikal_id = (((res.get('data') or {}).get('measurement')) or {}).get('id')
chk(res.get('status') == 'OK' and (meas_row(nikal_id).get('status') if nikal_id else None) == 'ESTIMATED',
    f'offline brez kalibracije → OK a OCENA ({meas_row(nikal_id).get("status")})')

# ══ G) vrata BOM ════════════════════════════════════════════════════════════
print('── G) vrata kosovnice (ocena ne sme v BOM)')
PRODUCT = bun_ts("""
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
p.product.findFirst({where:{active:true},select:{id:true,sku:true}}).then(r=>{console.log(JSON.stringify(r));return p.$disconnect()})""")[0]
try: PROD_ID = json.loads(PRODUCT).get('id')
except Exception: PROD_ID = None
chk(bool(PROD_ID), f'izdelek za paket najden ({PROD_ID})')


def ustvari_paket (koda, meas_id):
    """Paket, vezan na mero — measurement je edini vir količin (issue #15)."""
    out, _ = bun_ts(f"""
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
(async()=>{{
  await p.projectPackage.deleteMany({{where:{{code:'{koda}'}}}});
  const pk=await p.projectPackage.create({{data:{{code:'{koda}',projectId:'{PROJ_ID}',productId:'{PROD_ID}',name:'{TAG} paket',qty:4,unit:'mb',measurementId:'{meas_id}'}}}});
  console.log(pk.id);await p.$disconnect();
}})()""")
    return out.strip().splitlines()[-1] if out.strip() else None


PKG_ID = ustvari_paket('PAK-R501-1', ID_NIK) if PROD_ID else None
chk(bool(PKG_ID), f'paket povezan z meritvijo ESTIMATED ({PKG_ID})')

if PKG_ID:
    s, d = callj('POST', f'/api/project-packages/{PKG_ID}/bom', admin, {'includeOptional': False})
    chk(s == 409 and 'ni poslovno uporabna' in json.dumps(d, ensure_ascii=False),
        f'ESTIMATED mera → 409 in NE kosovnica ({s})')
    s, d = callj('PATCH', f'/api/measurements/{ID_NIK}', admin, {'status': 'CONFIRMED'})
    chk(s == 200 and (d.get('data') or {}).get('status') == 'CONFIRMED',
        f'pisarna potrdi (CONFIRMED) → 200 ({s})')
    s2, d2 = callj('POST', f'/api/project-packages/{PKG_ID}/bom', admin, {'includeOptional': False})
    chk(s2 != 409, f'po potrditvi ista zahteva VEČ ni 409 (vrata se odprejo) — dobijeno {s2}')
    s, d = callj('PATCH', f'/api/measurements/{ID_NIK}', admin, {'status': 'INVALIDATED', 'statusNote': 'referenca je bila napačno izmerjena'})
    chk(s == 200 and (d.get('data') or {}).get('status') == 'INVALIDATED', f'razveljavitev → 200 ({s})')
    s3, _ = callj('POST', f'/api/project-packages/{PKG_ID}/bom', admin, {'includeOptional': False})
    chk(s3 == 409, f'INVALIDATED mera spet zapre BOM ({s3})')

# ══ H) pisarniški prehodi ═══════════════════════════════════════════════════
print('── H) ročni prehodi samo za pisarno')
s, _ = callj('PATCH', f'/api/measurements/{ID_KAL}', monter, {'status': 'CONFIRMED'})
chk(s == 403, f'monter ne more sam potrditi lastne mere → 403 ({s})')
s, d = callj('PATCH', f'/api/measurements/{ID_KAL}', admin, {'status': 'FOO'})
chk(s == 400, f'neznan status → 400 ({s})')
s, d = callj('PATCH', f'/api/measurements/{ID_KAL}', admin, {'status': 'CALIBRATED'})
chk(s == 400 and 'izračunan' in json.dumps(d, ensure_ascii=False),
    f'ročno ni nastavljivo stanje, ki ga izračuna strežnik → 400 ({s})')
s, d = callj('PATCH', f'/api/measurements/{ID_KAL}', admin, {'status': 'INVALIDATED'})
chk(s == 400 and 'razlog' in json.dumps(d, ensure_ascii=False),
    f'razveljavitev brez razloga → 400 (sledljivost) ({s})')

# ══ I) preračun in odvisni zapisi ══════════════════════════════════════════
print('── I) nova geometrija razveljavi potrjeno mero + odvisni paketi')
s, d = callj('PATCH', f'/api/measurements/{ID_VER}', admin, {'status': 'CONFIRMED'})
ID_CONFIRMED = d.get('data', {}).get('id')
chk(s == 200 and (d.get('data') or {}).get('status') == 'CONFIRMED', f'prej: VERIFIED → CONFIRMED ({s})')
PKG2_ID = ustvari_paket('PAK-R501-2', ID_CONFIRMED) if PROD_ID else None
chk(bool(PKG2_ID), f'paket povezan s potrjeno meritvijo ({PKG2_ID})')
nova_params = json.dumps({'photoId': photo_id, 'source': 'KAMERA', 'points': PTS,
                          'calibration': {'px': 800, 'cm': 100, 'imgW': 1600, 'imgH': 1200}})
s, d = callj('PATCH', f'/api/measurements/{ID_CONFIRMED}', admin, {'params': nova_params, 'status': 'CONFIRMED'})
chk(s == 400, f'geometrija + status v istem zahtevku → 400 (najprej preračun) ({s})')
s, d = callj('PATCH', f'/api/measurements/{ID_CONFIRMED}', admin, {'params': nova_params})
row = meas_row(ID_CONFIRMED)
chk(s == 200 and (d.get('data') or {}).get('status') not in ('CONFIRMED', None),
    f'nova geometrija vrne stanje na strežniški izračun ({(d.get("data") or {}).get("status")})')
chk('CALIBRATED' in (row.get('statusNote') or '') or (row.get('status') == 'CALIBRATED'),
    f'razlog preračuna je zapisan ({row.get("status")} / {str(row.get("statusNote"))[:70]})')
meta = (d.get('meta') or {}).get('invalidiran') or {}
chk(meta.get('paketi') == 1,
    f'odvisni paket je ponovno ovrednoten (meta.invalidiran paketi={meta.get("paketi")})')

s, d = callj('PATCH', f'/api/measurements/{ID_CONFIRMED}', admin, {'lengthCm': 335})
chk(s == 200 and (d.get('data') or {}).get('status') == 'MANUAL',
    f'številka brez preračuna geometrije na kamerem zapisu → MANUAL ({(d.get("data") or {}).get("status")})')

s, d = callj('PATCH', f'/api/measurements/{ID_CONFIRMED}', admin,
             {'params': json.dumps({'photoId': photo_id, 'source': 'KAMERA'})})
chk(s == 200 and (d.get('data') or {}).get('status') == 'INVALIDATED',
    f'odstranjena geometrije → INVALIDATED, ne tiho prejšnje stanje ({(d.get("data") or {}).get("status")})')

# ══ J) izvoz + javna povezava ═════════════════════════════════════════════
print('── J) izvoz in javna povezava')
s, raw, hdr = callraw('GET', f'/api/measure-engine/export?id={ID_ROC}&format=csv', monter)
chk(s == 200, f'izvoz CSV potrjene meritve → 200 ({s})')
chk('Provenienca' in raw and 'Poslovna mera dovoljena' in raw and 'DA' in raw,
    'izvoz nosi stanje zapisa in vrata poslovne mere')
s, raw, hdr = callraw('GET', f'/api/measure-engine/export?id={ID_PRED}&format=csv', monter)
chk(s == 200 and 'NE' in raw and 'nepotrjen' in raw,
    'izvoz ocene/predloga jasno pravi NE (monter in pisarka vidita isto)')

s, d = callj('POST', f'/api/measurements/{ID_ROC}/share', monter)
token = (d.get('data') or {}).get('token')
chk(s == 201 and bool(token), f'javna povezava ustvarjena ({s})')
if token:
    s, raw, _ = callraw('GET', f'/api/public/measure?token={token}')
    body = json.loads(raw) if raw.startswith('{') else {}
    mer = body.get('data') or {}
    chk(s == 200 and mer.get('statusLabel') == 'Ročni vnos',
        f'javna povezava pokaže OVOJNO oznako stanja ({s} / {mer.get("statusLabel")})')
    chk('statusNote' not in raw and 'Ročni popravek vrednosti' not in raw,
        'javna povezava NE razkrije interne obrazložitve (statusNote — lahko imenuje ljudi)')
    callj('DELETE', f'/api/measurements/{ID_ROC}/share', monter)
    s, raw, _ = callraw('GET', f'/api/public/measure?token={token}')
    chk(s == 404, f'preklicana povezava ne vrne več ničesar ({s})')

# ══ K) UI-nizi (source grep) ═══════════════════════════════════════════════
print('── K) enotnost med plastmi (source grep)')
ui = [
    ('src/lib/measure-engine.ts', 'export function parseCalibration', 'LIB: ENOTNA kalibracijska pogodba je izvožena'),
    ('src/lib/measure-engine.ts', 'export function pointsForStorage', 'LIB: enotna normalizacija točk za zapis'),
    ('src/lib/measure-engine.ts', 'export function consolidateViews', 'LIB: konsolidacija pogledov v jedru (mrežna + offline)'),
    ('src/lib/measure-engine.ts', 'export function deriveProvenance', 'LIB: izključen izračun statusa samo v jedru'),
    ('src/app/api/measurement/confirm/route.ts', 'deriveProvenance(', 'CONFIRM: stanje iz jedra'),
    ('src/app/api/sync/route.ts', 'deriveProvenance(', 'SYNC: offline ima ISTO stanje'),
    ('src/app/api/railing-layout/route.ts', 'parseCalibration(', 'LAYOUT: ista pogodba kalibracije'),
    ('src/app/api/measurements/[id]/route.ts', 'quotes.approve', 'PATCH: pisarniški prehod vezan na pravico'),
    ('src/app/api/measurements/[id]/route.ts', 'invalidateQuotesForPackage', 'PATCH: odvisne ponudbe ponovno ovrednotene'),
    ('src/app/api/project-packages/[id]/bom/route.ts', 'measurementStatusAllowsBusiness', 'BOM: vrata fail-closed na eni točki'),
    ('src/app/api/public/measure/route.ts', 'statusLabel', 'JAVNA POVEZAVA: samo naziv stanja, ne interne obrazložitve'),
    ('src/components/roksal/modules/meritve.tsx', 'ProvenancePanel', 'MERITVE UI: plošča provenience s potrditvijo/razveljavitvijo'),
    ('src/components/roksal/modules/meritve.tsx', 'MEASUREMENT_STATUS', 'MERITVE UI: oznake uvožene iz jedra'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'computeGeometry(', 'KAMERA UI: izračun v živo iz jedra'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'resolveScale(', 'KAMERA UI: pasus merila iz istega modela merila'),
    ('src/lib/fence-run-engine.ts', "from './measure-engine'", 'FENCE-RUN: uvozi lestvico iz jedra (brez podvojene tabele)'),
    ('src/lib/fence-run-engine.ts', 'MEASUREMENT_STATUS_SHORT', 'FENCE-RUN: oznake stanj = isti nabor kot meritve'),
]
for rel, needle, msg in ui:
    chk(src_has(rel, needle), msg)

# Negirana pravila: nobena plast NE SME več deliti svoje interpretacije reference
# (jedro je edini, ki iz px in cm naredi cm/px).
DIV = r'calib\.\s*cm\s*/'
for rel in ['src/app/api/sync/route.ts', 'src/app/api/measurement/confirm/route.ts',
            'src/app/api/railing-layout/route.ts', 'src/lib/fence-run-engine.ts',
            'src/components/roksal/modules/meritve-kamera.tsx',
            'src/components/roksal/modules/meritve.tsx']:
    chk(src_lacks(rel, DIV), f'{rel}: nima več lastnega cm/px izračuna (vrednost pride iz jedra)')

patch_src = read_src('src/app/api/measurements/[id]/route.ts')
chk(0 <= patch_src.find('statusWanted') < patch_src.find("'Ni sprememb za izvedbo.'"),
    'PATCH: sam prehod stanja (brez polj) je veljavna zahteva — pisarniški klik deluje')

# Vsaka ustvarjalna pot mora zapisati stanje. Kjer tega ni, privzame stolpec
# ESTIMATED in nova poslovna vrata (BOM) tiho zavrnejo kosovnico iz pravilno
# potrjenega tekača — to regresijo je ujel r488, zato je zdaj zajeta strojno.
USTVARJALNE = []
for root, _dirs, files in os.walk(os.path.join(REPO, 'src')):
    for fn in files:
        if not fn.endswith('.ts'):
            continue
        rel = os.path.relpath(os.path.join(root, fn), REPO).replace('\\', '/')
        try:
            text = read_src(rel)
        except Exception:
            continue
        # R537: transakcije — create teče na tx klientu znotraj $transaction;
        # status se še vedno nastavi eksplicitno.
        for m in re.finditer(r'(?:db|tx)\.measurement\.create\(', text):
            okno = text[m.end():m.end() + 900]
            USTVARJALNE.append((rel, bool(re.search(r'\n\s*status:', okno))))
chk(len(USTVARJALNE) >= 7 and all(nastavljeno for _rel, nastavljeno in USTVARJALNE),
    f'jedro: vseh {len(USTVARJALNE)} ustvarjalnih poti nastavi status (nobena ne sme biti skrita)')
for rel, nastavljeno in USTVARJALNE:
    chk(nastavljeno, f'{rel}: measurement.create nastavi status iz jedra, ne zanaša se na privzetek stolpca')

# ══ L) idempotentno čiščenje ×2 ════════════════════════════════════════════
print('── L) čiščenje testnih zapisov (×2, idempotentno)')
CLEAN_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
const KODI=['PAK-R501-1','PAK-R501-2'];
(async()=>{
  const ms=await p.measurement.findMany({where:{OR:[{note:{contains:'__TAG__'}},{location:{contains:'__TAG__'}}]},select:{id:true}});
  const ids=ms.map((m)=>m.id);
  // kosovnice testnih paketov naprej (BOM ima lahko rezervacije → brišemo samo
  // tipe, ki jih je ustvaril test; rezervacij tu ni, a vrstni red ostane FK-varen)
  const paki=await p.projectPackage.findMany({where:{code:{in:KODI}},select:{id:true,bom:{select:{id:true}}}});
  for (const pk of paki) {
    if (pk.bom) { await p.bomLine.deleteMany({where:{bomId:pk.bom.id}}); await p.bom.delete({where:{id:pk.bom.id}}); }
  }
  await p.projectPackage.deleteMany({where:{code:{in:KODI}}});
  for (const id of ids) {
    await p.projectPackage.updateMany({where:{measurementId:id},data:{measurementId:null}});
    await p.measurementVersion.deleteMany({where:{measurementId:id}});
  }
  // javni žeton je stolpec na meritvi (Measurement.shareToken) — zbrisane z zapisi
  await p.measurement.deleteMany({where:{id:{in:ids}}});
  await p.syncOp.deleteMany({where:{deviceId:'__DEV__'}});
  await p.auditLog.deleteMany({where:{detail:{contains:'__TAG__'}}});
  await p.auditLog.deleteMany({where:{entityId:{in:[...ids,'__DEV__',...KODI]}}});
  console.log('CLEAN_DONE');await p.$disconnect();
})()
'''
CLEAN = CLEAN_JS.replace('__TAG__', TAG).replace('__DEV__', DEV)
for i in range(2):
    out, err = bun_ts(CLEAN)
    chk('CLEAN_DONE' in out, f'počiščenje testnih zapisov ({i + 1}.) {"" if "CLEAN_DONE" in out else err[:200]}')

print(f'\n══ R501 (issue #15 faza 2): {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL else 0)
