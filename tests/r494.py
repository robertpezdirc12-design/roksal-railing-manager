#!/usr/bin/env python3
# tests/r494.py — R494: URADNE BARVNE LESTVICE + POLNA PALETA ODTENKOV + VRTNO POHIŠTVO
# Preverja: lestvice VERIFIED z datotekami/sha256, polna paleta variant po profilih,
# vrtno pohištvo (8 izdelkov), tehnične dopolnitve, API colors, matrika, UI,
# idempotenco seida (baza prek tests/dbenv.py — sistemski DATABASE_URL ne sme izsiliti napačne baze).
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

print('═══ R494: LESTVICE + PALETA + POHIŠTVO ═══')

# ── 1. zdravje in avtorizacija ──
s, d = callj('GET', '/api/public/health')
chk(s == 200 and d.get('ok') is True and d.get('db') == 'ok', 'GET /api/public/health → 200 ok')
s, _ = callj('GET', '/api/product-assets')
chk(s == 401, 'anonimni GET /api/product-assets → 401 (fail-closed)')

tok_adm = login('admin@roksal.si', 'Admin123!')
tok_mon = login('monter@roksal.si', 'Monter123!')

# ── 2. barvne lestvice — VERIFIED, datoteke, sha256 ──
s, d = callj('GET', '/api/product-assets?kind=BARVNA_LESTVICA', tok_adm)
chk(s == 200, 'GET ?kind=BARVNA_LESTVICA → 200')
charts = d.get('data', [])
chk(len(charts) == 8, f'8 zapisov lestvic (5 datotek × več profilov; dejansko: {len(charts)})')
chk(all(c.get('status') == 'VERIFIED' for c in charts), 'vse lestvice VERIFIED')
datoteke = set()
for c in charts:
    fp = os.path.join(REPO, c['filePath']) if c.get('filePath') else None
    dober = fp and os.path.exists(fp) and hashlib.sha256(open(fp, 'rb').read()).hexdigest() == c.get('sha256')
    chk(dober, f'datoteka+sha256: {os.path.basename(c.get("filePath") or "?")}')
    datoteke.add(c.get('filePath'))
chk(len(datoteke) == 6, f'6 edinstvenih datotek lestvic (5 r494 + namenska 57/32 iz R523; dejansko: {len(datoteke)})')

# imena odtenkov v opombi + provenienca
chk(all('Odtenki:' in (c.get('note') or '') for c in charts), 'opomba vsake lestvice navaja odtenke')
chk(all('roksal.com' in (c.get('note') or '') for c in charts), 'opomba navaja izvor (roksal.com)')
kjer = {c['product']['sku']: c for c in charts if c.get('product')}
chk('ROK-OGP-POLNA-57' in kjer, 'lestvica KUBO povezana tudi na POLNA 57/32 (kot v izvirniku)')
chk('ROK-TER-RUSTIC' in kjer and 'ROK-OG-DESKA-150' in kjer, 'lestvica TERASA povezana na RUSTIC in DESKA 150 (kot v izvirniku)')

# iskrenost: neskladje POLNA 128 (slika 6, besedilo 5) + omejitev 57/32 (3 barve, izbor neznan)
polna128 = kjer.get('ROK-OG-POLNA-128', {})
chk('NESKLADJE' in (polna128.get('note') or ''), 'POLNA 128: neskladje slika(6)/besedilo(5) IZRECNO zabeleženo')
chk('6 odtenkov' in (polna128.get('note') or ''), 'POLNA 128: opomba navaja 6 odtenkov s slike')
p57 = kjer.get('ROK-OGP-POLNA-57', {})
chk('NAMENJENA' in (p57.get('note') or '') or 'namenska' in (p57.get('note') or ''),
    'POLNA 57/32: NAMENJENA lestvica 57/32 (R523) — izbor odtenkov ZNAN, ne več »ni naveden«')
chk('Odtenki: Amazon wood, Oak wood, Rustic walnut' in (p57.get('note') or ''),
    'POLNA 57/32: opomba navaja točne 3 odtenke namenske lestvice (R523)')

