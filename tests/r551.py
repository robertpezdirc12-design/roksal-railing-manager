#!/usr/bin/env python3
# r551 — R551 (VARNOSTNA VRATA): dvojna vrata za demo prijavo + CSP
# pripravljenost PO PODATKIH. Dva kandidata iz odprtih točk README (revizija
# v1.58.0, top-10 izvedeni R535–R543) sta bila zadnji odprti varnostni
# odločitvi — ta izdaja ju spravi v stanje, ki ga lahko lastnik presojuje:
#
#   1. DEMO_ACCESS DVOJNA VRATA — demo gesla so JAVNO znana (javni repozitorij
#      prisma/seed.cjs), en sam DEMO_ACCESS=on v produkciji pa je pomenil, da
#      se lahko kot admin prijavi KADARKOLI. R543 je dodal le glasno opozorilo
#      v dnevnik. R551 doda DRUGA VRATA: v produkciji demo prijava zahteva
#      še DEMO_PROD_KEY s točno besedno zvezo (namerna potrditev, ne
#      skrivnost — preprečuje PONESREČNO odprtje). Poštena tabela stanj:
#        DEMO_ACCESS≠on            → zaprto povsod (enako kot prej)
#        NODE_ENV≠production       → odprto (razvoj/PAS — ena vrata)
#        produkcija + ujemajoč key → odprto (zavedna odločitev lastnika)
#        produkcija + vse drugo    → ZAPRTO (GET se odzove kot izklopljen,
#                                    POST 404 — notranje stanje se ne razkriva)
#   2. CSP ENFORCE PO PODATKIH — zavihek CSP poročil (R545) je pokazal
#      števila; R551 doda PRESOJO: /api/csp-reports nosi readyToEnforce
#      (true SAMO v report načinu z 0 kršitvami v zadnjih 7 dneh = TTL okno
#      csp-gc) in zavihek izriše zeleno/rumeni banner pripravljenosti.
#      Odločitev o preklopu CSP_MODE=enforce ostane LASTNIKOVA (filozofija
#      R545: aplikacija omogoča, ne odloča).
#
# Preverjanja:
#   A) bun enote: demoVrata — vsa štiri stanja pošteno (+ fraza izvožena)
#   B) žičenje (source grep): lib čist, route delegira, instrumentation
#      tri-stanjsko (r543 sidra ostajajo), ENV-VARS.md, CSP route + banner
#   C) HTTP živo: demo prijava v razvoju (ena vrata — brez regresije) +
#      CSP flip (čisto → poročilo → ni pripravljen → počisti → pripravljen)
#   D) registracija: ci-matrix GRUPE+CLANI, ci.yml, README 58. skupin
#
# Zagon: python3 tests/r551.py  (ali bash tests/ci-matrix.sh r551)

import json
import os
import re
import subprocess
import urllib.request
import urllib.error

PASS, FAIL, SKIP = 0, 0, 0
TAG = 'R551'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('BASE_URL', 'http://localhost:3000')


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)
def skip (msg): global SKIP; SKIP += 1; print(f'  ⏸ {msg}')


def src (relpath):
    with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
        return f.read()


def src_has (relpath, needle):
    try:
        return needle in src(relpath)
    except Exception:
        return False


def bun_js (script):
    """bun → node nadomestek (tests/toolshim.sh); TS uvozi prek ts-resolve hooka."""
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


