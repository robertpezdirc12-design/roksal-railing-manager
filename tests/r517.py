#!/usr/bin/env python3
"""tests/r517.py — R517 (issue #14): DOKONČAN PRIMER FOTOMONTAŽE + POVEZAVA
IZDELEK → PROFIL → BARVA (katalog je vir razmerij in barv).

Kaj ta suite ščiti — resnične pasti, ki sta jih odkrili izvedba:
  A) ODTENKI_HEX: WPC variante nimajo RAL — barva pride iz IZRAČUNA iz
     uradnih preverjenih barvnih lestvic (roksal-barvna-lestvica-*.png,
     ProductAsset BARVNA_LESTVICA/VERIFIED). Prej je izris za vse lesene
     ograje vzel temno-sivi RAL fallback — uporabnik je izbral »Golden teak«
     in videl sivo ograjo. Trditve: 8 odtenkov, heks oblika, meje barvnih
     kanalov, deterministične vrednosti (ne odvisne od okolja).
  B) barvaVariante: RAL ima PREDNOST pred odtenkom; odtenek nadomesti
     fallback; neznanemu imenu NE zaupa izmišljene barve (fail-closed).
  C) lameleIzTecha — širina profila IZ IMENA: »ROMB 67« → 67 mm,
     »POLNA DESKA 128« → 128, »57/32« → 57 (širina, ne debelina),
     »KLASIK 150×25« → 150. Prej je POLNA 128 risala 70 mm deske —
     skoraj dvakrat preveč desk (napačna razmerja). Eksplicitni lameleMm
     ima prednost; KUBO brez števke → null (ne izmišljena širina).
  D) živi katalog: ROK-OG-ROMB-67 tech res da 67 mm; varianta GLT res
     ima color 'Golden teak'; preverjena gradiva variante GLT obstajajo
     (FOTO_IZDELEK s filePath) — povezava izdelek→profil→barva→gradivo.
  E) žičenje UI: foto-replace.tsx riše z barvaVariante (ne ralHex-only),
     izbira izdelka prednastavi tudi višino deske (PRECNA), pika variante
     kaže odtenek, shranjevanje nosi trdnjo assetId.
  F) dokazni artefakti: ops/r517-render.ts zrcala UI cevovod (isti moduli,
     isto zaporedje) in ops/r517-*.png obstajajo ter niso prazni — izris
     se DA ponoviti in dokaz NI samo trditev.
  G) živi API (samo ob delujočem strežniku): za kateri koli projekt
     ustvari vizualizacijo z EXACT kupska fixture (maska+izpusti+prednji,
     referenca 90 cm, config 67/8/67) → renderParams preživi krog,
     trdnja gradiva se POTRDI s strežniškim zapisom poti+sha (odjemalec
     ne more podtiskati), nato počisti (idempotentno ×2).

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


print('═══ R517: povezava izdelek→profil→barva + dokončan primer fotomontaže ═══')

# ═══ A) ODTENKI_HEX — iz uradnih lestvic, deterministično ════════════════════
print('── A) ODTENKI_HEX (barve WPC iz uradnih lestvic, ne izmišljene) ──')
A = bun_js(r'''
const { ODTENKI_HEX, odtenekHex } = await import('./src/lib/photo-replace-core')
const imena = Object.keys(ODTENKI_HEX)
const hexOk = imena.every(k => /^#[0-9a-f]{6}$/.test(ODTENKI_HEX[k]))
const kanali = imena.map(k => ODTENKI_HEX[k].slice(1).match(/../g).map(h => parseInt(h, 16)))
const meje = kanali.every(c => c.every(v => v >= 40 && v <= 230))
const razlicne = new Set(Object.values(ODTENKI_HEX)).size === imena.length
console.log(JSON.stringify({
  n: imena.length, imena, hexOk, meje, razlicne,
  golden: ODTENKI_HEX['Golden teak'],
  neznano: odtenekHex('Snežno bela po občutku'),
  nullVnos: odtenekHex(null),
  presledek: odtenekHex('  Golden teak  '),
}))
''')
chk(A.get('n') == 8, f'8 WPC odtenkov definiranih (dejansko {A.get("n")})')
chk(A.get('hexOk') is True, 'vse vrednosti so veljavne hex barve')
chk(A.get('meje') is True, 'kanali v smiselnih mejah 40..230 (lesni toni, ne črnina/belina)')
chk(A.get('razlicne') is True, 'odtenki so med seboj razločljivi')
chk('Amazon wood' in A.get('imena', []) and 'White' in A.get('imena', []), 'obseg: Amazon wood … White (uradna lestvica POLNA 100)')
chk(A.get('golden') == '#a27e76', f'Golden teak = {A.get("golden")} (izračunano iz lestvic ROMB/POLNA 100/TERASA)')
chk(A.get('neznano') == '#383e42', 'neznan odtenek → fallback (fail-closed, ne izmišljena barva)')
chk(A.get('nullVnos') == '#383e42', 'null vnos → fallback')
chk(A.get('presledek') == '#a27e76', 'vodilni/sledilni presledki se tolerirajo')

# ═══ B) barvaVariante — prednost RAL, odtenek, fail-closed ══════════════════
print('── B) barvaVariante (RAL prednost, odtenek, fail-closed) ──')
B = bun_js(r'''
const { barvaVariante } = await import('./src/lib/photo-replace-core')
console.log(JSON.stringify({
  ral: barvaVariante({ ral: 'RAL 7016', color: null }),
  ralPrednost: barvaVariante({ ral: 'RAL 7016', color: 'Golden teak' }),
  wpc: barvaVariante({ ral: null, color: 'Golden teak' }),
  wpc2: barvaVariante({ ral: null, color: 'Rustic walnut' }),
  neznan: barvaVariante({ ral: 'RAL 9999', color: 'Bakerjeva rjava' }),
  nullV: barvaVariante(null),
  prazen: barvaVariante({}),
}))
''')
chk(B.get('ral') == '#383e42', 'RAL 7016 → antracit')
chk(B.get('ralPrednost') == '#383e42', 'veljaven RAL ima PREDNOST pred odtenkom')
chk(B.get('wpc') == '#a27e76', 'WPC brez RAL → odtenek Golden teak')
chk(B.get('wpc2') == '#71675c', 'WPC Rustic walnut → odtenek')
chk(B.get('neznan') == '#383e42', 'neznan RAL + neznano ime → fallback (ne izmišljeno)')
chk(B.get('nullV') == '#383e42', 'brez variante → fallback')
chk(B.get('prazen') == '#383e42', 'prazna varianta → fallback')

# ═══ C) lameleIzTecha — širina profila iz imena ═════════════════════════════
print('── C) lameleIzTecha (širina profila IZ IMENA — razmerja iz kataloga) ──')
C = bun_js(r'''
const { lameleIzTecha } = await import('./src/lib/photo-replace-core')
const J = (o) => JSON.stringify(o)
console.log(JSON.stringify({
  romb67: lameleIzTecha(J({ profil: 'ROMB 67' })),
  polna128: lameleIzTecha(J({ profil: 'POLNA DESKA 128' })),
  polna57: lameleIzTecha(J({ profil: 'POLNA DESKA 57/32' })),
  klasik150: lameleIzTecha(J({ profil: 'KLASIK 150×25' })),
  terasa150: lameleIzTecha(J({ profil: 'DESKA 150 (terasni)' })),
  polna100: lameleIzTecha(J({ profil: 'POLNA DESKA 100' })),
  kubo: lameleIzTecha(J({ profil: 'KUBO' })),
  brez: lameleIzTecha(J({ material: 'WPC (HDPE)' })),
  prazno: lameleIzTecha(''),
  smeti: lameleIzTecha('ni json {{{'),
  lameleMmPrednost: lameleIzTecha(J({ profil: 'ROMB 67', lameleMm: 90 })),
  lameleNiz: lameleIzTecha(J({ profil: 'POLNA DESKA 128', lamele: '80 mm' })),
  premalo: lameleIzTecha(J({ profil: 'DESKA 25×140' })),
}))
''')
chk(C.get('romb67') == 67, f'ROMB 67 → 67 mm (dejansko {C.get("romb67")})')
chk(C.get('polna128') == 128, f'POLNA DESKA 128 → 128 mm (prej bi risala 70 — napačna razmerja)')
chk(C.get('polna57') == 57, f'POLNA DESKA 57/32 → 57 mm (širina, ne debelina)')
chk(C.get('klasik150') == 150, 'KLASIK 150×25 → 150 mm')
chk(C.get('terasa150') == 150, 'DESKA 150 (terasni) → 150 mm')
chk(C.get('polna100') == 100, 'POLNA DESKA 100 → 100 mm')
chk(C.get('kubo') is None, 'KUBO brez številke → null (ne izmišljena širina)')
chk(C.get('brez') is None, 'tech brez profila → null')
chk(C.get('prazno') is None and C.get('smeti') is None, 'prazen/neveljaven JSON → null (ne izjema)')
chk(C.get('lameleMmPrednost') == 90, 'eksplicitni lameleMm ima prednost pred imenom')
chk(C.get('lameleNiz') == 80, 'lamele "80 mm" (niz) ima prednost pred imenom')
chk(C.get('premalo') is None, 'preozek profil (25 mm — debelina) se NE vzame kot širina')

# ═══ D) živi katalog — povezava izdelek → profil → barva → gradivo ═════════
print('── D) živi katalog: ROK-OG-ROMB-67 → ROMB 67 → Golden teak → VERIFIED ──')
D = bun_db(r'''
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const p = await db.product.findFirst({ where: { sku: 'ROK-OG-ROMB-67' }, include: { variants: true } })
const glt = p?.variants.find(v => v.sku === 'ROK-OG-ROMB-67-GLT') ?? null
const { lameleIzTecha, barvaVariante } = await import('./src/lib/photo-replace-core')
const gradiva = glt ? await db.productAsset.findMany({
  where: { productId: p.id, variantSku: glt.sku, status: 'VERIFIED', kind: 'FOTO_IZDELEK', filePath: { not: null } },
}) : []
console.log(JSON.stringify({
  sku: p?.sku, profil: JSON.parse(p?.tech ?? '{}').profil ?? null,
  sirina: lameleIzTecha(p?.tech ?? null),
  glt: glt ? { sku: glt.sku, color: glt.color, ral: glt.ral, barva: barvaVariante({ ral: glt.ral, color: glt.color }) } : null,
  gradiva: gradiva.map(g => g.filePath),
}))
await db.$disconnect()
''')
chk(D.get('sku') == 'ROK-OG-ROMB-67', 'izdelek v katalogu')
chk(D.get('profil') == 'ROMB 67', f'katalog tech.profil = {D.get("profil")}')
chk(D.get('sirina') == 67, f'lameleIzTecha nad realnim tech JSON → {D.get("sirina")} mm')
g = D.get('glt') or {}
chk(g.get('color') == 'Golden teak', 'varianta GLT nosi color "Golden teak"')
chk(g.get('ral') is None, 'WPC varianta nima RAL (zato potrebuje odtenek)')
chk(g.get('barva') == '#a27e76', f'barvaVariante nad katalogom → {g.get("barva")}')
datoteke = D.get('gradiva') or []
chk(any('r495-wpc-woodcore-romb-golden-precna-ograja-gasper1' in f for f in datoteke),
    f'preverjeno gradivo FOTO_IZDELEK za GLT obstaja ({len(datoteke)} datotek)')

# ═══ E) žičenje UI (foto-replace.tsx) ═══════════════════════════════════════
print('── E) žičenje UI: barva in razmerja gredo čez katalog ──')
UI = 'src/components/roksal/modules/foto-replace.tsx'
chk(src_has(UI, 'barvaVariante('), 'UI uvaža in uporablja barvaVariante')
chk(src_has(UI, 'const barva = barvaVariante('), 'izrisna barva gre čez barvaVariante (ne samo ralHex)')
chk(not src_has(UI, "variant?.ral ? ralHex(variant.ral) : '#383e42'"), 'stari temno-sivi fallback za WPC je ODSTRANJEN iz izrisa')
chk(src_has(UI, 'deskaMmS: String(sirina)'), 'izbira izdelka prednastavi tudi višino deske (prečna)')
chk(src_has(UI, 'v.color ? barvaVariante({ ral: null, color: v.color }'), 'pika izbirnika variant kaže odtenek')
chk(src_has(UI, 'lamelaMmS: String(sirina)'), 'izbira izdelka prednastavi širino lamel iz profila')

# ═══ F) dokazni artefakti (izris se da ponoviti) ═══════════════════════════
print('── F) dokazni artefakti: glavni brez izris (.mjs, izven app typechecka) + slike ──')
RENDER = 'ops/r517-render.mjs'
chk(src_has(RENDER, "pokrij(maska, W, H)"), 'dokazni izris uporablja MASK.pokrij (ista koda)')
chk(src_has(RENDER, 'obnoviOzadje(izvirnik, W, H, pk.ograja)'), 'dokazni izris uporablja MASK.obnoviOzadje')
chk(src_has(RENDER, 'slojObnove(obnova, pk.ograja, W, H)'), 'dokazni izris uporablja MASK.slojObnove')
chk(src_has(RENDER, 'slojPrednjega(izvirnik, W, H, pk.prednji)'), 'dokazni izris uporablja MASK.slojPrednjega')
chk(src_has(RENDER, 'CORE.izrisiOgrajo(') and src_has(RENDER, 'CORE.izrisiPrimerjavo('), 'dokazni izris uporablja CORE.izrisiOgrajo/izrisiPrimerjavo')
chk(src_has(RENDER, 'izberiGradivo(assets,'), 'gradivo izbere TEKS.izberiGradivo (fail-closed izbira)')
chk(src_has(RENDER, 'CORE.barvaVariante('), 'barva v dokaznem izrisu gre čez barvaVariante (ne ročna konstanta)')
for artefakt, min_kb in [
    ('ops/r517-1-original.jpg', 100),
    ('ops/r517-2-maska.png', 200),
    ('ops/r517-3-potem.png', 300),
    ('ops/r517-4-primerjava.png', 300),
    ('ops/r517-5-zoom-tekstura.png', 50),
]:
    try:
        velikost = os.path.getsize(os.path.join(REPO, artefakt))
        chk(velikost >= min_kb * 1000, f'{artefakt} obstaja ({velikost // 1024} kB ≥ {min_kb} kB)')
    except OSError:
        bad(f'{artefakt} manjka')
# VLM samopreverba dokaza (zapisano v R517 poteku) — slike morajo nositi žig §15
chk(src_has(RENDER, "zig: true"), 'dokazni izris POTEM nosi žig VIZUALIZACIJA ZA PREDSTAVITEV (§15)')

# ═══ G) živi API krog (samo ob delujočem strežniku) ════════════════════════
print('── G) živi API: kupska fixture preživi krog s 67 mm konfiguracijo ──')
try:
    with urllib.request.urlopen(BASE + '/api/auth/login'.replace('/api/auth/login', '/'), timeout=5) as r:
        pass
except Exception:
    print('  ⏸ strežnik ne teče na BASE_URL — blok G se preskoči (ne zeleno)')
else:
    TOKEN = login('admin@roksal.si', 'Admin123!')
    # kateri koli projekt + ROMB 67 izdelek
    s, prods = callj('GET', '/api/products?family=all', TOKEN)
    romb = next((p for p in prods.get('data', []) if p.get('sku') == 'ROK-OG-ROMB-67'), None)
    chk(romb is not None, 'ROK-OG-ROMB-67 dosegljiv prek API-ja')
    s, prjs = callj('GET', '/api/projects', TOKEN)
    projekt = next((p for p in prjs.get('data', [])), None)
    chk(projekt is not None, 'vsaj en projekt na voljo')
    if romb and projekt:
        glt = next((v for v in romb.get('variants', []) if v.get('sku') == 'ROK-OG-ROMB-67-GLT'), None)
        chk(glt is not None, 'varianta GLT na voljo prek API-ja')
        # gradivo za trdnjo (kot ga pošlje UI)
        s, assets = callj('GET', f'/api/product-assets?productId={romb["id"]}', TOKEN)
        trdno = next((a for a in assets.get('data', [])
                      if a.get('variantSku') == 'ROK-OG-ROMB-67-GLT' and a.get('status') == 'VERIFIED'
                      and 'gasper1' in (a.get('filePath') or '')), None)
        chk(trdno is not None, 'preverjeno gradivo GLT dosegljivo prek API-ja')
        # minimalen veljaven JPEG (1×1 sivica) — fotografija NI predmet tega bloka
        foto = ('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof'
                'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIy'
                'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEB'
                'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0Kx'
                'wRNS0WLwcJDhLWNENFdxcYIzRiZHKBkaFYoQEVFhYnfCBlSjNWVTJCVFYX//EABQBAQAAAAAAAAAAAAAAAAAAAAX/xAAU'
                'EQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=')
        render_params = {
            'quad': [{'x': 0.0, 'y': 0.665}, {'x': 0.098, 'y': 0.705}, {'x': 0.098, 'y': 0.505}, {'x': 0.0, 'y': 0.487}],
            'reference': {'tip': 'ROCNO', 'cm': 90, 'opis': 'standardni panel žične ograje je širok 90 cm'},
            'config': {'tip': 'PRECNA', 'lengthCm': 90, 'heightCm': 117, 'posts': 2, 'handrail': True,
                       'lamelaMm': 67, 'rezaMm': 8, 'deskaMm': 67, 'pritrditev': 'TALNA', 'vijaki': False},
            'maska': {
                'ograja': [[{'x': 0.0, 'y': 0.665}, {'x': 0.098, 'y': 0.705}, {'x': 0.098, 'y': 0.505}, {'x': 0.0, 'y': 0.487}]],
                'izpusti': [[{'x': 0.0, 'y': 0.645}, {'x': 0.098, 'y': 0.685}, {'x': 0.098, 'y': 0.705}, {'x': 0.0, 'y': 0.665}]],
                'prednji': [[{'x': 0.082, 'y': 0.345}, {'x': 0.099, 'y': 0.345}, {'x': 0.101, 'y': 0.705}, {'x': 0.084, 'y': 0.705}]],
            },
        }
        s, d = callj('POST', '/api/photo-visualization', TOKEN, {
            'projectId': projekt['id'], 'sourcePhoto': foto,
            'productId': romb['id'], 'variantId': glt['id'],
            'renderParams': render_params, 'note': 'R517 test — kupska fixture 67 mm',
            **({'gradivo': {'assetId': trdno['id']}} if trdno else {}),
        })
        chk(s == 201, f'vizualizacija ustvarjena (201, dejansko {s})')
        vid = d.get('data', {}).get('id')
        if vid:
            # preveri shranjene parametre neposredno v bazi (zaupanja vreden vir)
            V = bun_db(f'''
import {{ PrismaClient }} from '@prisma/client'
const db = new PrismaClient()
const v = await db.photoVisualization.findUnique({{ where: {{ id: '{vid}' }}, }})
const ver = await db.photoVisualizationVersion.findFirst({{ where: {{ visualizationId: '{vid}' }}, orderBy: {{ version: 'desc' }}, }})
const rp = v ? JSON.parse(v.renderParams) : {{}}
const meta = ver ? (JSON.parse(ver.data).meta ?? {{}}) : {{}}
console.log(JSON.stringify({{
  lamela: rp.config?.lamelaMm, deska: rp.config?.deskaMm, reza: rp.config?.rezaMm, posts: rp.config?.posts, vijaki: rp.config?.vijaki,
  maskaOgraja: rp.maska?.ograja?.length, maskaIzpusti: rp.maska?.izpusti?.length, maskaPrednji: rp.maska?.prednji?.length,
  gradivoPot: meta.dokaz?.gradivo?.pot ?? null, gradivoSha: meta.dokaz?.gradivo?.sha256 ?? null,
}}))
await db.$disconnect()
''')
            chk(V.get('lamela') == 67 and V.get('deska') == 67, f'konfiguracija 67 mm preživi krog (lamela {V.get("lamela")}, deska {V.get("deska")})')
            chk(V.get('reza') == 8 and V.get('posts') == 2, f'razmik {V.get("reza")} mm, stebri {V.get("posts")}')
            chk(V.get('vijaki') is False, 'skrito vijačenje (vijaki=false) preživi krog')
            chk(V.get('maskaOgraja') == 1 and V.get('maskaIzpusti') == 1 and V.get('maskaPrednji') == 1, 'maska (1 ograja + 1 izpust + 1 prednji) preživi krog')
            chk('gasper1' in (V.get('gradivoPot') or ''), f'trdnja gradiva potrjena s strežniško potjo ({V.get("gradivoPot")})')
            chk(isinstance(V.get('gradivoSha'), str) and len(V.get('gradivoSha')) == 64, 'trdnja nosi SHA-256 preverjene datoteke')
            # čiščenje (idempotentno ×2 — r513 vzorec)
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
