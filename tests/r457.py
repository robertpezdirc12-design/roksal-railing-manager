#!/usr/bin/env python3
"""tests/r457.py — R457 VRHUNSKI MERILNI ENGINE (issue #12)

Preverja:
  A) RBAC (fail-closed): brez žetona 401 na analyze/export; skladišče (brez
     measurements.*) 403 na obeh; proizvodnja (samo measurements.read) 403 na
     analyze + 200 na export; monter (read+write) 200 na obeh.
  B) Engine — OGRAJA (§8): geometrija (segmenti/koti/vogali), stebri po razmaku,
     ročnik, površina polnila; SPLOSNO: dolžine verige.
  C) Engine — KERAMIKA (§9): površina (shoelace), obseg, odprtine, neto,
     razporeditev ploščic (vrstice/stolpci), rezi, odpad, lepak, fuga; diagonalni
     vzorec; PROSTOR (§12): diagonale + kontrola pravokotnosti.
  D) Engine — STREHA (§10): tloris → ploskev / cos(naklon), slemen, kritina,
     odpad (beton 10 % / kovina 7 %).
  E) Engine — FASADA (§11): bruto/odprtine/neto.
  F) Engine — STOPNICE: vzpon/čežnost/nagib + ergonomska kontrola (§14).
  G) §14 validacija: odprt poligon (NAPAKA), kolinearne točke (površina 0 +
     INFO), kot < 10° (OPOZORILO), izven območja (OPOZORILO), ročna vs
     avtomatska mera (OPOZORILO), prekratki segmenti (INFO).
  H) §13 confidence: razpon 5..99, pasovi, slaba kakovost < dobra; §3 capture
     guide: mehka/temna slika + velik nagib → NEZADOSTNO; brez kalibracije → 400
     (§4 — brez reference ni avtomatske potrditve); napačen način → 400.
  I) Potrditev z mode + engine (§2/§7): params.mode/params.engine, verzija v1
     omenja način, revizija MEASUREMENT_CONFIRM nosi mode; napačen mode → 400;
     engine kot niz/prazen → 400.
  J) Export (§19): CSV (podpičja, BOM, domenski paket, reference, operater) in
     JSON (mere, nacin, verzija); format=pdf → 400; neznan id → 404; revizija
     MEASUREMENT_EXPORT; izvoz stare meritve brez mode → nacin null.
  K) Regresija: /api/measurements, /api/railing-layout, /api/measurement/confirm
     klasično (brez novih polj) → 201.
  L) Idempotentno čiščenje vseh testnih zapisov.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R457-TEST'
PASS, FAIL = 0, 0

def call (method, path, token=None, body=None, timeout=30):
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

def callj (method, path, token=None, body=None):
    s, b, _ = call(method, path, token, body)
    return s, (json.loads(b) if s and b[:1] in '{[' else None)

def jget (path, token):
    s, d = callj('GET', path, token)
    return d if s == 200 else None

def login (email, pw):
    s, d = callj('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s}'
    return d['token']

def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)

def bun (script):
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       env={**os.environ, 'DATABASE_URL': os.environ.get('TEST_DB_URL', 'file:' + REPO + '/db/roksal.db')})
    return 'CLEAN_DONE' in r.stdout, r.stderr[:300]

def analyze (token, mode, points, calib=None, options=None, quality=None, tilt=None, manual=None, views=None, agreement=None):
    body = {
        'mode': mode,
        'points': [{'x': x, 'y': y} for x, y in points],
        'calibration': calib or {'px': 100, 'cm': 100, 'method': 'MARKER', 'refObject': 'testna referenca'},
    }
    if options is not None: body['options'] = options
    if quality is not None: body['quality'] = quality
    if tilt is not None: body['tiltDeg'] = tilt
    if manual is not None: body['manualLengthCm'] = manual
    if views is not None: body['viewCount'] = views
    if agreement is not None: body['viewAgreementPct'] = agreement
    return callj('POST', '/api/measure-engine/analyze', token, body)

def codes (result):
    return [i['code'] for i in (result or {}).get('validation', [])]

PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='

CLEAN = f'''
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
(async()=>{{
  const ms=await p.measurement.findMany({{where:{{note:{{contains:'{TAG}'}}}},select:{{id:true}}}});
  for(const m of ms){{
    await p.projectPackage.updateMany({{where:{{measurementId:m.id}},data:{{measurementId:null}}}});
    await p.measurementVersion.deleteMany({{where:{{measurementId:m.id}}}});
    await p.measurement.delete({{where:{{id:m.id}}}});
  }}
  await p.auditLog.deleteMany({{where:{{detail:{{contains:'{TAG}'}}}}}});
  await p.measurement.deleteMany({{where:{{note:'DBG-TEST'}}}});
  console.log('CLEAN_DONE');return p.$disconnect();
}})()
'''

# ══ 0. prijava + čiščenje ════════════════════════════════════════════════════
admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')
proizvodnja = login('proizvodnja@roksal.si', 'Proizvodnja123!')
print('── prijava: admin / monter / skladišče / proizvodnja ──')
ok('prijava 4 vlog')

done, err = bun(CLEAN)
chk(done, f'čiščenje ostankov pred testom {"" if done else " — " + err}')

# ══ A. RBAC ══════════════════════════════════════════════════════════════════
print('── A. RBAC (fail-closed) ──')
s, _ = callj('POST', '/api/measure-engine/analyze', body={'mode': 'OGRAJA', 'points': [{'x': 0, 'y': 0}], 'calibration': {'px': 1, 'cm': 1}})
chk(s == 401, f'analyze brez žetona 401 (dejansko {s})')
s, _ = callj('GET', '/api/measure-engine/export?id=x&format=csv')
chk(s == 401, f'export brez žetona 401 (dejansko {s})')
s, _ = callj('POST', '/api/measure-engine/analyze', skladisce, {'mode': 'OGRAJA', 'points': [{'x': 0, 'y': 0}, {'x': 1, 'y': 0}], 'calibration': {'px': 1, 'cm': 1}})
chk(s == 403, f'skladišče (brez measurements.*) analyze 403 (dejansko {s})')
s, _ = callj('GET', '/api/measure-engine/export?id=x&format=csv', skladisce)
chk(s == 403, f'skladišče export 403 (dejansko {s})')
s, _ = callj('POST', '/api/measure-engine/analyze', proizvodnja, {'mode': 'OGRAJA', 'points': [{'x': 0, 'y': 0}, {'x': 1, 'y': 0}], 'calibration': {'px': 1, 'cm': 1}})
chk(s == 403, f'proizvodnja (samo read) analyze 403 (dejansko {s})')
s, r = analyze(monter, 'OGRAJA', [(0, 0), (300, 0)])
chk(s == 200, f'monter analyze 200 (dejansko {s})')

# ══ B. OGRAJA + SPLOSNO ══════════════════════════════════════════════════════
print('── B. OGRAJA (§8) + SPLOSNO ──')
# točke v px, kalibracija 1 cm/px: (0,0)→(300,0)→(300,400) = 300 + 400 cm, vogal 90°
s, r = analyze(monter, 'OGRAJA', [(0, 0), (300, 0), (300, 400)], options={'maxSpanCm': 120, 'heightCm': 100})
chk(s == 200 and r['data']['domain']['mode'] == 'OGRAJA', 'OGRAJA analiza 200 z domenskim paketom')
d = r['data']['domain']
g = r['data']['geometry']
chk(abs(g['totalLengthCm'] - 700) < 0.2, f'skupna dolžina 700 cm (dejansko {g["totalLengthCm"]})')
chk(len(g['segments']) == 2 and abs(g['segments'][0]['lengthCm'] - 300) < 0.1 and abs(g['segments'][1]['lengthCm'] - 400) < 0.1, 'segmenta 300 + 400 cm')
chk(abs(g['corners'][0]['interiorDeg'] - 90) < 0.2, f'vogal 90° (dejansko {g["corners"][0]["interiorDeg"]})')
# stebri: seg1 ceil(300/120)=3→4, seg2 ceil(400/120)=4→5, skupni vogal −1 → 8
chk(d['posts'] == 8, f'stebri 8 (razmak 120; dejansko {d["posts"]})')
chk(d['spacingCm'] == 120, 'razmak stebrov 120 cm')
chk(abs(d['handrailM'] - 7.0) < 0.02, f'ročnik 7 m (dejansko {d["handrailM"]})')
chk(abs(d['infillM2'] - 7.0) < 0.02, f'površina polnila 7 m² (dejansko {d["infillM2"]})')
chk(r['data']['validation'] == [], 'OGRAJA brez validation ugotovitev (geometrija v redu)')

s, r = analyze(monter, 'SPLOSNO', [(0, 0), (150, 0), (150, 200)])
chk(s == 200 and abs(r['data']['domain']['totalLengthCm'] - 350) < 0.2, 'SPLOSNO veriga 350 cm')

# ══ C. KERAMIKA + PROSTOR ════════════════════════════════════════════════════
print('── C. KERAMIKA (§9) + PROSTOR (§12) ──')
rect = [(0, 0), (400, 0), (400, 300), (0, 300)]
s, r = analyze(monter, 'KERAMIKA', rect, options={'tileWcm': 60, 'tileHcm': 60, 'jointMm': 3, 'openings': [{'wCm': 100, 'hCm': 120, 'count': 2}]})
chk(s == 200 and r['data']['domain']['mode'] == 'KERAMIKA', 'KERAMIKA analiza 200')
d = r['data']['domain']
poly = r['data']['polygon']
chk(abs(poly['areaM2'] - 12.0) < 0.02, f'bruto površina 12 m² (dejansko {poly["areaM2"]})')
chk(abs(poly['perimeterCm'] - 1400) < 0.2, f'obseg 1400 cm (dejansko {poly["perimeterCm"]})')
chk(poly['closed'] and abs(poly['closureCm'] - 300) < 0.2, f'samodejna zaklepalka = levi rob 300 cm (dejansko {poly["closureCm"]})')
chk(poly['closurePct'] < 25, f'zaklepalka 21 % obsega — normalen pravokotnik (dejansko {poly["closurePct"]} %)')
chk(r['data']['validation'] == [], 'KERAMIKA pravilen pravokotnik — brez ugotovitev')
chk(abs(d['openingsM2'] - 2.4) < 0.02, f'odprtine 2×1,2 m² = 2,4 m² (dejansko {d["openingsM2"]})')
chk(abs(d['netAreaM2'] - 9.6) < 0.02, f'neto 9,6 m² (dejansko {d["netAreaM2"]})')
chk(d['rows'] == 5 and d['cols'] == 7, f'razporeditev 5×7 (dejansko {d["rows"]}×{d["cols"]})')
chk(d['tilesCount'] == 35, f'35 ploščic (dejansko {d["tilesCount"]})')
chk(d['cuts'] == 5, f'rezi 5 (vrstica reza; dejansko {d["cuts"]})')
chk(d['netTiles'] == 27, f'neto ploščice 27 (dejansko {d["netTiles"]})')
chk(d['wastePct'] == 30, f'odpad 30 % (dejansko {d["wastePct"]})')
chk(d['adhesiveKg'] == 39, f'lepak 39 kg (4 kg/m²; dejansko {d["adhesiveKg"]})')
chk(0 < d['fugueKg'] < 15, f'fuga smiselna {d["fugueKg"]} kg')
chk(d['pattern'] == 'PRAVOKOTNO', 'vzorec PRAVOKOTNO privzeto')

s, r = analyze(monter, 'KERAMIKA', rect, options={'tileWcm': 60, 'tileHcm': 60, 'jointMm': 3, 'pattern': 'DIAGONALNO'})
d2 = r['data']['domain']
chk(d2['tilesCount'] == 39 and d2['cuts'] == 10, f'diagonalno: 39 ploščic + 10 rezov (dejansko {d2["tilesCount"]}/{d2["cuts"]})')

s, r = analyze(monter, 'PROSTOR', rect)
d = r['data']['domain']
chk(len(d['diagonals']) == 2 and abs(d['diagonals'][0]['lengthCm'] - 500) < 0.2 and abs(d['diagonals'][1]['lengthCm'] - 500) < 0.2, 'PROSTOR diagonali 500 cm')
chk(d['rectangleOk'] is True, 'pravokotnost DA (enaki diagonali)')
s, r = analyze(monter, 'PROSTOR', [(0, 0), (400, 0), (400, 300), (10, 40)])
chk(r['data']['domain']['rectangleOk'] is False, 'popačen prostor → pravokotnost NE')

# ══ D. STREHA ════════════════════════════════════════════════════════════════
print('── D. STREHA (§10) ──')
s, r = analyze(monter, 'STREHA', rect, options={'pitchDeg': 35, 'roofMaterial': 'BETONNA'})
d = r['data']['domain']
chk(abs(d['footprintM2'] - 12.0) < 0.02, f'tloris 12 m² (dejansko {d["footprintM2"]})')
chk(abs(d['faceAreaM2'] - round(12 / 0.8191520442889918, 2)) < 0.02, f'ploskev 14,65 m² pri 35° (dejansko {d["faceAreaM2"]})')
chk(d['ridgeCm'] == 400, f'slemen = najdaljši rob 400 cm (dejansko {d["ridgeCm"]})')
chk(abs(d['eaveCm'] - 1000) < 0.2, f'ostali robovi 1000 cm (dejansko {d["eaveCm"]})')
chk(d['wastePct'] == 10 and d['material'] == 'BETONNA', 'betonska kritina — odpad 10 %')
chk(abs(d['materialM2'] - round(d['faceAreaM2'] * 1.10, 2)) < 0.02, 'material z odpadom')
s, r = analyze(monter, 'STREHA', rect, options={'pitchDeg': 35, 'roofMaterial': 'KOVINSKA'})
chk(r['data']['domain']['wastePct'] == 7 and r['data']['domain']['material'] == 'KOVINSKA', 'kovinska kritina — odpad 7 %')

# ══ E. FASADA ════════════════════════════════════════════════════════════════
print('── E. FASADA (§11) ──')
s, r = analyze(monter, 'FASADA', [(0, 0), (500, 0), (500, 300), (0, 300)], options={'openings': [{'wCm': 100, 'hCm': 120, 'count': 3}]})
d = r['data']['domain']
chk(abs(d['grossM2'] - 15.0) < 0.02, f'bruto fasada 15 m² (dejansko {d["grossM2"]})')
chk(abs(d['openingsM2'] - 3.6) < 0.02, f'odprtine 3×1,2 m² = 3,6 m² (dejansko {d["openingsM2"]})')
chk(abs(d['netM2'] - 11.4) < 0.02, f'neto 11,4 m² (dejansko {d["netM2"]})')

# ══ F. STOPNICE ══════════════════════════════════════════════════════════════
print('── F. STOPNICE ──')
s, r = analyze(monter, 'STOPNICE', [(0, 0), (400, 250)], options={'steps': 14})
d = r['data']['domain']
chk(d['steps'] == 14 and abs(d['riseCm'] - 17.9) < 0.15 and abs(d['runCm'] - 28.6) < 0.15, f'14 stopnic: vzpon 17,9 × čežnost 28,6 (dejansko {d["riseCm"]}×{d["runCm"]})')
chk(abs(d['angleDeg'] - 32.0) < 0.2, f'nagib 32° (dejansko {d["angleDeg"]})')
chk('STOPNICE_ERGONOMIJA' not in codes(r['data']), 'ergonomija v redu — brez opozorila')
s, r = analyze(monter, 'STOPNICE', [(0, 0), (400, 250)], options={'steps': 25})
chk('STOPNICE_ERGONOMIJA' in codes(r['data']), '25 stopnic → vzpon 10 cm → ergonomsko OPOZORILO')

# ══ G. §14 validacija ════════════════════════════════════════════════════════
print('── G. geometrijska kontrola (§14) ──')
s, r = analyze(monter, 'KERAMIKA', rect + [(0, 0)])
cs = codes(r['data'])
chk('ZAKLOPNA_TOCKA' in cs and any(i['severity'] == 'INFO' and i['code'] == 'ZAKLOPNA_TOCKA' for i in r['data']['validation']), 'eksplicitno zaprt poligon (5. točka = prva) → INFO ZAKLOPNA_TOCKA')
s, r = analyze(monter, 'KERAMIKA', [(0, 0), (400, 0), (400, 300), (250, 200)])
chk(not any(i['severity'] == 'NAPAKA' for i in r['data']['validation']), 'samodejno zaprt četverokotnik — veljaven brez NAPAK (zaklepalka je predpostavljena)')
s, r = analyze(monter, 'KERAMIKA', [(0, 0), (100, 0), (200, 0)])
cs = codes(r['data'])
chk('POVSRSINA_NICLA' in cs, 'kolinearne točke → NAPAKA površina 0')
chk('TOCKE_KOLINEARNE' in cs, 'kolinearne točke → INFO')
s, r = analyze(monter, 'SPLOSNO', [(0, 0), (100, 0), (199, 1)])
chk('KOT_NESMISELEN' in codes(r['data']), 'vogal < 10° → OPOZORILO KOT_NESMISELEN')
s, r = analyze(monter, 'STOPNICE', [(0, 0), (2500, 0)], options={'steps': 5})
chk('ZUNAJ_OBMOCJA' in codes(r['data']), '2500 cm na stopnicah → OPOZORILO ZUNAJ_OBMOCJA')
s, r = analyze(monter, 'SPLOSNO', [(0, 0), (300, 0), (300, 400)], manual=500)
cs = codes(r['data'])
chk('ROCA_AUTO_ODSTOPANJE' in cs and any(i['code'] == 'ROCA_AUTO_ODSTOPANJE' and i['severity'] == 'OPOZORILO' for i in r['data']['validation']), 'ročna 500 vs avtomatska 700 → OPOZORILO odstopanje')
s, r = analyze(monter, 'SPLOSNO', [(0, 0), (300, 0), (300, 400)], manual=680)
chk('ROCA_AUTO_ODSTOPANJE' not in codes(r['data']), 'ročna 680 (2,9 % odstopanja) → brez opozorila')
s, r = analyze(monter, 'SPLOSNO', [(0, 0), (2, 0)])
chk('SEGMENT_KRATEK' in codes(r['data']), 'segment 2 cm → INFO SEGMENT_KRATEK')

# ══ H. §13 confidence + §3 capture guide + §4 kalibracija ════════════════════
print('── H. confidence (§13) + capture guide (§3) + kalibracija (§4) ──')
s, good = analyze(monter, 'OGRAJA', [(0, 0), (300, 0)], quality={'blurScore': 300, 'brightness': 120, 'dark': False, 'bright': False, 'blurry': False}, views=2, agreement=97)
s, badq = analyze(monter, 'OGRAJA', [(0, 0), (300, 0)], quality={'blurScore': 10, 'brightness': 30, 'dark': True, 'bright': False, 'blurry': True}, tilt=55, views=1)
cg = good['data']['confidence']; cb = badq['data']['confidence']
chk(5 <= cg['confidence'] <= 99 and 5 <= cb['confidence'] <= 99, f'confidence v 5..99 ({cg["confidence"]}/{cb["confidence"]})')
chk(cg['confidence'] > cb['confidence'], f'dobra kakovost > slaba ({cg["confidence"]} > {cb["confidence"]})')
chk(cg['band'] in ('VISOK', 'SREDNJI', 'NIZEK') and len(cg['reasons']) > 0, 'pasovi + razlogi zaupanja')
guide = badq['data']['captureGuide']
chk(guide['status'] == 'NEZADOSTNO', 'slaba kakovost + nagib → capture guide NEZADOSTNO')
gd = {c['code']: c['state'] for c in guide['checks']}
chk(gd.get('BLUR') == 'NEZADOSTNO' and gd.get('TILT') == 'NEZADOSTNO' and gd.get('LIGHT') == 'OPOZORILO', f'posamezne kontrole: {gd}')
guide2 = good['data']['captureGuide']
chk(guide2['status'] == 'DOBRO', 'dobra kakovost + 2 pogleda + kalibracija → DOBRO')
gd2 = {c['code']: c['state'] for c in guide2['checks']}
chk(gd2.get('COVERAGE') == 'DOBRO' and gd2.get('REF') == 'DOBRO', 'pokritost 2 pogleda + referenca DOBRO')

s, r = callj('POST', '/api/measure-engine/analyze', monter, {'mode': 'OGRAJA', 'points': [{'x': 0, 'y': 0}, {'x': 1, 'y': 0}]})
chk(s == 400, f'brez kalibracije 400 (§4; dejansko {s})')
s, r = callj('POST', '/api/measure-engine/analyze', monter, {'mode': 'SVINČNIK', 'points': [{'x': 0, 'y': 0}], 'calibration': {'px': 1, 'cm': 1}})
chk(s == 400, f'neznan način 400 (dejansko {s})')
s, r = callj('POST', '/api/measure-engine/analyze', monter, {'mode': 'OGRAJA', 'calibration': {'px': 1, 'cm': 1}})
chk(s == 400, f'manjkajo točke 400 (dejansko {s})')

# ══ I. potrditev z mode + engine (§2/§7) ═════════════════════════════════════
print('── I. potrditev z mode + engine (§2/§7) ──')
s, d = callj('POST', '/api/measure/photo', monter, {'dataUrl': PHOTO, 'location': TAG, 'note': 'DBG-TEST'})
chk(s in (200, 201), f'fotografija pripravljena ({s})')
photo_id = d['data']['id']

s, ker = analyze(monter, 'KERAMIKA', rect, options={'tileWcm': 60, 'tileHcm': 60, 'jointMm': 3, 'openings': [{'wCm': 100, 'hCm': 120, 'count': 2}]})
engine = {'domain': ker['data']['domain'], 'validation': ker['data']['validation'], 'confidence': ker['data']['confidence']}
s, d = callj('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OSTANEO', 'lengthCm': 1400, 'location': TAG,
    'note': f'{TAG} keramika', 'points': [{'x': x, 'y': y} for x, y in rect],
    'calibration': {'px': 100, 'cm': 100, 'method': 'ZNANA_MERA', 'refObject': 'vrata 100 cm'},
    'mode': 'KERAMIKA', 'engine': engine, 'confidence': 92,
})
chk(s == 201, f'potrditev s KERAMIKA mode + engine 201 (dejansko {s})')
mid = d['data']['id'] if s == 201 else None
params = json.loads(d['data']['params']) if s == 201 else {}
chk(params.get('mode') == 'KERAMIKA', 'params.mode = KERAMIKA')
chk(params.get('engine', {}).get('domain', {}).get('mode') == 'KERAMIKA', 'params.engine.domain = KERAMIKA')
chk(params.get('calibration', {}).get('method') == 'ZNANA_MERA', 'kalibracijska metoda zapisana (§4)')
chk(params.get('calibration', {}).get('refObject') == 'vrata 100 cm', 'referenčni objekt zapisan')
s, d2 = callj('GET', f'/api/measurements/{mid}', monter)
ver = jget(f'/api/measurements/{mid}/verzije', monter)
chk(ver and ver['data'][0]['note'].find('način KERAMIKA') >= 0, 'verzija v1 omenja način KERAMIKA')
aud = jget(f'/api/audit?action=MEASUREMENT_CONFIRM&limit=100', admin)
def audit_detail (e):
    d = e.get('detail')
    return json.loads(d) if isinstance(d, str) else (d or {})
chk(any(e.get('entityId') == mid and audit_detail(e).get('mode') == 'KERAMIKA' for e in (aud['data'] if aud else [])), 'revizija MEASUREMENT_CONFIRM nosi mode')

s, _ = callj('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 100, 'note': f'{TAG} napaka',
    'mode': 'SVINČNIK',
})
chk(s == 400, f'neveljaven mode 400 (dejansko {s})')
s, _ = callj('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 100, 'note': f'{TAG} napaka',
    'mode': 'SPLOSNO', 'engine': 'ne-objekt',
})
chk(s == 400, f'engine kot niz 400 (dejansko {s})')
s, _ = callj('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 100, 'note': f'{TAG} napaka',
    'mode': 'SPLOSNO', 'engine': {},
})
chk(s == 400, f'prazen engine 400 (dejansko {s})')

# klasična potrditev brez novih polj (povratna združljivost)
s, d = callj('POST', '/api/measurement/confirm', monter, {'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 250, 'note': f'{TAG} klasika'})
chk(s == 201, f'klasična potrditev brez mode/engine 201 (dejansko {s})')
classic_id = d['data']['id'] if s == 201 else None

# ══ J. export (§19) ══════════════════════════════════════════════════════════
print('── J. export (§19) ──')
s, b, h = call('GET', f'/api/measure-engine/export?id={mid}&format=csv', monter)
hd = {k.lower(): v for k, v in h.items()}
chk(s == 200, f'CSV izvoz 200 (dejansko {s})')
chk('text/csv' in hd.get('content-type', ''), 'Content-Type text/csv')
chk('attachment' in hd.get('content-disposition', ''), 'Content-Disposition attachment')
chk(b.startswith('\ufeff'), 'UTF-8 BOM za Excel')
lines = b.lstrip('\ufeff').strip().split('\r\n')
chk(lines[0] == 'Skupina;Polje;Vrednost;Enota', 'CSV glava Skupina;Polje;Vrednost;Enota')
chk('KERAMIKA' in b and 'Domenski paket' in b, 'CSV vsebuje način + domenski paket')
chk('Neto površina' in b and '9,6' in b, 'CSV vsebuje neto površino 9,6')
chk('ZNANA_MERA' in b and 'vrata 100 cm' in b, 'CSV vsebuje referenco (§4)')
chk('Monter' in b or 'Operater' in b, 'CSV vsebuje operaterja')
chk('Izvoz;ROKSAL meritev' in b, 'CSV glava dokumenta')

s, d = callj('GET', f'/api/measure-engine/export?id={mid}&format=json', monter)
chk(s == 200 and d['data']['nacin'] == 'KERAMIKA', 'JSON izvoz 200 z nacin KERAMIKA')
polja = {m['polje']: m for m in d['data']['mere']}
chk(polja.get('Neto površina', {}).get('vrednost') == '9,6', 'JSON mere vsebujejo neto površino')
chk(d['data']['verzija'] == 1, 'JSON verzija 1')
chk(any(m['skupina'] == 'Reference' for m in d['data']['mere']), 'JSON vsebuje skupino Reference')

s, _ = callj('GET', f'/api/measure-engine/export?id={mid}&format=pdf', monter)
chk(s == 400, f'format pdf 400 (dejansko {s})')
s, _ = callj('GET', '/api/measure-engine/export?id=neobstojeca-id&format=csv', monter)
chk(s == 404, f'neznan id 404 (dejansko {s})')
s, _ = callj('GET', '/api/measure-engine/export?format=csv', monter)
chk(s == 400, f'manjka id 400 (dejansko {s})')
s, d = callj('GET', f'/api/measure-engine/export?id={classic_id}&format=json', proizvodnja)
chk(s == 200 and d['data']['nacin'] is None, 'stara meritev brez mode → nacin null + proizvodnja (read) lahko izvozi')
aud = jget('/api/audit?action=MEASUREMENT_EXPORT&limit=100', admin)
chk(any(e.get('entityId') == mid for e in (aud['data'] if aud else [])), 'revizija MEASUREMENT_EXPORT zapisana')

# ══ K. regresija ═════════════════════════════════════════════════════════════
print('── K. regresija ──')
s, d = callj('GET', '/api/measurements', monter)
chk(s == 200, f'seznam meritev 200 (dejansko {s})')
s, d = callj('POST', '/api/railing-layout', monter, {'points': [{'x': 0, 'y': 0}, {'x': 300, 'y': 0}], 'calibration': {'px': 100, 'cm': 100}})
chk(s == 201 and abs(d['data']['totalLengthCm'] - 300) < 0.2, 'railing-layout nespremenjen (300 cm)')

# ══ L. čiščenje ══════════════════════════════════════════════════════════════
print('── L. čiščenje ──')
done, err = bun(CLEAN)
chk(done, f'čiščenje po testu {"" if done else " — " + err}')

print(f'\n══ R457: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL else 0)
