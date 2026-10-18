#!/usr/bin/env python3
# r559 — R559 (vprašanje lastnika: »ali kamera sama zazna, kaj je ograja,
# kakšno okovje, keramika ali les«): VLM PREPOZNAVANJE OBSTOJEČE OGRAJE.
#
# Stanje PREDR559 (preverjeno v kodi): živa hevristika (R467–R485) je
# klasificirala le PODLAGO (trava/les/ploščice na TEH), VLM /api/ar/analyze
# pa svetoval kje postaviti NOVO ograjo — materialov OBSTOJEČE ograje
# (ročnik les/keramika, okovje, stanje) ni prepoznal nihče.
#
# Preverja:
#   A) inspect-core enote (bun): varnoZaupanje/varnoBesedilo/varnoTri/
#      varnaOcenaCm meje + zaokroževanje.
#   B) parseInspectJson (bun): veljen primer (vse kategorije), jeOgraja=false
#      (VSE počiščeno — brez ostankov), šum VLM (neveljavni enumi → NEZNANO,
#      zaupanje >1 → 1, opombe >5 → 5, mere izven meja → null, ```json ovitek).
#   C) prompt pravila (grep): NIKOLI NE UGIBAJ, keramika ≠ ploščice na tleh,
#      tehnološki les, okovje tri-state navodilo.
#   D) HTTP inspect validacije (401/400 brez/400 prefix/400 prevelika) +
#      1 živ VLM klic z mini PNG (200/422/502).
#   E) registracija (ci-matrix/ci.yml/README 63./ROUTE-MAP) + REGRESIJE:
#      analyze (R454) in analyze-multi (R558) nedotaknjena, prečka panel,
#      AR integracija PrepoznavaPanel.

import json
import os
import subprocess
import urllib.request
import urllib.error

PASS, FAIL, SKIP = 0, 0, 0
TAG = 'R559-TEST'
BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)
def skip (msg): global SKIP; SKIP += 1; print(f'  SKIP {msg}')


def src (relpath):
    with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
        return f.read()


def src_has (relpath, needle):
    try:
        return needle in src(relpath)
    except Exception:
        return False


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


def call (method, path, token=None, body=None, timeout=90):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode('utf-8', 'replace')), r
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode('utf-8', 'replace')), e
        except Exception: return e.code, {}, e
    except Exception as e:
        return 0, {'error': str(e)}, None


def login (email, pw):
    s, d, _ = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s}'
    return d['token']


MOD = 'src/components/roksal/modules'
LIB = 'src/lib'
AR = f'{MOD}/ar'

print(f'════ r559 — VLM prepoznavanje obstoječe ograje (materiali, okovje, stanje) ════')

# ═══ A) inspect-core: varni pomočniki (bun) ════════════════════════════════
print('── A) inspect-core: varni pomočniki')
A = bun_js(r'''
const ic = await import('./src/lib/inspect-core')
const out = {}
out.z1 = ic.varnoZaupanje(0.8)
out.z2 = ic.varnoZaupanje(1.5)
out.z3 = ic.varnoZaupanje(-0.2)
out.z4 = ic.varnoZaupanje('abc')
out.z5 = ic.varnoZaupanje(0.123)
out.z6 = ic.varnoZaupanje(null)
out.b1 = ic.varnoBesedilo('  hrast  ', 20)
out.b2 = ic.varnoBesedilo('x'.repeat(50), 30)
out.b3 = ic.varnoBesedilo(42, 10)
out.b4 = ic.varnoBesedilo('', 10)
out.t1 = ic.varnoTri(true)
out.t2 = ic.varnoTri(false)
out.t3 = ic.varnoTri('da')
out.t4 = ic.varnoTri(null)
out.c1 = ic.varnaOcenaCm(105)
out.c2 = ic.varnaOcenaCm(9)
out.c3 = ic.varnaOcenaCm(20001)
out.c4 = ic.varnaOcenaCm(104.6)
out.c5 = ic.varnaOcenaCm('abc')
out.c6 = ic.varnaOcenaCm(20000)
console.log(JSON.stringify(out))
''')
if '_err' in A:
    bad(f'A uvoz: {A["_err"][:200]}')