# ── 3. polna paleta variant po profilih ──
s, d = callj('GET', '/api/products?family=all&q=ROK-', tok_adm)
prods = {p['sku']: p for p in d.get('data', [])}
PRICAKOVANE_BARVE = {
  'ROK-TER-KLASIK': 7, 'ROK-TER-RUSTIC': 7, 'ROK-OG-ROMB-67': 7, 'ROK-OG-DESKA-150': 7,
  'ROK-OGP-POLNA-100': 8, 'ROK-OG-POLNA-128': 6, 'ROK-FAS-KUBO': 4,
}
for sku, n in PRICAKOVANE_BARVE.items():
    p = prods.get(sku)
    vs = [v for v in (p.get('variants') or []) if v.get('active', True)]
    chk(p is not None and len(vs) == n, f'{sku}: {n} barvnih variant (dejansko: {len(vs) if p else "MANJKA"})')
# R495→R523 posodobitev: namenska uradna lestvica 57/32 (3 čipi) je odločilen dokaz → 3 variante
chk(len((prods.get('ROK-OGP-POLNA-57') or {}).get('variants') or []) == 3, 'POLNA 57/32: 3 variante (R523: namenska lestvica 57/32 — AMW, OKW, RWA)')
polna100 = prods.get('ROK-OGP-POLNA-100', {})
colors100 = set(v.get('color') for v in (polna100.get('variants') or []))
chk('White' in colors100, 'POLNA 100: White med variantami (8 odtenkov s lestvice)')
chk(all(v.get('ral') is None for p in prods.values() for v in (p.get('variants') or [])), 'vse Roksal variante BREZ RAL (WPC odtenki niso RAL)')

# ── 4. vrtno pohištvo (8 izdelkov, VRTNA_RESITEV) ──
POHISTVO = {
  'ROK-VRT-MIZA-KUBO': (2200, 800, 750), 'ROK-VRT-KLOP-KUBO': (2000, 450, 450),
  'ROK-VRT-MIZA-LINEA': (2200, 810, 450), 'ROK-VRT-KLOP-LINEA': (2000, 410, 450),
  'ROK-VRT-MIZA-X': (2160, 912, 761), 'ROK-VRT-KLOP-X': (2160, 392, 448),
  'ROK-VRT-MIZA-R': (2160, 912, 761), 'ROK-VRT-KLOP-R': (2160, 392, 448),
}
for sku, (dol, sir, vis) in POHISTVO.items():
    p = prods.get(sku)
    chk(p is not None, f'{sku} v katalogu')
    if p:
        chk(p.get('unit') == 'kos', f'{sku}: enota kos')
        chk(p.get('warrantyMonths') == 180, f'{sku}: garancija 180 m (15 let)')
        t = ((p.get('tech') if isinstance(p.get('tech'), dict) else {}) if p else {})  # R542: jsonb objekt
        chk('RAL 9005' in t.get('konstrukcija', '') or 'jeklena' in t.get('konstrukcija', ''), f'{sku}: konstrukcija opisana ({t.get("konstrukcija", "?")})')
        chk(t.get('vir', '').endswith('/vrtno-pohistvo/'), f'{sku}: vir roksal.com/vrtno-pohistvo')
        dim_ok = p.get('depthMm') == dol and p.get('widthMm') == sir and p.get('heightMm') == vis
        chk(dim_ok, f'{sku}: dimenzije {dol}×{sir}×{vis} mm')
s, d = callj('GET', '/api/products?family=VRTNA_RESITEV', tok_adm)
chk(len(d.get('data', [])) == 9, f'družina VRTNA_RESITEV: 9 izdelkov — 8 novih + obstoječa demo pergola (dejansko: {len(d.get("data", []))})')
chk(len([p for p in d.get('data', []) if p['sku'].startswith('ROK-VRT-')]) == 8, 'od tega 8 pravih Roksal (ROK-VRT-*)')

