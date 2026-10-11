#!/usr/bin/env python3
"""tests/r485.py — R485 (issue #8 — SMART VISION): MANJKAJOČE ZMOŽNOSTI
ZAZNAVANJA — navpični detektor stebrov, NEZNANO ročna oznaka, odrezan rob
hint, angleDeg popravek kota roba.

Preverja:
  A) RBAC (fail-closed): brez žetona 401 (POST/GET/PATCH scene-element);
     skladišče/proizvodnja 403 na POST; monter read-through 404.
  B) bun — DETEKTOR STEBROV (perception): 4 periodične navpičnice → OGRAJA
     (NEJASNO/0,25 — NIKOLI PREPOZNANO) z bbox iz razpona stebrov in
     postCount OCENO; 2 navpičnici → NI elementa (lahko okno);
     neperiodične navpičnice (okenski križ) → NI elementa; kratke
     navpičnice → NI elementa; horizontalna ograja ostaja brez postCount.
  C) bun — ODREZAN ROB HINT (core): element sega čez rob kadra →
     „Objekt ni v celoti v kadru — stopite nazaj …“; znotraj → brez hinta;
     PODLAGA do dna in ROB ob robu NE sprožita (legitimni na robu).
  D) bun — ANGLEDEG (core): applyEdits normalizira 350 → −10 (črta roba je
     neusmerjena, mod 180) + IZMERJENO/ROCNO; 12,34 → 12,3; sanitize
     popravka zavrže 400 (izven −90..360); element postCount/label.
  E) API — POST scene-element (ROČNA OZNAKA): 201 + element z vir ROCNO in
     confidence 1 se persistira (GET result + displayed); revizija
     SCENE_ELEMENT_ADD; OSEBA ZAVRNJEN (zasebnost §5); neveljaven razred /
     slab bbox / w=0 / brez cls → 400; neobstoječ posnetek → 404.
  F) API — PATCH angleDeg: 200 na ROB elementu; displayed kaže −10,
     izvirnik nespremenjen; 400 izven obsega; 15,25 → 15,3; revizija
     SCENE_EDIT z before/after; postCount preživi persistenco.
  G) sanitizacija sceneUnderstanding: ročni NEZNANO element (label) preživi
     POST+GET; OSEBA izpuščena (zasebnost — regresija); element angleDeg > 90
     izpuščen.
  H) Idempotentno čiščenje ×2 (direktno prek Prisma).
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R485-TEST'
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

def audit_has (token, action, entityId=None):
    s, d = callj('GET', f'/api/audit?action={action}&limit=100', token)
    rows = d.get('data', []) if s == 200 else []
    for e in rows:
        if entityId and e.get('entityId') != entityId:
            continue
        return True
    return False

CLEAN_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  await p.arSnapshot.deleteMany({where:{OR:[{note:{contains:'__TAG__'}},{scene:{contains:'__TAG__'}}]}});
  console.log('CLEAN_DONE');return p.$disconnect();
})()
'''
CLEAN = CLEAN_JS.replace('__TAG__', TAG)

def el (eid='el-1', cls='PODLAGA', status='VERJETNO', source='LOKALNO',
        bbox=None, confidence=0.5, kind='BETON', **extra):
    return {
        'id': eid, 'cls': cls, 'status': status, 'source': source,
        'confidence': confidence, 'bbox': bbox or [0, 2 / 3, 1, 1 / 3],
        'kind': kind, 'at': 1760000000000, **extra,
    }

# ═══════════════════════════════ TEST ═══════════════════════════════════════

print('════ R485 — manjkajoče zmožnosti zaznavanja (issue #8) ════')

# ── priprava ────────────────────────────────────────────────────────────────
out, _ = bun_ts(CLEAN)
chk('CLEAN_DONE' in out, 'predčiščenje')

admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')
proizvodnja = login('proizvodnja@roksal.si', 'Proizvodnja123!')

print('── A) RBAC (fail-closed)')
s, _ = callj('POST', '/api/ar-snapshots/xxx/scene-element', body={'cls': 'NEZNANO', 'bbox': [0.3, 0.3, 0.2, 0.2]})
chk(s == 401, f'POST scene-element brez žetona 401 ({s})')
s, _ = callj('GET', '/api/ar-snapshots/xxx/scene-element')
chk(s == 401, f'GET scene-element brez žetona 401 ({s})')
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', body={'elementId': 'el-1', 'angleDeg': 10})
chk(s == 401, f'PATCH scene-element (angleDeg) brez žetona 401 ({s})')
s, _ = callj('POST', '/api/ar-snapshots/xxx/scene-element', skladisce, {'cls': 'NEZNANO', 'bbox': [0.3, 0.3, 0.2, 0.2]})
chk(s == 403, f'skladišče POST scene-element 403 ({s})')
s, _ = callj('POST', '/api/ar-snapshots/xxx/scene-element', proizvodnja, {'cls': 'NEZNANO', 'bbox': [0.3, 0.3, 0.2, 0.2]})
chk(s == 403, f'proizvodnja POST scene-element 403 ({s})')
s, _ = callj('POST', '/api/ar-snapshots/xxx/scene-element', monter, {'cls': 'NEZNANO', 'bbox': [0.3, 0.3, 0.2, 0.2]})
chk(s == 404, f'monter POST scene-element na neobstoječem posnetku 404 (read-through) ({s})')
s, _ = callj('GET', '/api/ar-snapshots/xxx/scene-element', skladisce)
chk(s == 404, f'skladišče GET scene-element (read OK, neobstoječ → 404) ({s})')

print('── B–D) CORE/PERCEPCIJA (bun, sintetični kadri)')
CORE_JS = r'''
import { analyzeFrame, detectPostLines } from './src/lib/scene-perception'
import { applyEdits, nextStepGuidance, sanitizeSceneResult } from './src/lib/scene-understanding-core'

const W = 320, H = 240
function mkFrame (paint) {
  const data = new Uint8ClampedArray(W * H * 4)
  const gray = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = paint(x, y)
      const i = y * W + x
      data[i * 4] = c[0]; data[i * 4 + 1] = c[1]; data[i * 4 + 2] = c[2]; data[i * 4 + 3] = 255
      gray[i] = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
    }
  }
  return { data, gray }
}

// B) periodična vrsta stebrov: 4 svetli stolpci (x 40/120/200/280, y 40..200)
const posts = mkFrame((x, y) => {
  for (const cx of [40, 120, 200, 280]) {
    if (Math.abs(x - cx) <= 1 && y >= 40 && y <= 200) return [255, 255, 255]
  }
  return [110, 110, 110]
})
const det = detectPostLines(posts.gray, W, H)
const postEls = analyzeFrame(posts.data, posts.gray, W, H, null, null)
const ogra = postEls.filter((e) => e.cls === 'OGRAJA')

// B) dve navpičnici (okvir okna) — NI zadostna dokaza
const two = mkFrame((x, y) => {
  for (const cx of [40, 280]) {
    if (Math.abs(x - cx) <= 1 && y >= 40 && y <= 200) return [255, 255, 255]
  }
  return [110, 110, 110]
})

// B) neperiodične navpičnice (okenski križ: 40 / 200 / 260)
const win = mkFrame((x, y) => {
  for (const cx of [40, 200, 260]) {
    if (Math.abs(x - cx) <= 1 && y >= 60 && y <= 200) return [255, 255, 255]
  }
  return [110, 110, 110]
})

// B) kratke navpičnice (y 100..130 = 13 % višine < 25 %)
const short = mkFrame((x, y) => {
  for (const cx of [40, 120, 200, 280]) {
    if (Math.abs(x - cx) <= 1 && y >= 100 && y <= 130) return [255, 255, 255]
  }
  return [110, 110, 110]
})

// B) horizontalna ograja (2 črti) — postCount NE sme biti nastavljen
const fence = mkFrame((x, y) => {
  if ((y === 80 || y === 120) && x >= 100 && x <= 260) return [255, 255, 255]
  if ((y === 81 || y === 121) && x >= 100 && x <= 260) return [0, 0, 0]
  return [110, 110, 110]
})
const fEls = analyzeFrame(fence.data, fence.gray, W, H, null, null)

// C) odrezan rob — hint (jedro, sintetični elementi)
const el = (id, cls, bbox) => ({ id, cls, status: 'NEJASNO', source: 'LOKALNO', confidence: 0.3, bbox, at: 1 })
const t_edge_r = nextStepGuidance([el('a', 'OGRAJA', [0.5, 0.2, 0.55, 0.3])]) // x+w=1.05 → sega čez
const t_edge_b = nextStepGuidance([el('a', 'OVIRA', [0.3, 0.6, 0.3, 0.45])])   // y+h=1.05 → sega čez
const t_edge_l = nextStepGuidance([el('a', 'STOPNICA', [0.01, 0.2, 0.5, 0.3])]) // x=0.01 < 0.02
const t_inside = nextStepGuidance([el('a', 'OGRAJA', [0.2, 0.2, 0.5, 0.3])])
const t_floor = nextStepGuidance([el('a', 'PODLAGA', [0, 0.67, 1, 0.33])])   // tla do dna — legitimno
const t_rob = nextStepGuidance([el('a', 'ROB', [0.001, 0.3, 0.5, 0.05])])     // ROB ob robu — izjema
const t_person = nextStepGuidance([el('a', 'OSEBA', [0.99, 0.1, 0.01, 0.5])]) // OSEBA — lasten napotek

// D) angleDeg — applyEdits normalizacija (črta roba je neusmerjena: mod 180)
const mkRes = (angleDeg) => ({
  version: 1, at: 1,
  elements: [{ id: 'r', cls: 'ROB', status: 'NEJASNO', source: 'LOKALNO', confidence: 0.3, bbox: [0.1, 0.3, 0.8, 0.06], ...(angleDeg != null ? { angleDeg } : {}), at: 1 }],
  edits: [],
})
const d350 = applyEdits({ ...mkRes(5), elements: [JSON.parse(JSON.stringify(mkRes(5).elements[0]))], edits: [{ elementId: 'r', angleDeg: 350, by: 't', at: 2 }] })
const d1234 = applyEdits({ ...mkRes(null), elements: [JSON.parse(JSON.stringify(mkRes(null).elements[0]))], edits: [{ elementId: 'r', angleDeg: 12.34, by: 't', at: 2 }] })
const d170 = applyEdits({ ...mkRes(null), elements: [JSON.parse(JSON.stringify(mkRes(null).elements[0]))], edits: [{ elementId: 'r', angleDeg: 170, by: 't', at: 2 }] })
const d90 = applyEdits({ ...mkRes(null), elements: [JSON.parse(JSON.stringify(mkRes(null).elements[0]))], edits: [{ elementId: 'r', angleDeg: 90, by: 't', at: 2 }] })

// D) sanitize: popravek z angleDeg 400 IZPUSTIJO (izven −90..360); 355,5 ohranijo
//    element: postCount 5 veljaven, 99 izpuščen; label okoriščen na 60
const san = sanitizeSceneResult({
  version: 1, at: 1,
  elements: [
    { id: 'g', cls: 'OGRAJA', status: 'NEJASNO', source: 'LOKALNO', confidence: 0.25, bbox: [0.1, 0.3, 0.7, 0.4], postCount: 5, at: 1 },
    { id: 'h', cls: 'OGRAJA', status: 'NEJASNO', source: 'LOKALNO', confidence: 0.25, bbox: [0.1, 0.3, 0.7, 0.4], postCount: 99, at: 1 },
    { id: 'i', cls: 'NEZNANO', status: 'PREPOZNANO', source: 'ROCNO', confidence: 1, bbox: [0.3, 0.3, 0.2, 0.2], label: '  ograja za njimi  ', at: 1 },
    { id: 'j', cls: 'ROB', status: 'NEJASNO', source: 'LOKALNO', confidence: 0.3, bbox: [0.1, 0.3, 0.8, 0.06], angleDeg: 120, at: 1 },
  ],
  edits: [
    { elementId: 'g', angleDeg: 355.5, by: 't', at: 2 },
    { elementId: 'g', angleDeg: 400, by: 't', at: 3 },
  ],
})
const g = san.elements.find((e) => e.id === 'g')
const h = san.elements.find((e) => e.id === 'h')
const i = san.elements.find((e) => e.id === 'i')
const j = san.elements.find((e) => e.id === 'j')

const out = {
  // B
  b_det: det != null,
  b_det_count: det ? det.posts.length : 0,
  b_ogra: ogra.length,
  b_ogra_status: ogra[0] ? ogra[0].status : null,
  b_ogra_conf: ogra[0] ? ogra[0].confidence : null,
  b_ogra_bbox: ogra[0] ? ogra[0].bbox : null,
  b_ogra_posts: ogra[0] ? ogra[0].postCount : null,
  b_two: detectPostLines(two.gray, W, H) === null,
  b_two_ogra: analyzeFrame(two.data, two.gray, W, H, null, null).filter((e) => e.cls === 'OGRAJA').length,
  b_win: detectPostLines(win.gray, W, H) === null,
  b_short: detectPostLines(short.gray, W, H) === null,
  b_fence_ogra: fEls.filter((e) => e.cls === 'OGRAJA').length,
  b_fence_postc: fEls.filter((e) => e.cls === 'OGRAJA').map((e) => e.postCount),
  // C
  c_r: t_edge_r.includes('ni v celoti v kadru') && t_edge_r.includes('stopite nazaj'),
  c_b: t_edge_b.includes('ni v celoti v kadru'),
  c_l: t_edge_l.includes('ni v celoti v kadru'),
  c_inside: !t_inside.includes('ni v celoti v kadru'),
  c_floor: !t_floor.includes('ni v celoti v kadru'),
  c_rob: !t_rob.includes('ni v celoti v kadru'),
  c_person: t_person.includes('Oseba'),
  // D
  d_350: d350[0].angleDeg, d_350_g: d350[0].geomStatus, d_350_s: d350[0].source,
  d_1234: d1234[0].angleDeg,
  d_170: d170[0].angleDeg,
  d_90: d90[0].angleDeg,
  d_edit355: san.edits.some((e) => e.angleDeg === 355.5),
  d_edit400: san.edits.every((e) => e.angleDeg !== 400),
  d_post5: g ? g.postCount : null,
  d_post99: h ? h.postCount : undefined,
  d_label: i ? i.label : null,
  d_angle120: j ? j.angleDeg : '??',
}
console.log(JSON.stringify(out))
'''
m = bun_out(CORE_JS)

print('── B) detektor stebrov → OGRAJA (scene-perception)')
chk(m.get('b_det') is True, f'periodične navpičnice → detekcija stebrov ({m.get("b_det")})')
chk(m.get('b_det_count') == 4, f'4 zaznani stebri ({m.get("b_det_count")})')
chk(m.get('b_ogra') == 1, f'analyzeFrame: vrsta stebrov → 1 element OGRAJA ({m.get("b_ogra")})')
chk(m.get('b_ogra_status') == 'NEJASNO' and m.get('b_ogra_conf') == 0.25,
    f'OGRAJA iz stebrov je KONSERVATIVNA (NEJASNO/0,25 — nikoli PREPOZNANO) ({m.get("b_ogra_status")}/{m.get("b_ogra_conf")})')
bb = m.get('b_ogra_bbox')
chk(isinstance(bb, list) and 0.08 < bb[0] < 0.16, f'bbox X iz razpona stebrov (~0,115) ({bb})')
chk(isinstance(bb, list) and 0.7 < bb[2] < 0.85, f'bbox širina iz razpona stebrov (~0,77) ({bb})')
chk(isinstance(bb, list) and 0.1 < bb[1] < 0.2 and 0.65 < bb[3] < 0.78, f'bbox Y pokriva višino stebrov (~0,14/~0,72) ({bb})')
chk(m.get('b_ogra_posts') == 4, f'postCount = 4 (OCENA števila stebrov) ({m.get("b_ogra_posts")})')
chk(m.get('b_two') is True and m.get('b_two_ogra') == 0, f'dve navpičnici (okno) → NI OGRAJE ({m.get("b_two")}/{m.get("b_two_ogra")})')
chk(m.get('b_win') is True, f'neperiodične navpičnice (okenski križ) → NI OGRAJE ({m.get("b_win")})')
chk(m.get('b_short') is True, f'kratke navpičnice (< 25 % višine) → NI OGRAJE ({m.get("b_short")})')
chk(m.get('b_fence_ogra') == 1 and m.get('b_fence_postc') == [None],
    f'horizontalna ograja ostaja BREZ postCount (razlikovanje virov) ({m.get("b_fence_ogra")}/{m.get("b_fence_postc")})')

print('── C) odrezan rob — hint (scene-understanding-core)')
chk(m.get('c_r') is True, f'objekt čez desni rob → „ni v celoti v kadru — stopite nazaj“ ({m.get("c_r")})')
chk(m.get('c_b') is True, f'objekt čez spodnji rob → hint ({m.get("c_b")})')
chk(m.get('c_l') is True, f'objekt ob levem robu (x < 0,02) → hint ({m.get("c_l")})')
chk(m.get('c_inside') is True, f'objekt znotraj kadra → BREZ hinta ({m.get("c_inside")})')
chk(m.get('c_floor') is True, f'PODLAGA do dna kadra → BREZ hinta (tla so legitimno do dna) ({m.get("c_floor")})')
chk(m.get('c_rob') is True, f'ROB ob robu kadra → BREZ hinta (izjema — rob je legitimno ob robu) ({m.get("c_rob")})')
chk(m.get('c_person') is True, f'OSEBA ob robu → lasten napotek o zakritju (ne „stopi nazaj“) ({m.get("c_person")})')

print('── D) angleDeg popravek kota ROBA (core)')
chk(m.get('d_350') == -10, f'applyEdits 350° → −10° (normalizacija mod 180 — neusmerjena črta) ({m.get("d_350")})')
chk(m.get('d_350_g') == 'IZMERJENO' and m.get('d_350_s') == 'ROCNO', f'vir ROCNO + IZMERJENO (analog naklonu) ({m.get("d_350_g")}/{m.get("d_350_s")})')
chk(m.get('d_1234') == 12.3, f'12,34° → 12,3° (1 decimala) ({m.get("d_1234")})')
chk(m.get('d_170') == -10, f'170° → −10° (mod 180) ({m.get("d_170")})')
chk(m.get('d_90') == -90, f'90° → −90° (navpična črta, ±90 enakovredni) ({m.get("d_90")})')
chk(m.get('d_edit355') is True and m.get('d_edit400') is True, f'sanitize popravka: 355,5 ohranjen, 400 izpuščen ({m.get("d_edit355")}/{m.get("d_edit400")})')
chk(m.get('d_post5') == 5 and m.get('d_post99') is None, f'element postCount 5 veljaven / 99 izpuščen ({m.get("d_post5")}/{m.get("d_post99")})')
chk(m.get('d_label') == 'ograja za njimi', f'label ročne oznake okoriščen ({m.get("d_label")!r})')
chk(m.get('d_angle120') is None, f'element angleDeg 120 (izven ±90) izpuščen ({m.get("d_angle120")})')

snap_ids = []

print('── E) POST scene-element — ročno dodana NEZNANO oznaka')
# E1: posnetek z ROB elementom (za F) + OGRAJA s postCount
scene_base = {
    'version': 1, 'at': 1760000000000,
    'elements': [
        el('el-rob', cls='ROB', bbox=[0.1, 0.3, 0.8, 0.06], angleDeg=4.5),
        el('el-ogra', cls='OGRAJA', bbox=[0.1, 0.35, 0.7, 0.4], postCount=5),
    ],
    'edits': [],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG, 'sceneUnderstanding': scene_base})
chk(s == 201, f'POST posnetek z ROB/OGRAJA 201 ({s})')
sid = d.get('data', {}).get('id')
if sid: snap_ids.append(sid)
s, d = callj('GET', f'/api/ar-snapshots/{sid}/scene-element', monter)
res = d.get('data', {}).get('result', {})
chk(next((e.get('postCount') for e in res.get('elements', []) if e.get('id') == 'el-ogra'), None) == 5,
    'postCount preživi persistenco (POST+GET)')

# E2: ročna oznaka NEZNANO → 201
s, d = callj('POST', f'/api/ar-snapshots/{sid}/scene-element', monter,
             {'cls': 'NEZNANO', 'bbox': [0.42, 0.44, 0.2, 0.3], 'label': 'neprepoznano območje ob ograji'})
chk(s == 201, f'POST scene-element (NEZNANO) 201 ({s})')
new_el = d.get('data', {}).get('element', {})
chk(new_el.get('source') == 'ROCNO' and new_el.get('confidence') == 1, f'nov element: vir ROCNO + confidence 1 ({new_el.get("source")}/{new_el.get("confidence")})')

# E3: persistenca + prikaz
s, d = callj('GET', f'/api/ar-snapshots/{sid}/scene-element', monter)
res = d.get('data', {}).get('result', {})
disp = d.get('data', {}).get('displayed', [])
added = next((e for e in res.get('elements', []) if e.get('id') == new_el.get('id')), None)
chk(added is not None and added.get('label') == 'neprepoznano območje ob ograji',
    f'ročna oznaka persistirana z label ({added})')
chk(next((e.get('cls') for e in disp if e.get('id') == new_el.get('id')), None) == 'NEZNANO',
    'displayed prikaže ročno oznako (applyEdits)')
chk(len(res.get('elements', [])) == 3, f'izvirna 2 elementa + 1 ročni = 3 ({len(res.get("elements", []))})')

# E4: revizija
chk(audit_has(admin, 'SCENE_ELEMENT_ADD', sid), 'revizija SCENE_ELEMENT_ADD zapisana')

# E5–E10: zavrnitve
s, _ = callj('POST', f'/api/ar-snapshots/{sid}/scene-element', monter, {'cls': 'OSEBA', 'bbox': [0.4, 0.1, 0.2, 0.6]})
chk(s == 400, f'OSEBA ZAVRNJENA (zasebnost §5) → 400 ({s})')
s, _ = callj('POST', f'/api/ar-snapshots/{sid}/scene-element', monter, {'cls': 'VESOLJE', 'bbox': [0.3, 0.3, 0.2, 0.2]})
chk(s == 400, f'neveljaven razred → 400 ({s})')
s, _ = callj('POST', f'/api/ar-snapshots/{sid}/scene-element', monter, {'cls': 'NEZNANO'})
chk(s == 400, f'brez bbox → 400 ({s})')
s, _ = callj('POST', f'/api/ar-snapshots/{sid}/scene-element', monter, {'cls': 'NEZNANO', 'bbox': [0.3, 0.3, 1.4, 0.2]})
chk(s == 400, f'bbox > 1 → 400 ({s})')
s, _ = callj('POST', f'/api/ar-snapshots/{sid}/scene-element', monter, {'cls': 'NEZNANO', 'bbox': [0.3, 0.3, 0.0, 0.2]})
chk(s == 400, f'bbox w = 0 → 400 ({s})')
s, _ = callj('POST', f'/api/ar-snapshots/ne-obstaja/scene-element', monter, {'cls': 'NEZNANO', 'bbox': [0.3, 0.3, 0.2, 0.2]})
chk(s == 404, f'neobstoječ posnetek → 404 ({s})')

print('── F) PATCH angleDeg (popravek kota roba)')
s, d = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {'elementId': 'el-rob', 'angleDeg': 350})
chk(s == 200, f'PATCH angleDeg 350 → 200 ({s})')
s, d = callj('GET', f'/api/ar-snapshots/{sid}/scene-element', monter)
res = d.get('data', {}).get('result', {})
disp = d.get('data', {}).get('displayed', [])
orig = next((e for e in res.get('elements', []) if e.get('id') == 'el-rob'), {})
disp_el = next((e for e in disp if e.get('id') == 'el-rob'), {})
chk(disp_el.get('angleDeg') == -10 and orig.get('angleDeg') == 4.5,
    f'displayed kot −10 (350 normalizirano), izvirnik nespremenjen 4,5 ({disp_el.get("angleDeg")}/{orig.get("angleDeg")})')
chk(disp_el.get('source') == 'ROCNO' and disp_el.get('geomStatus') == 'IZMERJENO',
    f'popravek kota: vir ROCNO + IZMERJENO ({disp_el.get("source")}/{disp_el.get("geomStatus")})')
s, _ = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {'elementId': 'el-rob', 'angleDeg': 400})
chk(s == 400, f'PATCH angleDeg 400 → 400 izven obsega ({s})')
s, _ = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {'elementId': 'el-rob', 'angleDeg': -91})
chk(s == 200, f'PATCH angleDeg −91 veljaven (padec kamere v levo) ({s})')
s, _ = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {'elementId': 'el-rob', 'angleDeg': 15.25})
chk(s == 200, f'PATCH angleDeg 15,25 → 200 ({s})')
s, d = callj('GET', f'/api/ar-snapshots/{sid}/scene-element', monter)
disp_el = next((e for e in d.get('data', {}).get('displayed', []) if e.get('id') == 'el-rob'), {})
chk(disp_el.get('angleDeg') == 15.3, f'15,25 → 15,3 (zadnji popravek prevlada, 1 decimala) ({disp_el.get("angleDeg")})')
chk(audit_has(admin, 'SCENE_EDIT', sid), 'revizija SCENE_EDIT zapisana (before/after angleDeg)')

print('── G) sanitizacija sceneUnderstanding (regresija + novi)')
# G1: ročni NEZNANO element persistira skozi POST ar-snapshots (živi prikaz → zajem)
scene_manual = {
    'version': 1, 'at': 1760000000000,
    'elements': [
        el('el-man', cls='NEZNANO', status='PREPOZNANO', source='ROCNO', bbox=[0.3, 0.3, 0.2, 0.2], confidence=1, label='ročna oznaka monterja'),
        el('el-pers', cls='OSEBA', bbox=[0.4, 0.15, 0.18, 0.6]),
    ],
    'edits': [],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG + 'm', 'sceneUnderstanding': scene_manual})
chk(s == 201, f'POST z ročnim NEZNANO + OSEBA 201 ({s})')
sid_m = d.get('data', {}).get('id')
if sid_m: snap_ids.append(sid_m)
s, d = callj('GET', f'/api/ar-snapshots/{sid_m}/scene-element', monter)
els = {e['id']: e for e in d.get('data', {}).get('result', {}).get('elements', [])}
chk('el-man' in els and els['el-man'].get('label') == 'ročna oznaka monterja',
    f'ročni NEZNANO preživi persistenco z label ({sorted(els)})')
chk('el-pers' not in els, f'OSEBA izpuščena (zasebnost §5 — regresija) ({sorted(els)})')

print('── H) čiščenje ×2')
for i in range(2):
    out, _ = bun_ts(CLEAN)
    chk('CLEAN_DONE' in out, f'počiščenje testnih zapisov ({i + 1}.)')

print()
print(f'══ R485 REZULTAT: ✓ {PASS} / ✗ {FAIL} ══')
sys.exit(1 if FAIL else 0)
