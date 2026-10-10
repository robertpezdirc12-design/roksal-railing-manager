#!/usr/bin/env python3
"""tests/r473.py — R473 MERILNI MODEL (issue #9 §3 HOVER PARITY — Faza 1)

Preverja:
  A) RBAC (fail-closed): GET model brez žetona 401; skladišče 403;
     monter z nalogom v projektu 200; monter brez nalog/avtorstva 403 (IDOR).
  B) CORE LOGIKA (bun, čista):
     buildPlanModel — raven tek → kolinearne XY koordinate, ključi seg-N,
     totalPlanCm/closureGapCm; vogal 90° → LEVO (privzeto, predpostavka!) in
     DESNO (izrecno); teren → z vozlišč; statusi/verifikacije se prenesejo
     1:1 iz tekača; verifiedShare; σ (pravilo > ocena metode > ni podatka);
     parseTurns ('LD', neveljaven → null); nearestSegment (zadetek/zamik);
     diffModels (dolžina ±, tolerance, odstopanja); turnFromInterior;
     project3d (osni točki).
  C) API /api/fence-run/[id]/model:
     izpeljava iz tekača (konec (400, 400) pri LEVO); ?turns=D → (400, −400)
     s predpostavko ZAVOJ_SMER_NASTAVLJENA; ?turns=LDX → 400; 404 neznan;
     verifikacija segmenta → status VERIFIED + verifiedCm v modelu;
     EngineeringRule tol_pozicija_modela → σ = RULE (4 cm), sicer OCENA_METODE;
     tolerance.sigmaRule/dolzinaRule v odgovoru.
  D) Regresija: GET /api/fence-run/[id] nespremenjen; health OK.
  E) Idempotentno čiščenje vseh testnih zapisov (tekač, pravilo, uporabnik).
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R473-TEST'
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
    env_url = os.environ.get('DATABASE_URL') or ''
    if not env_url.startswith(('postgresql://', 'postgres://')):
        env_url = ''
    db_url = os.environ.get('TEST_DB_URL') or env_url or 'postgresql://roksal:roksal@localhost:54329/roksal'
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       cwd=REPO, env={**os.environ, 'DATABASE_URL': db_url})
    return r.stdout, r.stderr[:600]

# ── priprava ────────────────────────────────────────────────────────────────
admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')
proizvodnja = login('proizvodnja@roksal.si', 'Proizvodnja123!')

M2 = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
const crypto=require('crypto');
(async()=>{
  const salt=crypto.randomUUID().replace(/-/g,'');
  const hash=crypto.scryptSync('Monter123!',salt,64).toString('hex');
  const u=await p.user.upsert({where:{email:'monter2-r473@roksal.si'},
    update:{passwordHash:salt+':'+hash,active:true},
    create:{email:'monter2-r473@roksal.si',name:'Monter2 R473',role:'MONTER',
      passwordHash:salt+':'+hash,active:true}});
  console.log('M2='+u.id);return p.$disconnect();
})()
'''
out, _ = bun_ts(M2)
chk('M2=' in out, 'monter2 uporabnik pripravljen')
monter2 = login('monter2-r473@roksal.si', 'Monter123!')

s, d = callj('GET', '/api/projects', admin)
PROJ = {p['code']: p['id'] for p in d.get('data', [])}
P4 = PROJ.get('P-2026-004')
P3 = PROJ.get('P-2026-003')
chk(bool(P4 and P3), 'projekta P-2026-004/P-2026-003 najdena')

s, d = callj('GET', '/api/products?family=all', admin)
PRODUCTS = {p['sku']: p for p in d.get('data', [])}
OGRK2 = PRODUCTS.get('OGR-K-002')
chk(bool(OGRK2), 'izdelek OGR-K-002 najden')

CAL = {'method': 'ZUNANJA_NAPRAVA', 'refValueCm': 92, 'refObject': 'vhodna plošča', 'device': 'Leica DISTO D2'}

# ══ A. RBAC ════════════════════════════════════════════════════════════════
print('── A. RBAC (fail-closed) ──')
s, _ = callj('GET', '/api/fence-run/x/model')
chk(s == 401, f'model brez žetona 401 (dejansko {s})')
s, _ = callj('GET', '/api/fence-run/x/model', skladisce)
chk(s in (403, 404), f'skladišče model 403/404 (dejansko {s})')
s, _ = callj('GET', '/api/fence-run/neobstojec-id/model', proizvodnja)
chk(s == 404, f'proizvodnja model neznan id 404 (dejansko {s})')

# ══ B. CORE LOGIKA (bun, čista) ═════════════════════════════════════════════
print('── B. Core logika (model-core) ──')
CORE_JS = r'''
import {
  buildPlanModel, sigmaFromSources, parseTurns, nearestSegment, diffModels,
  turnFromInterior, project3d, MODEL_ENGINE_VERSION,
} from './src/lib/model-core'

const out = []
const eq = (a, b, eps = 0.6) => Math.abs(a - b) <= eps

// 1) raven tek brez terena/kalibracije
const m1 = buildPlanModel({
  runId: 'r1', runName: 'T1', runStatus: 'OSNUTEK',
  nodes: [
    { kind: 'ZACETEK', atCm: 0 },
    { kind: 'STEBER', atCm: 500 },
    { kind: 'KONEC', atCm: 1000 },
  ],
  segments: [
    { order: 0, fromAtCm: 0, toAtCm: 500, lengthCm: 500, heightCm: null, angleDeg: null,
      slopeDeg: 0, heightDiffCm: 0, posts: 3, status: 'ESTIMATED', verifiedCm: null, verifyMethod: null },
    { order: 1, fromAtCm: 500, toAtCm: 1000, lengthCm: 500, heightCm: null, angleDeg: null,
      slopeDeg: 0, heightDiffCm: 0, posts: 3, status: 'ESTIMATED', verifiedCm: null, verifyMethod: null },
  ],
  terrain: null, calibration: null,
})
out.push('KOLIN=' + (m1.nodes.every((n) => n.p.y === 0 && eq(n.p.x, n.atCm)) ? 'OK' : 'NE'
  + ` [${m1.nodes.map((n) => n.p.x + ',' + n.p.y).join('|')}]`))
out.push('KEYS=' + (m1.segments.map((s) => s.key).join(',') === 'seg-1,seg-2' ? 'OK' : 'NE'))
out.push('VER=' + (m1.engineVersion === MODEL_ENGINE_VERSION && m1.units === 'cm' ? 'OK' : 'NE'))
out.push('PLAN=' + (eq(m1.totalPlanCm, 1000) ? 'OK' : 'NE:' + m1.totalPlanCm))
out.push('GAP=' + (eq(m1.closureGapCm, 1000) ? 'OK' : 'NE:' + m1.closureGapCm))
out.push('SIGNULL=' + (m1.quality.sigmaCm === null && m1.quality.sigmaSource === 'NI_PODATKA' ? 'OK' : 'NE'))
const codes1 = m1.quality.assumptions.map((a) => a.code)
out.push('ASM=' + (codes1.includes('BREZ_KALIBRACIJE') && codes1.includes('BREZ_TERENA') ? 'OK' : 'NE:' + codes1.join('/')))

// 2) vogal 90° — privzeto LEVO (predpostavka!), izrecno DESNO
const cornerNodes = [
  { kind: 'ZACETEK', atCm: 0 },
  { kind: 'VOGAL', atCm: 400, interiorDeg: 90 },
  { kind: 'KONEC', atCm: 800 },
]
const cornerSegs = [
  { order: 0, fromAtCm: 0, toAtCm: 400, lengthCm: 400, heightCm: null, angleDeg: 90, slopeDeg: 0,
    heightDiffCm: 0, posts: 2, status: 'CALIBRATED', verifiedCm: null, verifyMethod: null },
  { order: 1, fromAtCm: 400, toAtCm: 800, lengthCm: 400, heightCm: null, angleDeg: null, slopeDeg: 0,
    heightDiffCm: 0, posts: 2, status: 'VERIFIED', verifiedCm: 400, verifyMethod: 'LASER' },
]
const baseArgs = {
  runId: 'r2', runName: 'T2', runStatus: 'PREGLED',
  nodes: cornerNodes, segments: cornerSegs, terrain: null,
  calibration: { method: 'ZUNANJA_NAPRAVA', refValueCm: 92 },
}
const m2 = buildPlanModel(baseArgs)
const last = m2.nodes[m2.nodes.length - 1]
out.push('LEVO=' + (eq(last.p.x, 400) && eq(last.p.y, 400) ? 'OK' : `NE:${last.p.x},${last.p.y}`))
out.push('ASMLEVO=' + (m2.quality.assumptions.some((a) => a.code === 'ZAVOJ_SMER_PRIVZETA') ? 'OK' : 'NE'))
const m2d = buildPlanModel({ ...baseArgs, turns: ['DESNO'] })
const lastd = m2d.nodes[m2d.nodes.length - 1]
out.push('DESNO=' + (eq(lastd.p.x, 400) && eq(lastd.p.y, -400) ? 'OK' : `NE:${lastd.p.x},${lastd.p.y}`))
out.push('ASMNAST=' + (m2d.quality.assumptions.some((a) => a.code === 'ZAVOJ_SMER_NASTAVLJENA') ? 'OK' : 'NE'))
out.push('SIG5=' + (m2.quality.sigmaCm === 5 && m2.quality.sigmaSource === 'OCENA_METODE' ? 'OK' : 'NE:' + m2.quality.sigmaCm))
out.push('VSHARE=' + (m2.quality.verifiedShare === 0.5 && m2.quality.unverified === 1 ? 'OK' : 'NE:' + m2.quality.verifiedShare))
const s1 = m2.segments[0]
out.push('VSEG=' + (s1.verifiedCm === null && m2.segments[1].verifiedCm === 400 ? 'OK' : 'NE'))

// 3) teren → z koordinate vozlišč
const m3 = buildPlanModel({
  ...baseArgs, nodes: [
    { kind: 'ZACETEK', atCm: 0 }, { kind: 'KONEC', atCm: 600 },
  ],
  segments: [{ order: 0, fromAtCm: 0, toAtCm: 600, lengthCm: 603, heightCm: null, angleDeg: null,
    slopeDeg: 5.7, heightDiffCm: 60, posts: 5, status: 'ESTIMATED', verifiedCm: null, verifyMethod: null }],
  terrain: [{ distCm: 0, elevCm: 0 }, { distCm: 300, elevCm: 30 }, { distCm: 600, elevCm: 60 }],
})
out.push('TEREN=' + (m3.nodes[0].p.z === 0 && eq(m3.nodes[1].p.z, 60) ? 'OK' : `NE:${m3.nodes[0].p.z},${m3.nodes[1].p.z}`))
out.push('SLOPE=' + (eq(m3.segments[0].heightDiffCm, 60) ? 'OK' : 'NE'))

// 4) σ viri
out.push('SIGRULE=' + JSON.stringify(sigmaFromSources(4, null)))
out.push('SIGMET=' + JSON.stringify(sigmaFromSources(null, { method: 'ROCNO', refValueCm: 50 })))
out.push('SIGNONE=' + JSON.stringify(sigmaFromSources(null, null)))

// 5) parseTurns
out.push('PT1=' + JSON.stringify(parseTurns('LD')))
out.push('PT2=' + (parseTurns('LX') === null ? 'OK' : 'NE'))
out.push('PT3=' + (parseTurns(null) === null && parseTurns('') !== null ? 'OK' : 'NE'))

// 6) nearestSegment
out.push('NS1=' + JSON.stringify(nearestSegment(m2, 200, 30, 40)))
out.push('NS2=' + (nearestSegment(m2, 200, 500, 40) === null ? 'OK' : 'NE'))

// 7) diffModels (seg-1 podaljšan za 4 cm)
const m4 = buildPlanModel({ ...baseArgs, nodes: cornerNodes, segments: [
  { ...cornerSegs[0] },
  { ...cornerSegs[1], lengthCm: 404 },
] })
const df = diffModels(m2, m4, 2)
const dl = df.rows.find((r) => r.key === 'seg-2' && r.metric === 'DOLZINA')
out.push('DIFF=' + (dl && dl.diff === 4 ? 'OK' : 'NE:' + JSON.stringify(dl)))
out.push('DEVI=' + (df.compared === 2 && df.deviations === 1 && df.maxAbsDiffCm === 4 ? 'OK' : 'NE:' + JSON.stringify(df.deviations)))
out.push('NOTOL=' + (diffModels(m2, m4, null).toleranceCm === null ? 'OK' : 'NE'))

// 8) turnFromInterior + project3d
out.push('TFI=' + (turnFromInterior(90) === 90 && turnFromInterior(180) === 0 && turnFromInterior(45) === 135 ? 'OK' : 'NE'))
const p0 = project3d({ x: 0, y: 0, z: 0 }, 0, 0, 700)
const px = project3d({ x: 100, y: 0, z: 0 }, 0, 0, 700)
out.push('P3D=' + (p0.sx === 0 && p0.sy === 0 && eq(px.sx, 100) && px.sy === 0 ? 'OK' : `NE:${p0.sx},${p0.sy},${px.sx}`))

console.log(out.join('\n'))
'''
out, err = bun_ts(CORE_JS)
if err and not out: print('  BUN ERR:', err)
for line in out.strip().splitlines():
    k, _, v = line.partition('=')
    if k in ('SIGRULE', 'SIGMET', 'SIGNONE', 'PT1', 'NS1'): 
        continue
    chk(v.startswith('OK'), f'core: {k} ({v[:70]})')
chk('"sigmaCm":4' in out and '"sigmaSource":"RULE:tol_pozicija_modela"' in out, 'core: σ pravilo prevlada (4 cm, RULE)')
chk('"sigmaCm":25' in out and '"sigmaSource":"OCENA_METODE"' in out, 'core: σ ocena metode ROCNO 25 cm')
chk('"sigmaCm":null' in out and '"sigmaSource":"NI_PODATKA"' in out, 'core: σ brez podatka')
chk('"LEVO"' in out.replace('ZAVOJ', 'X') and 'PT1=["LEVO","DESNO"]' in out, 'core: parseTurns L/D')
chk('"key":"seg-1"' in out and '"distCm":30' in out, 'core: nearestSegment zadetek seg-1 (30 cm)')

# ══ C. API ─════════════════════════════════════════════════════════════════
print('── C. API /api/fence-run/[id]/model ──')
NODES_C = [
    {'kind': 'ZACETEK', 'atCm': 0, 'podlaga': 'BETON', 'pritrditev': 'TLACNA'},
    {'kind': 'VOGAL', 'atCm': 400, 'interiorDeg': 90, 'podlaga': 'BETON'},
    {'kind': 'KONEC', 'atCm': 800, 'podlaga': 'ZEMLJA'},
]
TERRAIN_C = [{'distCm': 0, 'elevCm': 0}, {'distCm': 400, 'elevCm': 0}, {'distCm': 800, 'elevCm': 20}]
s, d = callj('POST', '/api/fence-run', admin, {
    'projectId': P4, 'name': f'Model test {TAG}', 'nodes': NODES_C, 'terrain': TERRAIN_C,
    'calibration': CAL, 'productId': OGRK2['id'], 'note': TAG})
chk(s == 201, f'ustvarjanje tekača 201 (dejansko {s}, {d.get("error", "")})')
RUN = d.get('data', {}).get('id')
chk(bool(RUN), f'tekač id={RUN}')

s, d = callj('GET', f'/api/fence-run/{RUN}/model', admin)
chk(s == 200, f'model GET 200 (dejansko {s})')
mdl = d.get('data', {}).get('model', {})
chk(mdl.get('engineVersion') == 'model-core/1.0', f"engineVersion (dejansko {mdl.get('engineVersion')})")
chk(mdl.get('units') == 'cm', 'enote cm')
nodes = mdl.get('nodes', [])
lastn = nodes[-1] if nodes else {}
chk(abs(lastn.get('p', {}).get('x', -1) - 400) < 1 and abs(lastn.get('p', {}).get('y', -1) - 400) < 1,
    f"konec pri (400,400) — privzeto LEVO (dejansko {lastn.get('p')})")
seg_keys = [s_['key'] for s_ in mdl.get('segments', [])]
chk(seg_keys == ['seg-1', 'seg-2'], f'ključi seg-1/seg-2 usklajeni z dvojčkom (dejansko {seg_keys})')
q = mdl.get('quality', {})
chk(q.get('sigmaCm') == 5 and q.get('sigmaSource') == 'OCENA_METODE', f"σ=5 OCENA_METODE (dejansko {q.get('sigmaCm')}/{q.get('sigmaSource')})")
asm = [a.get('code') for a in q.get('assumptions', [])]
chk('ZAVOJ_SMER_PRIVZETA' in asm, f'predpostavka smeri zavojev IZRECNO zapisana (dejansko {asm})')
chk(abs((mdl.get('closureGapCm') or 0) - 565.7) < 1, f"odprtina ~565,7 cm (dejansko {mdl.get('closureGapCm')})")
chk(d.get('data', {}).get('tolerance', {}).get('sigmaRule') is None, 'brez pravila σ v odgovoru (zaenkrat)')
chk(abs(mdl.get('segments', [{}])[0].get('slopeDeg', -9) - 0) < 0.1, 'seg-1 padina 0° (raven teren)')

# izrecna smer DESNO
s, d = callj('GET', f'/api/fence-run/{RUN}/model?turns=D', admin)
chk(s == 200, f'model ?turns=D 200 (dejansko {s})')
lastn = (d.get('data', {}).get('model', {}).get('nodes') or [{}])[-1]
chk(abs(lastn.get('p', {}).get('y', 1) + 400) < 1, f"konec pri (400,−400) — DESNO (dejansko {lastn.get('p')})")
asm = [a.get('code') for a in d.get('data', {}).get('model', {}).get('quality', {}).get('assumptions', [])]
chk('ZAVOJ_SMER_NASTAVLJENA' in asm, f'predpostavka NASTAVLJENA zapisana (dejansko {asm})')

# neveljaven turns → 400
s, _ = callj('GET', f'/api/fence-run/{RUN}/model?turns=LDX', admin)
chk(s == 400, f'turns=LDX 400 (dejansko {s})')

# neznan tekač → 404
s, _ = callj('GET', '/api/fence-run/neobstaja/model', admin)
chk(s == 404, f'neznan tekač 404 (dejansko {s})')

# IDOR: monter z nalogom v P4 vidi; monter2 brez nalog → 403
s, _ = callj('GET', f'/api/fence-run/{RUN}/model', monter)
chk(s == 200, f'monter z nalogom v P4 200 (dejansko {s})')
s, _ = callj('GET', f'/api/fence-run/{RUN}/model', monter2)
chk(s == 403, f'monter brez nalog/avtorstva 403 IDOR (dejansko {s})')

# verifikacija segmenta → VERIFIED v modelu
s, d = callj('GET', f'/api/fence-run/{RUN}', admin)
segs = d.get('data', {}).get('segments', [])
chk(s == 200 and len(segs) == 2, f'tekač detail 200 z 2 segmentoma (dejansko {s}/{len(segs)})')
seg1_id = segs[0]['id'] if segs else None
s, d = callj('POST', f'/api/fence-run/{RUN}/verify', admin, {'segmentId': seg1_id, 'measuredCm': 400, 'method': 'LASER'})
chk(s == 200, f'verifikacija seg-1 200 (dejansko {s})')
s, d = callj('GET', f'/api/fence-run/{RUN}/model', admin)
mseg1 = (d.get('data', {}).get('model', {}).get('segments') or [{}])[0]
chk(mseg1.get('status') == 'VERIFIED' and mseg1.get('verifiedCm') == 400,
    f"seg-1 v modelu VERIFIED 400 (dejansko {mseg1.get('status')}/{mseg1.get('verifiedCm')})")
chk(abs((d.get('data', {}).get('model', {}).get('quality', {}).get('verifiedShare') or 0) - 0.5) < 0.01,
    'verifiedShare 0,5 po verifikaciji')

# pravilo tol_pozicija_modela → σ = RULE
s, d = callj('POST', '/api/engineering-rules', admin, {
    'key': 'tol_pozicija_modela', 'label': 'Toleranca položaja modela (test)', 'value': 4, 'unit': 'cm', 'note': TAG})
chk(s == 201, f'pravilo tol_pozicija_modela 201 (dejansko {s})')
RULE_ID = d.get('data', {}).get('id')
s, d = callj('GET', f'/api/fence-run/{RUN}/model', admin)
q = d.get('data', {}).get('model', {}).get('quality', {})
chk(q.get('sigmaCm') == 4 and q.get('sigmaSource') == 'RULE:tol_pozicija_modela',
    f"σ=4 RULE po pravilu (dejansko {q.get('sigmaCm')}/{q.get('sigmaSource')})")
chk((d.get('data', {}).get('tolerance', {}).get('sigmaRule') or {}).get('valueCm') == 4, 'tolerance.sigmaRule v odgovoru')

# ══ D. Regresija ═══════════════════════════════════════════════════════════
print('── D. Regresija ──')
s, d = callj('GET', f'/api/fence-run/{RUN}', admin)
chk(s == 200 and len(d.get('data', {}).get('segments', [])) == 2, f'tekač GET nespremenjen (dejansko {s})')
s, _ = callj('GET', '/api/public/health')
chk(s == 200, f'health OK (dejansko {s})')

# ══ E. Čiščenje ════════════════════════════════════════════════════════════
print('── E. Čiščenje ──')
if RULE_ID:
    s, _ = callj('DELETE', f'/api/engineering-rules/{RULE_ID}', admin)
    chk(s == 200, f'pravilo izbrisano (dejansko {s})')
s, _ = callj('DELETE', f'/api/fence-run/{RUN}', admin)
chk(s == 200, f'tekač izbrisan (dejansko {s})')

CLEAN = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  await p.user.deleteMany({where:{email:'monter2-r473@roksal.si'}});
  // pravilo je test ustvaril — API DELETE ga le deaktivira, zato trdo počistimo
  const r=await p.ruleVersion.deleteMany({where:{rule:{key:'tol_pozicija_modela'}}});
  await p.engineeringRule.deleteMany({where:{key:'tol_pozicija_modela'}});
  const runs=await p.fenceRun.count({where:{OR:[{note:{contains:'__TAG__'}},{name:{contains:'__TAG__'}}]}});
  const u=await p.user.count({where:{email:'monter2-r473@roksal.si'}});
  const e=await p.engineeringRule.count({where:{key:'tol_pozicija_modela'}});
  console.log('N='+runs+' U='+u+' E='+e+' V='+r.count);return p.$disconnect();
})()
'''.replace('__TAG__', TAG)
out, _ = bun_ts(CLEAN)
chk('N=0 U=0 E=0' in out, f'sledi testov odstranjene ({out.strip()})')

print()
print(f'══ SKUPAJ: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL else 0)
