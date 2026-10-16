#!/usr/bin/env python3
"""tests/r513.py — R513 (konsolidacija: prenos perspektivne ravnine/homografije
iz vzporedne linije main na spojito kodo R512 — issue #15 Faza 1).

Preverja (POGODBA SPOJITE KODE — ScaleModel, ne mainov ScaleInfo):
  A) RBAC (fail-closed): brez žetona 401 na /api/measure-engine/analyze.
  B) PERSPEKTIVNA RAVNINA (plane: 4 vogali znanega pravokotnika + dimenziji):
     sintetična projektivna kamera (znana homografija Ht) preslika ravnino
     200×100 cm v sliko; analiza mora iz merjenih točk izračunati PRAVO
     dolžino (111,80 cm) z napako < 1 % — numerični dokaz, da perspektivna
     rectifikacija deluje (UNIFORM bi na isti sliki odstopal > 20 %);
     • scale.basis = 'RAVNINA', scale.known = true, scale.H ≠ null;
     • geometry.cmPerPx = null (ni globalnega merila — poanta perspektive);
     • validacija: MERITEV_NA_RAVNINI INFO izrecno pove obseg veljavnosti.
  C) EKSPlicitno merilo — neveljavni vhodi:
     • brez calibration ALI px=0/cm=0 brez ravnine → 400;
     • plane s kolinearnimi vogali → 200 + RAVNINA_NERESENLJIVA NAPAKA +
       scale.known = false + totalLengthCm = 0 (pošteno, ne tihi 1 cm/px);
     • plane z višino 0 → 400 (strukturna kontrola).
  D) PREDPOSTAVKA_FRONTALNOST (UNIFORM brez dokaza pravokotnosti):
     tilt 20° → OPOZORILO; tilt 35° → NAPAKA; neznan nagib → predpostavka
     izrecno v scale.basis ENOTNO_BREZ_DOKAZA + razlogu (NE v validaciji).
  E) STREŽNIŠKI PRERAČUN JE AVTORITETA (confirm):
     • PLANE + usklajena lengthCm → 201 + status CALIBRATED (stolpec +
       params.provenance) + params.calibration.plane persistiran (revizija);
     • neusklajena lengthCm (± 79 %) → 409 z navedbo strežniškega izračuna;
     • točke brez kalibracije → 201 + status ESTIMATED (POGODBA veje: ocena
       se shrani pošteno označena, ne zavrže — poslovna vrata so v statusu).
  F) IZVOZ: CSV PLANE meritve vsebuje Ravnina (pravokotnik) + Kalibrirano
     (merilo dokazano) + homografijo v obrazložitvi; UNIFORM nosi predpostavko.
  G) bun — čiste funkcije (resolveScale/planeHomography): UNIFORM veljaven/
     neveljaven, PLANE degeneriran → null H, determinizem (isti vhodi → ista H).
  H) UI-nizi (source grep): Postavi ravnino, perspektivno rectificirano,
     RAVNINA v CALIB_METHODS, PREDPOSTAVKA_FRONTALNOST koda.
  I) Idempotentno čiščenje ×2 (direktno prek Prisma).

Issue #15 Faza 1 kriterij: »enaka vhodna fotografija, točke in reference dajo
ponovljiv rezultat; poševna slika ne uporablja lažnega globalnega merila;
neveljavna kalibracija ne more ustvariti potrjene mere.«
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R513-TEST'
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
        return needle in besedilo
    except Exception:
        return False

def meas_params (mid):
    out, _ = bun_ts(f"""
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
p.measurement.findUnique({{where:{{id:'{mid}'}},select:{{params:true,lengthCm:true,status:true,statusNote:true}}}}).then(r=>{{
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
# za primerjavo: UNIFORM na isti sliki bi dal ≈ 137 cm (> 20 % napake) —
# dokaz, da globalno merilo pri poševnem posnetku LAŽE

# ═══════════════════════════════════ TEST ═══════════════════════════════════

print('════ R513 — konsolidacija: perspektivna ravnina na spojeni kodi ════')

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
    sc = r.get('scale', {})
    chk(sc.get('basis') == 'RAVNINA' and sc.get('known') is True, f'scale.basis = RAVNINA + known ({sc.get("basis")}/{sc.get("known")})')
    chk(isinstance(sc.get('H'), list) and len(sc.get('H') or []) == 9, 'scale.H = 9 elementov homografije')
    chk(g.get('cmPerPx') is None, 'geometry.cmPerPx = null pri ravnini (ni globalnega merila)')
    chk(sc.get('isotropicProven') is True, 'ravnina dokazuje merilo v VSEH smereh (isotropicProven)')
    pr = (sc.get('planeRect') or {})
    chk(abs((pr.get('widthCm') or 0) - PLANE_W) < 1e-9 and abs((pr.get('heightCm') or 0) - PLANE_H) < 1e-9,
        f'planeRect dimenziji za revizijo ({pr.get("widthCm")}×{pr.get("heightCm")})')
    codes = [(i.get('code'), i.get('severity')) for i in r.get('validation', [])]
    chk(('MERITEV_NA_RAVNINI', 'INFO') in codes, f'MERITEV_NA_RAVNINI INFO izrecno ({codes})')
    chk(not any(c == 'MANJKA_KALIBRACIJA' for c, _ in codes), 'ravnina JE veljavna kalibracija (ni MANJKA_KALIBRACIJA)')
    seg0 = (g.get('segments') or [{}])[0]
    chk(abs((seg0.get('lengthCm') or 0) - TRUE_LEN) < 1.2, f'segment[0].lengthCm ≈ {TRUE_LEN:.1f} ({seg0.get("lengthCm")})')

print('── C) eksplicitno merilo — neveljavni vhodi')
s, d = callj('POST', '/api/measure-engine/analyze', monter, {
    'mode': 'OGRAJA', 'points': [A, B], 'calibration': {'px': 0, 'cm': 0}})
chk(s == 400, f'kalibracija px=0/cm=0 brez ravnine → 400 ({s})')
s, d = callj('POST', '/api/measure-engine/analyze', monter, {
    'mode': 'OGRAJA', 'points': [A, B]})
chk(s == 400, f'brez calibration → 400 ({s})')
# kolinearni vogali → homografija degenerirana → poštena NAPAKA (ne tiho 1 cm/px)
col = [{'x': 0.1, 'y': 0.5}, {'x': 0.2, 'y': 0.5}, {'x': 0.3, 'y': 0.5}, {'x': 0.4, 'y': 0.5}]
s, d = callj('POST', '/api/measure-engine/analyze', monter, {
    'mode': 'OGRAJA', 'points': [A, B],
    'calibration': {**PLANE_CAL, 'plane': {'points': col, 'widthCm': 200, 'heightCm': 100}}})
chk(s == 200, f'kolinearna ravnina → analiza 200 s poročilom (ne tiha zavrnitev) ({s})')
if s == 200:
    r = d.get('data', {})
    codes = [(i.get('code'), i.get('severity')) for i in r.get('validation', [])]
    chk(('RAVNINA_NERESENLJIVA', 'NAPAKA') in codes, f'RAVNINA_NERESENLJIVA NAPAKA pri degenerirani ravnini ({codes})')
    chk(r.get('scale', {}).get('known') is False, 'scale.known = false pri degeneraciji')
    chk(r.get('geometry', {}).get('totalLengthCm') == 0, 'neveljavno merilo → 0 cm (NE tihi px×1)')
# manjkajoča dimenzija → strukturna kontrola 400
s, d = callj('POST', '/api/measure-engine/analyze', monter, {
    'mode': 'OGRAJA', 'points': [A, B],
    'calibration': {**PLANE_CAL, 'plane': {'points': CORNERS, 'widthCm': 200, 'heightCm': 0}}})
chk(s == 400, f'ravnina z višino 0 → 400 ({s})')
# 3 točke namesto 4 → strukturna kontrola 400
s, d = callj('POST', '/api/measure-engine/analyze', monter, {
    'mode': 'OGRAJA', 'points': [A, B],
    'calibration': {**PLANE_CAL, 'plane': {'points': CORNERS[:3], 'widthCm': 200, 'heightCm': 100}}})
chk(s == 400, f'ravnina s 3 vogali → 400 ({s})')

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
    chk(sc.get('basis') == 'ENOTNO_BREZ_DOKAZA', f'neznan kot → basis ENOTNO_BREZ_DOKAZA ({sc.get("basis")})')
    razlog = ' '.join(sc.get('reasons') or []).lower()
    chk('predpostavka' in razlog, 'neznan kot → predpostavka izrecna v scale.reasons')
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
    chk(row.get('status') == 'CALIBRATED', f'DB status = CALIBRATED ({row.get("status")})')
    pr = json.loads(row.get('params') or '{}')
    prov = pr.get('provenance') or {}
    chk(prov.get('status') == 'CALIBRATED', f'params.provenance.status = CALIBRATED ({prov.get("status")})')
    # plane je v params.calibration kot JSON string (params nosi number|string)
    pl_raw = (pr.get('calibration') or {}).get('plane')
    pl = json.loads(pl_raw) if isinstance(pl_raw, str) else (pl_raw or {})
    chk(pl.get('widthCm') == PLANE_W and pl.get('heightCm') == PLANE_H and len(pl.get('points') or []) == 4,
        f'params.calibration.plane persistiran za revizijo ({json.dumps(pl)[:120]})')
    chk(abs((row.get('lengthCm') or 0) - TRUE_LEN) < 1.0, f'lengthCm ≈ prava dolžina ({row.get("lengthCm")} vs {TRUE_LEN:.1f})')
    sc2 = ((pr.get('engine') or {}).get('scale') or {})
    chk(sc2.get('basis') == 'RAVNINA', f'params.engine.scale.basis = RAVNINA v reviziji ({sc2.get("basis")})')

# neusklajena dolžina → 409 (vrata strežniškega preračuna)
s, d = callj('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA',
    'lengthCm': 200.0, 'location': f'{TAG} neusklajeno',
    'points': [A, B], 'calibration': PLANE_CAL,
    'note': f'{TAG} plane-409'})
chk(s == 409, f'neusklajena lengthCm (200 vs {TRUE_LEN:.1f}) → 409 ({s})')
if s == 409:
    det = d.get('detail') or ''
    chk('111,8' in det, f'409 navaja strežniški preračun z vejico ({det[:90]})')

# točke brez kalibracije → POŠTENA POGODBA SPOJITE VEJE: 201 + status ESTIMATED
# (main je zavrgel z 400; veja shrani kot OCENO — poslovna vrata so v statusu,
# ne v zavrnitvi — izvedba issue #15 H2)
s, d = callj('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 150.0,
    'location': f'{TAG} brez kalibracije', 'points': [A, B],
    'note': f'{TAG} brez-ref'})
chk(s == 201, f'točke brez kalibracije → 201 z oceno ({s})')
M0 = d.get('data', {}).get('id') if s == 201 else None
if M0:
    row0 = meas_params(M0)
    chk(row0.get('status') == 'ESTIMATED', f'brez kalibracije → status ESTIMATED, ne poslovna mera ({row0.get("status")})')

# UNIFORM usklajen → 201 + engine.scale v reviziji (kot UI pošlje)
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
        chk('Kalibrirano (merilo dokazano)' in b, 'CSV vsebuje Stanje zapisa: Kalibrirano (merilo dokazano)')
        chk('homografija' in b, 'CSV obrazložitev navaja homografijo')
        chk('RAVNINA' in b, 'CSV navaja bazo merila RAVNINA')
if M2:
    s, b, = callraw('GET', f'/api/measure-engine/export?id={M2}&format=csv', monter)
    chk(s == 200, f'CSV izvoz UNIFORM meritve 200 ({s})')
    if s == 200:
        chk('predpostavka' in b.lower(), 'CSV UNIFORM navaja predpostavko (ni dokazano merilo)')

print('── G) bun — čiste funkcije (resolveScale/planeHomography)')
out, err = bun_ts("""
const m = require('./src/lib/measure-engine.ts')
// UNIFORM veljaven
const u = m.resolveScale({px: 800, cm: 200})
console.log(JSON.stringify({uKnown: u.known, uBasis: u.basis, uCmX: u.cmPerPxX, uH: u.H}))
// UNIFORM neveljaven (prej: tihi 1 cm/px!)
const bad = m.resolveScale({px: 0, cm: 0})
console.log(JSON.stringify({bKnown: bad.known, bCmX: bad.cmPerPxX, bReason: (bad.reasons||[]).length > 0}))
// PLANE degeneriran → null H
const deg = m.planeHomography([{x:0,y:0},{x:10,y:0},{x:20,y:0},{x:30,y:0}], 200, 100)
console.log(JSON.stringify({deg: deg === null}))
// PLANE veljaven → H (normalizirane točke prek imgW/imgH pretvori JEDRO)
const pl = m.resolveScale({px: 0, cm: 0, imgW: 1000, imgH: 800, plane: {points: [{x:0.04,y:0.0375},{x:0.2469,y:0.0647},{x:0.2684,y:0.2083},{x:0.0823,y:0.2043}], widthCm: 200, heightCm: 100}})
console.log(JSON.stringify({plKnown: pl.known, plBasis: pl.basis, plH: Array.isArray(pl.H) && pl.H.length === 9}))
// determinizem: isti vogali → ista H
const c = [{x:40,y:30},{x:206.9,y:51.72},{x:225,y:166.67},{x:67.31,y:163.46}]
const h1 = m.planeHomography(c, 200, 100); const h2 = m.planeHomography(c, 200, 100)
console.log(JSON.stringify({det: JSON.stringify(h1) === JSON.stringify(h2)}))
""")
try:
    lines = [json.loads(l) for l in out.strip().split('\n') if l.strip()]
    o = {}
    for l in lines: o.update(l)
    chk(o.get('uKnown') is True and o.get('uBasis') == 'ENOTNO_BREZ_DOKAZA' and abs((o.get('uCmX') or 0) - 0.25) < 1e-9, f'UNIFORM: known/basis/cmPerPxX ({o.get("uKnown")}/{o.get("uBasis")}/{o.get("uCmX")})')
    chk(o.get('uH') is None, 'UNIFORM brez ravnine nima H')
    chk(o.get('bKnown') is False and o.get('bCmX') is None and o.get('bReason') is True, f'neveljavna kalibracija: known=false, cmPerPxX=null, razlog da ({o.get("bKnown")}/{o.get("bCmX")}/{o.get("bReason")})')
    chk(o.get('deg') is True, 'kolinearni vogali → planeHomography null')
    chk(o.get('plKnown') is True and o.get('plBasis') == 'RAVNINA' and o.get('plH') is True, f'ravnina prek resolveScale: known/basis/H ({o.get("plKnown")}/{o.get("plBasis")}/{o.get("plH")})')
    chk(o.get('det') is True, 'determinizem: isti vogali → ista homografija')
except Exception as e:
    bad(f'bun izhod neberljiv: {e} / {out[:200]} / {err[:200]}')

print('── H) UI-nizi (source grep)')
chk(src_has('src/components/roksal/modules/meritve-kamera.tsx', 'Postavi ravnino'), 'kamera: gumb Postavi ravnino')
chk(src_has('src/components/roksal/modules/meritve-kamera.tsx', 'perspektivno rectificirano'), 'kamera: prikaz perspektivne kalibracije')
chk(src_has('src/components/roksal/modules/meritve-kamera.tsx', 'perspektivna ravnina'), 'kamera: metoda RAVNINA opisana')
chk(src_has('src/lib/measure-engine.ts', "'RAVNINA'"), 'engine: RAVNINA v tipih kalibracije')
chk(src_has('src/lib/measure-engine.ts', 'PREDPOSTAVKA_FRONTALNOST'), 'engine: PREDPOSTAVKA_FRONTALNOST koda')
chk(src_has('src/lib/measure-engine.ts', 'MERITEV_NA_RAVNINI'), 'engine: MERITEV_NA_RAVNINI koda')
chk(src_has('src/lib/measure-engine.ts', 'RAVNINA_NERESENLJIVA'), 'engine: RAVNINA_NERESENLJIVA koda')

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
print(f'══ R513 REZULTAT: ✓ {PASS} / ✗ {FAIL} ══')
sys.exit(1 if FAIL > 0 else 0)
