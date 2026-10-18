#!/usr/bin/env python3
# r558 — R558 (raziskava R557 → IZVEDBA V1): štiri zmogljosti iz spletna
# primerjave najboljših gradbenih AR/LiDAR/ARCore programov:
#
#   V1.1 NAKLONOMER (nagib-core + naklonomer.tsx) — RELATIVNA gravitacijska
#        metoda: ničla na vodoravni referenci + deska čez zobce; kot med
#        dvema pospeškoma je platformno-neodvisen (ne odvisen od neoverjene
#        absolutne formule, ki jo je r553 zavedno odlašal). Stopniške ograje
#        so po literaturi največji vir napak v ponudbah.
#   V1.2 GLOBINSKI POLIGON (depth-adapter + globina.ts + scena-detail) —
#        N tapov v ENI AR seji (do 8); izstop (Nazaj) pri ≥2 točkah je
#        ZAKLJUČEK mere (pri starej dvotapni poti je bil napaka).
#   V1.3 DXF IZVOZ (lib/dxf.ts + export route + gumb) — čist tekstovni CAD
#        (R12 ASCII), poslovna mera kot razviti prikaz (linija + ročnik +
#        stebri + meta). Nikoli izmišljenih segmentov.
#   V1.4 VLM PREČKA (analyze-multi + precka-panel) — HOVER-style: 2–8
#        fotografij istega objekta → primerjava dimenzij med posnetki.
#
# Preverja:
#   A) nagib-core enote (bun): veljavnostPospeska, kotMedPospeskoma,
#      povprecjePospeskov, normalizirajKotPovrsine, formatKota,
#      kategorijaNaklona, vrednostZaVnos.
#   B) depth-adapter polyIzTock (bun): pravokotnik 3×4 m (total 1400,
#      12,00 m²), 2 točki (segment, površina null), kolinearne (0,00 m²),
#      <2 točke null; + žičenje hook/gumbov (grep).
#   C) dxf enote (bun): dxfStevilo, pozicijeStebrov, sestaviDxf struktura,
#      dxfIzMeritve (z mero: LINE+CIRCLE+TEXT+layers; brez mere: NI PODANA).
#   D) HTTP export dxf (monter): foto → confirm (600/110/7) → format=dxf
#      vsebuje SECTION/LINE/STEBRI; format=xml 400; 401 brez žetona; čiščenje.
#   E) HTTP analyze-multi validacije (401/400 <2/400 >8/400 prefix/400 brez)
#      + 1 živ VLM klic z 2 mini PNG (200/422 uspeh; 502 SKIP).
#   F) registracija (ci-matrix/ci.yml/README 62.) + REGRESIJE: stara
#      dvotapna mera ostaja (globina.ts runDepthMeasure), izvoz csv/json,
#      analyze (R454) nedotaknjen.

import json
import os
import subprocess
import urllib.request
import urllib.error

PASS, FAIL, SKIP = 0, 0, 0
TAG = 'R558-TEST'
BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)
def skip (msg): global SKIP; SKIP += 1; print(f'  SKIP {msg}')


def src (relpath):
    with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
        return f.read()


def src_has (relpath, needle):
    try:
        return needle in src(relpath)
    except Exception:
        return False


def bun_js (script):
    env = {**os.environ}
    env.setdefault('NODE_OPTIONS', '--import ./tests/ts-resolve-register.mjs')
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True, cwd=REPO, env=env)
    out = (r.stdout or '').strip().splitlines()
    for line in reversed(out):
        if line.startswith('{'):
            try:
                return json.loads(line)
            except Exception:
                break
    return {'_err': (r.stderr or r.stdout or '')[:900]}


def call (method, path, token=None, body=None, timeout=90):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode('utf-8', 'replace')), r
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode('utf-8', 'replace')), e
        except Exception: return e.code, {}, e
    except Exception as e:
        return 0, {'error': str(e)}, None


def raw_get (path, token=None):
    req = urllib.request.Request(BASE + path)
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        try: return e.code, e.read().decode('utf-8', 'replace')
        except Exception: return e.code, ''
    except Exception:
        return 0, ''


def login (email, pw):
    s, d, _ = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s}'
    return d['token']


MOD = 'src/components/roksal/modules'
LIB = 'src/lib'
AR = f'{MOD}/ar'

print(f'════ r558 — V1 izvedba: naklonomer, globinski poligon, DXF, VLM prečka ════')