else:
    chk(A.get('z1') == 0.8 and A.get('z5') == 0.12, f'A1 zaupanje 0,8→0,8; 0,123→0,12 (2 dec.) (dejansko {A.get("z1")}/{A.get("z5")})')
    chk(A.get('z2') == 1 and A.get('z3') == 0, f'A2 zaupanje 1,5→1; −0,2→0 (meje) (dejansko {A.get("z2")}/{A.get("z3")})')
    chk(A.get('z4') == 0 and A.get('z6') == 0, 'A3 neveljavno zaupanje (string/null) → 0')
    chk(A.get('b1') == 'hrast', f'A4 besedilo trim (dejansko »{A.get("b1")}«)')
    chk(A.get('b2') == 'x' * 30 and A.get('b3') == '' and A.get('b4') == '', 'A5 besedilo slice/ne-string/prazno')
    chk(A.get('t1') is True and A.get('t2') is False and A.get('t3') is None and A.get('t4') is None, f'A6 tri-state true/false/neveljavno/null → true/false/null/null (dejansko {A.get("t1")}/{A.get("t2")}/{A.get("t3")}/{A.get("t4")})')
    chk(A.get('c1') == 105 and A.get('c4') == 105, f'A7 ocena 105→105; 104,6→105 (round) (dejansko {A.get("c1")}/{A.get("c4")})')
    chk(A.get('c2') is None and A.get('c3') is None and A.get('c5') is None, 'A8 ocena 9/20001/abc → null (izven meja 10..20000)')
    chk(A.get('c6') == 20000, 'A9 ocena 20000 (zgornja meja) → veljavna')

# ═══ B) parseInspectJson (bun) ═════════════════════════════════════════════
print('── B) parser VLM odgovora')
B = bun_js(r'''
const ic = await import('./src/lib/inspect-core')
const out = {}
// B-veljaven: popoln VLM odgovor (keramični ročnik, steklo, 7 stebrov)
const veljaven = `{
  "jeOgraja": true,
  "scene": "Stopniščna ograja v vhodnem prostoru",
  "tipOgraje": "STOPNISKA",
  "rocnik": { "material": "KERAMIKA", "opis": "keramični ročnik, hladen na dotik", "barva": "antracit", "zaupanje": 0.75 },
  "polnilo": { "vrsta": "STEKLO", "opis": "varno steklo 10 mm", "zaupanje": 0.6 },
  "stebri": { "material": "INOX", "steviloOcena": 7, "opis": "okrogli inox stebri", "zaupanje": 0.8 },
  "okovje": { "kljuka": true, "tecaji": null, "kljucavnica": false, "opis": "nerjavna kljuka" },
  "stanje": "DOBRO",
  "stanjeOpis": "brez vidnih poškodb",
  "ocenaVisineCm": 105,
  "ocenaDolzineCm": 320,
  "opombe": ["fuge med steklom in stebrom","rja na spodnjem vijaku"]
}`
out.veljaven = ic.parseInspectJson(veljaven)
// B-ni-ograje: jeOgraja false — VSE mora biti počiščeno (tudi če VLM pošlje šumno polje)
const ni = `{
  "jeOgraja": false,
  "scene": "Kuhinja z oknom",
  "tipOgraje": "BALKONSKA",
  "rocnik": { "material": "LES", "opis": "ostanek", "zaupanje": 0.9 },
  "stanje": "NOVO",
  "opombe": ["ostanek"]
}`
out.ni = ic.parseInspectJson(ni)
// B-šum: neveljavni enumi, čezmejna zaupanja, predolga besedila, preveč opomb
const sum = `{
  "jeOgraja": true,
  "scene": "Balkon",
  "tipOgraje": "PLESCALNA",
  "rocnik": { "material": "zlato", "opis": "${'z'.repeat(500)}", "barva": null, "zaupanje": 7 },
  "polnilo": { "vrsta": "plazma", "opis": "", "zaupanje": -3 },
  "stebri": { "material": "LES", "steviloOcena": 999, "opis": "les", "zaupanje": 0.5 },
  "okovje": { "kljuka": "da", "tecaji": true, "kljucavnica": null, "opis": null },
  "stanje": "MUZEJSKO",
  "stanjeOpis": "ok",
  "ocenaVisineCm": 9,
  "ocenaDolzineCm": 15000,
  "opombe": ["a","b","c","d","e","f","g","h"]
}`
out.sum = ic.parseInspectJson(sum)
// ovit v ```json
out.ovit = ic.parseInspectJson('```json\n' + veljaven + '\n```')
out.neJson = ic.parseInspectJson('Danes je lep dan.')
out.prazno = ic.parseInspectJson('')
console.log(JSON.stringify(out))
''')
if '_err' in B:
    bad(f'B uvoz: {B["_err"][:200]}')
