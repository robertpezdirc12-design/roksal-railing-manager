#!/usr/bin/env python3
# tests/r495.py — R495: GALERIJSKE FOTOGRAFIJE PROFIL×BARVA + POLNA 57/32 VARIANTI + VRtno POHIŠTVO S FOTOGRAFIJAMI
# Preverja: 50 povezav gradiv iz Roksalovih galerij (colorName POTRJEN z naslovom vira),
# 4 variante POLNA 57/32 (stran ograj: »štiri barve« + lestvica KUBO), vrtno pohištvo s fotografijami,
# matrika 0 MANJKA, BREZ samodejnega vnosa cen (izrecno navodilo lastnika 2026-10-13),
# idempotenco seida (baza prek tests/dbenv.py verige).
import json, os, sys, hashlib, subprocess, urllib.request, urllib.error
import dbenv

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.environ.get('REPO_DIR', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PASS = 0; FAIL = 0

def callj (method, path, token=None, body=None, timeout=60):
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

def src (relpath):
    with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
        return f.read()

def db_rows (script, timeout=120):
    r = subprocess.run(['bun', '-e', script], cwd=REPO, capture_output=True, text=True, timeout=timeout,
                       env={**os.environ, 'DATABASE_URL': DBURL})
    assert r.returncode == 0, r.stderr[-300:]
    return [json.loads(l) for l in r.stdout.strip().splitlines() if l.startswith('{')]

# R496: veriga TEST_DB_URL → env.sh → DATABASE_URL, vedno z zahtevo po postgresql://
# (sistemski sqlite bi preusmeril seide in neposredne BP pogovore na napačno bazo)
DBURL = dbenv.db_url(REPO)

print('═══ R495: GALERIJSKE FOTOGRAFIJE PROFIL×BARVA ═══')

# ── 1. zdravje in avtorizacija ──
s, d = callj('GET', '/api/public/health')
chk(s == 200 and d.get('ok') is True and d.get('db') == 'ok', 'GET /api/public/health → 200 ok')
s, _ = callj('GET', '/api/product-assets')
chk(s == 401, 'anonimni GET /api/product-assets → 401 (fail-closed)')

tok_adm = login('admin@roksal.si', 'Admin123!')
tok_mon = login('monter@roksal.si', 'Monter123!')

# ── 2. datoteke: 48 prenesenih, celovitost (sha256 iz MANIFEST) ──
manifest = json.load(open(os.path.join(REPO, 'public/assets/roksal/src/MANIFEST.json'), encoding='utf-8'))
r495m = [e for e in manifest if e['file'].startswith('r495-')]
chk(len(r495m) == 48, f'MANIFEST: 48 novih datotek r495-* (dejansko: {len(r495m)})')
good = 0
for e in r495m:
    fp = os.path.join(REPO, 'public/assets/roksal/src', e['file'])
    if not os.path.exists(fp): continue
    data = open(fp, 'rb').read()
    if hashlib.sha256(data).hexdigest() == e['sha256'] and len(data) == e['bytes']:
        good += 1
chk(good == 48, f'sha256+velikost se ujema za vseh 48 datotek (dejansko: {good})')

# ── 3. POLNA 57/32: 3 variante (AMW, OKW, RWA) + opomba ── (R523: namenska
# uradna lestvica 57/32 — 3 čipi — je odločilen dokaz; ROAK odstranjen)
rows = db_rows("""
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const p = await db.product.findUnique({ where: { sku: 'ROK-OGP-POLNA-57' }, include: { variants: true } });
console.log(JSON.stringify({ sku: p.sku, tech: p.tech, varianti: p.variants.map(v => ({ sku: v.sku, name: v.name, color: v.color })) }));  // R542: tech je jsonb objekt
await db.$disconnect();
""")
r57 = rows[0]
colors57 = sorted(v['color'] for v in r57['varianti'])
chk(colors57 == sorted(['Amazon wood', 'Oak wood', 'Rustic walnut']),
    f'POLNA 57/32: 3 variante po NAMENSKI lestvici (dejansko: {colors57}) — R523')
chk(all('ROK-OGP-POLNA-57-' in v['sku'] for v in r57['varianti']), 'POLNA 57/32: SKU vzorec ROK-OGP-POLNA-57-{KODA}')
chk('namenska' in r57['tech'].get('barvOpomba', '').lower() or 'Namenjena' in r57['tech'].get('barvOpomba', ''),
    'POLNA 57/32: opomba dokumentira namensko lestvico (R523)')
chk(r57['tech'].get('barv') == 3, 'POLNA 57/32: tech.barv = 3 (R523)')

# ── 4. ProductAsset: 50 galerijskih povezav, colorName potrjen ──
rows = db_rows("""
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const a = await db.productAsset.findMany({ where: { filePath: { startsWith: 'public/assets/roksal/src/r495-' } }, include: { product: true } });
console.log(JSON.stringify({ n: a.length, slike: a.map(x => ({ kind: x.kind, sku: x.product.sku, color: x.colorName, vir: x.sourceUrl, sha: x.sha256, bytes: x.bytes, status: x.status, variantSku: x.variantSku, note: x.note })) }));
await db.$disconnect();
""")
ga = rows[0]
chk(ga['n'] == 50, f'50 zapisov gradiv r495 (dejansko: {ga["n"]})')
chk(all(x['status'] == 'VERIFIED' for x in ga['slike']), 'vsi r495 zapisi VERIFIED')
chk(all(x['vir'] and x['vir'].startswith('https://roksal.com/wp-content/uploads/') for x in ga['slike']),
    'vsak zapis ima izvirni URL roksal.com (provenienca)')
chk(all(x['sha'] and x['bytes'] for x in ga['slike']), 'vsak zapis ima sha256 + velikost')
chk(all('Prenos 2026-10-13' in x['note'] for x in ga['slike']), 'opombe: datum prenosa 2026-10-13')
chk(all('naslov zapisu' in x['note'].lower() or 'Naslov zapisu' in x['note'] for x in ga['slike']), 'opombe: Roksalov naslov zapisu citiran')

# barve: 40+ zapisov s potrjeno barvo
with_color = [x for x in ga['slike'] if x['color']]
chk(len(with_color) >= 40, f'{len(with_color)} zapisov s POTRJDENO barvo iz naslova vira (≥40)')

# ── 5. pokritost profil×barv (cilj issue #6) ──
pc = {}
for x in ga['slike']:
    if x['color']:
        pc.setdefault(x['sku'], set()).add(x['color'])
pričakovano = {
  'ROK-OGP-POLNA-57': {'Amazon wood', 'Oak wood'},        # Rustic oak/walnut: ni fotografskega dokaza (lestvica da)
  'ROK-OGP-POLNA-100': {'Amazon wood', 'Ash wood', 'Golden teak', 'Burma teak', 'Oak wood', 'Rustic oak', 'Rustic walnut', 'White'},
  'ROK-OG-POLNA-128': {'Amazon wood', 'Ash wood', 'Burma teak', 'Oak wood', 'Rustic oak', 'Rustic walnut'},
  'ROK-OG-ROMB-67': {'Amazon wood', 'Ash wood', 'Golden teak', 'Burma teak', 'Oak wood', 'Rustic oak', 'Rustic walnut'},
  'ROK-OG-DESKA-150': {'Amazon wood', 'Ash wood', 'Golden teak', 'Burma teak', 'Oak wood', 'Rustic oak', 'Rustic walnut'},
  'ROK-FAS-KUBO': {'Amazon wood', 'Oak wood', 'Rustic oak', 'Rustic walnut'},
  'ROK-TER-KLASIK': {'Burma teak', 'Ash wood', 'Oak wood'},
  'ROK-TER-RUSTIC': {'Rustic oak', 'Rustic walnut'},
}
for sku, need in pričakovano.items():
    have = pc.get(sku, set())
    missing = need - have
    chk(not missing, f'{sku}: fotografije za vse ciljne barve (manjka: {sorted(missing) if missing else "nič"})')

# vrtno pohištvo: 8 izdelkov, vsaj 1 fotografija na izdelek
vrts = [x for x in ga['slike'] if x['sku'].startswith('ROK-VRT-')]
vrt_skus = {x['sku'] for x in vrts}
chk(len(vrt_skus) == 8, f'vrtno pohištvo: 8 izdelkov s fotografijo (dejansko: {len(vrt_skus)})')
chk(all(not x['color'] or x['color'] in ('Rustic oak', 'Burma teak', 'Rustic walnut', 'Oak wood') for x in vrts),
    'vrtno pohištvo: barvne oznake samo kjer jih navaja vir')

# ── 6. matrika pokritosti: 0 MANJKA ──
s, d = callj('GET', '/api/product-assets?matrix=1', tok_adm)
rowsm = d.get('rows') or d.get('data') or []
chk(len(rowsm) == 18, f'matrika: 18 ROK izdelkov (dejansko: {len(rowsm)})')
chk(not [r for r in rowsm if 'MANJKA' in str(r.get('status', ''))], 'matrika: NIČ MANJKA (zaključna letev sedaj VERIFIED)')

# ── 7. zaključna letev (KOMPONENTA, izvirnik 200×145) ──
zak = [x for x in ga['slike'] if x['sku'] == 'ROK-KOM-ZAKL-LETV']
chk(len(zak) == 1 and zak[0]['kind'] == 'KOMPONENTA', 'zaključna letev: zapis KOMPONENTA')
chk(zak and zak[0]['bytes'] == 2564, 'zaključna letev: izvirnik 2564 B (edina objavljena velikost vira)')

# ── 8. BREZ samodejnega vnosa cen (navodilo lastnika) ──
seed = src('prisma/seed-r495.cjs')
chk('Cene: IZRECNO BREZ samodejnega vnosa cen' in seed, 'seed: izrecna izjava o ročnih cenah')
kat = src('src/components/roksal/modules/katalog.tsx')
chk('samodejn' not in kat.lower(), 'UI katalog: brez samodejnega vnosa cen')
chk('Uredi pravilo' in kat, 'UI katalog: ročno urejanje cenikov ostaja')
chk('galerijskih fotografij' in kat and '2026-10-13' in kat, 'UI katalog: opomba omenja galerijske fotografije kot vir potrditve')
chk('barva: {a.colorName} (potrjena)' in kat or '(potrjena)' in kat, 'UI katalog: oznaka potrjene barve iz naslova vira')

# ── 9. API: product-assets vrača podatke ──
s, d = callj('GET', '/api/product-assets?status=VERIFIED', tok_adm)
chk(s == 200 and len(d.get('data', [])) == 115, f'115 VERIFIED gradiv skupaj z r524 (dejansko: {len(d.get("data", []))})')
s, d = callj('GET', '/api/product-assets', tok_mon)
chk(s == 200, 'monter lahko bere gradiva (_read)')

# ── 10. seed idempotenca (z env.sh bazo) ──
subenv = {**os.environ, 'DATABASE_URL': DBURL}
r = subprocess.run(['node', 'prisma/seed-r495.cjs'], cwd=REPO, capture_output=True, text=True, timeout=180, env=subenv)
chk(r.returncode == 0 and '0 novih zapisov' in r.stdout and '50 povezav' in r.stdout,
    'seed-r495 idempotenten: 0 novih, 50 posodobljenih')
# R523: veriga se konča s seed-r523 (čipi KUBO, lestvici, POLNA-57 brez ROAK)
r = subprocess.run(['node', 'prisma/seed-r523.cjs'], cwd=REPO, capture_output=True, text=True, timeout=180, env=subenv)
chk(r.returncode == 0 and 'KUBO DETAJL ×4' in r.stdout, 'obnova stanja: seed-r523 po r495 preverbi (čipi KUBO)')
rows = db_rows("""
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
console.log(JSON.stringify({ assets: await db.productAsset.count(), verified: await db.productAsset.count({ where: { status: 'VERIFIED' } }), vars: await db.productVariant.count({ where: { sku: { startsWith: 'ROK-' } } }) }));
await db.$disconnect();
""")
st = rows[0]
chk(st['assets'] == 115 and st['verified'] == 115, f'skupaj 115 gradiv VERIFIED po r524 (dejansko: {st["assets"]}/{st["verified"]})')
chk(st['vars'] == 49, f'49 ROK variant (dejansko: {st["vars"]}) — R523: POLNA-57 brez ROAK')

# ── 11. regresija temeljev ──
s, d = callj('GET', '/api/guide', tok_mon)
chk(s == 200 and (d.get('data', {}).get('issues') or []) == [], 'regresija: /api/guide v redu')

print()
print(f'═══ R495 REZULTAT: ✓ {PASS} / ✗ {FAIL} ═══')
sys.exit(1 if FAIL else 0)
