#!/usr/bin/env python3
"""tests/r532.py — R532 (issue #14 §4, raziskava 16. 10. 2026): HARMONIZACIJA
BARV PRIZORA v fotomontažnem jedru (engine 1.4.0).

Zakaj: spec issue #14 §4 zahteva »determinističen izračun/umerjanje robov,
svetlosti in senc, ki temelji na fotografiji« — svetlost in sence sta obstajali
(od R507), barvni ton izdelka pa je ostal STUDIO DOJETJEV: ograja iz kataloga
na topli/hladni fotografiji je izpadala kot prilepljena. Raziskava po spletu
(16. 10. 2026, docs/RAZISKAVA-IZBOLJSAVE-2026-10.md) je iz klasičnih metod
(Reinhard color transfer, von Kries) izbrala VEZANI barvni namig: kromatičnost
osvetlitve prizora (odmik pasov neba/tal od lastne svetlosti) zamakne osnovni
ton izdelka za največ MEJE.zamik po kanalu (jakost 35 %). Brez AI, brez
primerjave z barvo izdelka — nevtralen prizor pusti barvo NEDOTIKNJENO.

Kaj preverja ta suite (41. skupina):
  A) čiste funkcije: oceniBarvoPrizora (tople/nevtralno/prazno), vezana
     harmonizacijskaMapa (smer, meje ±zamik, determinizem), harmonizirajHex
     (identiteta na nevtralnem);
     [R536: preverjanja raztega (s, vir, raztegMin/Max/minStd) odstranjena —
     mrtva veja jedra odstranjena v R536 (vir nikoli podan produkcijsko, s je
     bila vedno [1,1,1]; dokaz v worklogu R536-c)]
  B) žičenje v izrisiOgrajo (@napi-rs/canvas): topla fotografija → ogelata
     fasada toplejša kot na nevtralni (kanal r gor, b dol), determinizem
     (isti seme → isti izris, bajtno), opcija harmonizacija=false na
     nevtralni sliki = IZRISE KOT PRED 1.4.0 (bajtno identičen), brez novih
     opozoril;
  C) vir: ENGINE_VERSION 1.4.0, meje in možnost zabeležene v jedru, statistika
     PRED risanjem;
  D) živi API (samo ob delujočem strežniku): krog POST vizualizacije zapiše
     engineVersion 1.4.0, nato idempotentno čiščenje.

Brez AI, brez novih odvisnosti, brez omrežja (razen lokalni strežnik).
"""
import json
import os
import subprocess
import sys
import urllib.request

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


print('═══ R532: harmonizacija barv prizora (issue #14 §4, engine 1.4.0) ═══')