else:
    v = B.get('veljaven') or {}
    chk(v.get('jeOgraja') is True and v.get('tipOgraje') == 'STOPNISKA', f'B1 veljaven: ograja + tip STOPNISKA (dejansko {v.get("tipOgraje")})')
    r = v.get('rocnik') or {}
    chk(r.get('material') == 'KERAMIKA' and r.get('barva') == 'antracit' and r.get('zaupanje') == 0.75, f'B2 ročnik KERAMIKA/antracit/0,75 (dejansko {r})')
    chk((v.get('polnilo') or {}).get('vrsta') == 'STEKLO', f'B3 polnilo STEKLO (dejansko {(v.get("polnilo") or {}).get("vrsta")})')
    st = v.get('stebri') or {}
    chk(st.get('material') == 'INOX' and st.get('steviloOcena') == 7, f'B4 stebri INOX ×7 (dejansko {st.get("material")}/{st.get("steviloOcena")})')
    ok_ = v.get('okovje') or {}
    chk(ok_.get('kljuka') is True and ok_.get('tecaji') is None and ok_.get('kljucavnica') is False, f'B5 okovje true/null/false (tri-state) (dejansko {ok_.get("kljuka")}/{ok_.get("tecaji")}/{ok_.get("kljucavnica")})')
    chk(v.get('stanje') == 'DOBRO' and v.get('ocenaVisineCm') == 105 and v.get('ocenaDolzineCm') == 320, f'B6 stanje DOBRO + oceni 105/320 (dejansko {v.get("stanje")}/{v.get("ocenaVisineCm")}/{v.get("ocenaDolzineCm")})')
    chk(len(v.get('opombe', [])) == 2, f'B7 opombe 2 (dejansko {len(v.get("opombe", []))})')
    n = B.get('ni') or {}
    chk(n.get('jeOgraja') is False and n.get('tipOgraje') == 'NEZNANO' and (n.get('rocnik') or {}).get('material') == 'NEZNANO' and (n.get('rocnik') or {}).get('zaupanje') == 0,
        f'B8 ni-ograje: VSE počiščeno NEZNANO/0 kljub šumnim poljem (dejansko tip={n.get("tipOgraje")} rocnik={n.get("rocnik")})')
    chk((n.get('stebri') or {}).get('steviloOcena') is None and n.get('ocenaVisineCm') is None and n.get('okovje', {}).get('kljuka') is None and n.get('opombe') == [],
        f'B9 ni-ograje: ocene/okovje/opombe prazni (dejansko {n.get("stebri")}/{n.get("okovje")}/{n.get("opombe")})')
    s = B.get('sum') or {}
    sr = s.get('rocnik') or {}
    chk(sr.get('material') == 'NEZNANO' and sr.get('zaupanje') == 1 and len(sr.get('opis', '')) == 200,
        f'B10 šum: neveljaven material→NEZNANO, zaupanje 7→1, opis slice 200 (dejansko {sr.get("material")}/{sr.get("zaupanje")}/{len(sr.get("opis", ""))})')
    chk(s.get('tipOgraje') == 'DRUGO' and (s.get('polnilo') or {}).get('vrsta') == 'NEZNANO' and s.get('stanje') == 'NEZNANO',
        f'B11 šum: neveljavni enumi → DRUGO/NEZNANO/NEZNANO (dejansko {s.get("tipOgraje")}/{(s.get("polnilo") or {}).get("vrsta")}/{s.get("stanje")})')
    chk((s.get('stebri') or {}).get('steviloOcena') is None and s.get('ocenaVisineCm') is None and s.get('ocenaDolzineCm') == 15000,
        f'B12 šum mere: stevilo 999→null, višina 9→null, dolžina 15000 veljavna (dejansko {(s.get("stebri") or {}).get("steviloOcena")}/{s.get("ocenaVisineCm")}/{s.get("ocenaDolzineCm")})')
    chk((s.get('okovje') or {}).get('kljuka') is None and len(s.get('opombe', [])) == 5,
        f'B13 šum: kljuka "da"→null, opombe 8→5 (dejansko {(s.get("okovje") or {}).get("kljuka")}/{len(s.get("opombe", []))})')
    chk((B.get('ovit') or {}).get('jeOgraja') is True, 'B14 ```json ovit VLM odgovor → uspešno izluščen')
    chk(B.get('neJson') is None and B.get('prazno') is None, 'B15 ne-JSON/prazno → null (route vrne 422)')