# ── 5. tehnične dopolnitve ──
romb = prods.get('ROK-OG-ROMB-67', {})
t_romb = ((romb.get('tech') if isinstance(romb.get('tech'), dict) else {}) if romb else {})  # R542: jsonb objekt
chk(t_romb.get('sestavaMateriala') == '60 % bambusova vlakna, 30 % reciklirani polietilen (HDPE), 10 % aditivi', 'ROMB: sestava materiala 60/30/10 (izvirnik)')
chk('vključena v ceno' in t_romb.get('aluCev', ''), 'ROMB: alu cev vključena v ceno (izvirnik)')
chk(t_romb.get('standardniRazmakFasadaMm') == 8, 'ROMB: standardni razmak fasada 8 mm (referenca Intersport)')
chk(t_romb.get('montaznaTemperatura') == 'najmanj +5 °C', 'ROMB: montažna temperatura ≥ +5 °C')
p100 = prods.get('ROK-OGP-POLNA-100', {})
t100 = ((p100.get('tech') if isinstance(p100.get('tech'), dict) else {}) if p100 else {})  # R542: jsonb objekt
chk(t100.get('razmakDeskMm') == '5–30 (priporočeno)', 'POLNA 100: razmak desk 5–30 mm (izvirnik)')
chk('180 cm' in t100.get('maxStebrickev', ''), 'POLNA 100: max stebrički 180 cm (≤150 cm višine)')
p57 = prods.get('ROK-OGP-POLNA-57', {})
t57 = ((p57.get('tech') if isinstance(p57.get('tech'), dict) else {}) if p57 else {})  # R542: jsonb objekt
chk(t57.get('vijak') == 'dolg približno 2/3 globine profila', 'POLNA 57/32: vijak 2/3 globine (izvirnik)')
chk(t57.get('maxStebrickevMm') == 1500 and t57.get('maxNosilciMm') == 1000, 'POLNA 57/32: max stebrički 150 / nosilci 100 cm')
p128 = prods.get('ROK-OG-POLNA-128', {})
t128 = ((p128.get('tech') if isinstance(p128.get('tech'), dict) else {}) if p128 else {})  # R542: jsonb objekt
chk('6 odtenkov' in t128.get('barvOpomba', ''), 'POLNA 128: barvOpomba dokumentira neskladje vira')

# ── 6. API colors (imena odtenkov za UI lestvice) ──
s, d = callj('GET', f"/api/product-assets?productId={prods['ROK-OGP-POLNA-100']['id']}", tok_adm)
chk(s == 200 and isinstance(d.get('colors'), list), 'API ?productId: polje colors prisotno')
# R495: normalizirano na uradno obliko s lestvic (Rustic oak/walnut)
chk(set(d.get('colors', [])) == {'Amazon wood', 'Ash wood', 'Golden teak', 'Burma teak', 'Oak wood', 'White', 'Rustic oak', 'Rustic walnut'}, 'colors = 8 odtenkov POLNA 100')
s, d = callj('GET', '/api/product-assets', tok_mon)
chk(s == 200 and isinstance(d.get('colors'), list) and len(d.get('colors', [])) == 0, 'brez productId: colors = [] (ne crashne)')

# ── 7. matrika ──
s, d = callj('GET', '/api/product-assets?matrix=1', tok_mon)
rows = d.get('data', [])
chk(len(rows) == 18, f'matrika: 18 vrstic (dejansko: {len(rows)})')
scales_ok = [r for r in rows if r.get('barvnaLestvica', {}) and r['barvnaLestvica'].get('status') == 'VERIFIED']
chk(len(scales_ok) == 8, f'matrika: 8 izdelkov z VERIFIED lestvico (dejansko: {len(scales_ok)})')
chk(all(r['status'] != 'DELECNO' for r in rows), 'matrika: nič DELECNO')
legenda = d.get('legenda', {}).get('barve', '')
chk('lestvic' in legenda, 'matrika: legenda omenja lestvice kot vir potrditve')

# ── 8. UI nizi ──
# R548: blok gradiv se je fizično preselil iz katalog.tsx v katalog-gradiva.tsx (razbitje srednjih modulov) — sidra posodobljena pošteno.
grad = src('src/components/roksal/modules/katalog-gradiva.tsx')
chk('Uradna barvna lestvica' in grad, 'UI: naslov Uradna barvna lestvica')
chk('Imena odtenkov' in grad, 'UI: aria-label Imena odtenkov')
chk('object-contain' in grad, 'UI: lestvica neskrčena (object-contain)')
# R495: opomba posodobljena (galerijske fotografije 2026-10-13 dodane k virom potrditve)
chk('2026-10-12' in grad and 'galerijskih fotografij' in grad, 'UI: iskrena opomba o viru potrditve (lestvice + galerije)')
chk('Golden teak in White' in grad, 'UI: opomba omejitve (Golden teak/White samo s slike)')