# ═══ A) nagib-core (bun) ═══════════════════════════════════════════════════
print('── A) nagib-core: relativna gravitacijska metoda')
A = bun_js(r'''
const nc = await import('./src/lib/nagib-core')
const out = {}
out.veljaven = nc.veljavnostPospeska({ x: 0, y: 0, z: -9.81 })
out.premikanje = nc.veljavnostPospeska({ x: 0, y: 0, z: -5 })
out.brez = nc.veljavnostPospeska(null)
out.kotIsta = nc.kotMedPospeskoma({ x: 0, y: 0, z: -9.81 }, { x: 0.02, y: -0.03, z: -9.8 })
// nagnjena površina ~36,9° (3-4-5): gravitacija v drugi legi
const rad = 36.87 * Math.PI / 180
out.kotNagnjeno = nc.kotMedPospeskoma({ x: 0, y: 0, z: -9.81 }, { x: 0, y: -9.81 * Math.sin(rad), z: -9.81 * Math.cos(rad) })
out.kotObrnjeno = nc.kotMedPospeskoma({ x: 0, y: 0, z: -9.81 }, { x: 0, y: 0, z: 9.81 })
out.kotNull = nc.kotMedPospeskoma(null, { x: 0, y: 0, z: -9.81 })
out.povp = nc.povprecjePospeskov([{ x: 0, y: 0, z: -9.8 }, { x: 0, y: 0, z: -9.82 }])
out.povpPrazno = nc.povprecjePospeskov([])
out.norm35 = nc.normalizirajKotPovrsine(35.24)
out.norm150 = nc.normalizirajKotPovrsine(150.0)
out.fmt = nc.formatKota(35.5)
out.fmtNull = nc.formatKota(null)
out.kat = [nc.kategorijaNaklona(0.4), nc.kategorijaNaklona(5), nc.kategorijaNaklona(20), nc.kategorijaNaklona(36), nc.kategorijaNaklona(50)]
out.vnos = nc.vrednostZaVnos(35.24)
out.vnosNull = nc.vrednostZaVnos(null)
console.log(JSON.stringify(out))
''')
if '_err' in A:
    bad(f'A uvoz: {A["_err"][:200]}')
else:
    chk(A.get('veljaven', {}).get('veljavno') is True, f'A1 veljavnostPospeska 9,81 → veljavno (razlog: {A.get("veljaven", {}).get("razlog")})')
    chk(A.get('premikanje', {}).get('veljavno') is False and A.get('premikanje', {}).get('razlog') is not None, 'A2 |g| 5 → neveljavno z razlogom (premikanje)')
    chk(A.get('brez', {}).get('veljavno') is False, 'A3 null → neveljavno (senzor ne poroča)')
    chk(abs(A.get('kotIsta', -1) - 0.0) < 0.5, f'A4 isti vektor → ~0° (senzorni šum < 0,5°; dejansko {A.get("kotIsta")})')
    k = A.get('kotNagnjeno')
    chk(isinstance(k, (int, float)) and 36.5 <= k <= 37.2, f'A5 nagnjeno 36,9° (3-4-5) → {k}')
    chk(A.get('kotObrnjeno') == 180.0, f'A6 obrnjeno (ekran dol) → 180,0° (dejansko {A.get("kotObrnjeno")})')
    chk(A.get('kotNull') is None, 'A7 null vnos → null (brez ugibanj)')
    p = A.get('povp')
    chk(isinstance(p, dict) and abs(p.get('z', 0) + 9.81) < 0.01, 'A8 povprečje 2 vzorcev → −9,81')
    chk(A.get('povpPrazno') is None, 'A9 prazno povprečje → null')
    chk(A.get('norm35', {}).get('deg') == 35.2 and A.get('norm35', {}).get('obrnjeno') is False, 'A10 normalizacija 35,24 → 35,2 (1 dec.)')
    n150 = A.get('norm150', {})
    chk(n150.get('deg') == 30.0 and n150.get('obrnjeno') is True, f'A11 150° → 30° z oznako obrnjeno (dejansko {n150})')
    chk(A.get('fmt') == '35,5°', f'A12 formatKota → »35,5°« (dejansko {A.get("fmt")})')
    chk(A.get('fmtNull') == '—', 'A13 formatKota null → »—«')
    kat = A.get('kat', [])
    chk(kat and kat[0] == 'vodoravno' and kat[1] == 'blago nagnjeno', f'A14 kategorije 1. del ({kat[:2]})')
    chk(kat and kat[2] == 'zmerno nagnjeno' and kat[3] == 'strmo (typično stopnišče)', f'A15 kategorije 2. del ({kat[2:4]})')
    chk(kat and kat[4] == 'zelo strmo — preverite izmero', f'A16 kategorija 50° ({kat[4] if len(kat) > 4 else None})')
    chk(A.get('vnos') == '35.2', f'A17 vrednostZaVnos → »35.2« (pika za vnos; dejansko {A.get("vnos")})')
    chk(A.get('vnosNull') == '', 'A18 vrednostZaVnos null → prazno')