# ═══ C) prompt pravila + žičenje (grep) ════════════════════════════════════
print('── C) prompt poštenostna pravila + žičenje')
c1 = [
    (f'{LIB}/inspect-core.ts', 'NIKOLI NE UGIBAJ', 'prompt: izrecna prepoved ugibanja'),
    (f'{LIB}/inspect-core.ts', 'ploščice na tleh niso material ograje', 'prompt: keramika ročnika ≠ ploščice na tleh'),
    (f'{LIB}/inspect-core.ts', 'tehnološki les', 'prompt: WPC/tehnološki les → LES z opisom'),
    (f'{LIB}/inspect-core.ts', 'null = iz tega kota ni vidno', 'prompt: okovje tri-state navodilo'),
    (f'{LIB}/inspect-core.ts', 'export function parseInspectJson', 'core izvozi parser'),
    (f'{LIB}/inspect-core.ts', 'export const INSPECT_PROMPT', 'core izvozi prompt'),
    ('src/app/api/ar/inspect/route.ts', "import { INSPECT_PROMPT, parseInspectJson } from '@/lib/inspect-core'", 'route uvozi čisto jedro'),
    ('src/app/api/ar/inspect/route.ts', 'AR_INSPECT', 'audit dejanje AR_INSPECT'),
    ('src/app/api/ar/inspect/route.ts', 'measurements.write', 'vrata: measurements.write'),
    (f'{AR}/prepoznava-panel.tsx', 'Prepoznaj ograjo', 'panel: gumb prepoznavanja'),
    (f'{AR}/prepoznava-panel.tsx', 'potrdite na terenu', 'panel: poštenostna nota'),
    (f'{AR}/prepoznava-panel.tsx', 'prepoznano · ', 'panel: badge zaupanja'),
    (f'{AR}/prepoznava-panel.tsx', 'Zajemi kader iz predogleda', 'panel: zajem iz predogleda'),
    (f'{AR}/prepoznava-panel.tsx', 'ni vidno', 'panel: okovje tri-state prikaz'),
    (f'{MOD}/ar.tsx', '<PrepoznavaPanel', 'ar.tsx: vključitev panela'),
    (f'{MOD}/ar.tsx', 'zajemiKader={mode === \'on\'', 'ar.tsx: zajem SAMO ob živi kameri (brez lažnega gumba)'),
    (f'{AR}/tipi.ts', 'inspect-core', 'tipi: re-export iz jedra'),
]
for rel, needle, msg in c1:
    chk(src_has(rel, needle), f'C1 ŽIČENJE: {msg}')