# ── 9. seed idempotenca (baza prek tests/dbenv.py verige) ──
subenv = dbenv.seed_env(REPO)
chk(subenv['DATABASE_URL'].startswith('postgresql://'), f'subenv DATABASE_URL ({subenv["DATABASE_URL"][:30]}…)')
r = subprocess.run(['node', 'prisma/seed-r494.cjs'], cwd=REPO, capture_output=True, text=True, timeout=180, env=subenv)
chk(r.returncode == 0 and 'KONEC: 5 lestvic VERIFIED' in r.stdout, 'seed-r494 idemponten: 5 lestvic, brez podvajanj')
s, d = callj('GET', '/api/product-assets?status=VERIFIED', tok_adm)
# R523: seed-r494 pobriše le ROK-VRT izdelke (cascade 10 r495 gradiv pohištva) → 91−10 = 81
# R524: + 24 DETAJL čipov ograj → 115−10 = 105
chk(len(d.get('data', [])) == 105, f'po ponovnem seedu: 105 VERIFIED (115 − 10 ROK-VRT; r523/r524 gradiva preživijo; dejansko: {len(d.get("data", []))})')
s, d = callj('GET', '/api/products?family=all&q=ROK-', tok_adm)
chk(len(d.get('data', [])) == 18, 'po ponovnem seedu: 18 izdelkov')
chk(len([v for p in d.get('data', []) for v in p.get('variants', [])]) == 49, 'po ponovnem seedu: 49 variant (46 r494 + 3× 57/32 iz r495/r523 — ROAK ostaja odstranjen; r494 POLNA-57 variant ne ustvarja)', )

# R495: seed-r494 briše ROK-VRT izdelke (cascade na gradiva) → obnovimo najnovejše stanje
r = subprocess.run(['node', 'prisma/seed-r495.cjs'], cwd=REPO, capture_output=True, text=True, timeout=180, env=subenv)
chk(r.returncode == 0 and '50 povezav' in r.stdout, 'obnova stanja: seed-r495 po r494 preverbi (50 povezav)')
# R523: veriga se konča s seed-r523 (čipi KUBO, lestvici) — naslednje skupine
# (r520/r523) drugače vidijo stanje BREZ čipov
r = subprocess.run(['node', 'prisma/seed-r523.cjs'], cwd=REPO, capture_output=True, text=True, timeout=180, env=subenv)
chk(r.returncode == 0 and 'KUBO DETAJL ×4' in r.stdout, 'obnova stanja: seed-r523 po r494 preverbi (čipi KUBO)')
# R524: veriga se konča s seed-r524 (24 DETAJL čipov ograj + lestvice izvirniki)
r = subprocess.run(['node', 'prisma/seed-r524.cjs'], cwd=REPO, capture_output=True, text=True, timeout=180, env=subenv)
chk(r.returncode == 0 and 'DETAJL čipov' in r.stdout, 'obnova stanja: seed-r524 po r494 preverbi (čipi ograj)')
s, d = callj('GET', '/api/product-assets?status=VERIFIED', tok_adm)
chk(len(d.get('data', [])) == 115, f'obnova stanja: 115 VERIFIED po r524 (91 r523 + 24 čipov R524; dejansko: {len(d.get("data", []))})')
s, d = callj('GET', '/api/products?family=all&q=ROK-', tok_adm)
chk(len([v for p in d.get('data', []) for v in p.get('variants', [])]) == 49, 'obnova stanja: 49 variant (R523)')

# ── 10. regresija temeljev ──
s, d = callj('GET', '/api/guide', tok_mon)
chk(s == 200 and (d.get('data', {}).get('issues') or []) == [], 'regresija: /api/guide v redu')

print()
print(f'═══ R494 REZULTAT: ✓ {PASS} / ✗ {FAIL} ═══')
sys.exit(1 if FAIL else 0)
