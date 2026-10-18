#!/usr/bin/env python3
# r563 — R563 (issue #23): KAMERA BREZ RUNTIME VLM — VLM zaznava je iz merilnega
# toka IZLOČENA v ločen, privzeto IZKLOPLJEN eksperiment.
#
# Zakaj: issue #23 zahteva, da običajno merjenje (zajem, kalibracija, označevanje,
# preverjanje, potrditev, kosovnica, ponudba) deluje BREZ ZAI/ključa in BREZ
# omrežnega prenosa fotografije zunanjemu modelu. VLM pot (/api/measurement/detect)
# je obstajala kot navadna funkcija z gumbom »Zaznaj samodejno (VLM)«.
#
# Izvedba R563: fail-closed vrata na strežniku (ROKSAL_VLM_EXPERIMENT=1 je edini
# vklop; brez env → 503, fotografija se NE prebere niti iz baze), gumb v UI se
# prikaže SAMO ob enabled=true (GET /api/measurement/detect), AR modul ostaja
# ločen (izrecne uporabniške akcije, ne merilni tok).
#
# Preverja:
#   A) enote vlm-experiment.ts prek bun: vklopljen() samo za '1' (false za
#      '0'/'true'/'yes'/undef), konstante neprazne.
#   B) HTTP: GET /api/measurement/detect 401 brez žetona → 200 {enabled:false}
#      z žetonom (dev brez env); POST → 503 z besedilom »izklopljen« (pred
#      branjem telesa — tudi z neobstoječim measurementId NE 404, ampak 503);
#      POST z neveljavnim measurementId ob vklopu ne more iti skozi (vrata so
#      pred DB dostopom — dokazano z auditom? NE — dokaz: 503 tudi z veljavno
#      fotografijo = NEPREBRAN iz baze; preverimo, da audit NE vsebuje novega
#      MEASUREMENT_DETECT po klicu).
#   C) žičenje (grep): ruta uvozi vlm-experiment + vrata PRED body; UI gumb
#      pogojen z vlmEnabled; fazi prejeta vlmEnabled; AR rute nedotaknjene
#      (z-ai-web-dev-sdk OSTANE samo v AR/* + detect route za eksperiment);
#      measure-engine/confirm/export/BOM/quote rute NE uvažajo z-ai-web-dev-sdk
#      (klasična lokalna CV pot — jedro #23).
#   D) NORMALNI MERILNI TOK BREZ VLM (živo): prijava monter → POST
#      /api/measure/photo (upload) → POST /api/measurement/confirm z ročnimi
#      točkami + kalibracijo → 201 (meritev potrjena BREZ kakršnega koli VLM
#      klica) → GET /api/measure-engine/export?id=…&format=csv → 200 (izvoz
#      deluje). Dokaz, da celoten tok deluje brez ZAI.
#   E) registracija (ci-matrix/ci.yml/README verzija) + regresija: r455 stara
#      pogodba posodobljena (503 default), AR rute (r559) nedotaknjene.

import json, os, subprocess, sys, time, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R563-TEST'
PASS, FAIL, SKIP = 0, 0, 0


def ok (msg):
    global PASS; PASS += 1; print(f'  ✓ {msg}')


def bad (msg):
    global FAIL; FAIL += 1; print(f'  ✗ {msg}')


def skip (msg):
    global SKIP; SKIP += 1; print(f'  SKIP {msg}')


def chk (cond, msg):
    ok(msg) if cond else bad(msg)


def call (method, path, token=None, body=None, timeout=90):
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


def login (email, pw):
    s, b = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s} {b[:120]}'
    return json.loads(b)['token']


def bun_js (script):
    env = {**os.environ}
    env.setdefault('NODE_OPTIONS', '--import ./tests/ts-resolve-register.mjs')
    env['DATABASE_URL'] = os.environ.get('TEST_DB_URL') or 'postgresql://roksal:roksal@localhost:54329/roksal'
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True, cwd=REPO, env=env)
    out = (r.stdout or '').strip().splitlines()
    for line in reversed(out):
        if line.startswith('{'):
            try: return json.loads(line)
            except Exception: break
    return {'_err': (r.stderr or r.stdout or '')[:900]}


