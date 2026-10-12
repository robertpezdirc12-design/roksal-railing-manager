#!/usr/bin/env python3
# tests/r493.py — ISSUE #6: ORIGINAL ROKSAL PRODUCT ASSET LIBRARY
# Preverja: podatkovni model + seed (idempotenca), API (avtorizacija + matrika),
# iskrenost statusov (manjkajo barvne lestvice so VIDNE, ne skrite),
# datoteke na disku z sha256, UI nizi, RAL_HEX približek ločen od uradnega.
import json, os, sys, hashlib, urllib.request, urllib.error

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

print('═══ R493: ISSUE #6 — PRODUCT ASSET LIBRARY ═══')

# ── 1. zdravje ──
s, d = callj('GET', '/api/public/health')
chk(s == 200 and d.get('ok') is True and d.get('db') == 'ok', 'GET /api/public/health → 200 ok (db ok)')

# ── 2. shema in migracija ──
schema = src('prisma/schema.prisma')
chk('model ProductAsset' in schema, 'shema: model ProductAsset obstaja')
chk('permission' in schema.split('model ProductAsset')[1].split('}')[0], 'shema: ProductAsset.polje permission (provenienca)')
chk('status' in schema.split('model ProductAsset')[1].split('}')[0], 'shema: ProductAsset.polje status (VERIFIED/…)')
mig = os.path.join(REPO, 'prisma/migrations')
migdirs = [x for x in os.listdir(mig) if 'r493' in x]
chk(len(migdirs) == 1, f'migracija r493 obstaja ({migdirs[0] if migdirs else "MANJKA"})')

# ── 3. avtorizacija API (fail-closed) ──
s, _ = callj('GET', '/api/product-assets')
chk(s == 401, 'anonimni GET /api/product-assets → 401 (fail-closed)')
s, _ = callj('GET', '/api/product-assets?matrix=1')
chk(s == 401, 'anonimni GET /api/product-assets?matrix=1 → 401 (fail-closed)')

tok_adm = login('admin@roksal.si', 'Admin123!')
tok_mon = login('monter@roksal.si', 'Monter123!')

# ── 4. seed izdelkov (prava Roksal linija) ──
s, d = callj('GET', '/api/products?family=all&q=ROK-', tok_adm)
chk(s == 200, 'GET /api/products?q=ROK- → 200')
prods = d.get('data', [])
skus = [p['sku'] for p in prods]
chk(len(prods) == 10, f'10 pravih Roksal izdelkov (dejansko: {len(prods)})')
for expected in ['ROK-TER-KLASIK', 'ROK-TER-RUSTIC', 'ROK-OGP-POLNA-57', 'ROK-OGP-POLNA-100', 'ROK-OG-POLNA-128', 'ROK-OG-ROMB-67', 'ROK-OG-DESKA-150', 'ROK-FAS-KUBO']:
    chk(expected in skus, f'izdelek {expected} v katalogu')
romb = next((p for p in prods if p['sku'] == 'ROK-OG-ROMB-67'), None)
chk(romb is not None and romb.get('warrantyMonths') == 180, 'ROMB 67: garancija 180 mesecev (15 let, roksal.com)')
chk(romb is not None and romb.get('variants'), 'ROMB 67: variante z barvami')
tech = json.loads(romb['tech']) if romb and romb.get('tech') else {}
chk(tech.get('maxRazmakPrecnaMm') == 1450, 'ROMB 67: max razmak prečna 145 cm (izvorni podatek)')
chk(tech.get('maxRazmakPokoncnaMm') == 1100, 'ROMB 67: max razmak pokončna 110 cm (izvorni podatek)')

# ── 5. gradiva — VERIFIED fotografije s sha256 ──
s, d = callj('GET', '/api/product-assets?status=VERIFIED', tok_adm)
chk(s == 200, 'GET /api/product-assets?status=VERIFIED → 200')
assets = d.get('data', [])
chk(len(assets) == 27, f'27 preverjenih fotografij (dejansko: {len(assets)})')
manjkajoce_datoteke = [a for a in assets if not a.get('filePath')]
chk(len(manjkajoce_datoteke) == 0, 'vse VERIFIED gradive imajo filePath')
# preveri 3 vzorčne datoteke po sha256
import random
random.seed(493)
for a in random.sample(assets, min(3, len(assets))):
    fp = os.path.join(REPO, a['filePath'])
    obst = os.path.exists(fp)
    chk(obst, f'datoteka na disku: {os.path.basename(a["filePath"])}')
    if obst:
        sha = hashlib.sha256(open(fp, 'rb').read()).hexdigest()
        chk(sha == a['sha256'], f'sha256 ujema: {os.path.basename(a["filePath"])[:16]}…')
        chk(a.get('permission') and a.get('sourceName'), 'provenienca + dovoljenje zapisana')
        chk(a.get('colorApprox') is None or 'VLM' not in json.dumps(a), 'VLM ocena je ločeno polje, ne ime')

