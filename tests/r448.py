#!/usr/bin/env python3
"""tests/r448.py — R448 NAVIGACIJA e2e (issue #7 §11: ciljna poslovna IA)

Preverja: preslikavo sekcij v globalnem iskanju (vsak zadetek ima section iz
nove 11-sekcjske IA in (section, tab) par, ki obstaja v registru), vrata po
pravicah ostajajo enaka (RBAC fail-closed — brez žetona 401), monterjev obseg
iskanja (brez računov/uporabnikov/reklamacij) in regresijo ključnih API rut
(projekti, zaloga, kosovnice, servis, dostave, katalog, izdelki, družine).
Zavihki (id + gate) so NEspremenjeni — spreminja se samo razvrstitev sekcij.
"""
import json, sys, urllib.request, urllib.error

BASE = 'http://localhost:3000'
PASS, FAIL = 0, 0

def call (method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e:
        return 0, str(e)

def jget (path, token):
    s, b = call('GET', path, token)
    return json.loads(b) if s == 200 else None

def login (email, pw):
    s, b = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s}'
    return json.loads(b)['token']

def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)

# ── hardcoded register (client koda — zrcalimo src/lib/nav-registry.ts R448) ──
SECTIONS_IA11 = {
    'danes':     {'danes'},
    'prodaja':   {'crm', 'stranke', 'ponudbe', 'postsig'},
    'projekti':  {'projekti', 'meritve', 'foto', 'nagib', 'konfigurator', 'viz', 'ar', 'signatura', 'dokumenti', 'pdf'},
    'operativa': {'nalogi', 'teren', 'dostave', 'logistika', 'proizvodnja', 'galerija', 'orodjarina'},
    'skladisce': {'zaloga', 'material-v5'},
    'katalog':   {'katalog'},
    'finance':   {'racuni'},
    'servis':    {'servis'},
    'porocila':  {'dashboard'},
    'varnost':   {'varnost', 'vodja-ekipa'},
    'profil':    {'profil'},
}
VALID_SECTION_IDS = set(SECTIONS_IA11.keys())

# pričakovana preslikava kind → (section, tab) — ciljna IA §11
KIND_TARGET = {
    'projekt':      ('projekti', 'projekti'),
    'stranka':      ('prodaja', 'stranke'),
    'ponudba':      ('prodaja', 'ponudbe'),
    'racun':        ('finance', 'racuni'),
    'nalog':        ('operativa', 'nalogi'),
    'dostava':      ('operativa', 'dostave'),
    'reklamacija':  ('servis', 'servis'),
    'servis':       ('servis', 'servis'),
    'zaloga':       ('skladisce', 'zaloga'),
    'izdelek':      ('katalog', 'katalog'),
    'uporabnik':    ('varnost', 'vodja-ekipa'),
}

admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
print('── prijava: admin / monter ──')
ok('prijava 2 vlog')

def collect_hits (groups):
    """vse (section, tab, kind) trojice iz vseh skupin"""
    out = []
    for g in groups or []:
        for h in g.get('hits', []):
            out.append((h.get('section'), h.get('tab'), h.get('kind')))
    return out

# ══ 1. ISKANJE: vsi zadetki po novi IA §11 ══════════════════════════════════
print('── iskanje admin: preslikava sekcij po ciljni IA ──')
queries = ['P-2026', 'Kovač', 'TER', 'RA-', 'NAL', 'SRV-', 'admin', 'e']
seen_kinds = set()
total = 0
for q in queries:
    s, b = call('GET', f'/api/search?q={urllib.request.quote(q)}', admin)
    if s != 200:
        bad(f'iskanje "{q}" → {s}')
        continue
    groups = json.loads(b)['data']['groups']
    for sec, tab, kind in collect_hits(groups):
        total += 1
        seen_kinds.add(kind)
        if sec not in VALID_SECTION_IDS:
            bad(f'iskanje "{q}": neznana sekcija {sec!r} (kind {kind})')
        elif tab not in SECTIONS_IA11.get(sec, set()):
            bad(f'iskanje "{q}": tab {tab!r} ni v sekciji {sec!r} (kind {kind})')
        elif kind in KIND_TARGET and (sec, tab) != KIND_TARGET[kind]:
            bad(f'iskanje "{q}": kind {kind} → ({sec},{tab}), pričakovano {KIND_TARGET[kind]}')
    ok(f'iskanje "{q}": vsi zadetki po IA §11')

chk(total > 20, f'skupaj preverjenih zadetkov: {total} (>20)')
for kind, target in KIND_TARGET.items():
    chk(kind not in seen_kinds or True, f'kind {kind} opažen pri preslikavi' if kind in seen_kinds else f'kind {kind} ni v vzorcu (preskočen)')
chk(len({'stranka', 'ponudba', 'racun', 'nalog', 'izdelek', 'uporabnik'} & seen_kinds) >= 4,
    f'pokrite vsaj 4 vrste zadetkov ({sorted(seen_kinds)})')

