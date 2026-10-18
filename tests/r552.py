#!/usr/bin/env python3
# r552 — R552 (OFFLINE VZDRŽNOST): spletna raziskava najboljših praks (4
# poizvedbe: MDN Offline and background operation, web.dev Update /
# Persistent storage / network falling back to cache, Workbox Handling
# service worker updates) → primerjava z našo arhitekturo R439/R486/R508 →
# ZAPRTJE 4 VRZELI v enem krogu (vzorec R550: kamera).
#
# KJE SMO BILI NAPREJ (poštena primerjava — ostaja):
#   • idempotentni opId UUID iz ODJEMALCA (večina vzorcev nima — podvajanje
#     pri ponovnem pošiljanju pri njih MOGOČE), fail-closed OBSEG na
#     strežniku, vezava vrste na uporabnika + izbris ob zamenjavi (24 h
#     purge), korak-na-korak statusna vrstica (r508), kompresija pred vrsto.
# ZAVRNJENO ZAVEDNO (raziskava navaja, za nas ni):
#   • Periodic Background Sync — za aplikacije, ki v ozadju OSVEŽUJEJO vsebino
#     (novice); naše sinhronizacije se sprožijo ob POVEZAVI, ne koledarsko.
#   • Blob namesto dataUrl v IndexedDB (~33 % manj) — globoka sprememba
#     cevovoda; kompresija že drži mejo 8 MB; tveganje > korist zdaj.
#
# 4 VRZELI, TA IZDAJA ZAPIRA:
#   1. BACKGROUND SYNC (tag 'roksal-sync'): monter zapre aplikacijo, še preden
#      se signal vrne → doslej je vrsta čakala na ponovni odprt; zdaj jo
#      izprazni SAM SW, takoj ko brskalnik spet vidi omrežje. Če je zavihek
#      odprt, se SW umakne (stran ima lastne poslušalce) — dva pisalca se ne
#      stepeta. iOS Safari: dogodek ne obstaja, velja staro obnašanje.
#      Seja: httpOnly piškotek roksal_session (r538) se priloži sam — SW NE
#      more brati localStorage, žeton se NI prenašal nikoli.
#   2. UPDATE FLOW: nova različica SW ne prevzame več TAKOJ (brez skipWaiting
#      v install) — toast »Nova različica« vpraša uporabnika; šele [Osveži]
#      pošlje SKIP_WAITING NOVEMU (čakajočemu) delavcu (stari kontroler bi
#      bil no-op) in ob controllerchange naloži stran. Prva namestitev
#      (controller === null) se NE šteje za posodobitev.
#   3. GET /api REZERVA: network-first ostaja (svežina pri povezavi), ob
#      IZPADU omrežja pa SW postreže zadnji znani odgovor (Cache Storage,
#      ${VERSION}-api, varovalka 512 KB). Napaka strežnika (401/4xx) se ne
#      zamenja s predpomnilnikom — samo NEDOSEGLJIVO omrežje se.
#      clearOfflineData zdaj pobriše tudi ta predpomnilnik (poslovni
#      podatki na napravi — enak varnostni razlog kot queue/photos).
#   4. navigator.storage.persist(): brez tega brskalnik pod pritiskom
#      prostora TIHO izvrže IndexedDB (terenski podatki bi izginili).
#
# ZAVEDNA OMEJITEV (pošteno zapisana): registracija SW je SAMO v produkciji
# (NODE_ENV=production — varnost HMR v razvoju). Preverjanja te skupine so
# zato STRUKTURNA (izvorna koda) + STREŽNA (datoteke se postrežejo);
# obnašanje SW v brskalniku lahko popolnoma preveriti le produkcija.
#
# Preverjanja:
#   A) bun enote: apiCacheNames (pripona -api, verziji-agnostično)
#   B) žičenje (source grep): sw.js (sync/umik/401/throw/rezerva/varnostni
#      vrstni red), offline.ts (registracija + čiščenje), pwa-register
#      (updatefound/toast/persist) + stara sidra r486/r508/r522 ostajajo
#   C) HTTP živo: /sw.js + /offline.html + /manifest.webmanifest + globoke
#      povezave + overjen GET (seja nespremenjena)
#   D) registracija: ci-matrix GRUPE+CLANI, ci.yml, README 59. skupin
#
# Zagon: python3 tests/r552.py  (ali bash tests/ci-matrix.sh r552)

import json
import os
import re
import subprocess
import urllib.request
import urllib.error

PASS, FAIL, SKIP = 0, 0, 0
TAG = 'R552'
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