# ═══ B) depth-adapter polyIzTock (bun) ════════════════════════════════════
print('── B) globinski poligon: polyIzTock')
B = bun_js(r'''
const da = await import('./src/lib/depth-adapter')
const M = { provider: 'WEBXR_DEPTH', depthFormat: 'luminance-alpha', rawValueToMeters: 1, width: 160, height: 120, focalPx: 80, timestamp: 1760000000123 }
// world točke so v METRIH (WebXR prostor) — pointsDistanceCm računa ×100
const tap = (x, y, z) => ({ world: { x, y, z }, sample: { u: 0.5, v: 0.5, depthM: 2 }, manifest: M })
const out = {}
// pravokotnik 3 m × 4 m v ravnini XZ (tla): oglišča ograje
out.pravokotnik = da.polyIzTock([tap(0, 0, 0), tap(3, 0, 0), tap(3, 0, 4), tap(0, 0, 4)])
// 2 točki — segment (nazajzdružljivo s staro potjo)
out.dve = da.polyIzTock([tap(0, 0, 0), tap(2.5, 0, 0)])
// 3 kolinearne točke — veljavno, a površina 0
out.kolinearne = da.polyIzTock([tap(0, 0, 0), tap(1, 0, 0), tap(2, 0, 0)])
// premalo
out.ena = da.polyIzTock([tap(0, 0, 0)])
out.nic = da.polyIzTock([])
console.log(JSON.stringify(out))
''')
if '_err' in B:
    bad(f'B uvoz: {B["_err"][:200]}')
else:
    pk = B.get('pravokotnik', {})
    chk(pk.get('points') == 4 and pk.get('segments') == 3, f'B1 pravokotnik: 4 točke, 3 segmenti (dejansko {pk.get("points")}/{pk.get("segments")})')
    chk(pk.get('totalCm') == 1000, f'B2 dolžina VERIGE (3+4+3 m; ne obvod) 1000 cm (dejansko {pk.get("totalCm")})')
    chk(pk.get('segmentsCm') == [300, 400, 300], f'B3 segmenti po vrsti (dejansko {pk.get("segmentsCm")})')
    chk(pk.get('minCm') == 300 and pk.get('maxCm') == 400, f'B4 min/max 300/400 (dejansko {pk.get("minCm")}/{pk.get("maxCm")})')
    chk(pk.get('areaXzM2') == 12.0, f'B5 površina horizontalne projekcije 12,00 m² (dejansko {pk.get("areaXzM2")})')
    dv = B.get('dve', {})
    chk(dv.get('segments') == 1 and dv.get('totalCm') == 250 and dv.get('areaXzM2') is None, f'B6 2 točki → segment 250 cm, površina null (dejansko {dv})')
    kl = B.get('kolinearne', {})
    chk(kl.get('totalCm') == 200 and kl.get('areaXzM2') == 0.0, f'B7 kolinearne → 200 cm, 0,00 m² (dejansko {kl})')
    chk(B.get('ena') is None and B.get('nic') is None, 'B8 1/0 točk → null (brez mere)')

# B9 — žičenje: hook, gumbi, opisi
b9 = [
    (f'{LIB}/depth-adapter.ts', 'export function startDepthPolygonMeasurement', 'adapter izvozi poligonsko sejo'),
    (f'{LIB}/depth-adapter.ts', 'export function polyIzTock', 'adapter izvozi čisto polyIzTock'),
    (f'{AR}/globina.ts', 'runDepthPolygonMeasure', 'hook: poligonska mera'),
    (f'{AR}/globina.ts', 'Poligon iz AR globine zabeležen.', 'toast naslov poligona'),
    (f'{AR}/scena-detail.tsx', 'Poligon (3–8)', 'gumb poligona v scena-detail'),
    (f'{AR}/scena-detail.tsx', 'izstop z Nazaj pri ≥2 točkah zaključi mero', 'navodilo poligona'),
    (f'{MOD}/ar.tsx', 'runDepthPolygonMeasure', 'vstop AR prenosa poligona'),
    (f'{AR}/naklonomer.tsx', 'Zajemi ničlo', 'naklonomer: gumb ničle'),
    (f'{AR}/naklonomer.tsx', 'Prevzemi kot v vnos naklona', 'naklonomer: prevzem'),
    (f'{AR}/scena-detail.tsx', 'Izmeri s telefonom', 'scena-detail: gumb naklonometra'),
]
for rel, needle, msg in b9:
    chk(src_has(rel, needle), f'B9 ŽIČENJE: {msg}')