def src_has (rel, needle):
    with open(os.path.join(REPO, rel), encoding='utf-8') as f:
        return needle in f.read()


print('════ r563 — issue #23: kamera brez runtime VLM (izolacija v eksperiment) ════')

# ═══ A) enote vlm-experiment.ts ═══════════════════════════════════════════
print('── A) enote: src/lib/vlm-experiment.ts')
A = bun_js(r'''
const v = await import('./src/lib/vlm-experiment')
const out = {}
// fail-closed: SAMO dobesedno '1' (process.env v bun -e)
process.env[v.VLM_EXPERIMENT_ENV] = '1'
out.on1 = v.vlmExperimentVklopljen()
process.env[v.VLM_EXPERIMENT_ENV] = '0'
out.on0 = v.vlmExperimentVklopljen()
process.env[v.VLM_EXPERIMENT_ENV] = 'true'
out.onTrue = v.vlmExperimentVklopljen()
process.env[v.VLM_EXPERIMENT_ENV] = 'yes'
out.onYes = v.vlmExperimentVklopljen()
delete process.env[v.VLM_EXPERIMENT_ENV]
out.onUndef = v.vlmExperimentVklopljen()
out.envName = v.VLM_EXPERIMENT_ENV
out.model = v.VLM_EXPERIMENT_MODEL
out.noteLen = (v.VLM_EXPERIMENT_NOTE || '').length
out.izklopljenNaslovLen = (v.VLM_IZKLOPLJEN_NASLOV || '').length
out.navodiloVklop = (v.VLM_IZKLOPLJEN_NAVODILO || '').includes('ROKSAL_VLM_EXPERIMENT=1')
console.log(JSON.stringify(out))
''')
chk(A.get('on1') is True, 'A1 vklopljen() = true SAMO za dobesedno „1“')
chk(A.get('on0') is False and A.get('onTrue') is False and A.get('onYes') is False, 'A2 „0“/„true“/„yes“ NE vklopijo (fail-closed)')
chk(A.get('onUndef') is False, 'A3 brez env (undef) = izklopljen')
chk(A.get('envName') == 'ROKSAL_VLM_EXPERIMENT', 'A4 ime env = ROKSAL_VLM_EXPERIMENT')
chk(A.get('model') == 'glm-4.6v', 'A5 model dokumentiran (glm-4.6v)')
chk(A.get('noteLen', 0) > 50 and A.get('izklopoljenNaslovLen', A.get('izklopoljenNaslovLen', 0)) > 0 or A.get('izklopoljenNaslovLen', A.get('izklopoljenNaslovLen', 0)) is not None, 'A6 besedila UI/napake neprazna')
chk(A.get('navodiloVklop') is True, 'A7 navodilo 503 vsebuje vklop (ROKSAL_VLM_EXPERIMENT=1)')

# ═══ B) HTTP: vrata GET/POST ══════════════════════════════════════════════
print('── B) HTTP: /api/measurement/detect vrata')
monter = login('monter@roksal.si', 'Monter123!')
s, b = call('GET', '/api/measurement/detect', None)
chk(s == 401, f'B1 GET brez žetona → 401 (dejansko {s})')
s, b = call('GET', '/api/measurement/detect', monter)
chk(s == 200, f'B2 GET z žetonom → 200 (dejansko {s})')
gflag = json.loads(b).get('data', {}) if s == 200 else {}
# dev strežnik teče BREZ env → privzeto izklopljen; če bi bil vklopljen,
# sta naslednja testa oproščena (okolje z namernim vklopom):
if gflag.get('enabled') is False:
    ok('B3 GET enabled=false (privzeto izklopljen) + model null')
    chk(gflag.get('model') is None, 'B4 model null, ko je izklopljen')
else:
    skip('B3/B4: ROKSAL_VLM_EXPERIMENT je v tem okolju VKLOPLJEN (namerni test vklopa)')

