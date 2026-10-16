#!/usr/bin/env python3
"""tests/r518.py — R518 (issue #14): OSTALI MODELI/BARVE — 5 dokazanih primerov
fotomontaže (POLNA 128/100/57 · DESKA 150 · ALU) + RAZMIK iz kataloga.

Nadaljevanje R517 (ROMB 67 · Golden teak, 1 primer): lastnikovo naročilo je za
dokazano delujočo eno ograji zahtevalo OSTALE modele in barve. Ta suite ščiti
resnične pasti, ki jih je izvedba odkrila:

  A) rezaIzTecha — razmik (reža) IZ tech.razmakDeskMm: POLNE ograje NISO brez
     rež — Roksalovi tech podatki priporočajo »5–30 (priporočeno)« → sredina
     obsega (18 mm). Obseg (– — -), enojno število, niz, meje 0..80, fail-closed
     za smeti/prenevelike vrednosti (UI obdrži svojo privzeto vrednost).
  B) generirajRazpored — DETERMINISTIČNA matematika razmikov: PRECNA 128/18 na
     74 cm → 4 deske z režo natanko 1.8 cm med njimi; POKOCNA 57/20 na 200 cm →
     24 palic z režo 2.0 cm; vijaki 3×stebri ali 0. Reže res pridejo iz
     konfiguracije (ne iz občutka) — pikselska meritev je namreč motena z žilami
     teksture, zato se trdi matematika, ne slike.
  C) živi katalog: POLNA-128/POLNA-100 res nosita razmakDeskMm »5–30 (priporočeno)«
     (→ 18 mm), POLNA-57 in DESKA-150 ga nimata (null → uporabnikovo polje),
     ALU OGR-K-002 ANT ima RAL 7016 → #383e42.
  D) stanja gradiv (izberiGradivo nad realnim katalogom) za VSE dokazane primer:
     A UPORABLJENO (DETAJL čip R524), B UPORABLJENO (DETAJL čip R524), B2
     UPORABLJENO (čip R524 — v R518 SAMO_DRUZINA, zdaj uradni čip lestvice),
     D UPORABLJENO (DETAJL čip R524),
     E NI_PREVERJENO (ALU brez gradiv — pošteni barvni približek brez teksture).
  E) žičenje: UI (foto-replace.tsx) ob izbiri izdelka prednastavi rezaMmS iz
     tech; dokazni render uporablja rezaIzTecha.
  F) dokazni artefakti: ops/r518-render.mjs zrcala UI cevovod (isti moduli,
     isto zaporedje slojev) in vse r518-*.png obstajajo ter niso prazne.
  G) živi API (samo ob delujočem strežniku): hotel-bazen fixture + POLNA-128
     (config 128/18, maska 1+0+1) → renderParams preživi krog, trdnja gradiva
     se POTRDI s strežniškim zapisom poti+sha256, nato počisti (idempotentno ×2).

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


print('═══ R518: ostali modeli/barve — razmik iz kataloga + 5 dokazanih primerov ═══')

# ═══ A) rezaIzTecha — razmik iz tech (obseg → sredina, fail-closed) ══════════
print('── A) rezaIzTecha (razmik IZ tech.razmakDeskMm — POLNE niso brez rež) ──')
A = bun_js(r'''
const { rezaIzTecha } = await import('./src/lib/photo-replace-core')
const J = (o) => JSON.stringify(o)
console.log(JSON.stringify({
  stevilo: rezaIzTecha(J({ razmakDeskMm: 15 })),
  float: rezaIzTecha(J({ razmakDeskMm: 17.6 })),
  obsegEn: rezaIzTecha(J({ razmakDeskMm: '5–30 (priporočeno)' })),
  obsegCrtica: rezaIzTecha(J({ razmakDeskMm: '5-30' })),
  obsegEm: rezaIzTecha(J({ razmakDeskMm: '5—30 mm' })),
  niz: rezaIzTecha(J({ razmakDeskMm: '20 mm' })),
  nic: rezaIzTecha(J({ razmakDeskMm: 0 })),
  meja: rezaIzTecha(J({ razmakDeskMm: 80 })),
  preveliko: rezaIzTecha(J({ razmakDeskMm: 81 })),
  negativno: rezaIzTecha(J({ razmakDeskMm: -5 })),
  smece: rezaIzTecha(J({ razmakDeskMm: '5–30 (priporočeno) ### 5000' })),
  brezKljuca: rezaIzTecha(J({ profil: 'POLNA DESKA 57/32' })),
  nullTech: rezaIzTecha(null),
  prazno: rezaIzTecha(''),
  smeti: rezaIzTecha('ni json {{{'),
}))
''')
chk(A.get('stevilo') == 15, f'število 15 → 15 mm (dejansko {A.get("stevilo")})')
chk(A.get('float') == 18, f'float 17.6 → zaokroženo 18 mm (dejansko {A.get("float")})')
chk(A.get('obsegEn') == 18, f'obseg »5–30 (priporočeno)« → sredina 18 (dejansko {A.get("obsegEn")}) — REALNA vrednost POLNA-128/100')
chk(A.get('obsegCrtica') == 18, f'obseg s pomišljajem 5-30 → 18 (dejansko {A.get("obsegCrtica")})')
chk(A.get('obsegEm') == 18, f'obseg z dolgim pomišljajem 5—30 → 18 (dejansko {A.get("obsegEm")})')
chk(A.get('niz') == 20, f'niz »20 mm« → 20 (dejansko {A.get("niz")})')
chk(A.get('nic') == 0 and A.get('meja') == 80, 'meje 0 in 80 sta veljavni (zaprta obseg)')
chk(A.get('preveliko') is None and A.get('negativno') is None, 'prenevelik/negativen razmik → null (UI ohrani privzeto, ne smeče)')
chk(A.get('smece') == 18, 'smeči za obsegom se ignorirajo (vzame prvi veljaven obseg)')
chk(A.get('brezKljuca') is None, 'tech brez razmakDeskMm → null (POLNA-57, DESKA-150 — uporabnikovo polje)')
chk(A.get('nullTech') is None and A.get('prazno') is None and A.get('smeti') is None, 'null/prazen/neveljaven JSON → null (ne izjema)')

# ═══ B) generirajRazpored — deterministična matematika razmikov ═══════════════
print('── B) generirajRazpored (reže res pridejo iz konfiguracije) ──')
B = bun_js(r'''
const { generirajRazpored } = await import('./src/lib/photo-replace-core')
const precna = generirajRazpored({ tip: 'PRECNA', lengthCm: 200, heightCm: 74, posts: 3, handrail: true,
  lamelaMm: 70, rezaMm: 18, deskaMm: 128, pritrditev: 'TALNA', vijaki: true })
const pokocna = generirajRazpored({ tip: 'POKOCNA', lengthCm: 200, heightCm: 136, posts: 3, handrail: true,
  lamelaMm: 57, rezaMm: 20, deskaMm: 120, pritrditev: 'TALNA', vijaki: true })
const brezVijakov = generirajRazpored({ tip: 'POKOCNA', lengthCm: 200, heightCm: 136, posts: 3, handrail: true,
  lamelaMm: 57, rezaMm: 20, deskaMm: 120, pritrditev: 'TALNA', vijaki: false })
const rezeDeske = precna.deske.slice(1).map((d, i) => +(d.yCm - (precna.deske[i].yCm + precna.deske[i].visinaCm)).toFixed(3))
const rezePalice = []
for (let i = 1; i < pokocna.palice.length; i++) {
  const prej = pokocna.palice[i - 1], zdaj = pokocna.palice[i]
  // znotraj istega polja je korak 7.7 cm; prehod med poljema (čez steber) ima
  // drugačen odmik in NI reža — izpustimo ga
  if (Math.abs(zdaj.xCm - prej.xCm - 7.7) < 0.05) rezePalice.push(+(zdaj.xCm - (prej.xCm + prej.sirinaCm)).toFixed(3))
}
console.log(JSON.stringify({
  deske: precna.deske.length, prvaY: precna.deske[0]?.yCm, visina: precna.deske[0]?.visinaCm,
  rezeDeske: [...new Set(rezeDeske)],
  palice: pokocna.palice.length, sirina: pokocna.palice[0]?.sirinaCm,
  rezePalice: [...new Set(rezePalice)],
  stebri: pokocna.posts.length, vijaki: pokocna.vijaki.length, vijakiBrez: brezVijakov.vijaki.length,
}))
''')
chk(B.get('deske') == 4, f'PRECNA 128+18 na 74 cm → 4 deske (dejansko {B.get("deske")}) — primer A')
chk(abs((B.get('prvaY') or 0) - 6) < 0.01 and abs((B.get('visina') or 0) - 12.8) < 0.01, f'deska 12.8 cm, prva od tal 6 cm (y={B.get("prvaY")}, h={B.get("visina")})')
chk(B.get('rezeDeske') == [1.8], f'reža med deskami NATANKO 1.8 cm (dejansko {B.get("rezeDeske")}) — iz konfiguracije, ne po občutku')
chk(B.get('palice') == 24, f'POKOCNA 57+20 na 200 cm/3 stebri → 24 palic (dejansko {B.get("palice")}) — primer B')
chk(abs((B.get('sirina') or 0) - 5.7) < 0.01, f'palica 5.7 cm (dejansko {B.get("sirina")})')
chk(B.get('rezePalice') == [2.0], f'reža med lamelami NATANKO 2.0 cm (dejansko {B.get("rezePalice")})')
chk(B.get('stebri') == 3, '3 stebri enakomerno')
chk(B.get('vijaki') == 9 and B.get('vijakiBrez') == 0, f'vijaki 3×stebri=9 oz. 0 ko skrito (dejansko {B.get("vijaki")}/{B.get("vijakiBrez")})')

# ═══ C) živi katalog — tech podatki vseh petih modelov ════════════════════════
print('── C) živi katalog: razmiki in profili petih dokazanih modelov ──')
C = bun_db(r'''
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const { rezaIzTecha, lameleIzTecha, barvaVariante } = await import('./src/lib/photo-replace-core')
const out = {}
for (const sku of ['ROK-OG-POLNA-128', 'ROK-OGP-POLNA-100', 'ROK-OGP-POLNA-57', 'ROK-OG-DESKA-150', 'OGR-K-002']) {
  const p = await db.product.findFirst({ where: { sku }, include: { variants: true } })
  out[sku] = {
    profil: JSON.parse(p?.tech ?? '{}').profil ?? null,
    razmakRaw: JSON.parse(p?.tech ?? '{}').razmakDeskMm ?? null,
    reza: rezaIzTecha(p?.tech ?? null), sirina: lameleIzTecha(p?.tech ?? null),
  }
}
const ant = await db.productVariant.findFirst({ where: { sku: 'OGR-K-002-ANT' } })
out['OGR-K-002'].barva = ant ? barvaVariante({ ral: ant.ral, color: ant.color }) : null
out['OGR-K-002'].ral = ant?.ral ?? null
console.log(JSON.stringify(out))
await db.$disconnect()
''')
p128 = C.get('ROK-OG-POLNA-128') or {}
p100 = C.get('ROK-OGP-POLNA-100') or {}
p57 = C.get('ROK-OGP-POLNA-57') or {}
d150 = C.get('ROK-OG-DESKA-150') or {}
alu = C.get('OGR-K-002') or {}
chk(p128.get('razmakRaw') == '5–30 (priporočeno)' and p128.get('reza') == 18, f'POLNA-128 tech: »{p128.get("razmakRaw")}« → 18 mm')
chk(p128.get('sirina') == 128, f'POLNA-128 širina profila 128 mm (dejansko {p128.get("sirina")})')
chk(p100.get('reza') == 18 and p100.get('sirina') == 100, f'POLNA-100: reza 18, širina 100 (dejansko {p100.get("reza")}/{p100.get("sirina")})')
chk(p57.get('razmakRaw') is None and p57.get('reza') is None and p57.get('sirina') == 57, f'POLNA-57: BREZ razmaka v tech (null → uporabnikovo polje), širina 57 (dejansko {p57.get("sirina")})')
chk(d150.get('reza') is None and d150.get('sirina') == 150, f'DESKA-150: brez razmaka (render uporabi izmerjenih 30 mm), širina 150 (dejansko {d150.get("sirina")})')
chk(alu.get('ral') == 'RAL 7016' and alu.get('barva') == '#383e42', f'ALU OGR-K-002-ANT: {alu.get("ral")} → {alu.get("barva")} (pošteni približek, brez teksture)')

# ═══ D) stanja gradiv — poštena izbira za vse dokazane primer ════════════════
print('── D) izberiGradivo nad realnim katalogom: A/B/B2/D/E ──')
D = bun_db(r'''
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const { izberiGradivo } = await import('./src/lib/photo-replace-texture')
const out = {}
for (const [ime, sku, variantSku, orientacija] of [
  ['A', 'ROK-OG-POLNA-128', 'ROK-OG-POLNA-128-BUT', 'SPLOSNO'],
  ['B', 'ROK-OGP-POLNA-57', 'ROK-OGP-POLNA-57-OKW', 'POKOCNA'],
  ['B2', 'ROK-OGP-POLNA-57', 'ROK-OGP-POLNA-57-RWA', 'POKOCNA'],
  ['D', 'ROK-OGP-POLNA-100', 'ROK-OGP-POLNA-100-WHT', 'POKOCNA'],
  ['E', 'OGR-K-002', 'OGR-K-002-ANT', 'POKOCNA'],
]) {
  const p = await db.product.findFirst({ where: { sku }, select: { id: true } })
  const assets = await db.productAsset.findMany({
    where: { productId: p.id },
    select: { id: true, kind: true, orientation: true, view: true, colorName: true, variantSku: true, productId: true, filePath: true, sha256: true, status: true, permission: true, sourceName: true },
  })
  const izbira = izberiGradivo(assets, { productId: p.id, variantSku, orientation: orientacija })
  out[ime] = {
    stanje: izbira.stanje,
    datoteka: izbira.gradivo?.filePath?.split('/').pop() ?? null,
    manjkajo: izbira.manjkajo,
  }
}
console.log(JSON.stringify(out))
await db.$disconnect()
''')
a, b, b2, d, e = D.get('A') or {}, D.get('B') or {}, D.get('B2') or {}, D.get('D') or {}, D.get('E') or {}
chk(a.get('stanje') == 'UPORABLJENO' and 'polna128-cip-but' in (a.get('datoteka') or ''), f'A: POLNA-128 Burma teak → UPORABLJENO z DETAJL čipom R524 ({a.get("datoteka")})')
chk(b.get('stanje') == 'UPORABLJENO' and 'polna57-cip-okw' in (b.get('datoteka') or ''), f'B: POLNA-57 Oak wood → UPORABLJENO z DETAJL čipom R524 ({b.get("datoteka")})')
chk(b2.get('stanje') == 'UPORABLJENO' and 'polna57-cip-rwa' in (b2.get('datoteka') or ''),
    f'B2: POLNA-57 Rustic walnut → UPORABLJENO z DETAJL čipom R524 ({b2.get("datoteka")}) [R518: SAMO_DRUZINA → R524: čip uradne lestvice 57/32]')
chk(d.get('stanje') == 'UPORABLJENO' and 'polna100-cip-wht' in (d.get('datoteka') or ''), f'D: POLNA-100 White → UPORABLJENO z DETAJL čipom R524 ({d.get("datoteka")})')
chk(e.get('stanje') == 'NI_PREVERJENO' and e.get('datoteka') is None and any('površina variante' in m for m in (e.get('manjkajo') or [])),
    f'E: ALU antracit → NI_PREVERJENO brez gradiva (pošteni približek): manjka {e.get("manjkajo")}')

# ═══ E) žičenje UI + dokazni render ═══════════════════════════════════════════
print('── E) žičenje: UI in dokazni render uporabljata rezaIzTecha ──')
UI = 'src/components/roksal/modules/foto-replace.tsx'
RENDER = 'ops/r518-render.mjs'
chk(src_has(UI, 'rezaIzTecha'), 'UI uvaža rezaIzTecha iz jedra')
chk(src_has(UI, 'const razmik = p ? rezaIzTecha(p.tech) : null'), 'izbira izdelka vzame razmik iz tech')
chk(src_has(UI, "razmik != null ? { rezaMmS: String(razmik) }"), 'UI prednastavi rezaMmS iz tech (POLNA 128/100 → 18)')
chk(src_has(RENDER, 'CORE.rezaIzTecha(produkt.tech)'), 'dokazni render uporablja rezaIzTecha (ista koda kot UI)')

# ═══ F) dokazni artefakti (izris se da ponoviti) ═════════════════════════════
print('── F) dokazni artefakti: 5 primerov × (potem + primerjava) + zoomi ──')
chk(src_has(RENDER, 'MASK.pokrij(maska, W, H)'), 'dokazni izris uporablja MASK.pokrij (ista koda)')
chk(src_has(RENDER, 'MASK.obnoviOzadje(izvirnik, W, H, pk.ograja)'), 'dokazni izris uporablja MASK.obnoviOzadje')
chk(src_has(RENDER, 'MASK.slojObnove(obnova, pk.ograja, W, H)'), 'dokazni izris uporablja MASK.slojObnove')
chk(src_has(RENDER, 'MASK.slojPrednjega(izvirnik, W, H, pk.prednji)'), 'dokazni izris uporablja MASK.slojPrednjega')
chk(src_has(RENDER, 'CORE.izrisiOgrajo(') and src_has(RENDER, 'CORE.izrisiPrimerjavo('), 'dokazni izris uporablja CORE.izrisiOgrajo/izrisiPrimerjavo')
chk(src_has(RENDER, 'TEKS.izberiGradivo(assets,'), 'gradivo izbere TEKS.izberiGradivo (fail-closed izbira)')
chk(src_has(RENDER, 'zig: true'), 'dokazni izris POTEM nosi žig VIZUALIZACIJA ZA PREDSTAVITEV (§15)')
for artefakt, min_kb in [
    ('ops/r518-A-potem.png', 500), ('ops/r518-A-primerjava.png', 500), ('ops/r518-A-zoom.png', 300),
    ('ops/r518-B-potem.png', 400), ('ops/r518-B-primerjava.png', 400), ('ops/r518-B-zoom.png', 300),
    ('ops/r518-B2-potem.png', 400), ('ops/r518-B2-primerjava.png', 400),
    ('ops/r518-C-potem.png', 500), ('ops/r518-C-primerjava.png', 500), ('ops/r518-C-zoom.png', 300),
    ('ops/r518-D-potem.png', 400), ('ops/r518-D-primerjava.png', 400), ('ops/r518-D-zoom.png', 300),
    ('ops/r518-E-potem.png', 400), ('ops/r518-E-primerjava.png', 400),
]:
    try:
        velikost = os.path.getsize(os.path.join(REPO, artefakt))
        chk(velikost >= min_kb * 1000, f'{artefakt} obstaja ({velikost // 1024} kB ≥ {min_kb} kB)')
    except OSError:
        bad(f'{artefakt} manjka')

# ═══ G) živi API krog (samo ob delujočem strežniku) ══════════════════════════
print('── G) živi API: hotel-bazen fixture + POLNA-128 (128 mm + reza 18) ──')
try:
    with urllib.request.urlopen(BASE + '/', timeout=5) as r:
        pass
except Exception:
    print('  ⏸ strežnik ne teče na BASE_URL — blok G se preskoči (ne zeleno)')
else:
    TOKEN = login('admin@roksal.si', 'Admin123!')
    s, prods = callj('GET', '/api/products?family=all', TOKEN)
    polna = next((p for p in prods.get('data', []) if p.get('sku') == 'ROK-OG-POLNA-128'), None)
    chk(polna is not None, 'ROK-OG-POLNA-128 dosegljiv prek API-ja')
    s, prjs = callj('GET', '/api/projects', TOKEN)
    projekt = next((p for p in prjs.get('data', [])), None)
    chk(projekt is not None, 'vsaj en projekt na voljo')
    if polna and projekt:
        but = next((v for v in polna.get('variants', []) if v.get('sku') == 'ROK-OG-POLNA-128-BUT'), None)
        chk(but is not None, 'varianta BUT (Burma teak) na voljo prek API-ja')
        s, assets = callj('GET', f'/api/product-assets?productId={polna["id"]}', TOKEN)
        trdno = next((a for a in assets.get('data', [])
                      if a.get('variantSku') == 'ROK-OG-POLNA-128-BUT' and a.get('status') == 'VERIFIED'
                      and 'burma128-2' in (a.get('filePath') or '')), None)
        chk(trdno is not None, 'preverjeno gradivo BUT dosegljivo prek API-ja')
        # minimalen veljaven JPEG (1×1 sivica) — fotografija NI predmet tega bloka
        foto = ('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof'
                'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIy'
                'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEB'
                'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF8AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0Kx'
                'wRNS0WLwcJDhLWNENFdxcYIzRiZHKBkaFYoQEVFhYnfCBlSjNWVTJCVFYX//EABQBAQAAAAAAAAAAAAAAAAAAAAX/xAAU'
                'EQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=')
        render_params = {
            'quad': [{'x': 0.78, 'y': 0.72}, {'x': 1.0, 'y': 0.875}, {'x': 1.0, 'y': 0.6}, {'x': 0.78, 'y': 0.585}],
            'reference': {'tip': 'ROCNO', 'cm': 200, 'opis': 'ležalnik na terasi je dolg 200 cm'},
            'config': {'tip': 'PRECNA', 'lengthCm': 200, 'heightCm': 74, 'posts': 3, 'handrail': True,
                       'lamelaMm': 128, 'rezaMm': 18, 'deskaMm': 128, 'pritrditev': 'TALNA', 'vijaki': True},
            'maska': {
                'ograja': [[{'x': 0.78, 'y': 0.72}, {'x': 1.0, 'y': 0.875}, {'x': 1.0, 'y': 0.6}, {'x': 0.78, 'y': 0.585}]],
                'izpusti': [],
                'prednji': [[{'x': 0.455, 'y': 0.855}, {'x': 0.76, 'y': 0.79}, {'x': 0.8, 'y': 0.7}, {'x': 0.8, 'y': 0.6}, {'x': 0.7, 'y': 0.3}, {'x': 0.52, 'y': 0.24}]],
            },
        }
        s, d = callj('POST', '/api/photo-visualization', TOKEN, {
            'projectId': projekt['id'], 'sourcePhoto': foto,
            'productId': polna['id'], 'variantId': but['id'],
            'renderParams': render_params, 'note': 'R518 test — hotel-bazen fixture 128/18',
            **({'gradivo': {'assetId': trdno['id']}} if trdno else {}),
        })
        chk(s == 201, f'vizualizacija ustvarjena (201, dejansko {s})')
        vid = d.get('data', {}).get('id')
        if vid:
            V = bun_db(f'''
import {{ PrismaClient }} from '@prisma/client'
const db = new PrismaClient()
const v = await db.photoVisualization.findUnique({{ where: {{ id: '{vid}' }}, }})
const ver = await db.photoVisualizationVersion.findFirst({{ where: {{ visualizationId: '{vid}' }}, orderBy: {{ version: 'desc' }}, }})
const rp = v ? JSON.parse(v.renderParams) : {{}}
const meta = ver ? (JSON.parse(ver.data).meta ?? {{}}) : {{}}
console.log(JSON.stringify({{
  lamela: rp.config?.lamelaMm, deska: rp.config?.deskaMm, reza: rp.config?.rezaMm, posts: rp.config?.posts,
  maskaOgraja: rp.maska?.ograja?.length, maskaIzpusti: rp.maska?.izpusti?.length, maskaPrednji: rp.maska?.prednji?.length,
  gradivoPot: meta.dokaz?.gradivo?.pot ?? null, gradivoSha: meta.dokaz?.gradivo?.sha256 ?? null,
}}))
await db.$disconnect()
''')
            chk(V.get('lamela') == 128 and V.get('deska') == 128, f'konfiguracija 128 mm preživi krog (lamela {V.get("lamela")}, deska {V.get("deska")})')
            chk(V.get('reza') == 18 and V.get('posts') == 3, f'reza {V.get("reza")} mm (iz kataloga!), stebri {V.get("posts")}')
            chk(V.get('maskaOgraja') == 1 and V.get('maskaIzpusti') == 0 and V.get('maskaPrednji') == 1, 'maska (1 ograja + 0 izpustov + 1 prednji) preživi krog')
            chk('burma128-2' in (V.get('gradivoPot') or ''), f'trdnja gradiva potrjena s strežniško potjo ({V.get("gradivoPot")})')
            chk(isinstance(V.get('gradivoSha'), str) and len(V.get('gradivoSha')) == 64, 'trdnja nosi SHA-256 preverjene datoteke')
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
