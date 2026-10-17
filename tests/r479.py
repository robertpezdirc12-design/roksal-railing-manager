#!/usr/bin/env python3
"""tests/r479.py — R479 (issue #9 §7 + §10 osnova): PINI + ENOTNI PREGLED +
JAVNI ŽETON + GDPR SOGLASJE

Preverja:
  A) RBAC (fail-closed):
     - vse interne poti brez žetona 401 (pins GET/POST, pins/[id] PATCH/DELETE,
       review, review-link POST/DELETE);
     - skladišče (brez measurements.write) 403 na POST /api/pins;
       proizvodnja 403 na POST /api/pins;
     - monter LAHKO bere review (nalog na projektu — isti obseg kot tekač);
       monter brez nalog (tuji projekt) 403 (IDOR);
     - monter (brez portal.manage) 403 na ustvarjanje/preklic/seznam povezave.
  B) ČIST LIB pin-core (bun):
     - parsePinTarget/parsePinTargets (seg-N N≥1, node-N N≥0, cuid; smeti → null);
     - prehodi statusov (ODPRTO→RESENO/ZAPRT, RESENO→ZAPRT; nazaj NIKOLI);
     - publicPin stripa internalNote + e-pošte (samo imena);
     - consentStatus (MANJKA/VELJAVNO/POTEKLO) + photosBlockedReason.
  C) PINI CRUD (/api/pins, /api/pins/[id]):
     - ustvari na seg-1/node-0/fotografiji (201, snapshot cilja ob nastanku);
       fail-closed: seg-0/seg-99/node-99/tuja fotografija/smeti/prazen note → 400;
     - IDOR: monter na tuj projekt 403;
     - PATCH prehodi + resolvedAt/resolvedById; prehod nazaj 400; ZAPRT zaklenjen;
     - tuji pin (monter po dostopu) 403 na PATCH/DELETE; avtor 200;
     - DELETE samo ODPRTO (RESENO → 409); revizije PIN_CREATE/UPDATE/DELETE.
  D) ENOTNI OBSEK (/api/fence-run/[id]/review):
     - model (model-core, seg-1 ključi) + fotografije (cona/atCm, POŠTENO
       spatiallyRegistered:false) + pini + replay KAZALEC na obstoječi motor
       (GET replay 200) + consent + checks (exportChecks struktura).
  E) JAVNI ŽETON (/api/public/review?token=):
     - ustvari (portal.manage) → anonimni GET 200 z JAVNIM podskupom
       (internalNote ODSOTEN, brez e-pošte), viewCount šteje;
     - brez soglasja → photosBlocked MANJKA_SOGLASJE; SET → fotografije VIDNE;
       potek (backdate) → SOGLASJE_POTEKLO; CLEAR → spet MANJKA;
     - preklic → 404; potekel rok (backdate) → 404; smeten žeton → 404;
     - tempomat 60/min → 429; reviziji REVIEWLINK_CREATE/REVOKE + CONSENT_SET/CLEAR.
  F) CONSENT GATE portal + galerija:
     - /api/public/portal: brez soglasja photos=[] + photosBlocked (portal OSTANE
       dostopen); z soglasjem FOTO meritve vidne;
     - /api/gallery: interno ostane + project.consentStatus na vsakem zapisu.
  G) Idempotentno čiščenje vseh testnih zapisov (direktno prek Prisma).
"""
import json, os, subprocess, sys, time, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R479-TEST'
PASS, FAIL = 0, 0