# ═══ A) čiste funkcije — statistika, vezana preslikava, hex ══════════════════
print('── A) čiste funkcije: oceniBarvoPrizora / harmonizacijskaMapa / harmonizirajHex ──')
A = bun_js(r'''
const { createCanvas } = await import('@napi-rs/canvas')
const lib = await import('./src/lib/photo-replace-core')

const W = 240, H = 180
const quad = [{ x: 0.2 * W, y: 0.75 * H }, { x: 0.8 * W, y: 0.75 * H },
              { x: 0.8 * W, y: 0.25 * H }, { x: 0.2 * W, y: 0.25 * H }]

function scena (r, g, b) {
  const cv = createCanvas(W, H), ctx = cv.getContext('2d')
  ctx.fillStyle = `rgb(${r},${g},${b})`
  ctx.fillRect(0, 0, W, H)
  return ctx
}

const topla = scena(230, 180, 120)
const nevtralna = scena(128, 128, 128)
const statTopli = lib.oceniBarvoPrizora(topla, W, H, quad)
const statNevtr = lib.oceniBarvoPrizora(nevtralna, W, H, quad)
// degeneriran quad: pokriva celo sliko → pasova neba/tal prazna → null
const cvDeg = createCanvas(W, H), ctxDeg = cvDeg.getContext('2d')
ctxDeg.fillStyle = 'rgb(10,20,30)'; ctxDeg.fillRect(0, 0, W, H)
const statDeg = lib.oceniBarvoPrizora(ctxDeg, W, H,
  [{ x: 0, y: H }, { x: W, y: H }, { x: W, y: 0 }, { x: 0, y: 0 }])

const mapaTopli = lib.harmonizacijskaMapa(statTopli)
const mapaNevtr = lib.harmonizacijskaMapa(statNevtr)
const mapaNull = lib.harmonizacijskaMapa(null)
const mapa2x = lib.harmonizacijskaMapa(statTopli)

// ekstremen prizor: čista rdeča → kroma r = 200.8 → zamik cap 22
const rdeca = scena(255, 0, 0)
const mapaEkstrem = lib.harmonizacijskaMapa(lib.oceniBarvoPrizora(rdeca, W, H, quad))

// [R536: blok raztega (virStd*/prizorStd*/sStisnjen/sRaztegnjen/sVarnost)
// odstranjen — harmonizacijskaMapa nima več parametra vir niti polja s
// (mrtva veja: edini produkcijski klic ni podajal vir → s vedno [1,1,1])]

const hexOsnova = '#8a7a66'
const hexNevtr = lib.harmonizirajHex(hexOsnova, mapaNevtr)
const hexTopli = lib.harmonizirajHex(hexOsnova, mapaTopli)
const hexNull = lib.harmonizirajHex(hexOsnova, null)

console.log(JSON.stringify({
  statTopli: statTopli && { r: Math.round(statTopli.r), g: Math.round(statTopli.g), b: Math.round(statTopli.b) },
  statTopliToplejsi: statTopli && statTopli.r > statTopli.g && statTopli.g > statTopli.b,
  statNevtr: statNevtr && { r: Math.round(statNevtr.r), g: Math.round(statNevtr.g), b: Math.round(statNevtr.b) },
  statDeg: statDeg === null,
  mapaTopli, mapaNevtr, mapaNull: mapaNull === null,
  determinizem: JSON.stringify(mapaTopli) === JSON.stringify(mapa2x),
  ekstremCap: mapaEkstrem && Math.abs(mapaEkstrem.d[0]) <= 22 && Math.abs(mapaEkstrem.d[2]) <= 22,
  hexNevtr, hexTopli, hexNull,
}))
''')
chk(A.get('statTopliToplejsi') is True, f'topel prizor: statistika r > g > b (dobel {A.get("statTopli")})')
nev = A.get('statNevtr') or {}
chk(abs(nev.get('r', 0) - 128) <= 1 and abs(nev.get('b', 0) - 128) <= 1,
    f'nevtralen prizor: sredina ≈ 128 po kanalih (dejansko {nev})')
chk(A.get('statDeg') is True, 'degeneriran quad (celotna slika): statistike NI → null (fail-closed)')
chk(A.get('mapaNull') is True, 'manjkajoča statistika → brez preslikave (null)')
mN = A.get('mapaNevtr') or {}
dN = mN.get('d') or [99, 99, 99]
chk(all(abs(x) < 0.5 for x in dN), f'nevtralen prizor → zamik ≈ 0 (identiteta, dejansko {dN})')
mT = A.get('mapaTopli') or {}
dT = mT.get('d') or []
chk(len(dT) == 3 and dT[0] > 5 and dT[2] < -5,
    f'topel prizor → zamik: r gor, b dol (dejansko {dT})')
chk(all(-22.001 <= x <= 22.001 for x in dT), f'vezana meja ±22 po kanalu (dejansko {dT})')
chk(A.get('ekstremCap') is True, 'ekstremen prizor (čista rdeča) → zamik cap 22')
# [R536: trije chk-ji raztega odstranjeni skupaj z mrtvo vejo jedra]
chk(A.get('determinizem') is True, 'preslikava deterministična (isti vhod → isti izhod)')
chk(A.get('hexNevtr') == '#8a7a66', f'nevtralen prizok → hex NESPREMEMENJEN (dejansko {A.get("hexNevtr")})')
chk(A.get('hexNull') == '#8a7a66', f'brez preslikave → hex nespremenjen (dejansko {A.get("hexNull")})')
hT = A.get('hexTopli') or ''
if len(hT) == 7:
    rT, gT, bT = int(hT[1:3], 16), int(hT[3:5], 16), int(hT[5:7], 16)
    chk(rT > 138 + 4 and bT < 102 - 4, f'topel prizor → ton #8a7a66 se topli (r↑ b↓, dejansko {hT})')