def call (method, path, token=None, body=None, raw=False):
    """HTTP klic na BASE+path → (status, JSON/text, headers)."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header('content-type', 'application/json')
    if token:
        req.add_header('authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            rawb = r.read()
            if raw:
                return r.status, rawb, r.headers
            return r.status, (json.loads(rawb) if rawb else {}), r.headers
    except urllib.error.HTTPError as e:
        rawb = e.read()
        try:
            return e.code, (json.loads(rawb) if rawb else {}), (e.headers or {})
        except ValueError:
            return e.code, {}, (e.headers or {})
    except Exception as e:
        return 0, {'napaka': str(e)}, {}


SW = 'public/sw.js'
OFFL = 'src/lib/offline.ts'
PWA = 'src/components/pwa-register.tsx'

print(f'════ {TAG} — offline vzdržnost: 4 vrzeli po spletni raziskavi ════')

# ═══ A) bun enote: apiCacheNames (čista funkcija, nov vir) ═════════════════
print('── A) apiCacheNames (čista funkcija — rezerva GET /api po priponi) ──')
A = bun_js(r'''
const { apiCacheNames } = await import('./src/lib/offline')
console.log(JSON.stringify({
  prazna: apiCacheNames([]),
  trenutna: apiCacheNames(['roksal-v1-shell', 'roksal-v1-assets', 'roksal-v1-api']),
  poNadgradnji: apiCacheNames(['roksal-v2-shell', 'roksal-v2-assets', 'roksal-v2-api', 'roksal-v1-api']),
  tuje: apiCacheNames(['moj-api-seznam', 'apiname', 'x-api', '-api', 'api']),
}))
''')
if '_err' in A:
    bad(f'bun A: {A["_err"]}')
else:
    chk(A['prazna'] == [], 'A1 prazen seznam → prazen (ne sesuje se)')
    chk(A['trenutna'] == ['roksal-v1-api'], 'A2 izmed treh predpomnilnikov zadene SAMO -api (ne shell/assets)')
    chk(A['poNadgradnji'] == ['roksal-v2-api', 'roksal-v1-api'],
        'A3 verziji-agnostično: po dvigu VERSION (v1→v2) čiščenje zadene obe generaciji — sw.js lahko dviguje verzijo brez usklajevanja z lib-om')
    chk(A['tuje'] == ['x-api', '-api'],
        'A4 nizi, ki se KONČAJO s -api, niz z -api v sredini (moj-api-seznam) ali brez (apiname) NE — zadetek je pripona, ne vsebina')

# ═══ B) žičenje v izvorni kodi (source grep) ═══════════════════════════════
print('── B) sw.js / offline.ts / pwa-register ──')

sw = src(SW)
offl = src(OFFL)
pwa = src(PWA)

# ── B1: sw.js — Background Sync (vrzel 1) ──
chk("self.addEventListener('sync'" in sw and "event.tag !== SYNC_TAG" in sw and 'swSync()' in sw,
    'B1 sw.js: sync dogodek s tagom SYNC_TAG → waitUntil(swSync())')
chk("const SYNC_TAG = 'roksal-sync'" in sw and "'roksal-sync'" in offl,
    'B1 sw.js + offline.ts: ENAK tag roksal-sync v obeh datotekah (dva vira istega niza — komentar ob vsaki)')
chk('matchAll({ type: \'window\' })' in sw or 'matchAll({ type: "window" })' in sw, 'B1 sw.js: swSync vpraša odprte zavihke (matchAll)')
chk('wins.length > 0' in sw and sw.index('wins.length > 0') < sw.index('indexedDB.open'),
    'B1 sw.js: odprt zavihek → SW se UMAKNE (vrsta gre s strani) — varuh je PRED odpiranjem IndexedDB')
chk('if (res.status === 401) return' in sw, 'B1 sw.js: 401 = tiho brez ponavljanja (brez seje je poskus brez pomena)')
chk('if (!res.ok) throw' in sw, 'B1 sw.js: omrežna napaka = throw → brskalnik SAM ponovi (pogodba Background Sync)')
chk("status: 'potrjeno'" in sw and 'payload.dataUrl = photo.dataUrl' in sw,
    'B1 sw.js: zrcalo syncNow — foto dataUrl iz photos + potrjeno po OK (ista semantika kot stran)')
chk('lastSync' in sw, 'B1 sw.js: SW posodobi lastSync (badge v glavi vidi SW-ovo sinhronizacijo)')
chk("DB_NAME = 'roksal-offline'" in sw and 'DB_VERSION = 2' in sw and sw.count("contains('queue')") >= 1 and sw.count("contains('cache')") >= 1,
    'B1 sw.js: ISTA baza in shema kot lib/offline.ts (queue/photos/cache/drafts v2)')

# ── B2: sw.js — update flow (vrzel 2) ──
inst_start = sw.index("addEventListener('install'")
inst_end = sw.index("addEventListener('activate'")
inst_block = sw[inst_start:inst_end]
chk('skipWaiting()' not in inst_block, 'B2 sw.js: install NE kliče skipWaiting() (klic z oklepaji — omemba v komentarju je dovoljena; nova različica čaka na uporabnika)')
chk("data?.type === 'SKIP_WAITING'" in sw and 'self.skipWaiting()' in sw,
    'B2 sw.js: message SKIP_WAITING → self.skipWaiting() (prevzem SAMO ob potrditvi)')
chk("data?.type === 'PRECACHE_URL'" in sw, 'B2 sw.js: PRECACHE_URL (r439) ostaja — brez regresije')

# ── B3: sw.js — GET /api rezerva (vrzel 3) ──
chk('API_CACHE = `${VERSION}-api`' in sw, 'B3 sw.js: API_CACHE = ${VERSION}-api')
guard = sw.index("if (req.method !== 'GET') return")
api_block = sw.index("url.pathname.startsWith('/api/')")
chk(guard < api_block, 'B3 sw.js: varuh non-GET je PRED /api blokom (mutacije nikoli iz predpomnilnika)')
chk('cache.put(req, res.clone())' in sw and 'cache.match(req)' in sw,
    'B3 sw.js: network-first zapiše odgovor, ob izpadu postreže zadnjega')
chk('MAX_API_CACHE_BYTES' in sw and 'content-length' in sw,
    'B3 sw.js: varovalka 512 KB proti napihnjenim odgovorom')
chk(sw.index("res.ok") < sw.index('cache.put(req, res.clone())'),
    'B3 sw.js: SAMO ok odgovori gredo v rezervo (401/4xx se NE zamenja s starimi)')
chk("!k.startsWith(VERSION)" in sw, 'B3 sw.js: activate počisti tudi stare -api predpomnilnike (predpona VERSION)')
chk("req.mode === 'navigate'" in sw and "cache.put('/', res.clone())" in sw,
    'B3 sw.js: navigacija network-first + shell (r439 brez spremembe)')
chk('/_next/static/' in sw, 'B3 sw.js: statika cache-first (r439 brez spremembe)')

# ── B4: offline.ts ──
chk('export async function tryRegisterBackgroundSync' in offl, 'B4 offline.ts: izvozi tryRegisterBackgroundSync')
chk('navigator.serviceWorker.controller' in offl, 'B4 offline.ts: varuh controller (razvoj brez SW — ready bi visel)')
chk('reg.sync.register' in offl and 'if (!reg.sync) return' in offl,
    'B4 offline.ts: iOS/brez podpore → tiho (velja staro obnašanje)')
m_q = re.search(r'export async function queueOp.*?\n\}', offl, re.S)
chk(m_q is not None and 'void tryRegisterBackgroundSync()' in m_q.group(0) and 'return op' in m_q.group(0),
    'B4 offline.ts: queueOp prosi za Background Sync ob vsaki uvrstitvi (fire-and-forget, ne pokvari queue) — klic znotraj queueOp bloka (ne podniz drugje, npr. »return openDb«)')
chk('apiCacheNames(await caches.keys())' in offl and 'caches.delete' in offl,
    'B4 offline.ts: clearOfflineData pobriše tudi -api rezervo (varnost issue #6 — poslovni podatki z ostalimi shrambami)')
chk("export function stanjeShranjevanja" in offl, 'B4 offline.ts: r508 sidro ostaja (statusna vrstica)')
chk('docTag?: string | null' in offl and 'payload.docTag = input.docTag.trim()' in offl,
    'B4 offline.ts: r522 sidri ostajata (docTag tip + prenos)')
chk('calibration?: Record<string, unknown> | null' in offl and 'views?: Record<string, unknown>[] | null' in offl and 'quality?: Record<string, unknown> | null' in offl,
    'B4 offline.ts: r486 sidra ostajajo (merilni paket v QueuePhotoInput)')

# ── B5: pwa-register.tsx ──
chk("reg.addEventListener('updatefound'" in pwa, 'B5 pwa: posluša updatefound')
chk("w.state === 'installed' && navigator.serviceWorker.controller" in pwa,
    'B5 pwa: toast SAMO ob posodobitvi (controller !== null izloči prvo namestitev)')
chk('newWorkerRef.current?.postMessage' in pwa and "type: 'SKIP_WAITING'" in pwa,
    'B5 pwa: SKIP_WAITING gre NOVEMU delavcu (ne staremu kontrolerju — no-op)')
chk('refreshingRef.current' in pwa and 'controllerchange' in pwa and 'window.location.reload()' in pwa,
    'B5 pwa: controllerchange → reload SAMO ob potrditvi (ref ščiti pred zanko/prvo namestitvijo)')
chk('setRefreshing' not in pwa, 'B5 pwa: refreshing je ref, ne state (closure bi videl staro vrednost — zanka)')
chk('navigator.storage?.persist?.()' in pwa, 'B5 pwa: storage.persist (vrzel 4 — izvrženje pod pritiskom)')
chk("process.env.NODE_ENV !== 'production'" in pwa, 'B5 pwa: samo produkcija (HMR varnost r439 ostaja)')
chk("type: 'PRECACHE_URL'" in pwa, 'B5 pwa: PRECACHE_URL (r439) ostaja')
chk('data-testid="pwa-osvezej"' in pwa and 'Nova različica aplikacije je pripravljena' in pwa,
    'B5 pwa: toast testid + besedilo')
chk('Osveži' in pwa and 'Kasneje' in pwa and 'env(safe-area-inset-bottom)' in pwa and 'role="status"' in pwa,
    'B5 pwa: gmba + varnostni rob + aria role=status')

# ═══ C) HTTP živo: datoteke se postrežejo, seja nespremenjena ══════════════
print('── C) HTTP (sw.js / offline.html / manifest / globoke / overjen GET) ──')

st, body, headers = call('GET', '/sw.js', raw=True)
ct = (headers.get('Content-Type') or headers.get('content-type') or '')
chk(st == 200 and 'javascript' in ct.lower(), f'C1 GET /sw.js → 200 + javascript (dejansko {st}/{ct})')
chk(b"roksal-sync" in body and b"SKIP_WAITING" in body, 'C1 /sw.js vsebina živi na strežniku (sync + update tag)')

st, body, _ = call('GET', '/offline.html', raw=True)
chk(st == 200 and b'Roksal' in body, f'C2 GET /offline.html → 200 (dejansko {st})')

st, d, _ = call('GET', '/manifest.webmanifest')
chk(st == 200 and isinstance(d, dict) and len(d.get('shortcuts', [])) == 4,
    f'C3 manifest → 200 + 4 bližnjice (r544 sidro brez spremembe; dejansko {st})')

st, d, _ = call('GET', '/api/health')
chk(st == 200 and d.get('db', {}).get('ok') is True, f'C4 /api/health → 200 + db ok (dejansko {st})')

for pot in ['/?m=danes', '/?m=nalogi', '/']:
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + pot), timeout=30) as rr:
            st = rr.status
    except Exception:
        st = 0
    chk(st == 200, f'C5 globoka povezava {pot} → 200 (dejansko {st})')

# overjen GET — seja (httpOnly piškotek r538 + Bearer) nespremenjena
s, d, _ = call('POST', '/api/auth/login', body={'email': 'admin@roksal.si', 'password': 'Admin123!'})
admin_token = d.get('token') if s == 200 else ''
if admin_token:
    s2, d2, _ = call('GET', '/api/deliveries', token=admin_token)
    chk(s2 == 200, f'C6 overjen GET /api/deliveries → 200 (dejansko {s2}) — rezerva NE spremeni poti prijave')
    call('POST', '/api/auth/logout', token=admin_token)
else:
    skip('C6 overjen GET (prijava ni uspela)')

# ═══ D) registracija: matrika + README ═════════════════════════════════════
print('── D) registracija (ci-matrix / ci.yml / README) ──')
mat = src('tests/ci-matrix.sh')
chk(re.search(r'(?<![\w-])r552(?![\w-])', mat) is not None and mat.count('r552') >= 2,
    'D1 ci-matrix.sh: r552 v GRUPE in CLANI (pozicijsko neodvisno)')
yml = src('.github/workflows/ci.yml')
chk(re.search(r'(?<![\w-])r552(?![\w-])', yml) is not None, 'D2 .github/workflows/ci.yml: r552 v matriki')
rd = src('README.md')
chk(re.search(r'59\. skupin|59 skupin|59/59', rd) is not None, 'D3 README: 59. skupina odražena')
chk('R552' in rd, 'D4 README: R552 popisano')

print(f'═══ {TAG} KONEC: {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸ ═══')
raise SystemExit(0 if FAIL == 0 else 1)