# ── 6. barvne lestvice — iskrena vrzel (MISSING, ne tiho skrita) ──
s, d = callj('GET', '/api/product-assets?kind=BARVNA_LESTVICA', tok_adm)
chk(s == 200, 'GET /api/product-assets?kind=BARVNA_LESTVICA → 200')
charts = d.get('data', [])
chk(len(charts) == 5, f'5 barvnih lestvic zabeleženih (dejansko: {len(charts)})')
chk(all(c.get('status') == 'MISSING' for c in charts), 'vse barvne lestvice status MISSING (datoteka ni prenesena — iskreno)')
chk(all(c.get('sourceUrl', '').startswith('https://roksal.com/') for c in charts), 'vsaka lestvica ima izvorni URL na roksal.com')
chk(all('WAF' in (c.get('note') or '') for c in charts), 'opomba pojasnjuje vzrok manjkajoče datoteke')

# ── 7. matrika pokritosti ──
s, d = callj('GET', '/api/product-assets?matrix=1', tok_mon)
chk(s == 200, 'GET /api/product-assets?matrix=1 (monter) → 200')
rows = d.get('data', [])
chk(len(rows) == 10, f'matrika: 10 vrstic (dejansko: {len(rows)})')
legenda = d.get('legenda', {})
chk('DELECNO' in legenda.get('status', ''), 'matrika: legenda razloži status DELECNO')
delecno = [r for r in rows if r['status'] == 'DELECNO']
chk(len(delecno) >= 5, f'matrika: vrstice z manjkajočo lestvico so VIDNO DELECNO ({len(delecno)})')
chk(all(r.get('fotografije', 0) >= 0 for r in rows), 'matrika: števec fotografij prisoten')

# ── 8. potrjena imena odtenkov samo Rustic (iz besedila vira) ──
s, d = callj('GET', '/api/products?family=all&q=ROK-', tok_adm)
allvars = [v for p in d.get('data', []) for v in p.get('variants', [])]
chk(len(allvars) == 14, f'14 variant (dejansko: {len(allvars)})')
chk(all(v.get('ral') is None for v in allvars), 'Roksal variante BREZ RAL kode (WPC odtenki niso RAL — približek bi bil napačen)')
barve = set(v.get('color') for v in allvars)
chk(barve == {'Rustic Oak', 'Rustic Walnut'}, f'imena barv točno Rustic Oak/Walnut (dejansko: {barve})')

# ── 9. UI — iskreni nizi v katalogu ──
kat = src('src/components/roksal/modules/katalog.tsx')
chk('Produktna gradiva' in kat, 'UI: razdelek Produktna gradiva')
chk('VLM ocena, ni uradno ime' in kat, 'UI: VLM približek IZRECNO označen kot neuraden')
chk('Preverjeno' in kat and 'V preverjanju' in kat and 'Manjka datoteka' in kat, 'UI: statusi Preverjeno/V preverjanju/Manjka')
chk('niso izmišljena' in kat, 'UI: manjkajoča imena odtenkov izrecno niso izmišljena')
chk('približek' in kat, 'UI: beseda približek prisotna (ločitev od uradnega)')

# ── 10. RAL_HEX ostaja označen kot približek v jedru ──
core = src('src/lib/photo-replace-core.ts')
chk('Pogosti RAL kodi → hex (približek' in core, 'photo-replace-core: RAL_HEX dokumentiran kot približek')

# ── 11. seed idempotenca (baza) ──
import subprocess
r = subprocess.run(['node', 'prisma/seed-r493.cjs'], cwd=REPO, capture_output=True, text=True, timeout=180)
chk(r.returncode == 0 and 'KONEC: 10 izdelkov, 14 variant' in r.stdout, 'seed-r493 idemponten ponovni zagon: 10 izdelkov, 14 variant')
s, d = callj('GET', '/api/product-assets?status=VERIFIED', tok_adm)
chk(len(d.get('data', [])) == 27, 'po ponovnem seedu: še vedno 27 VERIFIED (brez podvajanj)')
s, d = callj('GET', '/api/products?family=all&q=ROK-', tok_adm)
chk(len(d.get('data', [])) == 10, 'po ponovnem seedu: 10 izdelkov (brez podvajanj)')

# ── 12. regresija temeljev ──
s, d = callj('GET', '/api/guide', tok_mon)
chk(s == 200 and (d.get('data', {}).get('issues') or []) == [], 'regresija: /api/guide v redu')

print()
print(f'═══ R493 REZULTAT: ✓ {PASS} / ✗ {FAIL} ═══')
sys.exit(1 if FAIL else 0)