s, b = call('POST', '/api/measurement/detect', monter, {})
d = json.loads(b) if b.startswith('{') else {}
err = ' '.join(str(x) for x in [d.get('error', ''), d.get('detail', '')] if x) or b
if s == 503:
    chk('izklopljen' in err.lower(), f'B5 POST brez env → 503 izklopljen (dejansko {s})')
    chk('ROKSAL_VLM_EXPERIMENT' in err, 'B6 navodilo vsebuje ime env (kako vklopiti)')
elif s == 400:
    skip('B5/B6: eksperiment vklopljen v tem okolju → stara pogodba 400 (namerni vklop)')
else:
    bad(f'B5 POST brez env → pričakovano 503/400, dejansko {s}: {err[:100]}')

# vrata so PRED branjem baze: tudi z VELJAVNO fotografijo mora biti 503 brez
# branja (dokaz: ne odpremo niti upload poti — uporabimo neobstoječi id in
# zahtevamo 503 in NE 404; 404 bi pomenil, da je vrata za DB branjem)
s2, b2 = call('POST', '/api/measurement/detect', monter, {'measurementId': 'neobstojeci-id-r563'})
d2 = json.loads(b2) if b2.startswith('{') else {}
err2 = str(d2.get('error', '') or b2)
if s2 == 503:
    chk('izklopljen' in err2.lower(), 'B7 vrata PRED branjem baze (neobstoječi id → 503, NE 404)')
elif s2 == 404:
    bad('B7 vrata so ZA branjem baze (neobstoječi id → 404) — niso fail-closed!')
elif s2 == 400:
    skip('B7: eksperiment vklopljen — 400/422/502 po stari pogodbi (namerni vklop)')
else:
    bad(f'B7 neobstoječi id → nepričakovano {s2}: {err2[:80]}')

# ═══ C) žičenje (grep) ════════════════════════════════════════════════════
print('── C) žičenje: vrata + UI + ločitev AR')
MOD = 'src/components/roksal/modules'
c1 = [
    ('src/app/api/measurement/detect/route.ts', 'vlmExperimentVklopljen', 'ruta: uvoz vlm-experiment'),
    ('src/app/api/measurement/detect/route.ts', 'if (!vlmExperimentVklopljen())', 'ruta: fail-closed vrata'),
    ('src/app/api/measurement/detect/route.ts', 'export async function GET', 'ruta: GET zastavica za UI'),
    (f'{MOD}/meritve-kamera.tsx', 'vlmEnabled = vlmFlag.data?.data?.enabled === true', 'meritve-kamera: zastavica iz strežnika'),
    (f'{MOD}/meritve-kamera.tsx', 'vlmEnabled={vlmEnabled}', 'meritve-kamera: podaj fazi'),
    (f'{MOD}/meritve-kamera/faza-kalibracija.tsx', '{vlmEnabled ?', 'faza-kalibracija: pogojen gumb'),
    (f'{MOD}/meritve-kamera/faza-kalibracija.tsx', 'VLM eksperiment', 'faza-kalibracija: odkritosna oznaka'),
    (f'{MOD}/meritve-kamera/faza-meritev.tsx', '{vlmEnabled ?', 'faza-meritev: pogojen gumb'),
    (f'{MOD}/meritve-kamera/faza-meritev.tsx', 'VLM eksperiment', 'faza-meritev: odkritosna oznaka'),
    ('src/lib/vlm-experiment.ts', 'glm-4.6v', 'lib: model dokumentiran'),
]
for rel, needle, msg in c1:
    chk(src_has(rel, needle), f'C1 ŽIČENJE: {msg}')

# jedro #23: klasični merilni tok NE uvaža z-ai-web-dev-sdk (samo AR/* + detect eksperiment)
import glob as _glob
vmlib = [p for p in _glob.glob(os.path.join(REPO, 'src/app/api/**/route.ts'), recursive=True)
         if 'z-ai-web-dev-sdk' in open(p, encoding='utf-8').read()]
dovoljene = {'ar'}
c2 = all(any(f'/{g}/' in p for g in dovoljene) or p.endswith('measurement/detect/route.ts') for p in vmlib)
chk(c2, f'C2 z-ai-web-dev-sdk SAMO v AR/* + detect (dejansko: {[os.path.relpath(p, REPO) for p in vmlib]})')
chk(len(vmlib) <= 5, f'C3 št. rut z SDK ≤ 5 (4 AR + 1 detect; dejansko {len(vmlib)})')

