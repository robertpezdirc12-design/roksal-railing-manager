#!/usr/bin/env python3
"""tests/r483.py — R483 (issue #8 — SMART VISION, Faza 5): POPORAVKI
PREPOZNAVANJA (5 konservativnih popravkov lažnih pozitivov) + regresija.

Preverja:
  A) RBAC (fail-closed): brez žetona 401 (POST/GET ar-snapshots, GET/PATCH
     scene-element); skladišče/proizvodnja 403; monter read-through 404.
  B) bun — OGRAJA IZ DETEKCIJE (F5/1): 2 vzporedni črti → OGRAJA z bbox iz
     dejanskega obsega črt (NE stara polnoširinska konstanta); 1 črta sama →
     NI OGRAJA (brez dokazov elementa ni); enakomeren lamelni niz → OGRAJA,
     NE STOPNICA; perspektivne stopnice → STOPNICA ostane.
  C) bun — GIBANJE = POVEZANE KOMPONENTE (F5/2): dve ločeni komponenti → 2
     okvirja; komponenta < 2 % kadra = šum (0 okvirjev); v analyzeFrame 2
     elementa z RAZLIČNIMA id; pokončna figura → OSEBA ločeno od široke
     OVIRE; stabilizeElements obdrži oba ločena ID-ja čez sličico.
  D) bun — PLOŠČICE/LES (F5/3): mreža fug (izotropna gostota) → PLOSCICE
     (zaupanje ≤ 0,5); topla vzdolžna vlakna → LES (≤ 0,5); asfalt NI les;
     BREZ izmerjene anizotropije razreda NE trdimo (NEZNANA — združljivo z
     r467); integracija: topla tla z vlakni → PODLAGA kind LES.
  E) bun — STOPNICA MONOTONOST (F5/4): cik-cak središč → NULL; podvojen y
     (razmak < 0,5 % višine) → NULL; monoton drif → veljavno ('desno');
     enakomeren vzorec s konstantnimi središči → še vedno stopnice
     ('globina' — r469 združljivost); vzorec s podestom → še vedno veljaven.
  F) bun — PODLAGA BBOX IZ MASKE (F5/5): tla od y=144 → bbox sledi maski
     (y0 ≈ 0,62, NE fiksna 2/3); maska prisotna; brez maske → pošten padec
     na staro območje.
  G) API sanitizacija: kind LES/PLOSCICE gre skozi POST+GET; OSEBA izpuščena
     (zasebnost §5); neveljaven razred → 400 brez vsebine; version 2 → scene
     zavržena, note ohranjen; bbox > 1 izločen.
  H) PATCH scene-element (R471 regresija): cls popravek 200 + revizija
     SCENE_EDIT; steps → ROCNO/IZMERJENO; kind PLOSCICE popravek; 404/400.
  I) Idempotentno čiščenje ×2 (direktno prek Prisma).
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R483-TEST'
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
  await p.user.deleteMany({where:{email:{contains:'r483'}}});
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

print('════ R483 — F5 popravki prepoznavanja (issue #8) ════')

# ── priprava ────────────────────────────────────────────────────────────────
out, _ = bun_ts(CLEAN)
chk('CLEAN_DONE' in out, 'predčiščenje')

admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')
proizvodnja = login('proizvodnja@roksal.si', 'Proizvodnja123!')

print('── A) RBAC (fail-closed)')
s, _ = callj('POST', '/api/ar-snapshots')
chk(s == 401, f'POST ar-snapshots brez žetona 401 ({s})')
s, _ = callj('GET', '/api/ar-snapshots/xxx/scene-element')
chk(s == 401, f'GET scene-element brez žetona 401 ({s})')
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', body={'elementId': 'el-1', 'cls': 'TLA'})
chk(s == 401, f'PATCH scene-element brez žetona 401 ({s})')
s, _ = callj('POST', '/api/ar-snapshots', skladisce, {'note': TAG})
chk(s == 403, f'skladišče POST ar-snapshots 403 ({s})')
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', skladisce, {'elementId': 'el-1', 'cls': 'TLA'})
chk(s == 403, f'skladišče PATCH scene-element 403 ({s})')
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', proizvodnja, {'elementId': 'el-1', 'status': 'SKRITO'})
chk(s == 403, f'proizvodnja PATCH scene-element 403 ({s})')
s, _ = callj('GET', '/api/ar-snapshots/xxx/scene-element', skladisce)
chk(s == 404, f'skladišče GET scene-element (read OK, neobstoječ → 404) ({s})')

print('── B–F) CORE/PERCEPCIJA (bun, sintetični kadri)')
CORE_JS = r'''
import { analyzeFrame, detectMotionBoxes } from './src/lib/scene-perception'
import {
  analyzeStairPattern, classifySurface, stabilizeElements,
  STAIR_MONO_MIN_GAP, STAIR_MONO_TOL_W,
} from './src/lib/scene-understanding-core'

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

// B) ograja: 2 vzporedni svetli črti (x 100..260) na sivi podlagi
const fence = mkFrame((x, y) => {
  if ((y === 80 || y === 120) && x >= 100 && x <= 260) return [255, 255, 255]
  if ((y === 81 || y === 121) && x >= 100 && x <= 260) return [0, 0, 0]
  return [110, 110, 110]
})
const fenceEls = analyzeFrame(fence.data, fence.gray, W, H, null, null)
const ogra = fenceEls.filter((e) => e.cls === 'OGRAJA')
const one = mkFrame((x, y) => {
  if (y === 80 && x >= 100 && x <= 260) return [255, 255, 255]
  if (y === 81 && x >= 100 && x <= 260) return [0, 0, 0]
  return [110, 110, 110]
})
const oneEls = analyzeFrame(one.data, one.gray, W, H, null, null)

// B) enakomeren lamelni niz (5 črt, enaki razmaki/razponi) — ograja, ne stopnice
const lamella = mkFrame((x, y) => {
  const ys = [60, 90, 120, 150, 180]
  for (const yy of ys) {
    if (y === yy) return [255, 255, 255]
    if (y === yy + 1) return [0, 0, 0]
  }
  return [110, 110, 110]
})
const lamEls = analyzeFrame(lamella.data, lamella.gray, W, H, null, null)

// B) prave stopnice s perspektivo (razponi 260→205, razmaki 45/35/28)
const stairs = mkFrame((x, y) => {
  const spec = [[60, 260], [105, 240], [140, 222], [168, 205]]
  for (const s of spec) {
    const from = W / 2 - s[1] / 2, to = W / 2 + s[1] / 2
    if (y === s[0] && x >= from && x <= to) return [255, 255, 255]
    if (y === s[0] + 1 && x >= from && x <= to) return [0, 0, 0]
  }
  return [110, 110, 110]
})
const stEls = analyzeFrame(stairs.data, stairs.gray, W, H, null, null)
const stairEl = stEls.find((e) => e.cls === 'STOPNICA')

// C) gibanje: dve ločeni komponenti na flat podlagi
const prevFlat = new Float32Array(W * H).fill(110)
const gray2blobs = new Float32Array(W * H).fill(110)
for (let y = 60; y < 140; y++) for (let x = 20; x < 80; x++) gray2blobs[y * W + x] = 200
for (let y = 40; y < 120; y++) for (let x = 200; x < 280; x++) gray2blobs[y * W + x] = 200
const boxes = detectMotionBoxes(gray2blobs, prevFlat, W, H)

const smallOnly = new Float32Array(W * H).fill(110)
for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) smallOnly[y * W + x] = 200
const smallBoxes = detectMotionBoxes(smallOnly, prevFlat, W, H)

// figura (55×170 pokončno) + široka ovira (100×80) — OSEBA ločeno od OVIRE
const flatData = new Uint8ClampedArray(W * H * 4)
for (let i = 0; i < W * H; i++) { flatData[i * 4] = 110; flatData[i * 4 + 1] = 110; flatData[i * 4 + 2] = 110; flatData[i * 4 + 3] = 255 }
const grayPerson = new Float32Array(W * H).fill(110)
for (let y = 30; y < 200; y++) for (let x = 110; x < 165; x++) grayPerson[y * W + x] = 200
for (let y = 30; y < 110; y++) for (let x = 200; x < 300; x++) grayPerson[y * W + x] = 200
const personEls = analyzeFrame(flatData, grayPerson, W, H, prevFlat, null)
const movers = personEls.filter((e) => e.cls === 'OSEBA' || e.cls === 'OVIRA')

// stabilizacija: isti vzorec rahlo premaknjen → ista, a RAZLIČNA ID-ja
const grayPerson2 = new Float32Array(W * H).fill(110)
for (let y = 32; y < 202; y++) for (let x = 112; x < 167; x++) grayPerson2[y * W + x] = 200
for (let y = 32; y < 112; y++) for (let x = 202; x < 302; x++) grayPerson2[y * W + x] = 200
const movers2 = analyzeFrame(flatData, grayPerson2, W, H, prevFlat, null).filter((e) => e.cls === 'OSEBA' || e.cls === 'OVIRA')
const stab = stabilizeElements(movers, movers2, { iouMin: 0.25, maxMisses: 1 })
const stabAgain = stabilizeElements(stab, movers2, { iouMin: 0.25, maxMisses: 1 })

// D) klasifikacija podlage
const vTiles = classifySurface({ brightness: 150, grayness: 0.4, greenRatio: 0.02, saturation: 0.25, edgeDensity: 0.22, textureVariance: 500, warmth: 0.2, grainAnisotropy: 0.05 })
const vWood = classifySurface({ brightness: 140, grayness: 0.3, greenRatio: 0.02, saturation: 0.3, edgeDensity: 0.08, textureVariance: 350, warmth: 0.6, grainAnisotropy: 0.4 })
const vAsfalt = classifySurface({ brightness: 40, grayness: 0.9, greenRatio: 0, saturation: 0.05, edgeDensity: 0.03, textureVariance: 100, warmth: 0.05, grainAnisotropy: 0.3 })
const vNoGrain = classifySurface({ brightness: 130, grayness: 0.35, greenRatio: 0.2, saturation: 0.5, edgeDensity: 0.3, textureVariance: 400, warmth: 0.3 })
const vBeton = classifySurface({ brightness: 160, grayness: 0.85, greenRatio: 0.02, saturation: 0.05, edgeDensity: 0.02, textureVariance: 150, warmth: 0.1 })

// D) integracija: topla tla z vodoravnimi vlakni → kind LES
const woodFloor = mkFrame((x, y) => (Math.floor(y / 6) % 2 === 0 ? [215, 185, 145] : [190, 160, 120]))
const wfEls = analyzeFrame(woodFloor.data, woodFloor.gray, W, H, null, null)
const wfPod = wfEls.find((e) => e.cls === 'PODLAGA')

// E) monotonost stopnic (jedro)
const zigzag = [{ y: 60, xFrom: 100, xTo: 220 }, { y: 90, xFrom: 150, xTo: 270 }, { y: 120, xFrom: 100, xTo: 220 }, { y: 150, xFrom: 150, xTo: 270 }]
const dupGap = [{ y: 60, xFrom: 30, xTo: 290 }, { y: 61, xFrom: 30, xTo: 290 }, { y: 90, xFrom: 30, xTo: 290 }, { y: 121, xFrom: 30, xTo: 290 }]
const drift = [{ y: 60, xFrom: 150, xTo: 270 }, { y: 90, xFrom: 120, xTo: 240 }, { y: 120, xFrom: 90, xTo: 210 }, { y: 150, xFrom: 60, xTo: 180 }]
const reg = [{ y: 60, xFrom: 30, xTo: 290 }, { y: 90, xFrom: 30, xTo: 290 }, { y: 120, xFrom: 30, xTo: 290 }, { y: 150, xFrom: 30, xTo: 290 }, { y: 180, xFrom: 30, xTo: 290 }]
const landing = [{ y: 60, xFrom: 30, xTo: 290 }, { y: 90, xFrom: 30, xTo: 290 }, { y: 120, xFrom: 30, xTo: 290 }, { y: 210, xFrom: 30, xTo: 290 }]

// F) PODLAGA bbox iz maske: tla od y=144, zgoraj svetlo
const floorImg = mkFrame((x, y) => (y >= 144 ? [120, 120, 120] : [235, 235, 235]))
const flEls = analyzeFrame(floorImg.data, floorImg.gray, W, H, null, null)
const pod = flEls.find((e) => e.cls === 'PODLAGA')

// F) brez maske: naključne barve po 8-px celicah → fallback na staro območje
let seed = 42
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const noiseData = new Uint8ClampedArray(W * H * 4)
const noiseGray = new Float32Array(W * H)
for (let cy = 0; cy < H / 8; cy++) {
  for (let cx = 0; cx < W / 8; cx++) {
    const r = Math.floor(rnd() * 256), g = Math.floor(rnd() * 256), b = Math.floor(rnd() * 256)
    for (let y = cy * 8; y < cy * 8 + 8; y++) {
      for (let x = cx * 8; x < cx * 8 + 8; x++) {
        const i = y * W + x
        noiseData[i * 4] = r; noiseData[i * 4 + 1] = g; noiseData[i * 4 + 2] = b; noiseData[i * 4 + 3] = 255
        noiseGray[i] = 0.299 * r + 0.587 * g + 0.114 * b
      }
    }
  }
}
const noiseEls = analyzeFrame(noiseData, noiseGray, W, H, null, null)
const noisePod = noiseEls.find((e) => e.cls === 'PODLAGA')

const out = {
  // B
  b_ogra_count: ogra.length,
  b_ogra_bbox: ogra[0] ? ogra[0].bbox : null,
  b_ogra_status: ogra[0] ? ogra[0].status : null,
  b_ogra_conf: ogra[0] ? ogra[0].confidence : null,
  b_one_ogra: oneEls.filter((e) => e.cls === 'OGRAJA').length,
  b_lam_ogra: lamEls.filter((e) => e.cls === 'OGRAJA').length,
  b_lam_stop: lamEls.filter((e) => e.cls === 'STOPNICA').length,
  b_stair_present: stairEl != null,
  b_stair_steps: stairEl ? stairEl.steps : null,
  // C
  c_boxes: boxes.length,
  c_box_x: boxes.length === 2 ? boxes[0][0] : null,
  c_small: smallBoxes.length,
  c_movers: movers.length,
  c_mover_ids: movers.length === 2 && movers[0].id !== movers[1].id,
  c_person: movers.some((e) => e.cls === 'OSEBA') && movers.some((e) => e.cls === 'OVIRA'),
  c_stab_ids: stab.length === 2 && stab[0].id !== stab[1].id &&
    stab.map((e) => e.id).join() === stabAgain.map((e) => e.id).join(),
  // D
  d_tiles: vTiles.kind, d_tiles_conf: vTiles.confidence,
  d_wood: vWood.kind, d_wood_conf: vWood.confidence,
  d_asfalt: vAsfalt.kind,
  d_nograin: vNoGrain.kind,
  d_beton: vBeton.kind,
  d_woodframe_kind: wfPod ? wfPod.kind : null,
  // E
  e_zigzag: analyzeStairPattern(zigzag, W, H) === null,
  e_dupgap: analyzeStairPattern(dupGap, W, H) === null,
  e_drift: analyzeStairPattern(drift, W, H) ? analyzeStairPattern(drift, W, H).ascent : null,
  e_reg: analyzeStairPattern(reg, W, H) ? analyzeStairPattern(reg, W, H).ascent : null,
  e_landing: analyzeStairPattern(landing, W, H) ? analyzeStairPattern(landing, W, H).landing : null,
  e_mono_gap: STAIR_MONO_MIN_GAP,
  e_mono_tol: STAIR_MONO_TOL_W,
  // F
  f_pod_present: pod != null,
  f_pod_y0: pod ? pod.bbox[1] : null,
  f_pod_h: pod ? pod.bbox[3] : null,
  f_mask_pts: pod && pod.maskPoints ? pod.maskPoints.length : 0,
  f_fallback_y0: noisePod ? noisePod.bbox[1] : null,
  f_fallback_mask: noisePod && noisePod.maskPoints ? noisePod.maskPoints.length : 0,
}
console.log(JSON.stringify(out))
'''
m = bun_out(CORE_JS)

print('── B) OGRAJA iz detekcije (scene-perception)')
chk(m.get('b_ogra_count') == 1, f'dve vzporedni črti → OGRAJA (1 element) ({m.get("b_ogra_count")})')
bb = m.get('b_ogra_bbox')
chk(isinstance(bb, list) and 0.2 < bb[0] < 0.4, f'bbox X iz dejanskega obsega črt (~0,30; ne stara konstanta 0,05) ({bb})')
chk(isinstance(bb, list) and 0.4 < bb[2] < 0.7, f'bbox širina iz razpona črt (~0,52; ne stara 0,9) ({bb})')
chk(isinstance(bb, list) and bb[1] < 90 / 240 and (bb[1] + bb[3]) > 120 / 240, f'bbox Y pokriva OBE črti (y=80..120) ({bb})')
chk(m.get('b_ogra_status') == 'NEJASNO' and m.get('b_ogra_conf') == 0.25, f'OGRAJA ostaja konservativna (NEJASNO/0,25) ({m.get("b_ogra_status")}/{m.get("b_ogra_conf")})')
chk(m.get('b_one_ogra') == 0, f'ena sama črta → NI OGRAJA (brez dokazov elementa ni) ({m.get("b_one_ogra")})')
chk(m.get('b_lam_stop') == 0 and m.get('b_lam_ogra') == 1, f'enakomeren lamelni niz → OGRAJA, NE STOPNICA ({m.get("b_lam_ogra")}/{m.get("b_lam_stop")})')
chk(m.get('b_stair_present') is True and m.get('b_stair_steps') == 4, f'perspektivne stopnice → STOPNICA ostane (4 nastopi) ({m.get("b_stair_steps")})')

print('── C) gibanje = povezane komponente (scene-perception)')
chk(m.get('c_boxes') == 2, f'dve ločeni komponenti → 2 okvirja ({m.get("c_boxes")})')
chk(isinstance(m.get('c_box_x'), (int, float)) and 0.6 < m.get('c_box_x') < 0.65, f'prvi okvir na desni skupini (~0,625) ({m.get("c_box_x")})')
chk(m.get('c_small') == 0, f'komponenta < 2 % kadra = šum → 0 okvirjev ({m.get("c_small")})')
chk(m.get('c_movers') == 2 and m.get('c_mover_ids') is True, f'analyzeFrame: 2 elementa z RAZLIČNIMA id ({m.get("c_movers")}/{m.get("c_mover_ids")})')
chk(m.get('c_person') is True, f'pokončna figura → OSEBA ločeno od široke OVIRE ({m.get("c_person")})')
chk(m.get('c_stab_ids') is True, f'stabilizacija: oba ID-ja stabilna in ločena čez sličico ({m.get("c_stab_ids")})')

print('── D) PLOŠČICE/LES (scene-understanding-core)')
chk(m.get('d_tiles') == 'PLOSCICE', f'mreža fug v obeh smereh → PLOSCICE ({m.get("d_tiles")})')
chk(isinstance(m.get('d_tiles_conf'), (int, float)) and m.get('d_tiles_conf') <= 0.5, f'PLOSCICE zaupanje ≤ 0,5 ({m.get("d_tiles_conf")})')
chk(m.get('d_wood') == 'LES', f'topel ton + vzdolžna vlakna → LES ({m.get("d_wood")})')
chk(isinstance(m.get('d_wood_conf'), (int, float)) and m.get('d_wood_conf') <= 0.5, f'LES zaupanje ≤ 0,5 ({m.get("d_wood_conf")})')
chk(m.get('d_asfalt') == 'ASFALT', f'asfalt NI les (negativni primer) ({m.get("d_asfalt")})')
chk(m.get('d_nograin') == 'NEZNANA' and m.get('d_beton') == 'BETON', f'brez izmerjene anizotropije NEZNANA (r467 združljivost: {m.get("d_nograin")}/{m.get("d_beton")})')
chk(m.get('d_woodframe_kind') == 'LES', f'integracija: topla tla z vlakni → PODLAGA kind LES ({m.get("d_woodframe_kind")})')

print('── E) STOPNICA monotonost (scene-understanding-core)')
chk(m.get('e_zigzag') is True, f'cik-cak središč → NI stopnišče ({m.get("e_zigzag")})')
chk(m.get('e_dupgap') is True, f'razmak < 0,5 % višine (podvojen y) → NI stopnišče ({m.get("e_dupgap")})')
chk(m.get('e_drift') == 'desno', f'monoton drif → veljavno stopnišče, smer desno ({m.get("e_drift")})')
chk(m.get('e_reg') == 'globina', f'enakomeren vzorec s konstantnimi središči → še vedno stopnice (r469) ({m.get("e_reg")})')
chk(m.get('e_landing') is True, f'vzorec s podestom → še vedno veljaven ({m.get("e_landing")})')
chk(m.get('e_mono_gap') == 0.005 and m.get('e_mono_tol') == 0.01, f'konstanti monotonosti izvoženi (0,005 / 0,01) ({m.get("e_mono_gap")}/{m.get("e_mono_tol")})')

print('── F) PODLAGA bbox iz maske (scene-perception)')
chk(m.get('f_pod_present') is True, 'PODLAGA vedno prisotna')
chk(isinstance(m.get('f_pod_y0'), (int, float)) and m.get('f_pod_y0') < 0.65, f'bbox Y0 sledi maski (~0,62; ne fiksna 2/3) ({m.get("f_pod_y0")})')
chk(isinstance(m.get('f_pod_h'), (int, float)) and m.get('f_pod_h') > 0.34, f'bbox višina iz maske (~0,38 > 1/3) ({m.get("f_pod_h")})')
chk(isinstance(m.get('f_mask_pts'), int) and m.get('f_mask_pts') >= 3, f'maska tal prisotna (≥3 točke) ({m.get("f_mask_pts")})')
chk(abs((m.get('f_fallback_y0') or 0) - 2 / 3) < 0.001 and m.get('f_fallback_mask') == 0, f'brez maske → pošten padec na staro območje [0, 2/3] ({m.get("f_fallback_y0")}/{m.get("f_fallback_mask")})')

snap_ids = []

print('── G) sanitizacija sceneUnderstanding (POST ar-snapshots)')
# G1: kind LES + PLOSCICE gresta skozi
scene_r483 = {
    'version': 1, 'at': 1760000000000,
    'elements': [
        el('el-les', kind='LES', bbox=[0, 0.6, 1, 0.4]),
        el('el-plos', cls='PODLAGA', kind='PLOSCICE', bbox=[0.05, 0.55, 0.9, 0.45]),
    ],
    'edits': [],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG, 'sceneUnderstanding': scene_r483})
chk(s == 201, f'POST z LES+PLOSCICE 201 ({s})')
sid = d.get('data', {}).get('id')
if sid: snap_ids.append(sid)
s, d = callj('GET', f'/api/ar-snapshots/{sid}/scene-element', monter)
els = {e['id']: e for e in d.get('data', {}).get('result', {}).get('elements', [])}
chk(els.get('el-les', {}).get('kind') == 'LES' and els.get('el-plos', {}).get('kind') == 'PLOSCICE',
    f"kind LES/PLOSCICE shranjena ({els.get('el-les', {}).get('kind')}/{els.get('el-plos', {}).get('kind')})")
# G2: OSEBA izpuščena (zasebnost §5), OSTALA elementa ostanejeta
scene_priv = {
    'version': 1, 'at': 1760000000000,
    'elements': [
        el('el-person', cls='OSEBA', bbox=[0.4, 0.15, 0.18, 0.6]),
        el('el-keep', cls='OVIRA', bbox=[0.1, 0.4, 0.2, 0.2]),
    ],
    'edits': [],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG + 'p', 'sceneUnderstanding': scene_priv})
chk(s == 201, f'POST z OSEBA+OVIRA 201 ({s})')
sid_p = d.get('data', {}).get('id')
if sid_p: snap_ids.append(sid_p)
s, d = callj('GET', f'/api/ar-snapshots/{sid_p}/scene-element', monter)
els = {e['id']: e for e in d.get('data', {}).get('result', {}).get('elements', [])}
chk('el-person' not in els and 'el-keep' in els, f"OSEBA se NE persistira (izpuščena), OVIRA ostane ({sorted(els)})")
# G3: neveljaven razred → brez vsebine 400
s, d = callj('POST', '/api/ar-snapshots', monter, {
    'sceneUnderstanding': {'version': 1, 'elements': [el(cls='OGRAJICA')], 'edits': []},
})
chk(s == 400, f'neveljaven razred izločen → 400 brez vsebine ({s})')
# G4: version 2 → scene zavržena, note ohranjen
s, d = callj('POST', '/api/ar-snapshots', monter, {
    'note': TAG + 'v', 'sceneUnderstanding': {'version': 2, 'elements': [el()], 'edits': []},
})
chk(s == 201, f'version 2 zavrže scene, note ohranjen → 201 ({s})')
sid_v = d.get('data', {}).get('id')
if sid_v: snap_ids.append(sid_v)
s, d = callj('GET', f'/api/ar-snapshots/{sid_v}', monter)
chk(s == 200 and d.get('data', {}).get('sceneJson') is None, f'sceneJson ni shranjen ob zavrnjeni verziji ({s})')
# G5: bbox > 1 izločen, veljaven ostane
mixed = [el('el-bad', bbox=[0, 0, 2, 2]), el('el-ok', kind='PLOSCICE', bbox=[0.1, 0.5, 0.4, 0.3])]
s, d = callj('POST', '/api/ar-snapshots', monter, {
    'note': TAG + 'm', 'sceneUnderstanding': {'version': 1, 'elements': mixed, 'edits': []},
})
chk(s == 201, f'mešani elementi → 201 ({s})')
sid_m = d.get('data', {}).get('id')
if sid_m: snap_ids.append(sid_m)
s, d = callj('GET', f'/api/ar-snapshots/{sid_m}', monter)
try:
    ids = [e['id'] for e in json.loads(d['data']['sceneJson'])['elements']]
    chk('el-ok' in ids and 'el-bad' not in ids, 'bbox >1 izločen, veljaven ostane')
except Exception as ex:
    bad(f'sceneJson berljiv: {ex}')

print('── H) PATCH scene-element (R471 regresija)')
# H1: cls popravek → 200 + revizija
s, d = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {'elementId': 'el-les', 'cls': 'TLA'})
chk(s == 200, f'PATCH cls 200 ({s})')
chk(audit_has(admin, 'SCENE_EDIT', sid), 'revizija SCENE_EDIT zapisana')
# H2: displayed kaže popravek, izvirnik nespremenjen
s, d = callj('GET', f'/api/ar-snapshots/{sid}/scene-element', monter)
res = d.get('data', {}).get('result', {})
disp = d.get('data', {}).get('displayed', [])
orig = next((e for e in res.get('elements', []) if e['id'] == 'el-les'), {})
disp_el = next((e for e in disp if e['id'] == 'el-les'), {})
chk(orig.get('cls') == 'PODLAGA' and disp_el.get('cls') == 'TLA' and disp_el.get('source') == 'ROCNO',
    f'izvirnik nespremenjen, displayed kaže popravek ({orig.get("cls")}/{disp_el.get("cls")}/{disp_el.get("source")})')
# H3: steps popravek → ROCNO/IZMERJENO (R469/R471 pot)
scene_st = {
    'version': 1, 'at': 1760000000000,
    'elements': [el('el-stair', cls='STOPNICA', bbox=[0.05, 0.2, 0.9, 0.5], steps=6, ascent='desno')],
    'edits': [],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG + 's', 'sceneUnderstanding': scene_st})
sid_s = d.get('data', {}).get('id')
if sid_s: snap_ids.append(sid_s)
s, d = callj('PATCH', f'/api/ar-snapshots/{sid_s}/scene-element', monter, {'elementId': 'el-stair', 'steps': 7})
chk(s == 200, f'PATCH steps 200 ({s})')
s, d = callj('GET', f'/api/ar-snapshots/{sid_s}/scene-element', monter)
disp = next((e for e in d.get('data', {}).get('displayed', []) if e['id'] == 'el-stair'), {})
chk(disp.get('steps') == 7 and disp.get('source') == 'ROCNO' and disp.get('geomStatus') == 'IZMERJENO',
    f'PATCH steps → ROCNO/IZMERJENO ({disp.get("steps")}/{disp.get("source")}/{disp.get("geomStatus")})')
# H4: kind PLOSCICE prek PATCH
s, d = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {'elementId': 'el-plos', 'kind': 'LES'})
chk(s == 200, f'PATCH kind PLOSCICE→LES 200 ({s})')
s, d = callj('GET', f'/api/ar-snapshots/{sid}/scene-element', monter)
disp = next((e for e in d.get('data', {}).get('displayed', []) if e['id'] == 'el-plos'), {})
chk(disp.get('kind') == 'LES', f'PATCH kind prikazan ({disp.get("kind")})')
# H5: napake — 404/400
s, _ = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {'elementId': 'ne-obstaja', 'cls': 'TLA'})
chk(s == 404, f'neobstoječ elementId 404 ({s})')
s, _ = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {'elementId': 'el-ok'})
chk(s == 400, f'brez polj 400 ({s})')
s, _ = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {'elementId': 'el-ok', 'kind': 'PAPRIKA'})
chk(s == 400, f'neveljaven kind 400 ({s})')

print('── I) čiščenje ×2')
for i in range(2):
    out, _ = bun_ts(CLEAN)
    chk('CLEAN_DONE' in out, f'počiščenje testnih zapisov ({i + 1}.)')

print()
print(f'══ R483 REZULTAT: ✓ {PASS} / ✗ {FAIL} ══')
sys.exit(1 if FAIL else 0)
