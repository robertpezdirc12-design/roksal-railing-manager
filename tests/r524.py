#!/usr/bin/env python3
"""tests/r524.py — R524 (issue #14): DETAJL čipi površine za OGRAJE iz uradnih
barvnih lestvic v izvirni ločljivosti.

Zakaj ta suite (odprta točka issue #14: »manjkajoči DETAJL za ograje«):

  A) izmeriSmerVlaken — sintetični sliki (navpične/vodoravne črte): merilec
     smeri vlaken, ki ga UI uporabi za odločitev o rotaciji vira DETAJL čipa
     (vlakna morajo teči VZDOLŽ elementa: pokončna ograja → navpična v viru,
     prečna → vodoravna).
  B) izberiGradivo: DETAJL čip po varianti ima prednost pred FOTO_IZDELEK tudi
     za OGRAJE — sintetični katalog + primerjava z R518 (POLNA-57 RWA je padla
     v SAMO_DRUZINA; zdaj UPORABLJENO z uradnim čipom).
  C) živi katalog: 24 DETAJL čipov po varianti (POLNA-57: 3, POLNA-128: 6,
     POLNA-100: 8, ROMB-67: 7 — datoteke + sha256 + MANIFEST), 4 lestvice
     nadgrajene na IZVIRNIKE (2560 px), terasa lestvica 3×izdelek BREZ čipov
     (dokumentirana odločitev: žlebičasta stran ≠ vidna gladka stran DESKA 150).
  D) čipi so ČISTI (brez prosojnih pikslov) in z NAVPIČNIMI vlakni (izmera
     anizotropije — vlakna tečejo vzdolž palice kot na realni pokončni ograji).
  E) jedro izrisa: čip na POKOCNA/PRECNA preslikan z NAVADNO mrežo (izoliran
     poskus R524: cela slika v mreži 9/10 proti podizrezu+zrcalu 6/10);
     determinizem (isti seme → isti izris); tekstura prisotna na ograji.
  F) revizijsko poročilo ops/r524-cipi.json (izrezi, barvne razdalje, rotacije).
  G) žičenje: seed-r524 v verigi db:seed, UI rotira vir po izmeri smeri vlaken,
     ENGINE_VERSION 1.4.0 (R532: harmonizacija barv prizora), dokazni izris zrcali UI pot.
  H) dokazni artefakti: 5 primerov × (potem + primerjava + zoom) + tabela čipov.
  I) živi API (samo ob delujočem strežniku): POST tip POKOCNA preživi krog —
     lamelaMm 57/rezaMm 20 nespremenjena, engineVersion 1.4.0, nato
     idempotentno čiščenje.

Iskreno zapisane odločitve (issue #14 ostaja odprt):
  - RWA 57/32 posnetek NE obstaja v uradnih virih (galerija Pokončne ograje: za
    57-32 samo OAK WOOD in AMAZON WOOD; salon: OKW) — oskrba #6;
  - PROFIL_PRESEK za POLNA/DESKA NE obstaja (knjižnica »presek« 0 zadetkov;
    »profil«: samo votli ročaj; obe produktni strani preverjeni) — oskrba #6.

Brez AI, brez novih odvisnosti, brez mrežnih klicov (razen lokalni strežnik).
"""
import json
import os
import subprocess
import sys
import urllib.request
import urllib.error

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
PASS, FAIL = 0, 0

sys.path.insert(0, os.path.join(REPO, 'tests'))
import dbenv  # noqa: E402

DBURL = dbenv.db_url(REPO)


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)


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


def bun_db (script):
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       cwd=REPO, env={**os.environ, 'DATABASE_URL': DBURL})
    out = (r.stdout or '').strip().splitlines()
    for line in reversed(out):
        if line.startswith('{'):
            try:
                return json.loads(line)
            except Exception:
                break
    return {'_err': (r.stderr or r.stdout or '')[:900]}


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


def callj (method, path, token=None, body=None, timeout=90):
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


print('═══ R524: DETAJL čipi površine za ograje (uradne lestvice, izvirna ločljivost) ═══')