# ═══ C) dxf (bun) ═════════════════════════════════════════════════════════
print('── C) dxf: čist tekstovni CAD (R12)')
C = bun_js(r'''
const dxf = await import('./src/lib/dxf')
const out = {}
out.st1 = dxf.dxfStevilo(12.345)
out.st2 = dxf.dxfStevilo(null)
out.stebri7 = dxf.pozicijeStebrov(600, 7)
out.stebri1 = dxf.pozicijeStebrov(600, 1)
out.stebriNic = dxf.pozicijeStebrov(600, null)
out.stebri0 = dxf.pozicijeStebrov(0, 7)
const s = dxf.sestaviDxf(
  [{ geo: { x1: 0, y1: 0, x2: 600, y2: 0 }, layer: 'OGRAJA' }],
  [{ geo: { x: 100, y: 0, r: 3 }, layer: 'STEBRI' }],
  [{ geo: { x: 0, y: -14, visina: 8, vsebina: 'TEST' }, layer: 'META' }],
)
out.dxf = s
out.dxfGlava = s.startsWith('0\nSECTION\n2\nENTITIES\n')
out.dxfRep = s.includes('0\nENDSEC\n0\nEOF\n')
out.lineCount = (s.match(/0\nLINE\n/g) || []).length
out.circleCount = (s.match(/0\nCIRCLE\n/g) || []).length
const zMero = dxf.dxfIzMeritve({ naslov: 'T', dolzinaCm: 600, visinaCm: 110, stebri: 7, naklonDeg: 3.5, projekt: 'P-1', lokacija: 'L', operater: 'O', datum: 'D', verzija: 2 })
out.zMeroLine = (zMero.match(/0\nLINE\n/g) || []).length
out.zMeroCircle = (zMero.match(/0\nCIRCLE\n/g) || []).length
out.zMeroText = (zMero.match(/0\nTEXT\n/g) || []).length
out.zMeroLayerji = ['OGRAJA', 'ROCNIK', 'STEBRI', 'META'].every(l => zMero.includes('8\n' + l + '\n'))
const brez = dxf.dxfIzMeritve({ naslov: 'T', dolzinaCm: null, visinaCm: null, stebri: null, naklonDeg: null, projekt: null, lokacija: null, operater: null, datum: null, verzija: null })
out.brezVsebuje = brez.includes('NI PODANA')
out.brezLine = (brez.match(/0\nLINE\n/g) || []).length
console.log(JSON.stringify(out))
''')
if '_err' in C:
    bad(f'C uvoz: {C["_err"][:200]}')
else:
    chk(C.get('st1') == '12.35' and C.get('st2') == '0.00', f'C1 dxfStevilo 12,345→»12.35«, null→»0.00« (dejansko {C.get("st1")}/{C.get("st2")})')
    chk(C.get('stebri7') == [0, 100, 200, 300, 400, 500, 600], f'C2 pozicijeStebrov(600, 7) → 0..600 korak 100 (dejansko {C.get("stebri7")})')
    chk(C.get('stebri1') == [300], f'C3 1 steber → sredina (dejansko {C.get("stebri1")})')
    chk(C.get('stebriNic') == [] and C.get('stebri0') == [], 'C4 null/0 dolžina → brez stebrov')
    chk(C.get('dxfGlava') is True and C.get('dxfRep') is True, 'C5 DXF glava SECTION/ENTITIES + rep ENDSEC/EOF')
    chk(C.get('lineCount') == 1 and C.get('circleCount') == 1, f'C6 entitete: 1 LINE + 1 CIRCLE (dejansko {C.get("lineCount")}/{C.get("circleCount")})')
    chk(C.get('zMeroLine') == 2, f'C7 z mero: 2 LINE (linija + ročnik; dejansko {C.get("zMeroLine")})')
    chk(C.get('zMeroCircle') == 7, f'C8 z mero: 7 CIRCLE stebrov (dejansko {C.get("zMeroCircle")})')
    chk(isinstance(C.get('zMeroText'), int) and C.get('zMeroText') >= 5, f'C9 z mero: ≥5 TEXT metapodatkov (dejansko {C.get("zMeroText")})')
    chk(C.get('zMeroLayerji') is True, 'C10 plasti OGRAJA/ROCNIK/STEBRI/META prisotne')
    chk(C.get('brezVsebuje') is True and C.get('brezLine') == 0, 'C11 brez mere: 0 LINE + »NI PODANA« (poštenost)')