def call (method, path, token=None, body=None):
    """HTTP klic na BASE+path → (status, JSON ali {})."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header('content-type', 'application/json')
    if token:
        req.add_header('authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {}), r.headers
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw) if raw else {}, (e.headers or {})
        except ValueError:
            return e.code, {}, (e.headers or {})
    except Exception as e:
        return 0, {'napaka': str(e)}, {}


def set_cookies (headers):
    """Vse glave Set-Cookie združene v en mali niz (primerjava brez ovojov)."""
    if hasattr(headers, 'get_all'):
        vsi = headers.get_all('Set-Cookie') or []
    else:
        vsi = [v for k, v in headers.items() if k.lower() == 'set-cookie']
    return '; '.join(vsi).lower()


LIB = 'src/lib/demo-access.ts'
ROUTE = 'src/app/api/auth/demo/route.ts'
INS = 'src/instrumentation.ts'
ENVVARS = 'config/ENV-VARS.md'
CSP_ROUTE = 'src/app/api/csp-reports/route.ts'
CSP_MODUL = 'src/components/roksal/modules/csp.tsx'

print(f'════ {TAG} — varnostna vrata: demo dvojna vrata + CSP pripravljenost ════')

# ═══ A) bun enote: demoVrata — poštena tabela stanj ═════════════════════════
print('── A) demoVrata (čist modul, vsa štiri stanja) ──')
A = bun_js(r'''
const { DEMO_PROD_KEY_FRAZA, demoVrata } = await import('./src/lib/demo-access')

// poštena tabela stanj (vrstni red preverjanj iz dokumentacije lib-a)
const stanja = {
  izklopljeno: demoVrata({ DEMO_ACCESS: 'off', NODE_ENV: 'production', DEMO_PROD_KEY: DEMO_PROD_KEY_FRAZA }),
  prazno: demoVrata({}),
  razvoj: demoVrata({ DEMO_ACCESS: 'on', NODE_ENV: 'development' }),
  niNodeEnv: demoVrata({ DEMO_ACCESS: 'on' }),
  prodBrez: demoVrata({ DEMO_ACCESS: 'on', NODE_ENV: 'production' }),
  prodNapacno: demoVrata({ DEMO_ACCESS: 'on', NODE_ENV: 'production', DEMO_PROD_KEY: 'yes' }),
  prodPresledek: demoVrata({ DEMO_ACCESS: 'on', NODE_ENV: 'production', DEMO_PROD_KEY: ' ' + DEMO_PROD_KEY_FRAZA + ' ' }),
  prodPravilno: demoVrata({ DEMO_ACCESS: 'on', NODE_ENV: 'production', DEMO_PROD_KEY: DEMO_PROD_KEY_FRAZA }),
  samoKey: demoVrata({ NODE_ENV: 'production', DEMO_PROD_KEY: DEMO_PROD_KEY_FRAZA }),
}

// fraza je namerno javna in dolga (premislitev, ne skrivnost)
const fraza = { dolzina: DEMO_PROD_KEY_FRAZA.length, vsebuje: DEMO_PROD_KEY_FRAZA.includes('ZNAM') }

console.log(JSON.stringify({ stanja, fraza }))
''')
if '_err' in A:
    bad(f'bun A: {A["_err"]}')
else:
    st = A['stanja']
    chk(st['izklopljeno'] == {'odprt': False, 'stanje': 'izklopljeno'}, 'izklopljeno: DEMO_ACCESS≠on → zaprto (kljub ujemajočemu ključu!)')
    chk(st['prazno'] == {'odprt': False, 'stanje': 'izklopljeno'}, 'prazno okolje → izklopljeno (ne sesuje se)')
    chk(st['razvoj'] == {'odprt': True, 'stanje': 'razvoj-odprto'}, 'razvoj: DEMO_ACCESS=on + development → odprto (ena vrata — PAS/dev nespremenjen)')
    chk(st['niNodeEnv'] == {'odprt': True, 'stanje': 'razvoj-odprto'}, 'brez NODE_ENV se šteje kot nerazvojno ne-produkcija → odprto (ne more pastiti v produkcijsko vejo)')
    chk(st['prodBrez'] == {'odprt': False, 'stanje': 'produkcija-blokirano'}, 'produkcija BREZ ključa → ZAPRTO (dvojna vrata — glavna vrzel)')
    chk(st['prodNapacno'] == {'odprt': False, 'stanje': 'produkcija-blokirano'}, 'produkcija z napačnim ključem → ZAPRTO')
    chk(st['prodPresledek'] == {'odprt': False, 'stanje': 'produkcija-blokirano'}, 'produkcija s ključem v presledkih → ZAPRTO (TOČNA enakost, ne trim)')
    chk(st['prodPravilno'] == {'odprt': True, 'stanje': 'produkcija-odprto'}, 'produkcija s točno besedno zvezo → odprto (zavedna odločitev lastnika)')
    chk(st['samoKey'] == {'odprt': False, 'stanje': 'izklopljeno'}, 'samo ključ brez DEMO_ACCESS → zaprto (ključ sam ne odpre ničesar)')
    chk(A['fraza']['dolzina'] >= 20 and A['fraza']['vsebuje'] is True, 'besedna zveza je dolga in namerna (premislitev, ne en znak)')

# ═══ B) žičenje v izvorni kodi (source grep) ═══════════════════════════════
print('── B) žičenje: lib / route / instrumentation / ENV-VARS / CSP ──')

lib = src(LIB)
route = src(ROUTE)
ins = src(INS)

chk('DEMO_PROD_KEY_FRAZA' in lib and 'export const' in lib, 'B1 lib: izvozi DEMO_PROD_KEY_FRAZA (en vir besedne zveze)')
chk('demoVrata' in lib and 'export function' in lib, 'B1 lib: izvozi demoVrata')
chk(re.search(r'^import ', lib, re.M) is None, 'B1 lib: ČIST modul brez uvozov (testabilen z bun — vzorec csp.ts)')
chk("from '@/lib/demo-access'" in route, 'B2 route: uvaža demoVrata iz lib-a (en vir logike)')
chk('demoVrata({' in route and '.odprt' in route, 'B2 route: demoEnabled delegira na demoVrata (ne lastna logika)')
chk(re.search(r"DEMO_ACCESS:\s*process\.env\.DEMO_ACCESS", route) is not None, 'B2 route: vsa tri okolja podana (DEMO_ACCESS/DEMO_PROD_KEY/NODE_ENV)')
chk("process.env.DEMO_ACCESS === 'on'" not in route,
    'B2 route: stara enojna vrata SO ODSTRANJENA (=== \'on\' odločitev živi samo v lib-u)')

chk("DEMO_ACCESS === 'on'" in ins and "NODE_ENV === 'production'" in ins and 'console.error' in ins,
    'B3 instrumentation: r543 sidra ostajajo (DEMO_ACCESS on + produkcija + console.error)')
chk("from './lib/demo-access'" in ins, 'B3 instrumentation: relativni uvoz iz lib-a (vzorec csp.ts — alias v instrumentation ni zagotovljen)')
chk('DEMO_PROD_KEY_FRAZA' in ins, 'B3 instrumentation: opozorilo NAVAJA besedno zvezo (lastnik ve točno, kaj nastaviti)')
chk(ins.count('console.error') >= 2, 'B3 instrumentation: TRI-STANJSKO (zavrnjena + namerne odprta — dve veji error)')
chk('demoVrata(process.env)' in ins, 'B3 instrumentation: stanje iz ISTEGA vira kot route (en vir resnice)')
chk('R551' in ins, 'B3 instrumentation: različica označena (sledljivost opozoril v dnevnikih)')

envv = src(ENVVARS)
chk('DEMO_PROD_KEY' in envv, 'B4 ENV-VARS.md: DEMO_PROD_KEY dokumentiran')
chk('ZNAM-DA-ODPIRAM-DEMO-V-PRODUKCIJI' in envv, 'B4 ENV-VARS.md: besedna zveza zapisana (dokumentacija = en vir)')
chk('R551' in envv, 'B4 ENV-VARS.md: izdaja označena')

cspr = src(CSP_ROUTE)
chk('readyToEnforce' in cspr, 'B5 CSP route: odgovor nosi readyToEnforce (presoja po podatkih)')
chk("mode === 'report' && last7d === 0" in cspr, 'B5 CSP route: pripravljen = report način IN 0 kršitev v 7 dneh (TTL okno)')
chk("process.env.CSP_MODE === 'enforce' ? 'enforce' : 'report'" in cspr,
    'B5 CSP route: r545 sidro mode ostaja (en vir načina)')

m = src(CSP_MODUL)
chk('readyToEnforce' in m, 'B6 CSP modul: porabi readyToEnforce iz odgovora')
chk('csp-pripravljenost' in m, 'B6 CSP modul: banner pripravljenosti montiran (testid)')
chk('text-roksal-green' in m and 'text-roksal-amber' in m, 'B6 CSP modul: blagovni znamki zeleno/rumeno (pripravljen/ni)')
chk('CSP_MODE=enforce' in m, 'B6 CSP modul: banner svetuje točno kaj nastaviti (lastnikova odločitev, ne gumb)')
chk('kršitev v zadnjih 7 dneh' in m, 'B6 CSP modul: število kršitev izpisano (podatek, ne sklep)')
chk('opazovalno obdobje je čisto' in m, 'B6 CSP modul: r545 prazno-stanje sidro ostaja')

# ═══ C) HTTP živo: demo v razvoju (brez regresije) + CSP flip ═══════════════
print('── C) HTTP (razvoj: ena vrata; CSP: flip po podatkih) ──')

s, d, h = call('GET', '/api/auth/demo')
demo_enabled = isinstance(d, dict) and d.get('data', {}).get('enabled') is True
if demo_enabled:
    racuni = d.get('data', {}).get('accounts', [])
    chk(len(racuni) == 5, f'C1 demo GET v razvoju → enabled + 5 računov (dejansko {len(racuni)}) — ena vrata, BREZ regresije')
    chk(all('password' not in str(r).lower() for r in racuni), 'C1 demo GET NE razkriva gesel (R496 ostaja)')
    s2, d2, h2 = call('POST', '/api/auth/demo', body={'email': 'admin@roksal.si'})
    chk(s2 == 200, f'C2 demo POST v razvoju → 200 (dejansko {s2}) — vrata NE blokirajo razvoja')
    sc = set_cookies(h2)
    chk('roksal_session=' in sc and 'httponly' in sc, 'C2 demo POST: piškotek roksal_session + HttpOnly (R538 ostaja)')
    demo_token = d2.get('data', {}).get('token') if isinstance(d2, dict) else None
    if demo_token:
        s3, _, _ = call('POST', '/api/auth/logout', token=demo_token)
        chk(s3 == 200, 'C2 demo seja odjavljena (čiščenje — pas ostaja ponovljiv)')
else:
    skip('C1/C2 DEMO_ACCESS ni vklopljen na tem strežniku — razvojna vrata preskočena')

# ── CSP flip: čisto → poročilo → ni pripravljen → počisti → pripravljen ──
s, admin, _ = call('POST', '/api/auth/login', body={'email': 'admin@roksal.si', 'password': 'Admin123!'})
admin_token = admin.get('token') if s == 200 else ''
chk(s == 200, f'C3 prijava admina → 200 (dejansko {s})')

if not admin_token:
    skip('C4–C9 CSP flip (ni admin žetona — prijava ni uspela)')
else:
    # čisto izhodišče (r551 je ZADNJA skupina v matriki — čiščenje ne more
    # prelomiti zgodnejših skupin; samostojni zagon r543/r545 po r551 bi
    # znova postavila lastna poročila)
    s, d, _ = call('DELETE', '/api/csp-reports', token=admin_token)
    chk(s == 200, f'C4 čisto izhodišče: DELETE vseh poročil → 200 (dejansko {s})')

    s, d, _ = call('GET', '/api/csp-reports', token=admin_token)
    summ = d.get('summary', {})
    chk(s == 200 and d.get('mode') == 'report', f'C5 prazna tabela → mode report (dejansko {d.get("mode")})')
    chk(d.get('readyToEnforce') is True and summ.get('last7d') == 0,
        f'C5 prazna tabela → readyToEnforce TRUE (dejansko {d.get("readyToEnforce")})')

    doc = f'https://r551-csp.roksal.test/{TAG.lower()}-flip'
    s, _, _ = call('POST', '/api/csp-report', body={
        'csp-report': {
            'document-uri': doc, 'violated-directive': 'img-src',
            'blocked-uri': 'https://r551-zunanja.test/slika.png',
            'disposition': 'report',
        }
    })
    chk(s == 204, f'C6 eno poročilo → 204 (javna točka R543; dejansko {s})')

    s, d, _ = call('GET', '/api/csp-reports', token=admin_token)
    summ = d.get('summary', {})
    chk(d.get('readyToEnforce') is False and summ.get('last7d', 0) >= 1,
        f'C7 z eno kršitvijo → readyToEnforce FALSE + last7d ≥ 1 (dejansko {d.get("readyToEnforce")}/{summ.get("last7d")}) — presoja SLEDI podatkom')

    s, d, _ = call('DELETE', '/api/csp-reports', token=admin_token)
    chk(s == 200, f'C8 počisti po testu → 200 (dejansko {s})')
    s, d, _ = call('GET', '/api/csp-reports', token=admin_token)
    chk(d.get('readyToEnforce') is True,
        f'C9 po čiščenju → readyToEnforce znova TRUE (flip je PO PODATKIH, ne po času; dejansko {d.get("readyToEnforce")})')

    # odjava admina (čiščenje sej)
    call('POST', '/api/auth/logout', token=admin_token)

for pot in ['/?m=csp', '/']:
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + pot), timeout=30) as rr:
            st = rr.status
    except Exception:
        st = 0
    chk(st == 200, f'C10 globoka povezava {pot} → 200 (dejansko {st})')

# ═══ D) registracija: matrika + README ═════════════════════════════════════
print('── D) registracija (ci-matrix / ci.yml / README) ──')
mat = src('tests/ci-matrix.sh')
chk(re.search(r'(?<![\w-])r551(?![\w-])', mat) is not None and mat.count('r551') >= 2,
    'D1 ci-matrix.sh: r551 v GRUPE in CLANI (pozicijsko neodvisno)')
yml = src('.github/workflows/ci.yml')
chk(re.search(r'(?<![\w-])r551(?![\w-])', yml) is not None, 'D2 .github/workflows/ci.yml: r551 v matriki')
rd = src('README.md')
chk(re.search(r'58\. skupin|58 skupin|58/58', rd) is not None, 'D3 README: 58. skupina odražena')
chk('R551' in rd and 'DEMO_PROD_KEY' in rd, 'D4 README: R551 dvojna vrata popisana')

print(f'═══ {TAG} KONEC: {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸ ═══')
raise SystemExit(0 if FAIL == 0 else 1)