# ═══ A) izmeriSmerVlaken — merilec smeri vlaken ═══════════════════════════════
print('── A) izmeriSmerVlaken: navpične proti vodoravnim črtam ──')
A = bun_js(r'''
const { izmeriSmerVlaken } = await import('./src/lib/photo-replace-texture')
// navpične črte (široko 4 px): svetlost se spreminja VODORAVNO (čez vlakna)
// → |dI/dy|/|dI/dx| << 1 (vlakna navpična)
const navpicne = (x, y) => (Math.floor(x / 4) % 2 === 0 ? 0.8 : 0.2)
// vodoravne črte: svetlost se spreminja NAVPIČNO → razmerje >> 1
const vodoravne = (x, y) => (Math.floor(y / 4) % 2 === 0 ? 0.8 : 0.2)
console.log(JSON.stringify({
  navpicne: izmeriSmerVlaken(navpicne, 200, 200),
  vodoravne: izmeriSmerVlaken(vodoravne, 200, 200),
}))
''')
chk(A.get('navpicne', 9) < 0.2, f'navpične črte → razmerje {round(A.get("navpicne", 9), 3)} < 0,2 (vlakna navpična)')
chk(A.get('vodoravne', 0) > 5.0, f'vodoravne črte → razmerje {round(A.get("vodoravne", 0), 1)} > 5 (vlakna vodoravna)')

# ═══ B) izberiGradivo: DETAJL čip pred FOTO_IZDELEK za OGRAJE ════════════════
print('── B) izbira gradiva: čip variante pred scenično fotografijo ──')
B = bun_js(r'''
const { izberiGradivo } = await import('./src/lib/photo-replace-texture')
const sredstva = (kind, variantSku) => [{
  id: 'a1', kind, orientation: 'SPLOSNO', view: 'SPREDAJ', colorName: null,
  variantSku, productId: 'p1', filePath: 'public/x-' + kind + '.png',
  sha256: 'x', status: 'VERIFIED', permission: 'P', sourceName: 'S',
}]
const izpisi = (variantSku, orientation) => JSON.parse(JSON.stringify(
  izberiGradivo([...sredstva('DETAJL', variantSku), ...sredstva('FOTO_IZDELEK', variantSku)],
    { productId: 'p1', variantSku, orientation })))
const cip = izpisi('ROK-OGP-POLNA-57-RWA', 'POKOCNA')
const brezCipa = JSON.parse(JSON.stringify(izberiGradivo(sredstva('FOTO_IZDELEK', 'ROK-OGP-POLNA-57-RWA'),
  { productId: 'p1', variantSku: 'ROK-OGP-POLNA-57-RWA', orientation: 'POKOCNA' })))
console.log(JSON.stringify({
  stanje: cip.stanje, vrsta: cip.gradivo?.kind,
  brezCipaStanje: brezCipa.stanje, brezCipaVrsta: brezCipa.gradivo?.kind,
}))
''')
chk(B.get('stanje') == 'UPORABLJENO' and B.get('vrsta') == 'DETAJL',
    f'DETAJL čip variante izbran pred FOTO_IZDELEK (stanje {B.get("stanje")}, vrsta {B.get("vrsta")})')
chk(B.get('brezCipaStanje') == 'UPORABLJENO' and B.get('brezCipaVrsta') == 'FOTO_IZDELEK',
    f'brez čipa ostane scenični vir (stanje {B.get("brezCipaStanje")}, vrsta {B.get("brezCipaVrsta")})')

