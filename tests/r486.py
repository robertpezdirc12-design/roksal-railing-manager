#!/usr/bin/env python3
"""tests/r486.py — R486 (issue #7 — MONTER CAMERA-FIRST): ZAČNI MERITEV s
kontekstom naloga + IndexedDB osnutek kamere + offline kalibracija/views/quality.

Preverja:
  A) RBAC (fail-closed): brez žetona 401 (sync / capture-session / photo /
     nalog — vir konteksta ZAČNI MERITEV).
  B) bun — OSNUTEK (measure-draft, IndexedDB mock): save/load roundtrip
     (pogledi/točke/kalibracija/faza/način); 1 osnutek na uporabnika
     (overwrite); VEZANOST na userId (drug uporabnik NE vidi tujega);
     clearDraft pobriše SAMO svojega; prazen userId → null/noop; > 8 MB → napaka.
  C) bun — STORE: setMeasureCtx nastavi {projectId, workOrderId};
     getState prebere; clearAuth pobriše kontekst (odjava).
  D) API — SYNC 'foto' z razširjenimi polji (R486 dopolnitev offline poti):
     kalibracija/pogledi/kakovost/zaupanje/ročni popravek/način se zapišejo
     v params meritev (ENAKO kot confirm); idempotenca ×2 (opId, brez
     podvajanj); LEGACY op brez razširitev → params identičen prejšnjemu
     (r439 združljivost); neveljavni confidence/mode se tiho izpustijo.
  E) API — CAPTURE-SESSION povezava z nalogom + posnetek s SLIČICO:
     seja z workOrderId se ustvari; posnetek z thumb (≤ 120 KB) se
     persistira; idempotenten clientKey.
  F) UI-nizi (source grep — DANES/kamera/store/offline/sync/zajem):
     ZAČNI MERITEV, Nadaljuj nedokončano, Dodaj fotografijo, pasica
     Imaš nedokončano meritev, NADALJUJ/ZAČNI NOVO, initialProjectId,
     autoResumeDraft, setMeasureCtx, queuePhoto razširitve, parseExtras,
     shrinkThumb.
  G) Idempotentno čiščenje ×2 (direktno prek Prisma).
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R486-TEST'
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

def login (email, pw):
    s, d = callj('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s}'
    return d['token']

def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)

def bun_ts (script):
    # R470: samo veljavni postgres URL-ji iz okolja — sqlite ostanki (sandbox
    # razvojne lupine) ne smejo prelomiti Prisma klienta (shema je postgresql)
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

def src_has (relpath, needle):
    try:
        with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
            return needle in f.read()
    except Exception:
        return False

# ═══════════════════════════════ TEST ═══════════════════════════════════════

print('════ R486 — ZAČNI MERITEV + osnutek kamere + offline dopolnitev (issue #7) ════')

admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')

print('── A) RBAC (fail-closed)')
for m, p_ in [('POST', '/api/sync'), ('POST', '/api/capture-session'),
              ('POST', '/api/capture-session/x/photo'), ('GET', '/api/nalog')]:
    s, _ = callj(m, p_, body={'deviceId': 'x', 'ops': []} if p_ == '/api/sync' else None)
    chk(s == 401, f'{m} {p_} brez žetona 401 ({s})')

print('── B) OSNUTEK kamere (measure-draft — IndexedDB, bun + mock)')
DRAFT_JS = r'''
// minimalen IndexedDB mock (samo vmesnik, ki ga measure-draft uporablja)
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
class Req { constructor () { this.result = undefined; this.onsuccess = null; this.onerror = null; this.onupgradeneeded = null } }
const storeMaps = {}
const mkStore = (n) => { const m = storeMaps[n]; return {
  get: (k) => { const r = new Req(); r.result = m.get(k) ?? undefined; queueMicrotask(() => r.onsuccess && r.onsuccess()); return r },
  put: (v) => { const r = new Req(); m.set(v.userId, v); r.result = v; queueMicrotask(() => r.onsuccess && r.onsuccess()); return r },
  delete: (k) => { const r = new Req(); m.delete(k); queueMicrotask(() => r.onsuccess && r.onsuccess()); return r },
} }
const db = {
  objectStoreNames: { contains: (n) => n in storeMaps },
  createObjectStore: (n) => { storeMaps[n] = new Map(); return mkStore(n) },
  transaction: (n) => { const s = mkStore(n); return { objectStore: () => s } },
  close: () => {},
}
globalThis.indexedDB = { open: () => { const r = new Req(); r.result = db
  queueMicrotask(() => { r.onupgradeneeded && r.onupgradeneeded(); r.onsuccess && r.onsuccess() })
  return r } }

const { saveDraft, loadDraft, clearDraft } = await import('./src/lib/measure-draft')

const view = (pts, calib) => ({
  key: 1, photoId: null, dataUrl: 'data:image/jpeg;base64,xx', imgW: 1600, imgH: 1200,
  quality: { brightness: 120, blurScore: 80, dark: false, bright: false, blurry: false, ok: true },
  points: pts, calib, calibLocked: false,
})
const snapA = (phase) => ({
  projectId: 'p1', workOrderId: 'wo1', mode: 'OGRAJA', phase,
  views: [view([{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }], { px: 250, cm: 100 })],
  activeView: 0, location: 'Stopnišče — vhod', calibMethod: 'MARKER',
  type: 'OGRAJA', heightS: '100', note: 'osnutek', maxTilt: 3.5,
})
await saveDraft('user-a', snapA(3))
const d = await loadDraft('user-a')
// overwrite: 1 osnutek na uporabnika (nov dogodek prepíše starega)
await saveDraft('user-a', { ...snapA(4), location: 'druga' })
const d2 = await loadDraft('user-a')
// izolacija uporabnikov (IDOR varnost)
await saveDraft('user-b', { ...snapA(2), projectId: 'p2', workOrderId: 'wo2' })
const bOwn = await loadDraft('user-b')
// clear pobriše SAMO svojega
await clearDraft('user-a')
const aGone = await loadDraft('user-a')
const bAlive = await loadDraft('user-b')
// prazen userId
const emptyLoad = await loadDraft('')
let emptyClear = 'ok'
try { await clearDraft('') } catch { emptyClear = 'throw' }
let emptySave = 'ok'
try { await saveDraft('', snapA(1)) } catch { emptySave = 'throw' }
// prevelik osnutek (> 8 MB)
let oversize = 'ok'
try { await saveDraft('user-c', { ...snapA(1), views: [{ ...view([], null), dataUrl: 'x'.repeat(9 * 1024 * 1024) }] }) } catch { oversize = 'throw' }

console.log(JSON.stringify({
  b_loaded: !!d, b_phase: d?.phase, b_pts: d?.views?.[0]?.points?.length,
  b_calib: d?.views?.[0]?.calib, b_mode: d?.mode, b_uid: d?.userId, b_saved: !!d?.savedAt,
  b_loc: d?.location, b_calibm: d?.calibMethod, b_tilt: d?.maxTilt,
  o_phase: d2?.phase, o_loc: d2?.location,
  iso_b: bOwn?.userId === 'user-b' && bOwn?.workOrderId === 'wo2',
  a_gone: aGone === null, b_alive: bAlive?.userId === 'user-b',
  empty_load: emptyLoad === null, empty_clear: emptyClear, empty_save: emptySave,
  oversize,
}))
'''
m = bun_out(DRAFT_JS)
chk(m.get('b_loaded') is True, f'osnutek shranjen in naložen ({m.get("_err", "")!r:.80})' if not m.get('b_loaded') else 'osnutek shranjen in naložen')
chk(m.get('b_phase') == 3, f'faza shranjena (nadaljevanje na zadnjem koraku) ({m.get("b_phase")})')
chk(m.get('b_pts') == 2, f'točke pogleda shranjene ({m.get("b_pts")})')
chk(m.get('b_calib') == {'px': 250, 'cm': 100}, f'kalibracija shranjena ({m.get("b_calib")})')
chk(m.get('b_mode') == 'OGRAJA' and m.get('b_uid') == 'user-a', f'način + userId vezava ({m.get("b_mode")}/{m.get("b_uid")})')
chk(m.get('b_saved') is True and m.get('b_loc') == 'Stopnišče — vhod' and m.get('b_calibm') == 'MARKER' and m.get('b_tilt') == 3.5,
    f'savedAt/lokacija/metoda/nagib shranjeni ({m.get("b_saved")}/{m.get("b_loc")}/{m.get("b_calibm")}/{m.get("b_tilt")})')
chk(m.get('o_phase') == 4 and m.get('o_loc') == 'druga', f'1 osnutek na uporabnika — novi save prepíše ({m.get("o_phase")}/{m.get("o_loc")})')
chk(m.get('iso_b') is True, f'drug uporabnik vidi SAMO svoj osnutek (IDOR) ({m.get("iso_b")})')
chk(m.get('a_gone') is True and m.get('b_alive') is True, f'clearDraft(a) NE pobriše b-jevega ({m.get("a_gone")}/{m.get("b_alive")})')
chk(m.get('empty_load') is None or m.get('empty_load') is True, f'loadDraft brez userId → null ({m.get("empty_load")})')
chk(m.get('empty_clear') == 'ok', f'clearDraft brez userId → tiho noop ({m.get("empty_clear")})')
chk(m.get('empty_save') == 'throw', f'saveDraft brez userId → napaka ({m.get("empty_save")})')
chk(m.get('oversize') == 'throw', f'osnutek > 8 MB zavrnjen ({m.get("oversize")})')

print('── C) STORE — setMeasureCtx (merilni kontekst)')
STORE_JS = r'''
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const { useAppStore } = await import('./src/lib/store')
const st = useAppStore.getState()
const hasFn = typeof st.setMeasureCtx === 'function'
st.setMeasureCtx({ projectId: 'p1', workOrderId: 'wo1' })
const ctx = useAppStore.getState().measureCtx
st.setAuth('tok', { id: 'u1', email: 'a@b.c', name: 'T', role: 'MONTER', perms: [] })
useAppStore.getState().setMeasureCtx({ projectId: 'p2', workOrderId: 'wo2', taskId: 't1' })
useAppStore.getState().clearAuth()
const after = useAppStore.getState().measureCtx
console.log(JSON.stringify({ hasFn, ctx, after }))
'''
m = bun_out(STORE_JS)
chk(m.get('hasFn') is True, f'setMeasureCtx v store ({m.get("hasFn")})')
chk(m.get('ctx') == {'projectId': 'p1', 'workOrderId': 'wo1'}, f'kontekst shranjen ({m.get("ctx")})')
chk(m.get('after') is None, f'clearAuth pobriše merilni kontekst ({m.get("after")})')

# ── priprava: testni nalog dodeljen monterju (kot r439) ──
s, d = callj('GET', '/api/projects', admin)
PID = (d.get('data') or [{}])[0].get('id')
s, d = callj('GET', '/api/users', admin)
MID = next((u['id'] for u in (d.get('data') or []) if u.get('email') == 'monter@roksal.si'), None)
chk(bool(PID and MID), f'priprava: projekt + monter ({PID is not None}/{MID is not None})')
s, d = callj('POST', '/api/nalog', admin, {
    'title': f'TEST {TAG} meritve', 'projectId': PID, 'assigneeId': MID,
    'instructions': 'R486 testni nalog za osnutek/offline dopolnitev'})
chk(s == 201, f'testni nalog ustvarjen ({s})')
WO = d.get('data', {}).get('id')

DEV = 'test-dev-r486'
IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

print('── D) SYNC foto z razširjenimi polji (offline dopolnitev)')
EXT = {
    'workOrderId': WO, 'dataUrl': IMG, 'type': 'OGRAJA', 'lengthCm': 412.5, 'heightCm': 101,
    'note': f'{TAG} offline', 'location': 'Terasa',
    'points': [{'x': 0.1, 'y': 0.2}, {'x': 0.3, 'y': 0.4}],
    'calibration': {'px': 250, 'cm': 100, 'imgW': 1600, 'imgH': 1200, 'method': 'MARKER', 'refObject': 'ravnilo'},
    'views': [{'points': [{'x': 0.11, 'y': 0.21}, {'x': 0.31, 'y': 0.41}], 'calibration': {'px': 240, 'cm': 100, 'imgW': 1600, 'imgH': 1200}}],
    'quality': {'brightness': 120, 'blurScore': 80, 'dark': False, 'bright': False, 'blurry': False},
    'confidence': 82, 'manualOverride': {'computedLengthCm': 405.5, 'reason': 'laser na terenu'},
    'mode': 'OGRAJA',
}
OP1 = 'r486-op-ext-1'
s, d = callj('POST', '/api/sync', monter, {'deviceId': DEV, 'ops': [{'opId': OP1, 'kind': 'foto', 'payload': EXT}]})
chk(s == 200 and d.get('data', {}).get('results', [{}])[0].get('status') == 'OK', f'sync foto z razširitvami → OK ({s})')
M_ID = d.get('data', {}).get('results', [{}])[0].get('data', {}).get('measurement', {}).get('id')
chk(bool(M_ID), f'meritev ustvarjena iz foto opa ({M_ID})')

def meas_params (mid):
    out, _ = bun_ts(f"""
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
p.measurement.findUnique({{where:{{id:'{mid}'}},select:{{params:true,lengthCm:true,workOrderId:true,projectId:true}}}}).then(r=>{{
console.log(JSON.stringify(r));return p.$disconnect()}})""")
    try: return json.loads(out)
    except Exception: return {}

mp = meas_params(M_ID)
pr = {}
try: pr = json.loads(mp.get('params') or '{}')
except Exception: pr = {}
chk(mp.get('lengthCm') == 412.5 and mp.get('workOrderId') == WO, f'osnovna meritev + nalog ({mp.get("lengthCm")}/{mp.get("workOrderId") == WO})')
chk(pr.get('calibration', {}).get('px') == 250 and pr.get('calibration', {}).get('method') == 'MARKER' and pr.get('calibration', {}).get('refObject') == 'ravnilo',
    f'kalibracija v params (px/metoda/referenca) ({pr.get("calibration")})')
chk(len(pr.get('points', [])) == 2, f'točke v params ({len(pr.get("points", []))})')
chk(isinstance(pr.get('views'), list) and len(pr['views']) == 1 and len(pr['views'][0].get('points', [])) == 2 and pr['views'][0].get('calibration', {}).get('px') == 240,
    f'dodatni pogled v params ({pr.get("views")})')
chk(pr.get('quality', {}).get('brightness') == 120 and pr.get('quality', {}).get('blurry') is False, f'kakovost v params ({pr.get("quality")})')
chk(pr.get('confidence') == 82, f'zaupanje v params ({pr.get("confidence")})')
chk(pr.get('manualOverride', {}).get('reason') == 'laser na terenu' and pr.get('manualOverride', {}).get('computedLengthCm') == 405.5,
    f'ročni popravek v params ({pr.get("manualOverride")})')
chk(pr.get('mode') == 'OGRAJA' and pr.get('synced') is True, f'način + synced oznaka ({pr.get("mode")}/{pr.get("synced")})')

# idempotenca ×2 — isti opId NE podvoji
for i in range(2):
    s, d = callj('POST', '/api/sync', monter, {'deviceId': DEV, 'ops': [{'opId': OP1, 'kind': 'foto', 'payload': EXT}]})
    chk(s == 200 and d.get('data', {}).get('results', [{}])[0].get('status') == 'OK', f'idempotentno ponovno pošiljanje #{i + 1} → OK')
out, _ = bun_ts(f"""
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
p.measurement.count({{where:{{note:{{contains:'{TAG} offline'}}}}}}).then(n=>{{console.log(n);return p.$disconnect()}})""")
chk(out.strip() == '1', f'ponovna dostava NE podvoji meritve ({out.strip()})')

# LEGACY op (r439 oblika — brez razširitev): params IDENTIČEN prejšnjemu
OP2 = 'r486-op-legacy-1'
s, d = callj('POST', '/api/sync', monter, {'deviceId': DEV, 'ops': [{'opId': OP2, 'kind': 'foto', 'payload': {
    'workOrderId': WO, 'dataUrl': IMG, 'type': 'NAGIB', 'lengthCm': 250, 'slopeDeg': 32.5, 'note': f'{TAG} legacy'}}]})
chk(s == 200, f'legacy foto op (brez razširitev) → 200 ({s})')
LEG_ID = d.get('data', {}).get('results', [{}])[0].get('data', {}).get('measurement', {}).get('id')
lp = meas_params(LEG_ID)
try: lpr = json.loads(lp.get('params') or '{}')
except Exception: lpr = {}
# R501 (issue #15 faza 2): offline pot dobi ISTI provenance izračun kot mrežna
# (deriveProvenance v jedru) — zato je v params dodan `provenance`; stari ključi
# (r439) ostanejo. Združljivost je v vrednostih, ne v odsotnosti dokaza.
chk(set(lpr.keys()) == {'photoId', 'synced', 'provenance'}, f'legacy params = {{photoId, synced, provenance}} ({sorted(lpr.keys())})')

# neveljavni kosi se tiho izpustijo (vrsta NE sme pasti)
OP3 = 'r486-op-bad-1'
s, d = callj('POST', '/api/sync', monter, {'deviceId': DEV, 'ops': [{'opId': OP3, 'kind': 'foto', 'payload': {
    'workOrderId': WO, 'dataUrl': IMG, 'type': 'OGRAJA', 'lengthCm': 300, 'note': f'{TAG} invalid',
    'confidence': 150, 'mode': 'VESOLJE', 'manualOverride': {'computedLengthCm': 1, 'reason': 'x'}}}]})
chk(s == 200, f'neveljavna confidence/mode se tiho izpustijo → 200 ({s})')
BAD_ID = d.get('data', {}).get('results', [{}])[0].get('data', {}).get('measurement', {}).get('id')
bp = meas_params(BAD_ID)
try: bpr = json.loads(bp.get('params') or '{}')
except Exception: bpr = {}
chk('confidence' not in bpr and 'mode' not in bpr and 'manualOverride' not in bpr,
    f'izpuščeni neveljavni kosi ({sorted(bpr.keys())})')

print('── E) CAPTURE-SESSION — povezava z nalogom + sličica posnetka')
s, d = callj('POST', '/api/capture-session', admin, {
    'projectId': PID, 'workOrderId': WO, 'mode': 'KAMERA', 'note': TAG})
chk(s == 201, f'seja z workOrderId ustvarjena ({s})')
SESS = d.get('data', {}).get('id')
plan = d.get('data', {}).get('plan', [])
chk(bool(SESS) and len(plan) > 0, f'seja + plan ({SESS is not None}/{len(plan)})')
out, _ = bun_ts(f"""
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
p.captureSession.findUnique({{where:{{id:'{SESS}'}},select:{{workOrderId:true,projectId:true}}}}).then(r=>{{
console.log(JSON.stringify(r));return p.$disconnect()}})""")
try: sessRow = json.loads(out)
except Exception: sessRow = {}
chk(sessRow.get('workOrderId') == WO and sessRow.get('projectId') == PID, f'seja vezana na nalog + projekt ({sessRow})')

zone = next((p_['id'] for p_ in plan if p_['kind'] in ('START', 'SEGMENT', 'TEREN', 'PODLAGA', 'KONEC')), plan[0]['id'])
THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICAkKDA8MCgsOCwgIDRENDg8QEBEQCgsSExIQEA8QEBD/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJgA/9k='
s, d = callj('POST', f'/api/capture-session/{SESS}/photo', admin,
             {'zone': zone, 'clientKey': f'{TAG}-1', 'quality': {'dark': False}, 'thumb': THUMB})
chk(s == 201, f'posnetek s sličico (thumb) 201 ({s})')
PH_ID = d.get('data', {}).get('id')
out, _ = bun_ts(f"""
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
p.capturePhoto.findUnique({{where:{{id:'{PH_ID}'}},select:{{thumb:true,zone:true}}}}).then(r=>{{
console.log(JSON.stringify(r));return p.$disconnect()}})""")
try: phRow = json.loads(out)
except Exception: phRow = {}
chk(phRow.get('thumb') == THUMB and phRow.get('zone') == zone, f'sličica persistirana na posnetku ({phRow.get("thumb") is not None}/{phRow.get("zone") == zone})')
s, d = callj('POST', f'/api/capture-session/{SESS}/photo', admin,
             {'zone': zone, 'clientKey': f'{TAG}-1', 'quality': {}, 'thumb': THUMB})
chk(s == 200 and d.get('data', {}).get('duplicate') is True, f'idempotenten clientKey posnetka ({s})')

print('── F) UI-nizi (source grep)')
ui = [
    ('src/components/roksal/modules/danes.tsx', 'ZAČNI MERITEV', 'DANES: primarni gumb ZAČNI MERITEV'),
    ('src/components/roksal/modules/danes.tsx', 'Nadaljuj nedokončano', 'DANES: Nadaljuj nedokončano'),
    ('src/components/roksal/modules/danes.tsx', 'Dodaj fotografijo', 'DANES: Dodaj fotografijo (§3)'),
    ('src/components/roksal/modules/danes.tsx', 'KameraMeritevDialog', 'DANES: kamera dialog montiran'),
    ('src/components/roksal/modules/danes.tsx', 'setMeasureCtx', 'DANES: setMeasureCtx klic'),
    ('src/components/roksal/modules/danes.tsx', 'initialWorkOrderId', 'DANES: kontekst naloga posredovan dialogu'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'Imaš nedokončano meritev', 'KAMERA: pasica nedokončane meritve'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'NADALJUJ', 'KAMERA: gumb NADALJUJ'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'ZAČNI NOVO', 'KAMERA: gumb ZAČNI NOVO'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'initialProjectId', 'KAMERA: predpolnjen projectId prop'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'autoResumeDraft', 'KAMERA: Nadaljuj takoj ob odprtju'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'saveDraft', 'KAMERA: samodejni osnutek'),
    ('src/lib/store.ts', 'setMeasureCtx', 'STORE: setMeasureCtx'),
    ('src/lib/store.ts', 'measureCtx', 'STORE: measureCtx polje'),
    ('src/lib/measure-draft.ts', 'saveDraft', 'LIB: saveDraft osnutek'),
    ('src/lib/measure-draft.ts', 'clearDraft', 'LIB: clearDraft osnutek'),
    ('src/lib/offline.ts', "calibration?: Record<string, unknown> | null", 'OFFLINE: calibration v QueuePhotoInput'),
    ('src/lib/offline.ts', 'views?: Record<string, unknown>[] | null', 'OFFLINE: views v QueuePhotoInput'),
    ('src/lib/offline.ts', 'quality?: Record<string, unknown> | null', 'OFFLINE: quality v QueuePhotoInput'),
    ('src/app/api/sync/route.ts', 'parseExtras', 'SYNC: parseExtras veja'),
    ('src/components/roksal/modules/zajem.tsx', 'shrinkThumb', 'ZAJEM: skrčitev sličice ≤ 120 KB'),
    ('src/components/roksal/modules/zajem.tsx', 'Dodaj posnetek', 'ZAJEM: gumb Dodaj posnetek ostaja'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'calibration: view.calib', 'KAMERA: saveOffline pošlje kalibracijo'),
]
for rel, needle, msg in ui:
    chk(src_has(rel, needle), msg)

print('── G) Idempotentno čiščenje ×2')
MEAS_IDS = [M_ID, LEG_ID, BAD_ID] if M_ID else []
CLEAN_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const measIds = __MEAS__;
  for (const id of measIds) {
    await p.measurementVersion.deleteMany({where:{measurementId:id}});
    await p.notificationDelivery.deleteMany({where:{event:{key:{contains:':'+id}}}});
    await p.notificationEvent.deleteMany({where:{key:{contains:':'+id}}});
    await p.notification.deleteMany({where:{title:'Meritev potrjena'}});
  }
  await p.measurement.deleteMany({where:{id:{in:measIds}}});
  const named=await p.workOrder.findMany({where:{title:{contains:'__TAG__'}},select:{id:true}});
  const ids=[...new Set([...named.map(w=>w.id),...__WO__])];
  for (const id of ids) {
    await p.measurementVersion.deleteMany({where:{measurement:{workOrderId:id}}});
    await p.measurement.deleteMany({where:{workOrderId:id}});
    await p.workOrderEvent.deleteMany({where:{workOrderId:id}});
    await p.workOrder.deleteMany({where:{id}});
  }
  for (const sid of __SESS__) {
    await p.capturePhoto.deleteMany({where:{sessionId:sid}});
    await p.captureSession.deleteMany({where:{id:sid}});
  }
  await p.syncOp.deleteMany({where:{deviceId:'__DEV__'}});
  await p.auditLog.deleteMany({where:{entityId:{in:[...measIds,...ids,...__SESS__,'__DEV__']}}});
  console.log('CLEAN_DONE');return p.$disconnect();
})()
'''
CLEAN = (CLEAN_JS
         .replace('__MEAS__', json.dumps(MEAS_IDS))
         .replace('__TAG__', TAG)
         .replace('__WO__', json.dumps([WO] if WO else []))
         .replace('__SESS__', json.dumps([SESS] if SESS else []))
         .replace('__DEV__', DEV))
for i in range(2):
    out, err = bun_ts(CLEAN)
    chk('CLEAN_DONE' in out, f'počiščenje testnih zapisov ({i + 1}.) {"" if "CLEAN_DONE" in out else err[:200]}')

print()
print(f'══ R486 REZULTAT: ✓ {PASS} / ✗ {FAIL} ══')
sys.exit(1 if FAIL else 0)