else:
    bad(f'topel prizor → hex veljavne oblike (dejansko {hT!r})')

# ═══ B) žičenje v izrisiOgrajo — topla slika, determinizem, izklop ══════════
print('── B) izrisiOgrajo: topla fotografija toploti izdelek; determinizem; izklop ──')
B = bun_js(r'''
const { createCanvas } = await import('@napi-rs/canvas')
const lib = await import('./src/lib/photo-replace-core')

const W = 240, H = 180
const QUAD = [{ x: 0.2, y: 0.75 }, { x: 0.8, y: 0.75 }, { x: 0.8, y: 0.25 }, { x: 0.2, y: 0.25 }]
const PARAMS = {
  quad: QUAD,
  reference: { tip: 'ROCNO', cm: 220, opis: 'višina polja' },
  config: { tip: 'FASADA', lengthCm: 245, heightCm: 285, posts: 2, handrail: false,
            lamelaMm: 80, rezaMm: 20, deskaMm: 150, pritrditev: 'TALNA', vijaki: false },
}
const MATERIAL = { vrsta: 'WPC', sijaj: 0.3, struktura: 0.6 }
const SVETLOBA = { smer: 1, svetlost: 0.55, zgoraj: '#cdd6de', spodaj: '#8d8579' }

function render (rgb, opcije) {
  const cv = createCanvas(W, H), ctx = cv.getContext('2d')
  ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
  ctx.fillRect(0, 0, W, H)
  const opozorila = lib.izrisiOgrajo(ctx, W, H, PARAMS, '#8a7a66', MATERIAL, SVETLOBA,
    { prekrijStaro: false, seme: 4242, ...(opcije || {}) })
  // povprečje notranjosti quada ( stran od robov/letvic preliva)
  const d = ctx.getImageData(0, 0, W, H).data
  let r = 0, g = 0, b = 0, n = 0
  for (let y = Math.round(0.34 * H); y < 0.66 * H; y += 2) {
    for (let x = Math.round(0.3 * W); x < 0.7 * W; x += 2) {
      const i = (y * W + x) * 4
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++
    }
  }
  return {
    povp: [Math.round(r / n), Math.round(g / n), Math.round(b / n)],
    url: cv.toDataURL('image/png').length,
    opozorila: opozorila.map((o) => o.koda),
  }
}

const nevtralna = render([128, 128, 128], {})
const topla = render([230, 180, 120], {})
const topla2 = render([230, 180, 120], {})
const izklop = render([128, 128, 128], { harmonizacija: false })

console.log(JSON.stringify({
  nevtralna, topla, topla2, izklop,
  toplaToplejsa: topla.povp[0] - nevtralna.povp[0] > 5 && nevtralna.povp[2] - topla.povp[2] > 5,
  determinizem: topla.url === topla2.url && JSON.stringify(topla.povp) === JSON.stringify(topla2.povp),
  izklopIdentika: izklop.url === nevtralna.url && JSON.stringify(izklop.povp) === JSON.stringify(nevtralna.povp),
  noveOpozorile: (nevtralna.opozorila || []).filter((k) => String(k).startsWith('HARMON')).length,
}))
''')
chk(B.get('toplaToplejsa') is True,
    f'topla fotografija → izdelek toplejši (r↑ b↓; nevtralno {B.get("nevtralna", {}).get("povp")}, toplo {B.get("topla", {}).get("povp")})')
chk(B.get('determinizem') is True, 'determinizem: isti seme + isti vhod → bajtno identičen izris')
chk(B.get('izklopIdentika') is True, 'harmonizacija=false na nevtralni sliki = izris PRED 1.4.0 (bajtno identičen)')
chk(B.get('noveOpozorile') == 0, f'brez novih opozoril HARMON* (dejansko {B.get("noveOpozorile")})')