# ═══ C) živi katalog: 24 čipov + 4 lestvice izvirniki ═════════════════════════
print('── C) živi katalog: 24 DETAJL čipov po varianti + lestvice izvirniki ──')
C = bun_db(r'''
import { PrismaClient, Prisma } from '@prisma/client'
import fs from 'node:fs'
import crypto from 'node:crypto'
const db = new PrismaClient()
const manifest = JSON.parse(fs.readFileSync('public/assets/roksal/src/MANIFEST.json', 'utf8'))
const pricakuj = {
  'ROK-OGP-POLNA-57': 3, 'ROK-OG-POLNA-128': 6, 'ROK-OGP-POLNA-100': 8, 'ROK-OG-ROMB-67': 7,
}
const izhod = { cipov: {}, lestvice: {}, napake: [] }
for (const [sku, st] of Object.entries(pricakuj)) {
  const p = await db.product.findUnique({ where: { sku } })
  if (!p) { izhod.napake.push('manjka izdelek ' + sku); continue }
  const cipi = await db.productAsset.findMany({ where: { productId: p.id, kind: 'DETAJL', sourceName: { contains: 'R524' } } })
  izhod.cipov[sku] = cipi.length
  for (const c of cipi) {
    const f = (c.filePath ?? '').split('/').pop()
    const m = manifest.find((e) => e.file === f)
    const buf = fs.readFileSync('public/assets/roksal/src/' + f)
    const sha = crypto.createHash('sha256').update(buf).digest('hex')
    if (!m) izhod.napake.push(f + ' ni v MANIFEST')
    else if (m.sha256 !== sha || m.bytes !== buf.length) izhod.napake.push(f + ' sha/bytes ne ustreata MANIFESTU')
    if (c.sha256 !== sha) izhod.napake.push(f + ' sha v zapisu se ne ujema z datoteko')
    if (!c.variantSku || !c.variantSku.startsWith(sku + '-')) izhod.napake.push(f + ' brez variantSku ' + sku)
  }
}
const lestvice = {
  'ROK-OG-POLNA-128': 'roksal-barvna-lestvica-polna-128-full.png',
  'ROK-OGP-POLNA-100': 'roksal-barvna-lestvica-polna-100-full.png',
  'ROK-OG-ROMB-67': 'roksal-barvna-lestvica-romb-67-full.png',
  'ROK-OG-DESKA-150': 'roksal-barvna-lestvica-terasa-150-full.png',
  'ROK-TER-KLASIK': 'roksal-barvna-lestvica-terasa-150-full.png',
  'ROK-TER-RUSTIC': 'roksal-barvna-lestvica-terasa-150-full.png',
}
for (const [sku, dat] of Object.entries(lestvice)) {
  const p = await db.product.findUnique({ where: { sku } })
  if (!p) { izhod.napake.push('manjka izdelek ' + sku); continue }
  const l = await db.productAsset.findFirst({ where: { productId: p.id, kind: 'BARVNA_LESTVICA' } })
  if (!l || !(l.filePath ?? '').endsWith(dat)) izhod.napake.push(sku + ' lestvica ni ' + dat)
  else izhod.lestvice[sku] = l.filePath.split('/').pop() + ' (' + l.bytes + ' B)'
}
// DESKA-150 NAMENOMERNO brez DETAJL čipov (žlebičasta stran lestvice ≠ vidna gladka)
const d150 = await db.product.findUnique({ where: { sku: 'ROK-OG-DESKA-150' } })
const c150 = await db.productAsset.count({ where: { productId: d150.id, kind: 'DETAJL' } })
izhod.deska150Detajl = c150
console.log(JSON.stringify(izhod))
await db.$disconnect()
''')
cekirane = {'ROK-OGP-POLNA-57': 3, 'ROK-OG-POLNA-128': 6, 'ROK-OGP-POLNA-100': 8, 'ROK-OG-ROMB-67': 7}
for sku, st in cekirane.items():
    chk((C.get('cipov') or {}).get(sku) == st, f'{sku}: {st} DETAJL čipov po varianti (dejansko {(C.get("cipov") or {}).get(sku)})')
chk(not C.get('napake'), f'vsi čipi: datoteke + sha256 + MANIFEST + variantSku brez napak ({len(C.get("napake") or [])} napak)')
chk(C.get('deska150Detajl') == 0, f'DESKA-150 NAMENOMERNO brez DETAJL čipov (žlebičasta stran lestvice ≠ vidna gladka; dejansko {C.get("deska150Detajl")})')
for sku in ['ROK-OG-POLNA-128', 'ROK-OGP-POLNA-100', 'ROK-OG-ROMB-67', 'ROK-OG-DESKA-150', 'ROK-TER-KLASIK', 'ROK-TER-RUSTIC']:
    chk(sku in (C.get('lestvice') or {}), f'{sku}: lestvica nadgrajena na izvirnik ({(C.get("lestvice") or {}).get(sku, "—")})')