# ═══ D) HTTP export dxf (monter) ══════════════════════════════════════════
print('── D) HTTP: izvoz DXF potrjene meritve')
monter = login('monter@roksal.si', 'Monter123!')
PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='
s, d, _ = call('POST', '/api/measure/photo', monter, {'dataUrl': PHOTO, 'location': TAG, 'note': TAG})
chk(s in (200, 201), f'D1 fotografija pripravljena ({s})')
photo_id = d['data']['id'] if s in (200, 201) else None
s, d, _ = call('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 600, 'heightCm': 110,
    'posts': 7, 'location': TAG, 'note': f'{TAG} dxf',
    'points': [{'x': 0.1, 'y': 0.2}, {'x': 0.5, 'y': 0.2}, {'x': 0.5, 'y': 0.6}],
    'calibration': {'px': 100, 'cm': 100, 'method': 'ZNANA_MERA', 'refObject': 'vrata 100 cm'},
    # 409 vrata (»dolžina se ne ujema«) ostajajo odprta za ročni popravek z
    # razlogom (r455) — v testu uporabimo to zakonito pot.
    'manualOverride': {'computedLengthCm': 600, 'reason': f'{TAG} ročni popravek (dxf test)'},
})
chk(s == 201, f'D2 potrditev meritve 600/110/7 → 201 (dejansko {s})')
mid = d['data']['id'] if s == 201 else None
if mid:
    st, txt = raw_get(f'/api/measure-engine/export?id={mid}&format=dxf', monter)
    chk(st == 200, f'D3 format=dxf → 200 (dejansko {st})')
    if st == 200:
        chk(txt.startswith('0\nSECTION\n2\nENTITIES\n'), 'D4 DXF glava')
        chk('0\nENDSEC\n0\nEOF' in txt, 'D5 DXF rep')
        chk('0\nLINE\n' in txt and '0\nCIRCLE\n' in txt and '0\nTEXT\n' in txt, 'D6 LINE + CIRCLE + TEXT entitete')
        chk('8\nSTEBRI\n' in txt and '8\nROCNIK\n' in txt, 'D7 plasti STEBRI + ROCNIK')
        chk(txt.count('0\nCIRCLE\n') == 7, f'D8 7 stebrov (dejansko {txt.count("0\nCIRCLE\n")})')
        chk('600.00' in txt, 'D9 dolžina 600,00 v risbi')
    st2, txt2 = raw_get(f'/api/measure-engine/export?id={mid}&format=xml', monter)
    chk(st2 == 400, f'D10 format=xml → 400 (dejansko {st2})')
    st3, txt3 = raw_get(f'/api/measure-engine/export?id={mid}&format=dxf')
    chk(st3 == 401, f'D11 brez žetona → 401 (dejansko {st3})')
    # čiščenje: izbriši meritev + VSE ostanke tega testa (photo_id je FOTO
    # osnutek v isti tabeli — /api/measure/photo ustvari measurement vrstico)
    del_src = '''
const { PrismaClient } = await import('@prisma/client')
const p = new PrismaClient()
let n = 0, f = 0
const m = await p.measurement.findUnique({ where: { id: 'MID' }, select: { id: true } })
if (m) {
  await p.measurementVersion.deleteMany({ where: { measurementId: m.id } })
  await p.measurement.delete({ where: { id: m.id } })
  n = 1
}
const r = await p.measurement.deleteMany({ where: { location: 'TAGV' } })
f = r.count
await p.$disconnect()
console.log(JSON.stringify({ n, f }))
'''.replace('MID', mid).replace('TAGV', TAG)
    cl = bun_js(del_src)
    chk(cl.get('n') == 1, 'D12 meritev izbrisana (čiščenje)')
    chk(isinstance(cl.get('f'), int) and cl.get('f') >= 0, f'D13 ostanki po location {TAG} pobrisani ({cl.get("f")})')