# ═══ D) HTTP inspect validacije ════════════════════════════════════════════
print('── D) HTTP: /api/ar/inspect validacije')
PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q942jgAAAABJRU5ErkJggg=='
monter = login('monter@roksal.si', 'Monter123!')
s, d, _ = call('POST', '/api/ar/inspect', None, {'photo': PNG})
chk(s == 401, f'D1 brez žetona → 401 (dejansko {s})')
s, d, _ = call('POST', '/api/ar/inspect', monter, {})
chk(s == 400, f'D2 brez photo → 400 (dejansko {s}: {d.get("error", "")[:60]})')
s, d, _ = call('POST', '/api/ar/inspect', monter, {'photo': 'data:text/plain;base64,QQ'})
chk(s == 400, f'D3 napačen prefix → 400 (dejansko {s})')
s, d, _ = call('POST', '/api/ar/inspect', monter, {'photo': 'data:image/png;base64,' + 'A' * (6 * 1024 * 1024 + 10)})
chk(s == 400, f'D4 prevelika (>6 MB) → 400 (dejansko {s})')
# živ VLM klic (kot E6 v r558 — 1×1 px slika; 422 je veljaven pošten izid)
s, d, _ = call('POST', '/api/ar/inspect', monter, {'photo': PNG, 'hint': TAG})
if s == 200:
    data = d.get('data', {})
    chk(isinstance(data.get('jeOgraja'), bool) and 'rocnik' in data and 'okovje' in data and 'stanje' in data,
        'D5 živ VLM → 200 s strukturo (jeOgraja/rocnik/okovje/stanje)')
    chk(data.get('jeOgraja') is False or data.get('rocnik', {}).get('material') is not None, 'D6 struktura materiala')
elif s == 422:
    skip('D5 živ VLM: 422 (1×1 px slika brez ograje — pošten izid)')
elif s == 502:
    skip('D5 živ VLM: 502 (zunanja storitev trenutno nedosegljiva — ne aplikacijska napaka)')
else:
    bad(f'D5 živ VLM → {s} (pričakovano 200/422/502): {json.dumps(d)[:160]}')

# ═══ E) registracija + regresije ═══════════════════════════════════════════
print('── E) registracija + regresije')
import re as _re
mat = src('tests/ci-matrix.sh')
chk(_re.search(r'(?<![\w-])r559(?![\w-])', mat) is not None and mat.count('r559') >= 2,
    'E1 ci-matrix.sh: r559 v GRUPE in CLANI')
yml = src('.github/workflows/ci.yml')
chk(_re.search(r'(?<![\w-])r559(?![\w-])', yml) is not None, 'E2 ci.yml: r559 v matriki')
rd = src('README.md')
chk(_re.search(r'63\. skupin|63 skupin|63/63', rd) is not None, 'E3 README: 63. skupina odražena')
chk('v1.74.0' in rd, 'E4 README: izdaja v1.74.0')
pkg = src('package.json')
chk('"version": "1.74.0"' in pkg, 'E5 package.json: verzija 1.74.0')
rmap = src('docs/ROUTE-MAP.md')
chk('api/ar/inspect' in rmap, 'E6 ROUTE-MAP: inspect zabeležena')

e7 = [
    ('src/app/api/ar/analyze/route.ts', 'Si svetovalec za postavitev ograj in teras', 'STARA analyze (R454) nedotaknjena'),
    ('src/app/api/ar/analyze-multi/route.ts', 'Izvedi prečko', None),  # placeholder — zamenjamo spodaj
    (f'{AR}/precka-panel.tsx', 'Izvedi prečko', 'prečka panel (R558) gumb ostaja'),
    (f'{AR}/tipi.ts', 'PreckaAnalysis', 'tip PreckaAnalysis (R558) ostaja'),
    (f'{MOD}/ar.tsx', '<PreckaPanel />', 'ar.tsx: prečka panel ostaja'),
]
for rel, needle, msg in e7:
    if msg is None: continue
    chk(src_has(rel, needle), f'E7 REGRESIJA: {msg}')
chk(src_has('src/app/api/ar/analyze-multi/route.ts', 'PREČKA'), 'E7 REGRESIJA: analyze-multi (R558) nedotaknjen')

print(f'════ r559 konec: {PASS} ✓ / {FAIL} ✗ / {SKIP} skip ════')
exit(1 if FAIL > 0 else 0)