# ═══ D) čipi so čisti in z navpičnimi vlakni (izmera, ne ugibanje) ════════════
print('── D) čipi: brez prosojnosti, vlakna NAVPIČNA (kot na realni pokončni ograji) ──')
VSE_KODE = {
    'roksal-polna57-cip': ['amw', 'okw', 'rwa'],
    'roksal-polna128-cip': ['amw', 'ash', 'but', 'okw', 'roak', 'rwa'],
    'roksal-polna100-cip': ['amw', 'ash', 'glt', 'but', 'okw', 'wht', 'roak', 'rwa'],
    'roksal-romb67-cip': ['amw', 'ash', 'glt', 'but', 'okw', 'roak', 'rwa'],
}
D = bun_js('''
const { loadImage, createCanvas } = await import('@napi-rs/canvas')
const skupine = ''' + json.dumps(VSE_KODE) + '''
const out = {}
for (const [predpona, kode] of Object.entries(skupine)) {
  for (const koda of kode) {
    const img = await loadImage('public/assets/roksal/src/' + predpona + '-' + koda + '.png')
    const cv = createCanvas(img.width, img.height)
    const ctx = cv.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(0, 0, img.width, img.height).data
    let prosojnih = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) prosojnih++
    let gx = 0, gy = 0
    const w = img.width, h = img.height
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (x + 1 < w) gx += Math.abs(d[i + 4] - d[i])
      if (y + 1 < h) gy += Math.abs(d[i + w * 4] - d[i])
    }
    out[predpona + '-' + koda] = { dim: w, prosojnih, razmerje: gy / Math.max(1, gx) }
  }
}
console.log(JSON.stringify(out))
''')
for predpona, kode in VSE_KODE.items():
    for koda in kode:
        d = (D.get(f'{predpona}-{koda}') or {})
        chk(d.get('prosojnih') == 0, f'{predpona.split("-")[1]}-{koda}: 0 prosojnih pikslov (izrez čisto znotraj čipa, {d.get("dim")} px)')
        chk((d.get('razmerje') or 9) < 1.0, f'{predpona.split("-")[1]}-{koda}: vlakna NAVPIČNA (|dI/dy|/|dI/dx| = {round(d.get("razmerje") or 9, 2)} < 1 — tečejo vzdolž palice)')

# ═══ E) jedro: čip na POKOCNA/PRECNA z mrežo; determinizem; tekstura ═════════
print('── E) izris ograje: mreža, determinizem, prisotnost teksture ──')
E = bun_js(r'''
const { loadImage, createCanvas } = await import('@napi-rs/canvas')
const CORE = await import('./src/lib/photo-replace-core')
const chip = await loadImage('public/assets/roksal/src/roksal-polna57-cip-rwa.png')
const W = 800, H = 400
const vir = { slika: chip, sirinaPx: chip.width, visinaPx: chip.height, doklad: 'test', oznaka: 't' }
const narediParams = (tip) => ({
  quad: [{ x: 0.02, y: 0.96 }, { x: 0.98, y: 0.96 }, { x: 0.98, y: 0.04 }, { x: 0.02, y: 0.04 }],
  reference: { tip: 'ROCNO', cm: 600, opis: 'test' },
  config: { tip, lengthCm: 600, heightCm: 120, posts: 2, handrail: true, lamelaMm: 57, rezaMm: 20, deskaMm: 57, pritrditev: 'TALNA', vijaki: false },
})
const out = {}
for (const tip of ['POKOCNA', 'PRECNA']) {
  const risi = (seme) => {
    const cv = createCanvas(W, H)
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
    CORE.izrisiOgrajo(ctx, W, H, narediParams(tip), '#71675c', { vrsta: 'WPC', sijaj: 0.3, struktura: 0.8 }, { smer: 1, svetlost: 0.6, zgoraj: '#cdd6de', spodaj: '#8d8579' }, { ghost: 1, seme, prekrijStaro: false, gradivo: vir })
    return cv.toBuffer('image/png').toString('base64')
  }
  const a = risi(1234), b = risi(1234), c = risi(4321)
  out[tip] = { determinizem: a === b, razlicnoSeme: a !== c }
  // tekstura prisotna: σ barvnih kanalov v sredici ograje — brez teksture bi
  // bil čist preliv (σ ≈ 0)
  const cv = createCanvas(W, H)
  const ctx = cv.getContext('2d')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
  CORE.izrisiOgrajo(ctx, W, H, narediParams(tip), '#71675c', { vrsta: 'WPC', sijaj: 0.3, struktura: 0.8 }, { smer: 1, svetlost: 0.6, zgoraj: '#cdd6de', spodaj: '#8d8579' }, { ghost: 1, seme: 77, prekrijStaro: false, gradivo: vir })
  const d = ctx.getImageData(Math.round(W * 0.3), Math.round(H * 0.35), Math.round(W * 0.4), Math.round(H * 0.3)).data
  let vsota = 0, vsotaKv = 0, n = 0
  for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; vsota += v; vsotaKv += v * v; n++ }
  const povp = vsota / n
  out[tip + '_teksturaStd'] = Math.sqrt(vsotaKv / n - povp * povp)
}
console.log(JSON.stringify(out))
''')
for tip in ['POKOCNA', 'PRECNA']:
    e = E.get(tip) or {}
    chk(e.get('determinizem'), f'{tip}: isti seme → bitno identičen izris (determinizem)')
    chk(e.get('razlicnoSeme'), f'{tip}: drugačen seme → drugačen izris')
    chk((E.get(f'{tip}_teksturaStd') or 0) > 3.0,
        f'{tip}: tekstura čipa prisotna na ograji (σ sredice = {round(E.get(f"{tip}_teksturaStd") or 0, 1)} > 3 — čist preliv bi imel ~0)')