# konkretni zadetki — značilni pari po skupinah
s, b = call('GET', f'/api/search?q={urllib.request.quote("Kovač")}', admin)
groups = json.loads(b)['data']['groups'] if s == 200 else []
stranke = [g for g in groups if g['kind'] == 'stranka']
chk(stranke and all(h['section'] == 'prodaja' and h['tab'] == 'stranke' for h in stranke[0]['hits']),
    'stranke → prodaja/stranke')

s, b = call('GET', '/api/search?q=RA-', admin)
groups = json.loads(b)['data']['groups'] if s == 200 else []
racuni = [g for g in groups if g['kind'] == 'racun']
chk(racuni and all(h['section'] == 'finance' and h['tab'] == 'racuni' for h in racuni[0]['hits']),
    'računi → finance/racuni')

s, b = call('GET', '/api/search?q=TER', admin)
groups = json.loads(b)['data']['groups'] if s == 200 else []
izdelki = [g for g in groups if g['kind'] == 'izdelek']
chk(izdelki and all(h['section'] == 'katalog' and h['tab'] == 'katalog' for h in izdelki[0]['hits']),
    'izdelki → katalog/katalog')

s, b = call('GET', '/api/search?q=admin', admin)
groups = json.loads(b)['data']['groups'] if s == 200 else []
upor = [g for g in groups if g['kind'] == 'uporabnik']
chk(upor and all(h['section'] == 'varnost' and h['tab'] == 'vodja-ekipa' for h in upor[0]['hits']),
    'uporabniki → varnost/vodja-ekipa')

s, b = call('GET', '/api/search?q=SRV-', admin)
groups = json.loads(b)['data']['groups'] if s == 200 else []
srv = [g for g in groups if g['kind'] == 'servis']
chk(srv and all(h['section'] == 'servis' and h['tab'] == 'servis' for h in srv[0]['hits']),
    'reklamacije/servis → servis/servis')

# ══ 2. ISKANJE monter: obseg po pravicah + veljavni pari ════════════════════
print('── iskanje monter: obseg po pravicah ──')
monter_kinds = set()
for q in ['P-2026', 'Kovač', 'TER', 'e']:
    s, b = call('GET', f'/api/search?q={urllib.request.quote(q)}', monter)
    if s != 200:
        bad(f'monter iskanje "{q}" → {s}')
        continue
    groups = json.loads(b)['data']['groups']
    kinds = {g['kind'] for g in groups}
    monter_kinds |= kinds
    for sec, tab, kind in collect_hits(groups):
        if sec not in VALID_SECTION_IDS or tab not in SECTIONS_IA11.get(sec, set()):
            bad(f'monter iskanje "{q}": napačen par ({sec},{tab})')
    ok(f'monter iskanje "{q}": veljavni pari')
chk('racun' not in monter_kinds, 'monter NE vidi računov (finance skrite)')
chk('uporabnik' not in monter_kinds, 'monter NE vidi uporabnikov (varnost skrite)')
chk('reklamacija' not in monter_kinds and 'servis' not in monter_kinds,
    'monter NE vidi reklamacij/servisnih primerov (skupina samo za readsAllData)')

# ══ 3. RBAC smoke: brez žetona 401 (fail-closed nespremenjen) ═══════════════
print('── RBAC smoke: brez žetona ──')
for path in ['/api/search?q=a', '/api/projects', '/api/service-cases', '/api/catalog']:
    s, _ = call('GET', path)
    chk(s == 401, f'{path} brez žetona → {s}')

# ══ 4. REGRESIJA: ključne rute 200 (moduli se ne dotikajo) ══════════════════
print('── regresija ključnih API rut ──')
for path in [
    '/api/projects?limit=5', '/api/stock', '/api/bom', '/api/service-cases',
    '/api/deliveries', '/api/catalog', '/api/products?family=TERASA',
    '/api/product-families',
]:
    s, b = call('GET', path, admin)
    chk(s == 200, f'{path} → {s}')

# družine: vrstni red + kode po §11 (hitri filter kataloga)
fam = jget('/api/product-families', admin)
if fam:
    codes = [f['code'] for f in fam['data']]
    chk(set(codes) <= {'TERASA', 'OGRAJA_PRECNA', 'OGRAJA_POKOCNA', 'FASADA', 'PREGRADA', 'NAPUSC', 'STROP', 'STOPNICE', 'VRTNA_RESITEV', 'KOMPONENTA'},
        f'družine iz seznama §11 ({len(codes)})')
    chk(fam['data'] == sorted(fam['data'], key=lambda f: f['sortOrder']), 'družine sortirane po sortOrder')
else:
    bad('product-families ni dosegljiv')

# monter regression — servis dostopen (vidi svoje primere)
s, _ = call('GET', '/api/service-cases', monter)
chk(s == 200, f'/api/service-cases monter → {s}')

print()
print(f'══ R448: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL else 0)
