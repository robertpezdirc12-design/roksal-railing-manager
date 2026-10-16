#!/usr/bin/env python3
"""tests/r538.py — R538: ŽETON SEJE V HTTPONLY PIŠKOTKU (migracija iz localStorage).

Zakaj: žeton seje je doslej živel v localStorage (zustand persist, ključ
'roksal-session') — vsak XSS izluščeni skript bi ga preprosto prebral in
odnesel (revizija v1.58.0, »žeton seje iz localStorage (XSS)«). Sedaj:
  • brskalnik prejme ob prijavi httpOnly piškotek `roksal_session`
    (JavaScript ga NE more prebrati; ista sha256 sejna pogodba R534);
  • programska pot `Authorization: Bearer` ostaja 100 % nespremenjena
    (45 testnih skupin pasa jo uporablja) — telo prijave žoton še vedno
    vrača;
  • localStorage NE nosi več žetona (partialize v src/lib/store.ts).

Kaj preverja ta suite:
  A) PRIJAVA: telo odgovora še vedno vsebuje `token` (združljivost za
     programske odjemalce/testni pas); glava Set-Cookie vsebuje
     `roksal_session=<token>`, HttpOnly, SameSite=Lax, Path=/ in
     Max-Age=604800 (7 dni — usklajeno s sejno pogodbo R534);
  B) PIŠKOTKOVNA AVTENTIKACIJA: GET /api/auth/session in GET /api/customers
     SAMO s piškotkom (brez Authorization glave) → 200;
  C) FAIL-CLOSED: smeten piškotek (`roksal_session=<smeti>`) → 401
     (iskanje po sha256 zgreši — brez odpuščanja);
  D) ODJAVA S PIŠKOTKOM: POST /api/auth/logout samo s piškotkom → 200 in
     Set-Cookie počisti piškotek (Max-Age=0/prazna vrednost); STARI Bearer
     žeton iz telesa prijave je NAKNADNO 401 (vrstica seje je preklicana);
     tudi piškotek sam je potem 401;
  E) STATIČNI PREGLED IZVORNE KODE: store.ts ima partialize, ki žetona NE
     persista; auth.ts bere piškotek `roksal_session`;
  F) DEMO PRIJAVA (DEMO_ACCESS=on): uspešen POST nastavi Set-Cookie
     (enako kot navadna prijava); če stikalo ni vklopljeno (npr. CI ne
     nastavi DEMO_ACCESS), se živi del preskoči, statični pa se izvede;
  G) NASTAVITEV (setup): statični dokaz, da prvi prevzem prav tako nastavi
     piškotek (živi klic NE — baza je že nameščena, vrata so zaklenjena).

POGOJI: teče nad lokalno razvojno bazo (TEST_DB_URL → env.sh → DATABASE_URL,
tests/dbenv.py) in strežnikom na BASE_URL. Uporablja obstoječega admina
(admin@roksal.si) — NI novih žrtev, vse ustvarjene seje se odjavijo (čiščenje).
Samostojno: 2 prijavi — pod privzeto mejo tempomata 30/min/IP.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
PASS, FAIL, SKIP = 0, 0, 0


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)
def skip (msg): global SKIP; SKIP += 1; print(f'  ⏸ {msg}')


def call (method, path, token=None, body=None, cookie=None):
    """HTTP klic → (status, dict|str, glave). `cookie` pošlje surovo glavo
    Cookie (nadzorovano, brez skritega jar-a) — točno to dela tudi brskalnik."""
    req = urllib.request.Request(BASE + path, method=method)
    if token:
        req.add_header('authorization', f'Bearer {token}')
    if cookie is not None:
        req.add_header('cookie', cookie)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header('content-type', 'application/json')
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as r:
            return r.status, _json(r.read()), r.headers
    except urllib.error.HTTPError as e:
        return e.code, _json(e.read()), (e.headers or {})
    except Exception as e:
        return 0, {'error': str(e)}, {}


def _json (raw):
    text = raw.decode('utf-8', 'replace')
    try:
        return json.loads(text)
    except ValueError:
        return text


def set_cookies (headers):
    """Vse glave Set-Cookie združene v en mali niz (primerjava brez ovojov)."""
    if hasattr(headers, 'get_all'):
        vsi = headers.get_all('Set-Cookie') or []
    else:
        vsi = [v for k, v in headers.items() if k.lower() == 'set-cookie']
    return '; '.join(vsi).lower()


def cookie_vrednost (headers, ime='roksal_session'):
    """Vrednost piškotka iz prve glave Set-Cookie (None, če je ni)."""
    if hasattr(headers, 'get_all'):
        vsi = headers.get_all('Set-Cookie') or []
    else:
        vsi = [v for k, v in headers.items() if k.lower() == 'set-cookie']
    for sc in vsi:
        prv = sc.split(';', 1)[0].strip()
        if prv.startswith(ime + '='):
            return prv.split('=', 1)[1]
    return None


def src (relpath):
    with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
        return f.read()


print('═══ R538: žeton seje v httpOnly piškotku ═══')

# ═══ A) prijava: telo še nosi žeton + Set-Cookie z vsemi zastavicami ════════
print('── A) prijava: žeton v telesu (združljivost) + httpOnly piškotek ──')
s, d, h = call('POST', '/api/auth/login', body={'email': 'admin@roksal.si', 'password': 'Admin123!'})
chk(s == 200, f'prijava admina → 200 (dejansko {s})')
bearer = d.get('token') if isinstance(d, dict) else None
chk(isinstance(bearer, str) and len(bearer) > 10, 'telo odgovora še vedno vsebuje žeton (Bearer pot ostaja)')
sc = set_cookies(h)
chk('roksal_session=' in sc, 'glava Set-Cookie vsebuje roksal_session=…')
chk('httponly' in sc, 'piškotek je HttpOnly (JavaScript ga ne more prebrati)')
chk('samesite=lax' in sc, 'piškotek je SameSite=Lax (CSRF varnost)')
chk('path=/' in sc, 'piškotek velja na Path=/')
chk('max-age=604800' in sc, 'Max-Age=604800 (7 dni — usklajeno s sejno pogodbo R534)')
piškotek = cookie_vrednost(h)
chk(piškotek is not None and piškotek == bearer,
    'vrednost piškotka == žeton iz telesa (ista seja, brez dvojnih nosilcev)')

# ═══ B) avtentikacija SAMO s piškotkom (brez Authorization glave) ═══════════
print('── B) piškotkovna avtentikacija (brez Bearer glave) ──')
if piškotek:
    cookie_hdr = f'roksal_session={piškotek}'
    s, d, h = call('GET', '/api/auth/session', cookie=cookie_hdr)
    chk(s == 200 and isinstance(d, dict) and isinstance(d.get('user'), dict) and d['user'].get('email') == 'admin@roksal.si',
        'GET /api/auth/session samo s piškotkom → 200 s prijavljenim uporabnikom')
    s, d, h = call('GET', '/api/customers', cookie=cookie_hdr)
    chk(s == 200, f'GET /api/customers samo s piškotkom → 200 (dejansko {s})')
else:
    bad('piškotek ni bil izdan — B) ne morem preveriti')

# ═══ C) fail-closed: smeten piškotek → 401 ══════════════════════════════════
print('── C) smeten piškotek → 401 (fail-closed) ──')
s, d, h = call('GET', '/api/auth/session', cookie='roksal_session=to-ni-veljaven-zeton-r538-smeti')
chk(s == 401, f'GET /api/auth/session s smetnim piškotkom → 401 (dejansko {s})')
s, d, h = call('GET', '/api/customers', cookie='roksal_session=<script>alert(1)</script>')
chk(s == 401, f'GET /api/customers s smetnim piškotkom → 401 (dejansko {s})')

# ═══ D) odjava s piškotkom: čisti piškotek + preklic seje (tudi Bearer) ══════
print('── D) odjava s piškotkom: brisanje piškotka + preklic seje ──')
if piškotek:
    cookie_hdr = f'roksal_session={piškotek}'
    s, d, h = call('POST', '/api/auth/logout', cookie=cookie_hdr)
    chk(s == 200, f'POST /api/auth/logout samo s piškotkom → 200 (dejansko {s})')
    sc = set_cookies(h)
    chk('roksal_session=' in sc and ('max-age=0' in sc or 'roksal_session=;' in sc or 'roksal_session= ;' in sc),
        'odgovor odjave POČISTI piškotek (Max-Age=0 / prazna vrednost)')
    s, d, h = call('GET', '/api/auth/session', token=bearer)
    chk(s == 401, f'stari Bearer žeton po odjavi → 401 (dejansko {s}) — vrstica seje je preklicana')
    s, d, h = call('GET', '/api/auth/session', cookie=cookie_hdr)
    chk(s == 401, f'star piškotek po odjavi → 401 (dejansko {s}) — isti preklic velja za oba nosilca')
else:
    bad('piškotek ni bil izdan — D) ne morem preveriti')

# ═══ E) statični pregled: store.ts ne persista žetona, auth.ts bere piškotek ═
print('── E) statični pregled izvorne kode ──')
store_src = src('src/lib/store.ts')
chk('partialize' in store_src, 'store.ts: persist ima partialize')
chk(re.search(r'partialize[\s\S]{0,300}const \{ token, \.\.\.', store_src) is not None,
    'store.ts: partialize IZPUŠČA žeton (const { token, … } destrukturacija)')
chk("'roksal-session'" in store_src, 'store.ts: ime ključa persista je nespremenjeno (roksal-session)')
auth_src = src('src/lib/auth.ts')
chk("SESSION_COOKIE = 'roksal_session'" in auth_src, 'auth.ts: konstanta SESSION_COOKIE (roksal_session)')
chk('cookies.get(' in auth_src, 'auth.ts: žeton se bere TUDI iz piškotka (req.cookies.get)')
chk('Bearer' in auth_src, 'auth.ts: Bearer glava ostaja prva pot (programski odjemalci/testi)')

# ═══ F) demo prijava: piškotek prav tako (samo ob DEMO_ACCESS=on) ═══════════
print('── F) demo prijava (DEMO_ACCESS) ──')
demo_src = src('src/app/api/auth/demo/route.ts')
chk('setSessionCookie' in demo_src, 'demo ruta: uspeh nastavi piškotek (setSessionCookie v izvorni kodi)')
s, d, h = call('GET', '/api/auth/demo')
demo_enabled = isinstance(d, dict) and d.get('data', {}).get('enabled') is True
if demo_enabled:
    s, d, h = call('POST', '/api/auth/demo', body={'email': 'admin@roksal.si'})
    chk(s == 200, f'demo prijava → 200 (dejansko {s})')
    sc = set_cookies(h)
    chk('roksal_session=' in sc and 'httponly' in sc, 'demo prijava: Set-Cookie z roksal_session + HttpOnly')
    demo_bearer = d.get('data', {}).get('token') if isinstance(d, dict) else None
    if demo_bearer:
        s, d, h = call('POST', '/api/auth/logout', token=demo_bearer)
        chk(s == 200, 'demo seja odjavljena (čiščenje — pas ostane ponovljiv)')
else:
    skip('DEMO_ACCESS ni vklopljen na tem strežniku (CI ga ne nastavi) — živi del F preskočen, statični dokaz zgoraj')

# ═══ G) nastavitev (setup): statični dokaz piškotka ob prvem prevzemu ═══════
print('── G) setup ruta: piškotek ob prvem prevzemu (samo statično) ──')
setup_src = src('src/app/api/setup/route.ts')
chk('setSessionCookie' in setup_src,
    'setup ruta: prvi prevzem (201) nastavi piškotek (setSessionCookie v izvorni kodi)')

print()
print(f'══ REZULTAT: {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸ ══')
sys.exit(1 if FAIL > 0 else 0)