# ═══ F) revizijsko poročilo ops/r524-cipi.json ════════════════════════════════
print('── F) revizija ops/r524-cipi.json ──')
try:
    with open(os.path.join(REPO, 'ops/r524-cipi.json'), encoding='utf-8') as f:
        REV = json.load(f)
    chk(True, 'ops/r524-cipi.json berljiv')
except Exception as ex:
    REV = {}
    chk(False, f'ops/r524-cipi.json berljiv ({ex})')
lestvice_rev = REV.get('lestvice') or []
chk(len(lestvice_rev) == 4, f'4 lestvice v reviziji (dejansko {len(lestvice_rev)})')
st_cipov = sum(len(l.get('cipi') or []) for l in lestvice_rev)
chk(st_cipov == 24, f'24 čipov v reviziji (dejansko {st_cipov})')
if lestvice_rev:
    chk(all((c.get('barvnaRazdalja') or 999) < 90 for l in lestvice_rev for c in (l.get('cipi') or [])),
        'vse barvne razdalje < 90/255 (blizina uradnim odtenkom)')
    chk(all((c.get('rotirano') is True) for l in lestvice_rev for c in (l.get('cipi') or [])),
        'vsi čipi rotirani na navpična vlakna (izmera anizotropije)')
    chk((REV.get('referenca') or {}).get('anizotropija', 9) <= 1.0,
        f'referenčna pokončna ograja ima navpična vlakna (|dI/dy|/|dI/dx| = {(REV.get("referenca") or {}).get("anizotropija")})')

# ═══ G) žičenje ─═════════════════════════════════════════════════════════════
print('── G) žičenje: veriga seed, UI rotacija, verzija engine-a ──')
try:
    with open(os.path.join(REPO, 'package.json'), encoding='utf-8') as f:
        PKG = json.load(f)
    chk('seed-r524.cjs' in (PKG.get('scripts') or {}).get('db:seed', ''),
        'seed-r524.cjs v verigi db:seed (package.json)')
except Exception:
    chk(False, 'package.json berljiv')
chk(src_has('src/components/roksal/modules/foto-replace.tsx', 'izmeriSmerVlaken'),
    'UI (foto-replace.tsx) uvaža izmeriSmerVlaken')
chk(src_has('src/components/roksal/modules/foto-replace.tsx', "rctx.rotate(Math.PI / 2)"),
    'UI rotira vir DETAJL čipa za 90°, kadar vlakna tečejo čez element')
chk(src_has('src/components/roksal/modules/foto-replace.tsx', "g.kind === 'DETAJL'"),
    'rotacija vezana SAMO na DETAJL vire (scenične fotografije ostanejo neprizadete)')
chk(src_has('src/lib/photo-replace-core.ts', "ENGINE_VERSION = '1.4.0'"),
    'ENGINE_VERSION 1.4.0 (§13 — R532 dvig)')
chk(src_has('ops/r524-render.mjs', 'izmeriSmerVlaken'),
    'dokazni izris (ops/r524-render.mjs) zrcali UI pot (ista izmera + rotacija)')
chk(src_has('src/lib/photo-replace-core.ts', 'struktura(palica.xCm, 0, palica.xCm + palica.sirinaCm, cfg.heightCm - 4)'),
    'POKOCNA preslikava ostaja NAVADNA mreža (brez čip posebne logike — izoliran poskus 9/10)')

# ═══ H) dokazni artefakti ════════════════════════════════════════════════════
print('── H) dokazni artefakti ──')
for pid in ['P1', 'P2', 'P3', 'P4', 'P5']:
    for vrsta in ['potem', 'primerjava', 'zoom']:
        obst = os.path.exists(os.path.join(REPO, f'ops/r524-{pid}-{vrsta}.png'))
        chk(obst, f'ops/r524-{pid}-{vrsta}.png obstaja')
chk(os.path.exists(os.path.join(REPO, 'ops/r524-tabela-cipov.png')), 'ops/r524-tabela-cipov.png obstaja')

# ═══ I) živi API (samo ob delujočem strežniku) ═══════════════════════════════
print('── I) živi API: POLNA-57 POKOCNA (57/20, RWA čip) ──')
try:
    with urllib.request.urlopen(BASE + '/', timeout=5) as r:
        pass