def call (method, path, token=None, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, e.read(), {k.lower(): v for k, v in e.headers.items()}
    except Exception as e:
        return 0, str(e).encode(), {}

def callj (method, path, token=None, body=None, timeout=60):
    s, b, _ = call(method, path, token, body, timeout)
    try: return s, json.loads(b.decode('utf-8', 'replace'))
    except Exception: return s, {}

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

def audit_rows (token, project_id, limit=300):
    s, d = callj('GET', f'/api/audit?projectId={project_id}&limit={limit}', token)
    return d.get('data', []) if s == 200 else []

def audit_has (token, action, entity_id, project_id):
    return any(
        e.get('action') == action and e.get('entityId') == entity_id
        for e in audit_rows(token, project_id)
    )

# ── priprava ────────────────────────────────────────────────────────────────
admin = login('admin@roksal.si', 'Admin123!')
vodja = login('vodja@roksal.si', 'Vodja123!')
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')
proizvodnja = login('proizvodnja@roksal.si', 'Proizvodnja123!')

s, d = callj('GET', '/api/projects', admin)
PROJ = {p['code']: p['id'] for p in d.get('data', [])}
P4 = PROJ.get('P-2026-004')   # ZAKLJUCEN, monter ima nalog N-2026-006, 2 FOTO meritvi
P3 = PROJ.get('P-2026-003')   # monter BREZ naloga (IDOR negativ)
chk(bool(P4 and P3), 'projekta za test najdena (P4 + P3 brez monterjevega naloga)')

NODES = [
    {'kind': 'ZACETEK', 'atCm': 0, 'podlaga': 'BETON', 'pritrditev': 'TLACNA', 'heightCm': 105},
    {'kind': 'VOGAL', 'atCm': 650, 'interiorDeg': 90, 'podlaga': 'BETON', 'heightCm': 105},
    {'kind': 'VRATA', 'atCm': 900, 'gateWcm': 100, 'podlaga': 'BETON'},
    {'kind': 'KONEC', 'atCm': 1250, 'podlaga': 'ZEMLJA', 'heightCm': 100},
]
# BREZ kalibracije → segmenti ostanejo ESTIMATED → checks morajo nositi NEPREVERJENI_SEGMENTI
s, d = callj('POST', '/api/fence-run', admin, {
    'projectId': P4, 'name': f'Pregled {TAG}', 'nodes': NODES,
    'terrain': [{'distCm': 0, 'elevCm': 0}, {'distCm': 650, 'elevCm': 10}, {'distCm': 1250, 'elevCm': 25}],
    'note': TAG})
chk(s == 201, f'tekač na P4 ustvarjen 201 (dejansko {s}, {d.get("error", "")})')
RUN = d.get('data', {}).get('id')

# tuj tekač (P3 — monter brez naloga)
s, d = callj('POST', '/api/fence-run', admin, {
    'projectId': P3, 'name': f'Tuj {TAG}', 'nodes': NODES, 'note': TAG})
RUN2 = d.get('data', {}).get('id')
chk(s == 201 and bool(RUN2), f'tuj tekač na P3 ustvarjen (IDOR tarča)')

# zajem na tekaču + 2 posnetka ( eden s sličico)
s, d = callj('POST', '/api/capture-session', admin, {
    'projectId': P4, 'mode': 'FENCE_RUN', 'fenceRunId': RUN,
    'name': f'Zajem {TAG}', 'note': TAG})
chk(s == 201, f'zajem ustvarjen 201 (dejansko {s})')
SESS = d.get('data', {}).get('id')
plan = d.get('data', {}).get('plan', [])
coverable = [p['id'] for p in plan if p['kind'] in ('START', 'SEGMENT', 'VRATA', 'TEREN', 'PODLAGA', 'KONEC')]
chk(len(coverable) >= 1, f'vodena ruta ima pokrivne postanke ({len(coverable)})')
THUMB = 'data:image/svg+xml;base64,' + 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4='
s, _ = callj('POST', f'/api/capture-session/{SESS}/photo', admin, {
    'zone': coverable[0], 'clientKey': 'r479-a', 'thumb': THUMB})
chk(s == 201, f'posnetek A 201 (dejansko {s})')
s, _ = callj('POST', f'/api/capture-session/{SESS}/photo', admin, {
    'zone': coverable[-1], 'clientKey': 'r479-b'})
chk(s == 201, f'posnetek B 201 (dejansko {s})')
s, d = callj('GET', f'/api/capture-session/{SESS}', admin)
PHOTOS = [p['id'] for p in d.get('data', {}).get('photos', [])]
chk(len(PHOTOS) == 2, f'2 posnetka na zajemu (dejansko {len(PHOTOS)})')

# zajem BREZ tekača (mode KAMERA na P4) — njegov posnetek NE sme postati pin tekača
s, d = callj('POST', '/api/capture-session', admin, {
    'projectId': P4, 'mode': 'KAMERA', 'name': f'Kamera {TAG}', 'note': TAG})
SESS2 = d.get('data', {}).get('id')
plan2 = [p['id'] for p in d.get('data', {}).get('plan', [])
         if p['kind'] in ('START', 'SEGMENT', 'VRATA', 'TEREN', 'PODLAGA', 'KONEC')]
zone2 = plan2[0] if plan2 else 'start'
chk(len(plan2) >= 1, f'kamera zajem ima splošno ruto ({len(plan2)} pokrivnih postankov)')
s, _ = callj('POST', f'/api/capture-session/{SESS2}/photo', admin, {
    'zone': zone2, 'clientKey': 'r479-c'})
chk(s == 201, f'posnetek na kamerinem zajemu 201 (dejansko {s})')
s, d = callj('GET', f'/api/capture-session/{SESS2}', admin)
FOREIGN_PHOTO = next((p['id'] for p in d.get('data', {}).get('photos', [])), None)
chk(bool(FOREIGN_PHOTO), 'posnetek brez tekača (tuja fotografija za negativni test)')

# ══ A. RBAC (fail-closed) ═══════════════════════════════════════════════════
print('── A. RBAC ──')
for method, path in [
    ('GET', f'/api/pins?fenceRunId={RUN}'),
    ('POST', '/api/pins'),
    ('PATCH', '/api/pins/xyz'),
    ('DELETE', '/api/pins/xyz'),
    ('GET', f'/api/fence-run/{RUN}/review'),
    ('POST', f'/api/fence-run/{RUN}/review-link'),
    ('DELETE', f'/api/fence-run/{RUN}/review-link?id=xyz'),
]:
    s, _, _ = call(method, path)
    chk(s == 401, f'{method} {path.split("?")[0]} brez žetona 401 (dejansko {s})')

s, _, _ = call('POST', '/api/pins', skladisce, {'fenceRunId': RUN, 'targetType': 'SEGMENT', 'targetKey': 'seg-1', 'note': 'x'})
chk(s == 403, f'skladišče (brez measurements.write) 403 na POST pin (dejansko {s})')
s, _, _ = call('POST', '/api/pins', proizvodnja, {'fenceRunId': RUN, 'targetType': 'SEGMENT', 'targetKey': 'seg-1', 'note': 'x'})
chk(s == 403, f'proizvodnja (brez measurements.write) 403 na POST pin (dejansko {s})')

s, d = callj('GET', f'/api/fence-run/{RUN}/review', monter)
chk(s == 200, f'monter LAHKO bere review (nalog na P4; dejansko {s})')
s, _, _ = call('GET', f'/api/fence-run/{RUN2}/review', monter)
chk(s == 403, f'monter brez nalog na tujem tekaču 403 (IDOR; dejansko {s})')
s, d = callj('GET', f'/api/fence-run/{RUN}/review', proizvodnja)
chk(s == 200, f'proizvodnja bere vse (readsAllData; dejansko {s})')

s, _, _ = call('POST', f'/api/fence-run/{RUN}/review-link', monter, {})
chk(s == 403, f'monter (brez portal.manage) 403 na ustvarjanje povezave (dejansko {s})')
s, _, _ = call('GET', f'/api/fence-run/{RUN}/review-link', monter)
chk(s == 403, f'monter 403 na seznam povezav (dejansko {s})')
s, _, _ = call('DELETE', f'/api/fence-run/{RUN}/review-link?id=xyz', monter)
chk(s == 403, f'monter 403 na preklic povezave (dejansko {s})')

# ══ B. ČIST LIB pin-core (bun) ══════════════════════════════════════════════
print('── B. pin-core (čist lib) ──')
CORE = r'''
const {
  parsePinTarget, parsePinTargets, canTransitionPin, publicPin, consentStatus,
  photosBlockedReason, isPinStatus, PIN_STATUSES, PIN_TARGET_TYPES, validPinNote,
} = require('./src/lib/pin-core.ts');
(async () => {
  const seg = (k) => parsePinTarget('SEGMENT', k);
  console.log('SEG=' + JSON.stringify([seg('seg-1')?.index, seg('seg-2')?.index, seg('seg-0'), seg('seg-x'), seg('SEG-1'), seg('node-1')]));
  const nod = (k) => parsePinTarget('VOZLISCE', k);
  console.log('NODE=' + JSON.stringify([nod('node-0')?.index, nod('node-3')?.index, nod('node--1'), nod('seg-1')]));
  const cid = 'c' + 'a1b2c3d4e5f6g7h8j9k1l2m3'; // cuid oblika
  console.log('FOTO=' + JSON.stringify([parsePinTarget('FOTOGRAFIJA', cid)?.targetType, parsePinTarget('FOTOGRAFIJA', 'xyz')]));
  console.log('PST=' + JSON.stringify([parsePinTargets('seg-3')?.targetType, parsePinTargets(' node-2 ')?.targetType, parsePinTargets(cid)?.targetType, parsePinTargets('smeti'), parsePinTargets('')]));
  console.log('TR=' + JSON.stringify([
    canTransitionPin('ODPRTO', 'RESENO'), canTransitionPin('ODPRTO', 'ZAPRT'),
    canTransitionPin('RESENO', 'ZAPRT'), canTransitionPin('RESENO', 'ODPRTO'),
    canTransitionPin('ZAPRT', 'ODPRTO'), canTransitionPin('ZAPRT', 'RESENO'),
    canTransitionPin('ODPRTO', 'ODPRTO'),
  ]));
  const pub = publicPin({
    id: 'p1', fenceRunId: 'r1', targetType: 'SEGMENT', targetKey: 'seg-1',
    x: 10.5, y: -3, note: 'javna opomba', status: 'ODPRTO',
    resolvedAt: null, author: {name: 'Robert Pezdirc'}, resolvedBy: null,
    snapshot: JSON.stringify({segmentLabel: 'seg-1', lengthCm: 650}),
    createdAt: new Date('2026-10-11T08:00:00Z'),
  });
  console.log('PUB=' + JSON.stringify(pub));
  console.log('PUB_KEYS=' + Object.keys(pub).sort().join(','));
  const now = new Date('2026-10-11T12:00:00Z');
  console.log('CS=' + JSON.stringify([
    consentStatus(null),
    consentStatus({photoConsentAt: null, photoConsentExpiresAt: null}),
    consentStatus({photoConsentAt: new Date('2026-10-01'), photoConsentExpiresAt: null}, now),
    consentStatus({photoConsentAt: new Date('2026-10-01'), photoConsentExpiresAt: new Date('2026-10-10')}, now),
    consentStatus({photoConsentAt: new Date('2026-10-01'), photoConsentExpiresAt: new Date('2026-10-20')}, now),
  ]));
  console.log('PB=' + JSON.stringify([photosBlockedReason('MANJKA'), photosBlockedReason('POTEKLO'), photosBlockedReason('VELJAVNO')]));
  console.log('ST=' + JSON.stringify([PIN_STATUSES.join('|'), PIN_TARGET_TYPES.join('|'), isPinStatus('RESENO'), isPinStatus('X'), validPinNote(' '), validPinNote('ok')]));
})()
'''
out, err = bun_ts(CORE)
chk('SEG=[1,2,null,null,null,null]' in out, f'parsePinTarget seg-N: N≥1 veljaven, N=0/smeti/velike črke ne (dejansko {out.splitlines()[:1]})')
chk('NODE=[0,3,null,null]' in out, f'parsePinTarget node-N: N≥0 veljaven, negativne/smeti ne (dejansko {out.splitlines()[1] if len(out.splitlines())>1 else out})')
chk('FOTO=["FOTOGRAFIJA",null]' in out, 'parsePinTarget FOTOGRAFIJA: cuid veljaven, smeti ne')
chk('PST=["SEGMENT","VOZLISCE","FOTOGRAFIJA",null,null]' in out, f'parsePinTargets UI razrez (dejansko {out.splitlines()[3] if len(out.splitlines())>3 else out})')
chk('TR=[true,true,true,false,false,false,false]' in out, f'prehodi: naprej DA, nazaj NIKOLI (dejansko {out.splitlines()[4] if len(out.splitlines())>4 else out})')
chk('"internalNote"' not in (out.split('PUB=')[1].split('\nPUB_KEYS')[0] if 'PUB=' in out else 'X'), 'publicPin BREZ internalNote')
chk('PUB_KEYS=authorName,createdAt,fenceRunId,id,note,resolvedAt,resolvedBy,snapshot,status,targetKey,targetType,x,y' in out,
    f'publicPin nosi SAMO varna polja (dejansko {out})')
chk('CS=["MANJKA","MANJKA","VELJAVNO","POTEKLO","VELJAVNO"]' in out, f'consentStatus MANJKA/VELJAVNO/POTEKLO (dejansko {out})')
chk('PB=["MANJKA_SOGLASJE","SOGLASJE_POTEKLO",null]' in out, 'photosBlockedReason preslika stanja')
chk('ST=["ODPRTO|RESENO|ZAPRT","SEGMENT|VOZLISCE|FOTOGRAFIJA",true,false,false,true]' in out, 'katalogi + isPinStatus + validPinNote')

# ══ C. PINI CRUD ═══════════════════════════════════════════════════════════
print('── C. Pini CRUD ──')
s, pin1 = callj('POST', '/api/pins', admin, {
    'fenceRunId': RUN, 'targetType': 'SEGMENT', 'targetKey': 'seg-1',
    'x': 100.5, 'y': -50, 'note': f'Preveri dolžino {TAG}', 'internalNote': f'INTERNI {TAG}'})
chk(s == 201, f'pin na seg-1 ustvarjen 201 (dejansko {s}, {pin1.get("error", "")})')
PIN1 = pin1.get('data', {}).get('id')
chk(pin1.get('data', {}).get('status') == 'ODPRTO', 'nov pin = ODPRTO')
chk(pin1.get('data', {}).get('internalNote', '').startswith('INTERNI'), 'internalNote se vrne INTERNEMU pogledu')
chk(pin1.get('data', {}).get('author', {}).get('name') == 'Robert Pezdirc', 'avtor z imenom')
snap = pin1.get('data', {}).get('snapshot') or {}  # R542: jsonb objekt
chk(snap.get('segmentLabel') == 'seg-1' and snap.get('lengthCm', 0) > 0, f'snapshot cilja ob nastanku (past #6): {snap}')
chk(audit_has(admin, 'PIN_CREATE', PIN1, P4), 'revizija PIN_CREATE')

for bad_body, why in [
    ({'fenceRunId': RUN, 'targetType': 'SEGMENT', 'targetKey': 'seg-0', 'note': 'x'}, 'seg-0 (N≥1)'),
    ({'fenceRunId': RUN, 'targetType': 'SEGMENT', 'targetKey': 'seg-99', 'note': 'x'}, 'seg-99 ne obstaja'),
    ({'fenceRunId': RUN, 'targetType': 'SEGMENT', 'targetKey': 'SEG-1', 'note': 'x'}, 'velike črke'),
    ({'fenceRunId': RUN, 'targetType': 'VOZLISCE', 'targetKey': 'node-99', 'note': 'x'}, 'node-99 ne obstaja'),
    ({'fenceRunId': RUN, 'targetType': 'FOTOGRAFIJA', 'targetKey': 'cneobstaja1234567890123', 'note': 'x'}, 'cuid ne obstaja'),
    ({'fenceRunId': RUN, 'targetType': 'FOTOGRAFIJA', 'targetKey': 'smeti', 'note': 'x'}, 'smetni targetKey'),
    ({'fenceRunId': RUN, 'targetType': 'FOTOGRAFIJA', 'targetKey': FOREIGN_PHOTO, 'note': 'x'}, 'fotografija tujega zajema'),
    ({'fenceRunId': RUN, 'targetType': 'SEGMENT', 'targetKey': 'seg-1'}, 'brez note'),
    ({'fenceRunId': RUN, 'targetType': 'SEGMENT', 'targetKey': 'seg-1', 'note': '  '}, 'prazen note'),
    ({'fenceRunId': RUN, 'targetType': 'SEGMENT', 'targetKey': 'seg-1', 'note': 'x', 'x': 'abc'}, 'neštevski x'),
    ({'fenceRunId': RUN, 'targetType': 'XYZ', 'targetKey': 'seg-1', 'note': 'x'}, 'neznan targetType'),
]:
    s, _, _ = call('POST', '/api/pins', admin, bad_body)
    chk(s == 400, f'fail-closed: {why} → 400 (dejansko {s})')

s, pin2 = callj('POST', '/api/pins', admin, {'fenceRunId': RUN, 'targetType': 'VOZLISCE', 'targetKey': 'node-0', 'note': f'Vozlišče {TAG}'})
chk(s == 201, f'pin na node-0 201 (dejansko {s})')
PIN2 = pin2.get('data', {}).get('id')
s, pin3 = callj('POST', '/api/pins', admin, {'fenceRunId': RUN, 'targetType': 'FOTOGRAFIJA', 'targetKey': PHOTOS[0], 'note': f'Foto {TAG}'})
chk(s == 201, f'pin na fotografijo 201 (dejansko {s})')
PIN3 = pin3.get('data', {}).get('id')
snap3 = pin3.get('data', {}).get('snapshot') or {}  # R542: jsonb objekt
chk(snap3.get('sessionId') == SESS, f'snapshot fotopina vezan na zajem ({snap3})')

# IDOR: monter na tuj tekač (P3)
s, _, _ = call('POST', '/api/pins', monter, {'fenceRunId': RUN2, 'targetType': 'SEGMENT', 'targetKey': 'seg-1', 'note': 'x'})
chk(s == 403, f'monter na tujem tekaču 403 (IDOR; dejansko {s})')

# monter ima nalog na P4 → LAHKO ustvari svoj pin
s, pin4 = callj('POST', '/api/pins', monter, {'fenceRunId': RUN, 'targetType': 'SEGMENT', 'targetKey': 'seg-2', 'note': f'Monter {TAG}', 'internalNote': f'INTERNI-M {TAG}'})
chk(s == 201, f'monter (nalog na P4) ustvari svoj pin 201 (dejansko {s})')
PIN4 = pin4.get('data', {}).get('id')

# seznam + filter
s, d = callj('GET', f'/api/pins?fenceRunId={RUN}', admin)
chk(s == 200 and len(d.get('data', [])) == 4, f'seznam pinov tekača = 4 (dejansko {s}, {len(d.get("data", []))})')
chk(all('internalNote' in p for p in d.get('data', [])), 'interni seznam vidi internalNote')
s, d = callj('GET', f'/api/pins?fenceRunId={RUN}&status=ODPRTO', admin)
chk(s == 200 and all(p['status'] == 'ODPRTO' for p in d.get('data', [])), 'filter ?status=ODPRTO')
s, _, _ = call('GET', f'/api/pins?fenceRunId={RUN}&status=XXX', admin)
chk(s == 400, 'filter z neveljavnim statusom 400')
s, _, _ = call('GET', '/api/pins', admin)
chk(s == 400, 'seznam brez fenceRunId 400')

# PATCH: prehodi + resolvedAt/By
s, d = callj('PATCH', f'/api/pins/{PIN1}', admin, {'status': 'RESENO'})
chk(s == 200 and d.get('data', {}).get('status') == 'RESENO', f'ODPRTO→RESENO 200 (dejansko {s})')
chk(d.get('data', {}).get('resolvedAt') is not None and d.get('data', {}).get('resolvedBy', {}).get('name'), 'resolvedAt + resolvedBy ob rešitvi')
chk(audit_has(admin, 'PIN_UPDATE', PIN1, P4), 'revizija PIN_UPDATE')
s, _, _ = call('PATCH', f'/api/pins/{PIN1}', admin, {'status': 'ODPRTO'})
chk(s == 400, f'prehod nazaj RESENO→ODPRTO 400 (dejansko {s})')
s, d = callj('PATCH', f'/api/pins/{PIN1}', admin, {'status': 'ZAPRT'})
chk(s == 200 and d.get('data', {}).get('status') == 'ZAPRT', f'RESENO→ZAPRT 200 (dejansko {s})')
s, _, _ = call('PATCH', f'/api/pins/{PIN1}', admin, {'status': 'RESENO'})
chk(s == 400, f'ZAPRT je zaklenjen (ZAPRT→RESENO 400; dejansko {s})')
s, _, _ = call('PATCH', f'/api/pins/{PIN1}', admin, {'status': 'NEVELJAVNO'})
chk(s == 400, 'neznan status 400')
s, d = callj('PATCH', f'/api/pins/{PIN2}', admin, {'note': f'Popravek {TAG}'})
chk(s == 200 and d.get('data', {}).get('note', '').startswith('Popravek'), 'PATCH note (avtor)')
s, d = callj('PATCH', f'/api/pins/{PIN2}', admin, {'internalNote': f'Novo interni {TAG}'})
chk(s == 200, 'PATCH internalNote (avtor)')
s, _, _ = call('PATCH', f'/api/pins/{PIN2}', admin, {})
chk(s == 400, 'PATCH brez polj 400')

# tuji pin: monter (z dostopom do tekača, a NI avtor) → 403
s, _, _ = call('PATCH', f'/api/pins/{PIN2}', monter, {'status': 'RESENO'})
chk(s == 403, f'monter ne more PATCH tuja pina (dejansko {s})')
s, _, _ = call('DELETE', f'/api/pins/{PIN2}', monter)
chk(s == 403, f'monter ne more brisati tuje ODPRTEGA pina (dejansko {s})')
# avtor svojega: PATCH + DELETE
s, d = callj('PATCH', f'/api/pins/{PIN4}', monter, {'note': f'Monter popravek {TAG}'})
chk(s == 200, f'monter ureja SVOJ pin (avtor; dejansko {s})')
s, _, _ = call('DELETE', f'/api/pins/{PIN4}', monter)
chk(s == 200, f'monter briše SVOJ ODPRT pin (dejansko {s})')

# DELETE: samo ODPRTO
s, _, _ = call('DELETE', f'/api/pins/{PIN1}', admin)
chk(s == 409, f'brisanje RESENO/ZAPRT pina 409 (zgodovina; dejansko {s})')
s, _, _ = call('DELETE', f'/api/pins/{PIN2}', admin)
chk(s == 200 and audit_has(admin, 'PIN_DELETE', PIN2, P4), 'DELETE ODPRTO (avtor) + revizija PIN_DELETE')
s, _, _ = call('DELETE', '/api/pins/neobstaja', admin)
chk(s == 404, 'brisanje neznana pina 404')

# ══ D. ENOTNI OBSEK (/api/fence-run/[id]/review) ════════════════════════════
print('── D. Enotni obsek pregleda ──')
s, rev = callj('GET', f'/api/fence-run/{RUN}/review', admin)
chk(s == 200, f'GET review 200 (dejansko {s}, {rev.get("error", "")})')
R = rev.get('data', {})
chk(R.get('model', {}).get('engineVersion') == 'model-core/1.0', 'model = model-core/1.0 (R473, skupna izpeljava)')
chk([seg['key'] for seg in R.get('model', {}).get('segments', [])][:1] == ['seg-1'], 'model segmenti nosijo seg-N ključe')
rev_photos = R.get('photos', [])
chk(len(rev_photos) == 2, f'fotografije zajema v obsegu (dejansko {len(rev_photos)})')
chk(all(p.get('spatiallyRegistered') is False for p in rev_photos), 'POŠTENO: posnetki niso prostorsko registrirani (past #5)')
chk(all(p.get('zone') and p.get('zoneLabel') for p in rev_photos), 'fotografije nosijo cono + oznako cone')
chk(any(p.get('thumb') for p in rev_photos), 'sličica thumb se prenese')
chk(len(R.get('pins', [])) >= 1, 'pini so v obsegu')
reps = R.get('replay', [])
chk(any(r.get('replayUrl') == f'/api/capture-session/{SESS}/replay' and r.get('photoCount') == 2 for r in reps),
    f'replay KAZALEC na obstoječi motor (past #4; dejansko {reps})')
s, _, _ = call('GET', f'/api/capture-session/{SESS}/replay', admin)
chk(s == 200, 'kazalčni replay URL dejansko deluje (200)')
chk(R.get('consent', {}).get('status') == 'MANJKA' and R.get('consent', {}).get('photosBlocked') == 'MANJKA_SOGLASJE',
    f'consent na začetku MANJKA + photosBlocked (dejansko {R.get("consent")})')
codes = [c.get('code') for c in R.get('checks', [])]
chk('NEPREVERJENI_SEGMENTI' in codes, f'checks iz exportChecks (ESTIMATED brez kalibracije → NEPREVERJENI_SEGMENTI; dejansko {codes})')
chk(all(set(c.keys()) >= {'code', 'severity', 'message'} for c in R.get('checks', [])), 'checks struktura (code/severity/message)')
chk(R.get('project', {}).get('code') == 'P-2026-004', 'projekt v obsegu')
s, _, _ = call('GET', f'/api/fence-run/{RUN}/review?turns=LDX', admin)
chk(s == 400, 'review turns validacija (neveljaven znak 400)')
s, _, _ = call('GET', f'/api/fence-run/{RUN}/review?turns=D', admin)
chk(s == 200, 'review turns=D 200')

# ══ E. JAVNI ŽETON (/api/public/review?token=) ══════════════════════════════
print('── E. Javni žeton ──')
s, L1 = callj('POST', f'/api/fence-run/{RUN}/review-link', admin, {'note': TAG})
chk(s == 201, f'povezava ustvarjena 201 (dejansko {s}, {L1.get("error", "")})')
T1 = L1.get('data', {}).get('token', '')
LID1 = L1.get('data', {}).get('id', '')
chk(T1.startswith('rv-'), f'žeton ima predpono rv- ({T1[:6]}…)')
chk(L1.get('data', {}).get('url') == f'/api/public/review?token={T1}', 'url kaže na javno pot')
import datetime as _dt
exp = _dt.datetime.fromisoformat(L1.get('data', {}).get('expiresAt', '').replace('Z', '+00:00'))
days = (exp - _dt.datetime.now(_dt.timezone.utc)).total_seconds() / 86400
chk(13.9 <= days <= 14.1, f'privzeti rok 14 dni (dejansko {days:.2f})')
chk(audit_has(admin, 'REVIEWLINK_CREATE', LID1, P4), 'revizija REVIEWLINK_CREATE')
s, _, _ = call('POST', f'/api/fence-run/{RUN}/review-link', admin, {'days': 91})
chk(s == 201, 'days=91 (> max) ne podere — varno na privzeto (vzorec portal)')
s, L7 = callj('POST', f'/api/fence-run/{RUN}/review-link', admin, {'days': 7, 'note': TAG})
exp7 = _dt.datetime.fromisoformat(L7.get('data', {}).get('expiresAt', '').replace('Z', '+00:00'))
days7 = (exp7 - _dt.datetime.now(_dt.timezone.utc)).total_seconds() / 86400
chk(6.9 <= days7 <= 7.1, f'rok 7 dni (dejansko {days7:.2f})')

s, body1, _ = call('GET', f'/api/public/review?token={T1}')
chk(s == 200, f'anonimni GET javnega pregleda 200 (dejansko {s})')
J = json.loads(body1.decode('utf-8', 'replace')).get('data', {})
chk(J.get('model', {}).get('segments'), 'javni podskup vsebuje model risbe')
chk(b'internalNote' not in body1, 'internalNote ODSOTEN v javnem odgovoru')
chk(b'@roksal.si' not in body1, 'brez e-pošte uporabnikov v javnem odgovoru')
pub_pins = J.get('pins', [])
chk(len(pub_pins) >= 1 and all('internalNote' not in p for p in pub_pins), 'pini = publicPin projekcija')
chk(any(p.get('authorName') for p in pub_pins), 'javni pin nosi samo IME avtorja')
chk(J.get('photos') == [] and J.get('photosBlocked') == 'MANJKA_SOGLASJE',
    f'brez soglasja → photos prazne + MANJKA_SOGLASJE (dejansko {J.get("photosBlocked")})')
chk(J.get('consent') == 'MANJKA', 'consent MANJKA v javnem odgovoru')
chk(J.get('link', {}).get('expiresAt'), 'javni odgovor nosi rok povezave')

s, _, _ = call('GET', f'/api/public/review?token={T1}')  # 2. ogled
s, d = callj('GET', f'/api/fence-run/{RUN}/review-link', admin)
lrow = next((l for l in d.get('data', []) if l.get('id') == LID1), {})
chk(lrow.get('viewCount') == 2, f'viewCount šteje oglede (dejansko {lrow.get("viewCount")})')
chk(lrow.get('active') is True and lrow.get('url') == f'/api/public/review?token={T1}', 'seznam povezav z veljavnostjo')

# soglasje SET → fotografije VIDNE
s, d = callj('POST', f'/api/projects/{P4}/consent', admin, {'action': 'SET', 'validDays': 30})
chk(s == 200 and d.get('data', {}).get('consent') == 'VELJAVNO', f'soglasje SET (pisarna; dejansko {s}, {d.get("error", "")})')
chk(audit_has(admin, 'CONSENT_SET', P4, P4), 'revizija CONSENT_SET')
s, d = callj('POST', f'/api/projects/{P4}/consent', monter, {'action': 'SET'})
chk(s == 403, f'monter (brez customers.write) 403 na soglasje (dejansko {s})')
s, body2, _ = call('GET', f'/api/public/review?token={T1}')
J2 = json.loads(body2.decode('utf-8', 'replace')).get('data', {})
chk(len(J2.get('photos', [])) == 2 and J2.get('photosBlocked') is None,
    f's soglasjem → fotografije VIDNE (dejansko {len(J2.get("photos", []))}, blocked={J2.get("photosBlocked")})')
chk(J2.get('consent') == 'VELJAVNO', 'consent VELJAVNO v javnem odgovoru')

# potek roka (backdate prek Prisma) → POTEKLO
backdate = r'''
const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  await p.project.update({where:{id:'__P4__'},data:{photoConsentExpiresAt:new Date(Date.now()-86400000)}});
  console.log('BACKDATED');return p.$disconnect();
})()
'''.replace('__P4__', P4)
out, err = bun_ts(backdate)
chk('BACKDATED' in out, f'rok soglasja podtaknjen v preteklost (err {err[:120]})')
s, body3, _ = call('GET', f'/api/public/review?token={T1}')
J3 = json.loads(body3.decode('utf-8', 'replace')).get('data', {})
chk(J3.get('photos') == [] and J3.get('photosBlocked') == 'SOGLASJE_POTEKLO',
    f'potekel rok → SOGLASJE_POTEKLO (dejansko {J3.get("photosBlocked")})')
chk(J3.get('consent') == 'POTEKLO', 'consent POTEKLO v javnem odgovoru')

# CLEAR → spet MANJKA + revizija
s, d = callj('POST', f'/api/projects/{P4}/consent', admin, {'action': 'CLEAR'})
chk(s == 200 and d.get('data', {}).get('consent') == 'MANJKA', f'soglasje CLEAR (dejansko {s})')
chk(audit_has(admin, 'CONSENT_CLEAR', P4, P4), 'revizija CONSENT_CLEAR')
s, _, _ = call('POST', f'/api/projects/{P4}/consent', admin, {'action': 'XYZ'})
chk(s == 400, 'neznano dejanje soglasja 400')

# preklic → 404
s, d = callj('DELETE', f'/api/fence-run/{RUN}/review-link?id={LID1}', admin)
chk(s == 200 and d.get('data', {}).get('revoked') is True, f'preklic povezave (dejansko {s})')
chk(audit_has(admin, 'REVIEWLINK_REVOKE', LID1, P4), 'revizija REVIEWLINK_REVOKE')
s, _, _ = call('GET', f'/api/public/review?token={T1}')
chk(s == 404, f'preklicana povezava → javni dostop 404 (dejansko {s})')
s, d = callj('DELETE', f'/api/fence-run/{RUN}/review-link?id={LID1}', admin)
chk(s == 200, 'preklic je idempotenten')

# potekel rok povezave (backdate expiresAt) → 404
expire_link = r'''
const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  await p.reviewLink.updateMany({where:{token:{startsWith:'rv-'}},data:{expiresAt:new Date(Date.now()-3600000)}});
  console.log('EXPIRED');return p.$disconnect();
})()
'''
out, err = bun_ts(expire_link)
chk('EXPIRED' in out, 'rok vseh testnih povezav podtaknjen v preteklost')
T7 = L7.get('data', {}).get('token', '')
s, _, _ = call('GET', f'/api/public/review?token={T7}')
chk(s == 404, f'potekla povezava → 404 (dejansko {s})')

# smeten/kratki žeton
s, _, _ = call('GET', '/api/public/review?token=kratk')
chk(s == 404, f'prekratki žeton 404 (dejansko {s})')
s, _, _ = call('GET', '/api/public/review')
chk(s == 404, 'brez žetona 404 (javna pot ne razkne ničesar)')
s, _, _ = call('GET', '/api/public/review?token=' + 'x' * 100)
chk(s == 404, 'predolgi žeton 404')

# tempomat 60/min → 429
s, L9 = callj('POST', f'/api/fence-run/{RUN}/review-link', admin, {'note': TAG})
T9 = L9.get('data', {}).get('token', '')
saw429 = False
for _ in range(70):
    s, _, _ = call('GET', f'/api/public/review?token={T9}')
    if s == 429:
        saw429 = True
        break
chk(saw429, 'tempomat 60/min na žeton → 429 po prekoračitvi')

# ══ F. CONSENT GATE: portal + galerija ══════════════════════════════════════
print('── F. Consent gate portal + galerija ──')
s, d = callj('POST', '/api/portal', admin, {'projectId': P4, 'days': 7, 'note': TAG})
chk(s == 201, f'portal povezava ustvarjena (dejansko {s})')
PT = d.get('data', {}).get('token', '')

s, pb, _ = call('GET', f'/api/public/portal?token={PT}')
PD = json.loads(pb.decode('utf-8', 'replace')).get('data', {})
chk(s == 200, 'portal ostane DOSTOPEN brez soglasja (NE 403 na celo pot)')
chk(PD.get('photos') == [] and PD.get('photosBlocked') == 'MANJKA_SOGLASJE',
    f'portal brez soglasja: fotografije zamaknjene + razlog (dejansko {PD.get("photosBlocked")})')

s, d = callj('POST', f'/api/projects/{P4}/consent', admin, {'action': 'SET'})
chk(s == 200, 'soglasje znova SET (brez roka)')
s, pb, _ = call('GET', f'/api/public/portal?token={PT}')
PD = json.loads(pb.decode('utf-8', 'replace')).get('data', {})
chk(len(PD.get('photos', [])) >= 1 and PD.get('photosBlocked') is None,
    f'portal z veljavnim soglasjem: FOTO meritve VIDNE (dejansko {len(PD.get("photos", []))})')

# interna galerija: photos ostanejo + consentStatus na projektu
s, d = callj('GET', f'/api/gallery?projectId={P4}', monter)
chk(s == 200, f'galerija 200 (gallery.read; dejansko {s})')
items = d.get('data', [])
chk(len(items) >= 1, f'P4 ima FOTO meritve v galeriji (dejansko {len(items)})')
chk(all(i.get('project', {}).get('consentStatus') in ('MANJKA', 'VELJAVNO', 'POTEKLO') for i in items),
    'vsak zapis galerije nosi project.consentStatus (opozorilo za UI)')
chk(all(i.get('photo') for i in items if i.get('project', {}).get('id') == P4), 'interno: fotografije OSTANEJO vidne (prijava)')

# umik soglasja → portal spet zamakne fotografije
s, d = callj('POST', f'/api/projects/{P4}/consent', admin, {'action': 'CLEAR'})
chk(s == 200, 'soglasje umaknjeno (CLEAR)')
s, pb, _ = call('GET', f'/api/public/portal?token={PT}')
PD = json.loads(pb.decode('utf-8', 'replace')).get('data', {})
chk(PD.get('photos') == [] and PD.get('photosBlocked') == 'MANJKA_SOGLASJE', 'umik soglasja → portal spet zamakne fotografije')

# /api/public/measure NE izpiše fotografij (select brez params) → gate ni potreben
s, d = callj('GET', '/api/public/measure?token=neobstaja')
chk(s in (404, 200), f'public/measure nedotaknjen (žetonska varnost; dejansko {s})')

# ══ G. IDEMPOTENTNO ČIŠČENJE ════════════════════════════════════════════════
print('── G. Idempotentno čiščenje ──')
CLEAN = r'''
const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  await p.reviewPin.deleteMany({where:{OR:[{note:{contains:'__TAG__'}},{internalNote:{contains:'__TAG__'}}]}});
  await p.reviewLink.deleteMany({where:{OR:[{note:{contains:'__TAG__'}},{fenceRun:{note:{contains:'__TAG__'}}}]}});
  await p.captureSession.deleteMany({where:{note:{contains:'__TAG__'}}});
  await p.fenceRun.deleteMany({where:{note:{contains:'__TAG__'}}});
  await p.portalLink.deleteMany({where:{note:{contains:'__TAG__'}}});
  await p.project.updateMany({where:{id:'__P4__'},data:{photoConsentAt:null,photoConsentById:null,photoConsentExpiresAt:null}});
  const pins=await p.reviewPin.count({where:{OR:[{note:{contains:'__TAG__'}},{internalNote:{contains:'__TAG__'}}]}});
  const links=await p.reviewLink.count({where:{token:{startsWith:'rv-'}}});
  const runs=await p.fenceRun.count({where:{note:{contains:'__TAG__'}}});
  const sess=await p.captureSession.count({where:{note:{contains:'__TAG__'}}});
  const cons=await p.project.count({where:{id:'__P4__',photoConsentAt:{not:null}}});
  console.log('AFTER='+JSON.stringify([pins,links,runs,sess,cons]));
  return p.$disconnect();
})()
'''.replace('__TAG__', TAG).replace('__P4__', P4)
out, err = bun_ts(CLEAN)
chk('AFTER=[0,0,0,0,0]' in out, f'čiščenje testnih zapisov (dejansko {out.strip()}, err {err[:150]})')
out, _ = bun_ts(CLEAN.replace('AFTER=', 'AFTER2='))
chk('AFTER2=[0,0,0,0,0]' in out, 'čiščenje je IDEMPOTENTNO (2. zagon = nič zadetkov)')

print(f'\n{"="*60}\nR479: {PASS} ✓ / {FAIL} ✗')
sys.exit(1 if FAIL else 0)
