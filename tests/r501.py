#!/usr/bin/env python3
"""tests/r501.py — R501 (issue #15 Faza 1 + začetek Faze 2 — MERILNA
NATANČNOST: perspektiva, eksplicitno merilo, strežniški preračun).

Preverja:
  A) RBAC (fail-closed): brez žetona 401 na /api/measure-engine/analyze.
  B) PERSPEKTIVNA RAVNINA (plane: 4 vogali znanega pravokotnika + dimenziji):
     sintetična projektivna kamera (znana homografija Ht) preslika ravnino
     200×100 cm v sliko; analiza mora iz merjenih točk izračunati PRAVO
     dolžino (111,80 cm) z napako < 1 % — numerični dokaz, da perspektivna
     rectifikacija deluje (isti rezultat kot UNIFORM bi odstopal > 20 %);
     • scale.mode = 'PLANE', scale.valid = true;
     • diagnostika: NEZADOSTNI_PODATKI se NE pojavi; MERITEV_NA_RAVNINI INFO DA.
  C) EKSPlicitno merilo — neveljavni vhodi:
     • brez calibration → 400 (parseCalib zavrne);
     • plane s 3 kolinearnimi vogali → NEZADOSTNI_PODATKI NAPAKA +
       scale.valid = false (pošteno poročilo, ne tiho 1 cm/px);
     • plane z manjkajočo dimenzijo → 400 (strukturna kontrola).
  D) PREDPOSTAVKA_FRONTALNOST: UNIFORM + tiltDeg 20° → OPOZORILO z
     navodilom; tiltDeg 35° → NAPAKA (poševna slika ni potrjena mera);
     UNIFORM brez znanega nagiba → predpostavka izrecna v
     scale.assumedFrontal = true (NE v validaciji).
  E) STREŽNIŠKI PRERAČUN JE AVTORITETA (confirm):
     • PLANE kalibracija + usklajena lengthCm → 201 + params.measureStatus =
       'CALIBRATED' + params.calibration.plane persistiran (revizija);
     • neusklajena lengthCm (± 30 %) → 409, meritev NI ustvarjena;
     • točke brez kalibracije → 400 (brez reference ni potrjene mere).
  F) IZVOZ: CSV izvoz PLANE meritve vsebuje Ravnina (pravokotnik) +
     Status mere KALIBRIRANA; UNIFORM izvoz nosi Predpostavka frontalnost.
  G) bun — resolveScale/planeHomography (lib, čiste funkcije): UNIFORM
     veljaven/neveljaven (0/1 ne glede na predpostavko), PLANE degeneriran →
     null homografija; determinizem (isti vhodi → isti H).
  H) UI-nizi (source grep): perspektivna ravnina v kameri, LIDAR NI
     izbirljiv (selectable filter), predpostavka frontalnosti prikazana.
  I) Idempotentno čiščenje ×2 (direktno prek Prisma).

Issue #15 Faza 1 kriterij: »enaka vhodna fotografija, točke in reference dajo
ponovljiv rezultat; poševna slika ne uporablja lažnega globalnega merila;
neveljavna kalibracija ne more ustvariti potrjene mere.«
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R501-TEST'
PASS, FAIL = 0, 0

def ok (msg):
    global PASS; PASS += 1; print(f'  ✓ {msg}')

def bad (msg):
    global FAIL; FAIL += 1; print(f'  ✗ {msg}')

def chk (cond, msg): ok(msg) if cond else bad(msg)

def callraw (method, path, token=None, body=None, timeout=40):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e:
        return 0, str(e)

def callj (method, path, token=None, body=None, timeout=40):
    s, b = callraw(method, path, token, body, timeout)
    try: return s, json.loads(b)
    except Exception: return s, {}

def login (email, pw):
    s, d = callj('POST', '/api/auth/login', body={'email': email, 'password': pw})
    return d.get('token') if s == 200 else None

def bun_ts (script):
    env_url = os.environ.get('DATABASE_URL') or ''
    if not env_url.startswith(('postgresql://', 'postgres://')):
        env_url = ''
    db_url = os.environ.get('TEST_DB_URL') or env_url or 'postgresql://roksal:roksal@localhost:54329/roksal'
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       cwd=REPO, env={**os.environ, 'DATABASE_URL': db_url})
    return r.stdout, r.stderr[:800]

def src_has (relpath, needle):
    try:
        with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
            return needle in f.read()
    except Exception:
        return False

def meas_params (mid):
    out, _ = bun_ts(f"""
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
p.measurement.findUnique({{where:{{id:'{mid}'}},select:{{params:true,lengthCm:true}}}}).then(r=>{{
console.log(JSON.stringify(r));return p.$disconnect()}})""")
    try: return json.loads(out)
    except Exception: return {}

# ═════════════════════════════ SINTETIČNA KAMERA ═════════════════════════════
# Projektivna preslikava ravnina (cm) → slika (px): znana homografija Ht.
# Izbrana tako, da je očitno NE-frontalna (perspektivna popačenja po oseh).
HT = [1.0, 0.3, 40, 0.15, 1.4, 30, 0.0008, 0.0004, 1]
IMG_W, IMG_H = 1000.0, 800.0
# referenčni pravokotnik NA ravnini: 200 × 100 cm
PLANE_W, PLANE_H = 200.0, 100.0

def project (hx, hy):
    """ravnina (cm) → slika (px) prek Ht, nato normalizirano 0..1."""
    w = HT[6] * hx + HT[7] * hy + HT[8]
    x = (HT[0] * hx + HT[1] * hy + HT[2]) / w
    y = (HT[3] * hx + HT[4] * hy + HT[5]) / w
    return {'x': round(x / IMG_W, 6), 'y': round(y / IMG_H, 6)}

# 4 vogali referenčnega pravokotnika (zg-levo → zg-desno → sp-desno → sp-levo)
CORNERS = [project(0, 0), project(PLANE_W, 0), project(PLANE_W, PLANE_H), project(0, PLANE_H)]
# merjeni točki NA ravnini: A=(50,25), B=(150,75) → prava razdalja √(100²+50²)
A = project(50, 25); B = project(150, 75)
TRUE_LEN = (100 ** 2 + 50 ** 2) ** 0.5  # 111,803 cm
# za primerjavo: UNIFORM na isti sliki bi dal 137,1 cm (22,6 % napake) —
# dokaz, da globalno merilo pri poševnem posnetku LAŽE

# ═══════════════════════════════════ TEST ═══════════════════════════════════

print('════ R501 — merilna natančnost: perspektiva + eksplicitno merilo ════')

admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
print('── prijava: admin / monter ──')
chk(admin is not None and monter is not None, 'prijava 2 vlogi')

print('── A) RBAC (fail-closed)')
s, _ = callj('POST', '/api/measure-engine/analyze', body={'mode': 'OGRAJA', 'points': [A, B], 'calibration': {'px': 100, 'cm': 50}})
chk(s == 401, f'brez žetona 401 ({s})')

PLANE_CAL = {'px': 0, 'cm': 0, 'imgW': int(IMG_W), 'imgH': int(IMG_H), 'method': 'RAVNINA',
             'refObject': 'testna vrata 200×100',
             'plane': {'points': CORNERS, 'widthCm': PLANE_W, 'heightCm': PLANE_H}}

print('── B) perspektivna ravnina — numerični dokaz')
s, d = callj('POST', '/api/measure-engine/analyze', monter, {
    'mode': 'OGRAJA', 'points': [A, B], 'calibration': PLANE_CAL})
chk(s == 200, f'analiza s perspektivno ravnino 200 ({s})')
if s == 200:
    r = d.get('data', {})
    g = r.get('geometry', {})
    got = g.get('totalLengthCm')
    err = abs(got - TRUE_LEN) / TRUE_LEN * 100 if got else 100
    chk(got is not None and err < 1.0, f'perspektivno rectificirana dolžina {got} cm ≈ prava {TRUE_LEN:.2f} cm (napaka {err:.2f} % < 1 %)')
    chk(g.get('calibrated') is True, f'geometry.calibrated = true ({g.get("calibrated")})')
    sc = r.get('scale', {})
    chk(sc.get('mode') == 'PLANE' and sc.get('valid') is True, f'scale.mode = PLANE + valid ({sc.get("mode")}/{sc.get("valid")})')
    chk(sc.get('cmPerPx') is None, 'scale.cmPerPx = null pri ravnini (ni globalnega merila)')
    codes = [i.get('code') for i in r.get('validation', [])]
    chk('NEZADOSTNI_PODATKI' not in codes, f'ni NEZADOSTNI_PODATKI ({codes})')
    chk('MERITEV_NA_RAVNINI' in codes, 'MERITEV_NA_RAVNINI (mere veljajo na ravnini) je izrecno')
    # tudi segment/diagonal osvežen na rectificiranih koordinatah
    seg0 = (g.get('segments') or [{}])[0]
    chk(abs((seg0.get('lengthCm') or 0) - TRUE_LEN) < 1.2, f'segment[0].lengthCm ≈ {TRUE_LEN:.1f} ({seg0.get("lengthCm")})')

print('── C) eksplicitno merilo — neveljavni vhodi')
s, d = callj('POST', '/api/measure-engine/analyze', monter, {
    'mode': 'OGRAJA', 'points': [A, B], 'calibration': {'px': 0, 'cm': 0}})
chk(s == 400, f'kalibracija px=0/cm=0 brez ravnine → 400 ({s})')
s, d = callj('POST', '/api/measure-engine/analyze', monter, {
    'mode': 'OGRAJA', 'points': [A, B]})
chk(s == 400, f'brez calibration → 400 ({s})')
# 3 kolinearni vogali → homografija degenerirana → NEZADOSTNI_PODATKI (pošteno)
col = [{'x': 0.1, 'y': 0.5}, {'x': 0.2, 'y': 0.5}, {'x': 0.3, 'y': 0.5}, {'x': 0.4, 'y': 0.5}]
s, d = callj('POST', '/api/measure-engine/analyze', monter, {
    'mode': 'OGRAJA', 'points': [A, B],
    'calibration': {**PLANE_CAL, 'plane': {'points': col, 'widthCm': 200, 'heightCm': 100}}})
chk(s == 200, f'kolinearna ravnina → analiza 200 s poročilom (ne tiha zavrnitev) ({s})')
if s == 200:
    r = d.get('data', {})
    codes = [(i.get('code'), i.get('severity')) for i in r.get('validation', [])]
    chk(('NEZADOSTNI_PODATKI', 'NAPAKA') in codes, f'NEZADOSTNI_PODATKI NAPAKA pri degenerirani ravnini ({codes})')
    chk(r.get('scale', {}).get('valid') is False, 'scale.valid = false pri degeneraciji')
    chk(r.get('geometry', {}).get('totalLengthCm') == 0, 'neveljavno merilo → 0 cm (NE tihi px×1)')
# manjkajoča dimenzija → strukturna kontrola 400
s, d = callj('POST', '/api/measure-engine/analyze', monter, {
    'mode': 'OGRAJA', 'points': [A, B],
    'calibration': {**PLANE_CAL, 'plane': {'points': CORNERS, 'widthCm': 200, 'heightCm': 0}}})
chk(s == 400, f'ravnina z višino 0 → 400 ({s})')

print('── D) predpostavka frontalnosti (UNIFORM)')
UNI = {'px': 800, 'cm': 200, 'imgW': int(IMG_W), 'imgH': int(IMG_H), 'method': 'ZNANA_MERA'}
s, d = callj('POST', '/api/measure-engine/analyze', monter, {
    'mode': 'OGRAJA', 'points': [A, B], 'calibration': UNI, 'tiltDeg': 20})
if s == 200:
    codes = [(i.get('code'), i.get('severity')) for i in d.get('data', {}).get('validation', [])]
    chk(('PREDPOSTAVKA_FRONTALNOST', 'OPOZORILO') in codes, f'tilt 20° → OPOZORILO o predpostavki ({codes})')
else:
    bad(f'uniform tilt 20 analiza 200 ({s})')
s, d = callj('POST', '/api/measure-engine/analyze', monter, {
    'mode': 'OGRAJA', 'points': [A, B], 'calibration': UNI, 'tiltDeg': 35})
if s == 200:
    codes = [(i.get('code'), i.get('severity')) for i in d.get('data', {}).get('validation', [])]
    chk(('PREDPOSTAVKA_FRONTALNOST', 'NAPAKA') in codes, f'tilt 35° → NAPAKA (ni potrjena mera) ({codes})')
else:
    bad(f'uniform tilt 35 analiza 200 ({s})')
s, d = callj('POST', '/api/measure-engine/analyze', monter, {
    'mode': 'OGRAJA', 'points': [A, B], 'calibration': UNI})
if s == 200:
    sc = d.get('data', {}).get('scale', {})
    chk(sc.get('assumedFrontal') is True, f'neznan kot → scale.assumedFrontal = true ({sc.get("assumedFrontal")})')
    codes = [i.get('code') for i in d.get('data', {}).get('validation', [])]
    chk('PREDPOSTAVKA_FRONTALNOST' not in codes, 'neznan kot NE povzroča validacijske ugotovitve (predpostavka živi v scale)')
else:
    bad(f'uniform brez tilt analiza 200 ({s})')

print('── E) strežniški preračun je avtoriteta (confirm)')
PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='
s, d = callj('POST', '/api/measurements', monter, {
    'type': 'FOTO', 'params': json.dumps({'photo': PHOTO}), 'location': f'{TAG} teren',
    'note': f'{TAG} foto osnova'})
chk(s == 201, f'FOTO osnova ustvarjena ({s})')
photo_id = (d.get('data') or {}).get('id')

# PLANE + usklajena dolžina → 201 + CALIBRATED + plane persistiran
# (kot UI: najprej analiza, nato confirm z engine paketom vključno scale)
s, d = callj('POST', '/api/measure-engine/analyze', monter, {
    'mode': 'OGRAJA', 'points': [A, B], 'calibration': PLANE_CAL})
chk(s == 200, f'analiza s perspektivno ravnino (engine osnova) 200 ({s})')
eng_plane = {} if s != 200 else {'domain': d['data']['domain'], 'validation': d['data']['validation'], 'confidence': d['data']['confidence'], 'scale': d['data']['scale']}
s, d = callj('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA',
    'lengthCm': round(TRUE_LEN, 1), 'location': f'{TAG} ravnina',
    'points': [A, B], 'calibration': PLANE_CAL,
    'mode': 'OGRAJA', 'engine': eng_plane,
    'note': f'{TAG} plane-ok'})
chk(s == 201, f'confirm s perspektivno ravnino + usklajeno dolžino 201 ({s}: {json.dumps(d)[:160] if s != 201 else ""})')
M1 = d.get('data', {}).get('id') if s == 201 else None
if M1:
    row = meas_params(M1)
    pr = json.loads(row.get('params') or '{}')
    chk(pr.get('measureStatus') == 'CALIBRATED', f'params.measureStatus = CALIBRATED ({pr.get("measureStatus")})')
    pl = ((pr.get('calibration') or {}).get('plane') or {})
    chk(pl.get('widthCm') == PLANE_W and pl.get('heightCm') == PLANE_H and len(pl.get('points') or []) == 4,
        f'params.calibration.plane persistiran za revizijo ({json.dumps(pl)[:120]})')
    chk(abs((row.get('lengthCm') or 0) - TRUE_LEN) < 1.0, f'lengthCm ≈ prava dolžina ({row.get("lengthCm")} vs {TRUE_LEN:.1f})')

# neusklajena dolžina → 409 (vrata)
s, d = callj('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA',
    'lengthCm': 200.0, 'location': f'{TAG} neusklajeno',
    'points': [A, B], 'calibration': PLANE_CAL,
    'note': f'{TAG} plane-409'})
chk(s == 409, f'neusklajena lengthCm (200 vs {TRUE_LEN:.1f}) → 409 ({s})')
if s == 409:
    det = d.get('detail') or ''
    chk('111,8' in det, f'409 navaja strežniški preračun ({det[:80]})')

# točke brez kalibracije → 400
s, d = callj('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 150.0,
    'location': f'{TAG} brez kalibracije', 'points': [A, B],
    'note': f'{TAG} brez-ref'})
chk(s == 400, f'točke brez kalibracije → 400 ({s})')

# UNIFORM usklajen (r487 vzorec) → 201 + engine.scale v reviziji (kot UI pošlje)
s, d = callj('POST', '/api/measure-engine/analyze', monter, {
    'mode': 'OGRAJA', 'points': [{'x': 0.1, 'y': 0.5}, {'x': 0.9, 'y': 0.5}],
    'calibration': {'px': 400, 'cm': 200, 'imgW': 1000, 'imgH': 800, 'method': 'ZNANA_MERA'}})
chk(s == 200, f'analiza za engine paket 200 ({s})')
eng = {} if s != 200 else {'domain': d['data']['domain'], 'validation': d['data']['validation'], 'confidence': d['data']['confidence'], 'scale': d['data']['scale']}
s, d = callj('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 400,
    'location': f'{TAG} uniform',
    'points': [{'x': 0.1, 'y': 0.5}, {'x': 0.9, 'y': 0.5}],
    'calibration': {'px': 400, 'cm': 200, 'imgW': 1000, 'imgH': 800, 'method': 'ZNANA_MERA'},
    'mode': 'OGRAJA', 'engine': eng,
    'note': f'{TAG} uniform-ok'})
chk(s == 201, f'confirm UNIFORM usklajen 201 ({s})')
M2 = d.get('data', {}).get('id') if s == 201 else None

print('── F) izvoz — status mere + vrsta merila')
if M1:
    s, b, = callraw('GET', f'/api/measure-engine/export?id={M1}&format=csv', monter)
    chk(s == 200, f'CSV izvoz PLANE meritve 200 ({s})')
    if s == 200:
        chk('Ravnina (pravokotnik)' in b, 'CSV vsebuje vrstico Ravnina (pravokotnik)')
        chk('KALIBRIRANA' in b, 'CSV vsebuje Status mere KALIBRIRANA')
        chk('perspektivna ravnina (homografija)' in b, 'CSV navaja vrsto merila (homografija)')
if M2:
    s, b, = callraw('GET', f'/api/measure-engine/export?id={M2}&format=csv', monter)
    chk(s == 200, f'CSV izvoz UNIFORM meritve 200 ({s})')
    if s == 200:
        chk('Predpostavka' in b and 'frontalen posnetek' in b, 'CSV UNIFORM navaja predpostavko frontalnosti')

print('── G) bun — čiste funkcije (resolveScale/planeHomography)')
out, err = bun_ts("""
const m = require('./src/lib/measure-engine.ts')
// UNIFORM veljaven
const u = m.resolveScale({px: 800, cm: 200})
console.log(JSON.stringify({uValid: u.valid, uMode: u.mode, uCm: u.cmPerPx, uFrontal: u.assumedFrontal}))
// UNIFORM neveljaven (prej: tihi 1 cm/px!)
const bad = m.resolveScale({px: 0, cm: 0})
console.log(JSON.stringify({bValid: bad.valid, bCm: bad.cmPerPx, bReason: typeof bad.reason === 'string'}))
// PLANE degeneriran → null H
const deg = m.planeHomography([{x:0,y:0},{x:10,y:0},{x:20,y:0},{x:30,y:0}], 200, 100)
console.log(JSON.stringify({deg: deg === null}))
// determinizem: isti vogali → ista H
const c = [{x:40,y:30},{x:206.9,y:51.72},{x:225,y:166.67},{x:67.31,y:163.46}]
const h1 = m.planeHomography(c, 200, 100); const h2 = m.planeHomography(c, 200, 100)
console.log(JSON.stringify({det: JSON.stringify(h1) === JSON.stringify(h2)}))
""")
try:
    lines = [json.loads(l) for l in out.strip().split('\n') if l.strip()]
    o = {}
    for l in lines: o.update(l)
    chk(o.get('uValid') is True and o.get('uMode') == 'UNIFORM' and abs((o.get('uCm') or 0) - 0.25) < 1e-9, f'UNIFORM: valid/mode/cmPerPx ({o.get("uValid")}/{o.get("uMode")}/{o.get("uCm")})')
    chk(o.get('uFrontal') is True, 'UNIFORM brez frontalDeg → assumedFrontal (izrecna predpostavka)')
    chk(o.get('bValid') is False and o.get('bCm') is None and o.get('bReason') is True, f'neveljavna kalibracija: valid=false, cmPerPx=null, razlog da ({o.get("bValid")}/{o.get("bCm")}/{o.get("bReason")})')
    chk(o.get('deg') is True, 'kolinearni vogali → planeHomography null')
    chk(o.get('det') is True, 'determinizem: isti vogali → ista homografija')
except Exception as e:
    bad(f'bun izhod neberljiv: {e} / {out[:200]} / {err[:200]}')

print('── H) UI-nizi (source grep)')
chk(src_has('src/components/roksal/modules/meritve-kamera.tsx', 'Postavi ravnino'), 'kamera: gumb Postavi ravnino')
chk(src_has('src/components/roksal/modules/meritve-kamera.tsx', 'perspektivno rectificirano'), 'kamera: prikaz perspektivne kalibracije')
chk(src_has('src/components/roksal/modules/meritve-kamera.tsx', "m.selectable)"), 'kamera: LIDAR filtriran iz izbire (selectable)')
chk(src_has('src/components/roksal/modules/meritve-kamera.tsx', 'predpostavka frontalnosti'), 'kamera: predpostavka frontalnosti prikazana')
chk(src_has('src/lib/measure-engine.ts', 'NEZADOSTNI_PODATKI'), 'engine: NEZADOSTNI_PODATKI koda')
chk(src_has('src/lib/measure-engine.ts', 'PREDPOSTAVKA_FRONTALNOST'), 'engine: PREDPOSTAVKA_FRONTALNOST koda')

print('── I) idempotentno čiščenje ×2')
CLEAN_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const ms=await p.measurement.findMany({where:{note:{contains:'__TAG__'}},select:{id:true}});
  for (const m of ms) {
    await p.projectPackage.updateMany({where:{measurementId:m.id},data:{measurementId:null}});
    await p.measurementVersion.deleteMany({where:{measurementId:m.id}});
    await p.notificationDelivery.deleteMany({where:{event:{key:{contains:':'+m.id}}}});
    await p.notificationEvent.deleteMany({where:{key:{contains:':'+m.id}}});
    await p.measurement.delete({where:{id:m.id}});
  }
  await p.auditLog.deleteMany({where:{detail:{contains:'__TAG__'}}});
  await p.auditLog.deleteMany({where:{entityId:{in:ms.map(m=>m.id)}}});
  console.log('CLEAN_DONE');return p.$disconnect();
})()
'''
CLEAN = CLEAN_JS.replace('__TAG__', TAG)
for i in range(2):
    out, err = bun_ts(CLEAN)
    chk('CLEAN_DONE' in out, f'počiščenje testnih zapisov ({i + 1}.) {"" if "CLEAN_DONE" in out else err[:200]}')

print()
print(f'══ R501 REZULTAT: ✓ {PASS} / ✗ {FAIL} ══')
sys.exit(1 if FAIL > 0 else 0)