except Exception:
    print('  ⏸ strežnik ne teče na BASE_URL — blok I se preskoči (ne zeleno)')
else:
    TOKEN = login('admin@roksal.si', 'Admin123!')
    s, prods = callj('GET', '/api/products?family=all', TOKEN)
    p57 = next((p for p in prods.get('data', []) if p.get('sku') == 'ROK-OGP-POLNA-57'), None)
    chk(p57 is not None, 'ROK-OGP-POLNA-57 dosegljiv prek API-ja')
    s, prjs = callj('GET', '/api/projects', TOKEN)
    projekt = next((p for p in prjs.get('data', [])), None)
    chk(projekt is not None, 'vsaj en projekt na voljo')
    if p57 and projekt:
        rwa = next((v for v in p57.get('variants', []) if v.get('sku') == 'ROK-OGP-POLNA-57-RWA'), None)
        chk(rwa is not None, 'varianta RWA (Rustic walnut) na voljo prek API-ja')
        foto = ('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof'
                'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIy'
                'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEB'
                'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF8AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0Kx'
                'wRNS0WLwcJDhLWNENFdxcYIzRiZHKBkaFYoQEVFhYnfCBlSjNWVTJCVFYX//EABQBAQAAAAAAAAAAAAAAAAAAAAX/xAAU'
                'EQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=')
        render_params = {
            'quad': [{'x': 0.12, 'y': 0.62}, {'x': 0.58, 'y': 0.62}, {'x': 0.58, 'y': 0.12}, {'x': 0.12, 'y': 0.12}],
            'reference': {'tip': 'ROCNO', 'cm': 220, 'opis': 'višina ograjnega polja ob pergoli'},
            'config': {'tip': 'POKOCNA', 'lengthCm': 400, 'heightCm': 120, 'posts': 3, 'handrail': True,
                       'lamelaMm': 57, 'rezaMm': 20, 'deskaMm': 57, 'pritrditev': 'TALNA', 'vijaki': False},
            'maska': {
                'ograja': [[{'x': 0.12, 'y': 0.62}, {'x': 0.58, 'y': 0.62}, {'x': 0.58, 'y': 0.12}, {'x': 0.12, 'y': 0.12}]],
                'izpusti': [],
                'prednji': [],
            },
        }
        s, d = callj('POST', '/api/photo-visualization', TOKEN, {
            'projectId': projekt['id'], 'sourcePhoto': foto,
            'productId': p57['id'], 'variantId': rwa['id'],
            'renderParams': render_params, 'note': 'R524 test — POLNA-57 pokončna 57/20',
        })
        chk(s == 201, f'vizualizacija POKOCNA ustvarjena (201, dejansko {s})')
        vid = d.get('data', {}).get('id')
        if vid:
            V = bun_db(f'''
import {{ PrismaClient }} from '@prisma/client'
const db = new PrismaClient()
const v = await db.photoVisualization.findUnique({{ where: {{ id: '{vid}' }}, }})
const rp = v ? JSON.parse(v.renderParams) : {{}}
console.log(JSON.stringify({{
  tip: rp.config?.tip, lamela: rp.config?.lamelaMm, reza: rp.config?.rezaMm,
  višina: rp.config?.heightCm, engine: v?.engineVersion,
}}))
await db.$disconnect()
''')
            chk(V.get('tip') == 'POKOCNA' and V.get('lamela') == 57, f'tip POKOCNA + lamela 57 mm preživi krog (dejansko {V.get("tip")}/{V.get("lamela")})')
            chk(V.get('reza') == 20 and V.get('višina') == 120, f'razmik 20 mm + višina 120 preživita krog (dejansko {V.get("reza")}/{V.get("višina")})')
            chk(V.get('engine') == '1.4.0', f'engineVersion 1.4.0 zapisan (§13, dejansko {V.get("engine")})')
            for _ in range(2):
                C2 = bun_db(f'''
import {{ PrismaClient }} from '@prisma/client'
const db = new PrismaClient()
await db.photoVisualization.delete({{ where: {{ id: '{vid}' }}, }}).catch(() => {{}})
const n = await db.photoVisualization.count({{ where: {{ id: '{vid}' }}, }})
console.log(JSON.stringify({{ n }}))
await db.$disconnect()
''')
            chk(C2.get('n') == 0, 'testna vizualizacija počiščena (idempotentno ×2)')

print()
print(f'══ REZULTAT: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL > 0 else 0)
