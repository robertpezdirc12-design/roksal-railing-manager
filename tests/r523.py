#!/usr/bin/env python3
"""tests/r523.py — R523 (issue #14): kakovost teksture KUBO + manjkajoči uradni materiali.

Zakaj ta suite (lastnikov ukaz 2026-10-15: NE dodajati novih funkcij — izboljšati
kakovost teksture KUBO, urediti manjkajoče originalne materiale in barvne
različice, dokončno preveriti produkcijsko različico):

  A) izmeriIzrezeNavpicnihPalic (množina!) — sintetična scena: VSE deske,
     ne samo ena; navezuje se na R520 E (en sama = najbližja sredini množice);
     fail-closed za posnetek ene površine (DETAJL/čip) in rebrasto površino.
  B) izberiGradivo: DETAJL pred FOTO_IZDELEK — posnetek površine variante je
     najboljši vir teksture (sintetični katalog + regresija starih stanj).
  C) živi katalog: 4 DETAJL čipi KUBO po varianti (datoteke + sha256 + MANIFEST),
     lestvica KUBO nadgrajena na IZVORNIK 2217×675, PROFIL_PRESEK za KUBO,
     POLNA-57: natanko 3 uradne variante (AMW/OKW/RWA — ROAK odstranjen po
     namenski lestvici) + namenska lestvica + produktni posnetek.
  D) čipi so ČISTI (brez prosojnih pikslov) in z NAVPIČNIMI vlakni (izmera
     anizotropije — vlakna tečejo vzdolž letvice kot na realni fasadi).
  E) jedro izrisa: variacija med letvicami (podizrez + zrcalo, deterministično
     seme) + determinizem (isti seme → isti izris) + zrcaljenje deluje.
  F) revizijsko poročilo ops/r523-cipi.json (izrezi, barvne razdalje, rotacije).
  G) žičenje: seed-r523 v verigi db:seed, UI in dokazni izris uporabljata
     množinsko izmero, VRSTE_POVRSINE ima DETAJL prvega.
  H) dokazni artefakti: 4 primeri × (potem + primerjava + zoom) + primerjava
     kakovosti (R520 ⊣⊢ R523).
  I) živi API (samo ob delujočem strežniku): POST tip FASADA preživi krog —
     lamelaMm 80/rezaMm 20 nespremenjena, nato idempotentno čiščenje.

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
        with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
            return needle in f.read()
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


print('═══ R523: kakovost teksture KUBO + manjkajoči uradni materiali ═══')

# ═══ A) izmeriIzrezeNavpicnihPalic — MNOŽINA izrezov ═════════════════════════
print('── A) množinska izmera: VSE deske, ne samo ena ──')
A = bun_js(r'''
const { izmeriIzrezeNavpicnihPalic, izmeriIzrezNavpicnePalice } = await import('./src/lib/photo-replace-texture')
// sintetična scena: 10 desk po 40 px (svetlo 0.8) z režami 6 px (temno 0.25);
// širina 470 + zamik, da ima PRVA in ZADNJA deska režo na obeh straneh
// (robna deska brez reže ne more dokazati koraka — izmera jo pošteno izpusti)
const scena = (x) => { const f = (x + 40) % 46; return f < 40 ? 0.8 : 0.25 }
const vsi = izmeriIzrezeNavpicnihPalic(scena, 470, 300)
const ena = izmeriIzrezNavpicnePalice(scena, 470, 300)
// determinizem: enak vhod → enak izhod
const vsi2 = izmeriIzrezeNavpicnihPalic(scena, 470, 300)
// posnetek ene površine (DETAJL/čip) in rebrasta površina — fail-closed
const detalj = izmeriIzrezeNavpicnihPalic(() => 0.72, 400, 300)
const rebra = izmeriIzrezeNavpicnihPalic((x) => (x % 8) < 4 ? 0.8 : 0.3, 400, 300)
console.log(JSON.stringify({
  n: vsi?.length ?? 0, sirine: vsi?.map(p => p.w) ?? [], visina: vsi?.[0]?.h ?? 0,
  enaNajblizja: ena?.w ?? null, enaJeClan: !!vsi?.find(p => p.x === ena?.x && p.w === ena?.w),
  ponovitevEnaka: JSON.stringify(vsi) === JSON.stringify(vsi2),
  detalj: detalj ?? null, rebra: rebra ?? null,
}))
''')
chk(A.get('n') == 10, f'scena 10 desk → VSE 10 izrezov (dejansko {A.get("n")}) — R520 je vzel samo 1')
chk(all(34 <= w <= 42 for w in (A.get('sirine') or [0])), f'vsi izrezi ≈ 40 px (dejansko {A.get("sirine")})')
chk(A.get('visina') == 300, 'izrezi zajamejo CELO višino vira (letnica vzdolž profila)')
chk(A.get('enaNajblizja') is not None and A.get('enaJeClan'), 'ena sama (R520 API) = član množice, najbližji sredini — združljivost')
chk(A.get('ponovitevEnaka') is True, 'determinizem: enak vhod → enaka množica izrezov')
chk(A.get('detalj') is None and A.get('rebra') is None, 'fail-closed: posnetek ene površine in rebrasta površina → null (cela slika / brez lažnih desk)')

# ═══ B) izberiGradivo — DETAJL pred FOTO_IZDELEK ══════════════════════════════
print('── B) izbira gradiva: posnetek površine (DETAJL) pred scenično FOTO_IZDELEK ──')
B = bun_js(r'''
const { izberiGradivo } = await import('./src/lib/photo-replace-texture')
const base = { id: 'x', status: 'VERIFIED', permission: 'test', sourceName: 'test', productId: 'p1' }
const A1 = { ...base, id: 'a1', kind: 'DETAJL', variantSku: 'V-OKW', orientation: 'SPLOSNO', view: 'SPREDAJ', filePath: 'cip.png', sha256: 'aa' }
const F1 = { ...base, id: 'f1', kind: 'FOTO_IZDELEK', variantSku: 'V-OKW', orientation: 'SPLOSNO', view: 'SPREDAJ', filePath: 'scena.png', sha256: 'bb' }
const F2 = { ...base, id: 'f2', kind: 'FOTO_IZDELEK', orientation: 'POKOCNA', view: 'SPREDAJ', filePath: 'druzina.png', sha256: 'cc' }
const oba = izberiGradivo([A1, F1], { productId: 'p1', variantSku: 'V-OKW', orientation: 'SPLOSNO' })
const samoFoto = izberiGradivo([F1], { productId: 'p1', variantSku: 'V-OKW', orientation: 'SPLOSNO' })
const družina = izberiGradivo([A1, F2], { productId: 'p1', variantSku: null, orientation: 'SPLOSNO' })
console.log(JSON.stringify({
  obaKind: oba.gradivo?.kind, obaStanje: oba.stanje,
  samoFotoKind: samoFoto.gradivo?.kind, samoFotoStanje: samoFoto.stanje,
  družinaKind: družina.gradivo?.kind, družinaStanje: družina.stanje,
}))
''')
chk(B.get('obaKind') == 'DETAJL' and B.get('obaStanje') == 'UPORABLJENO',
    f'varianta z OBE vrstama → DETAJL zmaga (dejansko {B.get("obaKind")}/{B.get("obaStanje")}) — čip površine je najboljši vir')
chk(B.get('samoFotoKind') == 'FOTO_IZDELEK' and B.get('samoFotoStanje') == 'UPORABLJENO',
    f'varianta samo s FOTO_IZDELEK → FOTO_IZDELEK (dejansko {B.get("samoFotoKind")}) — brez DETAJL se nič ne pokvari')
chk(B.get('družinaKind') == 'DETAJL' and B.get('družinaStanje') == 'SAMO_DRUZINA',
    f'družinska rezerva → DETAJL zmaga tudi tu (dejansko {B.get("družinaKind")}/{B.get("družinaStanje")})')

# ═══ C) živi katalog: KUBO čipi + lestvici + PROFIL_PRESEK + POLNA-57 ════════
print('── C) živi katalog: KUBO 4 čipi, lestvica 2217×675, POLNA-57 po namenski lestvici ──')
C = bun_db(r'''
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const { izberiGradivo } = await import('./src/lib/photo-replace-texture')
const kubo = await db.product.findUnique({ where: { sku: 'ROK-FAS-KUBO' }, include: { variants: true } })
const assets = await db.productAsset.findMany({
  where: { productId: kubo.id },
  select: { id: true, kind: true, orientation: true, view: true, colorName: true, variantSku: true, productId: true, filePath: true, sha256: true, status: true, permission: true, sourceName: true },
})
const izbire = {}
for (const v of kubo.variants) {
  const iz = izberiGradivo(assets, { productId: kubo.id, variantSku: v.sku, orientation: 'SPLOSNO' })
  izbire[v.sku.split('-').pop()] = { stanje: iz.stanje, datoteka: iz.gradivo?.filePath?.split('/').pop() ?? null }
}
const p57 = await db.product.findUnique({ where: { sku: 'ROK-OGP-POLNA-57' }, include: { variants: true } })
const p57a = await db.productAsset.findMany({ where: { productId: p57.id }, select: { kind: true, filePath: true } })
const roak = await db.productVariant.findFirst({ where: { sku: 'ROK-OGP-POLNA-57-ROAK' } })
console.log(JSON.stringify({
  kuboDetajli: assets.filter(a => a.kind === 'DETAJL').length,
  kuboProfil: assets.filter(a => a.kind === 'PROFIL_PRESEK').length,
  kuboLestvica: assets.find(a => a.kind === 'BARVNA_LESTVICA')?.filePath?.split('/').pop() ?? null,
  izbire,
  p57Variante: p57.variants.map(v => v.sku.split('-').pop()).sort(),
  p57RoakObstaja: !!roak,
  p57Lestvica: p57a.find(a => a.kind === 'BARVNA_LESTVICA')?.filePath?.split('/').pop() ?? null,
  p57Produkt: p57a.find(a => a.kind === 'FOTO_IZDELEK' && a.filePath?.includes('produkt'))?.filePath?.split('/').pop() ?? null,
}))
await db.$disconnect()
''')
chk(C.get('kuboDetajli') == 4, f'KUBO: 4 DETAJL čipi (po enem na odtenek, dejansko {C.get("kuboDetajli")})')
chk(C.get('kuboProfil') == 1, f'KUBO: PROFIL_PRESEK (uradni tehnični posnetek profilov, dejansko {C.get("kuboProfil")})')
chk('kubo-full' in (C.get('kuboLestvica') or ''), f'KUBO lestvica nadgrajena na IZVORNIK 2217×675 (dejansko {C.get("kuboLestvica")})')
for koda, datoteka in [('AMW', 'roksal-kubo-cip-amw'), ('OKW', 'roksal-kubo-cip-okw'), ('ROAK', 'roksal-kubo-cip-roak'), ('RWA', 'roksal-kubo-cip-rwa')]:
    iz = (C.get('izbire') or {}).get(koda) or {}
    chk(iz.get('stanje') == 'UPORABLJENO' and datoteka in (iz.get('datoteka') or ''),
        f'KUBO {koda}: izbira UPORABLJENO → čip uradne lestvice (dejansko {iz.get("stanje")}/{iz.get("datoteka")})')
chk((C.get('p57Variante') or []) == ['AMW', 'OKW', 'RWA'],
    f'POLNA-57: NATANKO 3 uradne variante po namenski lestvici (dejansko {C.get("p57Variante")})')
chk(C.get('p57RoakObstaja') is False, 'POLNA-57 ROAK (Rustic oak) ODSTRANJEN — ni v namenski uradni lestvici 57/32')
chk('polna-57' in (C.get('p57Lestvica') or ''), f'POLNA-57: NAMENJENA lestvica 57/32 (ne zrcalo KUBO, dejansko {C.get("p57Lestvica")})')
chk('polna57-produkt' in (C.get('p57Produkt') or ''), f'POLNA-57: uradni produktni posnetek registriran (dejansko {C.get("p57Produkt")})')

# ═══ D) čipi so čisti in z navpičnimi vlakni (izmera, ne ugibanje) ══════════
print('── D) čipi: brez prosojnosti, vlakna NAVPIČNA (kot na realni KUBO fasadi) ──')
D = bun_js(r'''
const { loadImage, createCanvas } = await import('@napi-rs/canvas')
const out = {}
for (const koda of ['amw', 'okw', 'roak', 'rwa']) {
  const img = await loadImage('public/assets/roksal/src/roksal-kubo-cip-' + koda + '.png')
  const cv = createCanvas(img.width, img.height)
  const ctx = cv.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, img.width, img.height).data
  let prosojnih = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) prosojnih++
  // anizotropija: gx = Σ|dI/dx| (spremembe po vodoravi), gy = Σ|dI/dy|
  let gx = 0, gy = 0
  const w = img.width, h = img.height
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    if (x + 1 < w) gx += Math.abs(d[i + 4] - d[i])
    if (y + 1 < h) gy += Math.abs(d[i + w * 4] - d[i])
  }
  out[koda] = { dim: w, prosojnih, razmerje: gy / Math.max(1, gx) }
}
console.log(JSON.stringify(out))
''')
for koda in ['amw', 'okw', 'roak', 'rwa']:
    d = (D.get(koda) or {})
    chk(d.get('prosojnih') == 0, f'čip {koda}: 0 prosojnih pikslov (izrez čisto znotraj čipa, {d.get("dim")}×{d.get("dim")})')
    chk((d.get('razmerje') or 9) < 1.0, f'čip {koda}: vlakna NAVPIČNA (|dI/dy|/|dI/dx| = {round(d.get("razmerje") or 9, 2)} < 1 — tečejo vzdolž letvice)')

# ═══ E) jedro izrisa: variacija med letvicami + determinizem + zrcalo ═══════
print('── E) izris FASADA: vsaka letvica svoja (seme), determinizem, zrcaljenje ──')
E = bun_js(r'''
const { loadImage, createCanvas } = await import('@napi-rs/canvas')
const CORE = await import('./src/lib/photo-replace-core')
const chip = await loadImage('public/assets/roksal/src/roksal-kubo-cip-roak.png')
const W = 800, H = 400
const vir = { slika: chip, sirinaPx: chip.width, visinaPx: chip.height, doklad: 'test', oznaka: 't' }
const params = {
  quad: [{ x: 0.02, y: 0.96 }, { x: 0.98, y: 0.96 }, { x: 0.98, y: 0.04 }, { x: 0.02, y: 0.04 }],
  reference: { tip: 'ROCNO', cm: 800, opis: 'test' },
  config: { tip: 'FASADA', lengthCm: 800, heightCm: 280, posts: 2, handrail: false, lamelaMm: 80, rezaMm: 20, deskaMm: 150, pritrditev: 'TALNA', vijaki: false },
}
const risi = (seme) => {
  const cv = createCanvas(W, H)
  const ctx = cv.getContext('2d')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
  CORE.izrisiOgrajo(ctx, W, H, params, '#9c8061', { vrsta: 'WPC', sijaj: 0.3, struktura: 0.8 }, { smer: 1, svetlost: 0.6, zgoraj: '#cdd6de', spodaj: '#8d8579' }, { ghost: 1, seme, prekrijStaro: false, gradivo: vir })
  return cv
}
const beriStolpec = (ctx, x) => {
  const d = ctx.getImageData(x, Math.round(H * 0.3), 1, Math.round(H * 0.4)).data
  let h = 0
  for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) % 1000003
  return h
}
const prvi = risi(42)
const drugi = risi(42)
const tretji = risi(7)
const prviCtx = prvi.getContext('2d')
// letvice: korak 10 cm = 10 px pri 800px/800cm → sredici letvic 5 in 6
const s5 = beriStolpec(prviCtx, 105), s6 = beriStolpec(prviCtx, 115), s7 = beriStolpec(prviCtx, 125)
const enako = prvi.toBuffer('image/png').equals(drugi.toBuffer('image/png'))
const razlicnoSeme = !prvi.toBuffer('image/png').equals(tretji.toBuffer('image/png'))
console.log(JSON.stringify({ s5, s6, s7, variacija: s5 !== s6 || s6 !== s7, determinizem: enako, razlicnoSeme }))
''')
chk(E.get('variacija') is True, 'FASADA s čipom: sosednje letvice NISO identičen klon (podizrez + zrcalo po semean)')
chk(E.get('determinizem') is True, 'determinizem: isti seme → bitno enak izris (reproducibilnost)')
chk(E.get('razlicnoSeme') is True, 'drugačen seme → drugačen izris (variacija res izhaja iz semena)')

# ═══ F) revizijsko poročilo izreza čipov ═════════════════════════════════════
print('── F) revizijsko poročilo ops/r523-cipi.json ──')
try:
    with open(os.path.join(REPO, 'ops/r523-cipi.json'), encoding='utf-8') as f:
        R523 = json.load(f)
    ok('ops/r523-cipi.json berljiv')
except Exception as e:
    R523 = {}
    bad(f'ops/r523-cipi.json berem: {e}')
cipi = R523.get('cipi') or []
chk(len(cipi) == 4, f'poročilo nosi 4 čipe (dejansko {len(cipi)})')
chk(all((c.get('rotirano') is True) for c in cipi), 'vsi 4 čipi rotirani (vlakna na lestvici so bila vodoravna)')
chk((R523.get('anizotropijaReference') or 9) < 1.0, f'referenčna deska z realne fasade ima vlakna navpična (|dI/dy|/|dI/dx| = {round(R523.get("anizotropijaReference") or 9, 2)})')
chk(all(150 <= (c.get('izrez') or {}).get('w', 0) for c in cipi), f'izrezi čipov ≥ 150 px (dejansko {[ (c.get("izrez") or {}).get("w") for c in cipi ]}) — 8–35× več kot 8–21 px trak R520')

# ═══ G) žičenje ─═════════════════════════════════════════════════════════════
print('── G) žičenje: sem, UI, dokazni izris, prioriteta vrst ──')
chk(src_has('src/lib/photo-replace-texture.ts', "const VRSTE_POVRSINE = ['DETAJL', 'FOTO_IZDELEK', 'PROFIL_PRESEK']"),
    'VRSTE_POVRSINE: DETAJL je prvi (posnetek površine variante pred scenično fotografijo)')
chk(src_has('src/lib/photo-replace-core.ts', 'izreziPalic[Math.floor(rnd() * izreziPalic.length)]'),
    'jedro: letvica dobi desko iz MNOŽICE po determinističnem semean')
chk(src_has('src/lib/photo-replace-core.ts', '0.62 + rnd() * 0.38'), 'jedro: podizrez čipa 62–100 % po letvici (variacija)')
chk(src_has('src/lib/photo-replace-core.ts', "zrcali = rnd() < 0.5"), 'jedro: izmenično zrcaljenje po letvici (variacija)')
chk(src_has('src/components/roksal/modules/foto-replace.tsx', 'izmeriIzrezeNavpicnihPalic'), 'UI uporablja množinsko izmero')
chk(src_has('ops/r523-render.mjs', 'izmeriIzrezeNavpicnihPalic'), 'dokazni izris uporablja množinsko izmero')
chk(src_has('package.json', 'seed-r523.cjs'), 'seed-r523.cjs je v verigi db:seed')
chk(os.path.exists(os.path.join(REPO, 'prisma/seed-r523.cjs')), 'prisma/seed-r523.cjs obstaja')
chk(src_has('prisma/seed-r495.cjs', "POLNA_57_BARVE = ['Amazon wood', 'Oak wood', 'Rustic walnut']"),
    'seed-r495: POLNA 57/32 ima 3 uradne barve (ROAK odstranjen po namenski lestvici)')

# ═══ H) dokazni artefakti ════════════════════════════════════════════════════
print('── H) dokazni artefakti: K/K2/K3 (čipi) + KM (množica) + primerjava ──')
for artefakt, min_kb in [
    ('ops/r523-K-potem.png', 500), ('ops/r523-K-primerjava.png', 500), ('ops/r523-K-zoom.png', 300),
    ('ops/r523-K2-potem.png', 500), ('ops/r523-K2-primerjava.png', 500), ('ops/r523-K2-zoom.png', 300),
    ('ops/r523-K3-potem.png', 400), ('ops/r523-K3-primerjava.png', 400), ('ops/r523-K3-zoom.png', 300),
    ('ops/r523-KM-potem.png', 400), ('ops/r523-KM-primerjava.png', 400), ('ops/r523-KM-zoom.png', 300),
    ('ops/r523-primerjava-kakovosti.png', 400),
]:
    try:
        velikost = os.path.getsize(os.path.join(REPO, artefakt))
        chk(velikost >= min_kb * 1000, f'{artefakt} obstaja ({velikost // 1024} kB ≥ {min_kb} kB)')
    except OSError:
        bad(f'{artefakt} manjka')

# ═══ I) živi API krog (samo ob delujočem strežniku) ══════════════════════════
print('── I) živi API: kubo-fasada fixture + KUBO FASADA (80/20) ──')
try:
    with urllib.request.urlopen(BASE + '/', timeout=5) as r:
        pass
except Exception:
    print('  ⏸ strežnik ne teče na BASE_URL — blok I se preskoči (ne zeleno)')
else:
    TOKEN = login('admin@roksal.si', 'Admin123!')
    s, prods = callj('GET', '/api/products?family=all', TOKEN)
    kubo = next((p for p in prods.get('data', []) if p.get('sku') == 'ROK-FAS-KUBO'), None)
    chk(kubo is not None, 'ROK-FAS-KUBO dosegljiv prek API-ja')
    s, prjs = callj('GET', '/api/projects', TOKEN)
    projekt = next((p for p in prjs.get('data', [])), None)
    chk(projekt is not None, 'vsaj en projekt na voljo')
    if kubo and projekt:
        roak = next((v for v in kubo.get('variants', []) if v.get('sku') == 'ROK-FAS-KUBO-ROAK'), None)
        chk(roak is not None, 'varianta ROAK (Rustic oak) na voljo prek API-ja')
        foto = ('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof'
                'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIy'
                'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEB'
                'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF8AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0Kx'
                'wRNS0WLwcJDhLWNENFdxcYIzRiZHKBkaFYoQEVFhYnfCBlSjNWVTJCVFYX//EABQBAQAAAAAAAAAAAAAAAAAAAAX/xAAU'
                'EQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=')
        render_params = {
            'quad': [{'x': 0.12, 'y': 0.62}, {'x': 0.58, 'y': 0.62}, {'x': 0.58, 'y': 0.12}, {'x': 0.12, 'y': 0.12}],
            'reference': {'tip': 'ROCNO', 'cm': 245, 'opis': 'širina KUBO odseka fasade ob vhodu'},
            'config': {'tip': 'FASADA', 'lengthCm': 245, 'heightCm': 285, 'posts': 2, 'handrail': False,
                       'lamelaMm': 80, 'rezaMm': 20, 'deskaMm': 150, 'pritrditev': 'TALNA', 'vijaki': False},
            'maska': {
                'ograja': [[{'x': 0.12, 'y': 0.62}, {'x': 0.58, 'y': 0.62}, {'x': 0.58, 'y': 0.12}, {'x': 0.12, 'y': 0.12}]],
                'izpusti': [],
                'prednji': [],
            },
        }
        s, d = callj('POST', '/api/photo-visualization', TOKEN, {
            'projectId': projekt['id'], 'sourcePhoto': foto,
            'productId': kubo['id'], 'variantId': roak['id'],
            'renderParams': render_params, 'note': 'R523 test — KUBO fasada 80/20',
        })
        chk(s == 201, f'vizualizacija FASADA ustvarjena (201, dejansko {s})')
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
            chk(V.get('tip') == 'FASADA' and V.get('lamela') == 80, f'tip FASADA + letvica 80 mm (uradno) preživi krog (dejansko {V.get("tip")}/{V.get("lamela")})')
            chk(V.get('reza') == 20 and V.get('višina') == 285, f'razmik 20 mm + višina 285 preživita krog (dejansko {V.get("reza")}/{V.get("višina")})')
            chk(V.get('engine') == '1.3.0', f'engineVersion 1.3.0 zapisan (§13 — R524 dvig, dejansko {V.get("engine")})')
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