# ═══ C) vir — verzija, meje, možnost, vrstni red ════════════════════════════
print('── C) vir: ENGINE_VERSION 1.4.0, meje, možnost, statistika PRED risanjem ──')
chk(src_has('src/lib/photo-replace-core.ts', "ENGINE_VERSION = '1.4.0'"),
    "jedro: ENGINE_VERSION = '1.4.0'")
chk(src_has('src/lib/photo-replace-core.ts', 'export const HARMONIZACIJA_MEJE'),
    'jedro: meje harmonizacije izvožene (dokumentirane konstante)')
chk(src_has('src/lib/photo-replace-core.ts', 'harmonizacija?: boolean'),
    'jedro: možnost harmonizacija (A/B izklop)')
chk(src_has('src/lib/photo-replace-core.ts', 'PRED risanjem'),
    'jedro: statistika prizora se izračuna PRED risanjem (pasovi vidijo original)')
chk(src_has('src/lib/photo-replace-core.ts', 'harmonizirajHex(barvaHex, mapaBarv)'),
    'jedro: osnovni ton gre skozi preslikavo (žičenje)')
chk(src_has('src/lib/photo-replace-core.ts', 'oceniBarvoPrizora'),
    'jedro: oceniBarvoPrizora izvožena')

# ═══ D) živi API (samo ob delujočem strežniku) ══════════════════════════════
print('── D) živi API: vizualizacija zapiše engineVersion 1.4.0 ──')
try:
    with urllib.request.urlopen(BASE + '/', timeout=5) as r:
        pass
except Exception:
    print('  ⏸ strežnik ne teče na BASE_URL — blok D se preskoči (ne zeleno)')
else:
    TOKEN = login('admin@roksal.si', 'Admin123!')
    s, prods = callj('GET', '/api/products?family=all', TOKEN)
    izdelek = next((p for p in prods.get('data', []) if p.get('sku') == 'ROK-FAS-KUBO'), None)
    chk(izdelek is not None, 'ROK-FAS-KUBO dosegljiv prek API-ja')
    s, prjs = callj('GET', '/api/projects', TOKEN)
    projekt = next((p for p in prjs.get('data', [])), None)
    chk(projekt is not None, 'vsaj en projekt na voljo')
    if izdelek and projekt:
        varianta = next((v for v in izdelek.get('variants', [])), None)
        chk(varianta is not None, 'vsaj ena varianta KUBO na voljo')
        foto = ('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof'
                'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIy'
                'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEB'
                'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF8AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0Kx'
                'wRNS0WLwcJDhLWNENFdxcYIzRiZHKBkaFYoQEVFhYnfCBlSjNWVTJCVFYV//EABQBAQAAAAAAAAAAAAAAAAAAAAX/xAAU'
                'EQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=')
        render_params = {
            'quad': [{'x': 0.12, 'y': 0.62}, {'x': 0.58, 'y': 0.62}, {'x': 0.58, 'y': 0.12}, {'x': 0.12, 'y': 0.12}],
            'reference': {'tip': 'ROCNO', 'cm': 220, 'opis': 'višina fasadnega polja'},
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
            'productId': izdelek['id'], 'variantId': varianta['id'] if varianta else None,
            'renderParams': render_params, 'note': 'R532 test — KUBO fasada 80/20 (harmonizacija 1.4.0)',
        })
        chk(s == 201, f'vizualizacija FASADA ustvarjena (201, dejansko {s})')
        vid = d.get('data', {}).get('id')
        if vid:
            V = bun_db(f'''
import {{ PrismaClient }} from '@prisma/client'
const db = new PrismaClient()
const v = await db.photoVisualization.findUnique({{ where: {{ id: '{vid}' }}, }})
console.log(JSON.stringify({{ engine: v?.engineVersion, tip: v?.renderParams?.config?.tip ?? null }}))  // R542: jsonb objekt
await db.$disconnect()
''')
            chk(V.get('tip') == 'FASADA', f'tip FASADA preživi krog (dejansko {V.get("tip")})')
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