else:
    bad('D2 potrditev ni uspela — nadaljevanje D bloka preskočeno')

# ═══ E) analyze-multi validacije ══════════════════════════════════════════
print('── E) HTTP: VLM prečka (analyze-multi)')
PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q942jgAAAABJRU5ErkJggg=='
s, d, _ = call('POST', '/api/ar/analyze-multi', None, {'photos': [PNG, PNG]})
chk(s == 401, f'E1 brez žetona → 401 (dejansko {s})')
s, d, _ = call('POST', '/api/ar/analyze-multi', monter, {'photos': [PNG]})
chk(s == 400, f'E2 1 fotografija → 400 (dejansko {s}: {d.get("error", "")[:60]})')
s, d, _ = call('POST', '/api/ar/analyze-multi', monter, {'photos': [PNG] * 9})
chk(s == 400, f'E3 9 fotografij → 400 (dejansko {s})')
s, d, _ = call('POST', '/api/ar/analyze-multi', monter, {'photos': [PNG, 'data:text/plain;base64,QQ']})
chk(s == 400, f'E4 napačen prefix → 400 (dejansko {s})')
s, d, _ = call('POST', '/api/ar/analyze-multi', monter, {})
chk(s == 400, f'E5 brez photos → 400 (dejansko {s})')
s, d, _ = call('POST', '/api/ar/analyze-multi', monter, {'photos': [PNG, PNG]})
if s == 200:
    data = d.get('data', {})
    chk('scene' in data and 'dims' in data and 'warnings' in data, 'E6 živ VLM klic → 200 s strukturo')
    chk(isinstance(data.get('dims', []), list), 'E7 dims seznam')
elif s == 422:
    skip('E6 živ VLM: 422 (1×1 px sliki ne prepozna — veljaven izid, struktura enaka)')
elif s == 502:
    skip('E6 živ VLM: 502 (zunanja storitev trenutno nedosegljiva — ne aplikacijska napaka)')
else:
    bad(f'E6 živ VLM klic → {s} (pričakovano 200/422/502): {json.dumps(d)[:160]}')

# ═══ F) registracija + regresije ══════════════════════════════════════════
print('── F) registracija + regresije')
import re as _re
mat = src('tests/ci-matrix.sh')
chk(_re.search(r'(?<![\w-])r558(?![\w-])', mat) is not None and mat.count('r558') >= 2,
    'F1 ci-matrix.sh: r558 v GRUPE in CLANI')
yml = src('.github/workflows/ci.yml')
chk(_re.search(r'(?<![\w-])r558(?![\w-])', yml) is not None, 'F2 ci.yml: r558 v matriki')
rd = src('README.md')
chk(_re.search(r'62\. skupin|62 skupin|62/62', rd) is not None, 'F3 README: 62. skupina odražena')
rmap = src('docs/ROUTE-MAP.md')
chk('api/ar/analyze-multi' in rmap, 'F4 ROUTE-MAP: analyze-multi zabeležena')

f5 = [
    (f'{LIB}/depth-adapter.ts', 'startDepthMeasurement', 'STARA dvotapna mera ostaja (nazajzdružljivost)'),
    (f'{AR}/globina.ts', 'Mera iz AR globine zabeležena.', 'stari toast dvotapne mere ostaja'),
    ('src/app/api/measure-engine/export/route.ts', "Podprite formata: csv, json, dxf.", 'izvoz: nova sporočila s dxf'),
    (f'{MOD}/meritve-kamera.tsx', "downloadExport('dxf')", 'gumb DXF v merilnem toku'),
    (f'{MOD}/meritve-kamera/izvoz.ts', "'csv' | 'json' | 'dxf'", 'izvoz tip razširjen'),
    ('src/app/api/ar/analyze/route.ts', 'Si svetovalec za postavitev ograj', 'STARA analyze (R454) nedotaknjena'),
    (f'{AR}/precka-panel.tsx', 'Izvedi prečko', 'prečka panel gumb'),
    (f'{AR}/tipi.ts', 'PreckaAnalysis', 'tip PreckaAnalysis'),
]
for rel, needle, msg in f5:
    chk(src_has(rel, needle), f'F5 REGRESIJA: {msg}')

print(f'════ r558 konec: {PASS} ✓ / {FAIL} ✗ / {SKIP} skip ════')
exit(1 if FAIL > 0 else 0)