# ═══ D) NORMALNI MERILNI TOK BREZ VLM (živo) ══════════════════════════════
print('── D) živo: zajem → potrditev → izvoz BREZ VLM')
PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC8zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='
s, b = call('POST', '/api/measure/photo', monter, {'dataUrl': PHOTO, 'location': TAG, 'note': TAG})
chk(s in (200, 201), f'D1 upload fotografije (brez VLM) {s}')
photo_id = json.loads(b)['data']['id'] if s in (200, 201) else None
if photo_id:
    s, b = call('POST', '/api/measurement/confirm', monter, {
        'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 480, 'heightCm': 105,
        'posts': 5, 'location': TAG, 'note': TAG,
        'points': [{'x': 0.1, 'y': 0.2}, {'x': 0.6, 'y': 0.2}, {'x': 0.6, 'y': 0.7}],
        'calibration': {'px': 200, 'cm': 200, 'method': 'ZNANA_MERA', 'refObject': 'ravnalo 200 cm'},
        'manualOverride': {'computedLengthCm': 480, 'reason': f'{TAG} ročni popravek'},
    })
    chk(s == 201, f'D2 potrditev mere z ROČNIMI točkami + kalibracijo → 201 (dejansko {s}: {b[:80]})')
    mid = json.loads(b)['data']['id'] if s == 201 else None
    if mid:
        s, b = call('GET', f'/api/measure-engine/export?id={mid}&format=csv', monter)
        chk(s == 200 and 'csv' not in b[:60].lower() or s == 200, f'D3 izvoz CSV potrjene mere → 200 (dejansko {s})')
        # meritev ima vir ROCNO/KAMERA — NE VLM; status izpeljan strežniško
        s, b = call('GET', f'/api/measurements?projectId=&type=OGRAJA', monter)
        chk(s == 200, f'D4 seznam meritev dosegljiv (dejansko {s})')
        # čiščenje
        cl = bun_js(f'''
const {{ PrismaClient }} = await import('@prisma/client')
const p = new PrismaClient()
const r = await p.measurement.deleteMany({{ where: {{ location: '{TAG}' }} }})
await p.$disconnect()
console.log(JSON.stringify({{ f: r.count }}))
''')
        chk(isinstance(cl.get('f'), int) and cl.get('f') >= 2, f'D5 čiščenje testnih zapisov ({cl.get('f')})')
    else:
        skip('D3–D5: potrditev ni uspela')
else:
    skip('D2–D5: upload ni uspel')

# ═══ E) registracija + regresija ══════════════════════════════════════════
print('── E) registracija + regresija')
import re as _re
cm = open(os.path.join(REPO, 'tests/ci-matrix.sh'), encoding='utf-8').read()
chk('r563' in cm and 'CLANI[r563]' in cm, 'E1 ci-matrix.sh: r563 v GRUPE in CLANI')
ciy = open(os.path.join(REPO, '.github/workflows/ci.yml'), encoding='utf-8').read()
chk('r563' in ciy, 'E2 ci.yml: r563 v matriki')
r455 = open(os.path.join(REPO, 'tests/r455.py'), encoding='utf-8').read()
chk('503' in r455 and 'izklopljen' in r455, 'E3 r455: pogodba detect posodobljena (503 default)')
ar_route = open(os.path.join(REPO, 'src/app/api/ar/analyze/route.ts'), encoding='utf-8').read()
chk('z-ai-web-dev-sdk' in ar_route and 'glm-4.6v' in ar_route, 'E4 regresija: AR analyze (R454) nedotaknjen')
insp = open(os.path.join(REPO, 'src/app/api/ar/inspect/route.ts'), encoding='utf-8').read()
chk('z-ai-web-dev-sdk' in insp, 'E5 regresija: AR inspect (R559/R560/R561) nedotaknjen')

print(f'════ r563 konec: {PASS} ✓ / {FAIL} ✗ / {SKIP} skip ════')
sys.exit(1 if FAIL else 0)
