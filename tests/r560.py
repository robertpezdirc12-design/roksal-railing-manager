#!/usr/bin/env python3
# r560 — R560 (zahteva lastnika: »mora prepoznat vijak les wpc zelezo
# rostfrai keramiko tla vogale vse kaj je možno v gradbeništvu, dolžina
# višina širina — čisto vse«): SPLOŠNO GRADBENO PREPOZNAVANJE.
#
# Stanje PREDR560 (preverjeno v kodi): R559 je prepoznal SAMO obstoječo
# ograjo (material ročnika, polnilo, stebri, okovje, stanje) — WPC je bil
# zvit v LES+opis, železo/inox/rostfraj nista bila ločena, vijakov, tal
# (vrsta + dimenzije ploščice), vogalov in os ŠIRINA ni prepoznal nihče.
#
# Preverja:
#   A) inspect-core nove enote (bun): varnaPloscicaCm 5..300, varnoStevilo
#      min..max + round.
#   B) parseInspectJson nove razdelke (bun): veljaven (WPC/železo/ZELEZO,
#      TORX/INOX, PORCELANAT 60×60, vogali 90°, mere SIRINA), jeOgraja=false
#      z SPLOŠNIM delom (ograja čista, splošni del PREŽIVI — jedro R560),
#      stari r559 format (brez novih ključev → privzete vrednosti), šum
#      (cap 6/8, NEZNANO ven, ploščica 4/301 → null, kot 5 → null,
#      vijaki vidni=false → počiščeno, neveljavna osa → ven).
#   C) žičenje (grep): prompt pravila (WPC lastna kategorija, nikoli ne
#      ugibaj zlitine, mero oceni SAMO iz referenc, vidni=true SAMO ob
#      glavah), ruta audit (tlaVrsta/materialiStevilo), tipi re-export,
#      panel nove kartice (Gradbišče/Vijaki/Tla/Vogali/Mere/ploščica ≈).
#   D) HTTP: 401 brez žetona + 1 živ VLM klic z generirano 32×32 PNG
#      (siva — VLM pošteno odgovori; struktura NOVIH razdelkov).
#   E) registracija (ci-matrix/ci.yml/README 64./v1.75.0) + REGRESIJE:
#      r559 pogodbe (NIKOLI NE UGIBAJ, tehnološki les, Prepoznaj ograjo,
#      potrdite na terenu, Zajemi kader, AR wiring) + analyze (R454) +
#      analyze-multi (R558) nedotaknjena.

import base64
import json
import os
import struct
import subprocess
import urllib.request
import urllib.error
import zlib

PASS, FAIL, SKIP = 0, 0, 0
TAG = 'R560-TEST'
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


def mini_png (w=32, h=32, rgb=(120, 120, 124)):
    """veljavna PNG ≥ 24×24 (lekcija R559: VLM zavrača 1×1 px)."""
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    def chunk (t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c))
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    return 'data:image/png;base64,' + base64.b64encode(
        b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')).decode()


MOD = 'src/components/roksal/modules'
LIB = 'src/lib'
AR = f'{MOD}/ar'

print(f'════ r560 — splošno gradbeno prepoznavanje (vijaki, WPC, železo/inox, tla, vogali, mere) ════')

# ═══ A) inspect-core: novi pomočniki (bun) ═════════════════════════════════
print('── A) nove enote: varnaPloscicaCm / varnoStevilo')
A = bun_js(r'''
const ic = await import('./src/lib/inspect-core')
const out = {}
out.p1 = ic.varnaPloscicaCm(60)
out.p2 = ic.varnaPloscicaCm(4)
out.p3 = ic.varnaPloscicaCm(301)
out.p4 = ic.varnaPloscicaCm(5)
out.p5 = ic.varnaPloscicaCm(300)
out.p6 = ic.varnaPloscicaCm(60.4)
out.p7 = ic.varnaPloscicaCm('abc')
out.s1 = ic.varnoStevilo(12, 1, 60)
out.s2 = ic.varnoStevilo(999, 0, 20)
out.s3 = ic.varnoStevilo(0, 0, 20)
out.s4 = ic.varnoStevilo(0.6, 0, 20)
out.s5 = ic.varnoStevilo(20, 0, 20)
out.s6 = ic.varnoStevilo(null, 0, 20)
out.s7 = ic.varnoStevilo(-1, 0, 20)
console.log(JSON.stringify(out))
''')
if '_err' in A:
    bad(f'A uvoz: {A["_err"][:200]}')
else:
    chk(A.get('p1') == 60 and A.get('p4') == 5 and A.get('p5') == 300, f'A1 ploščica 60/5/300 veljavne (dejansko {A.get("p1")}/{A.get("p4")}/{A.get("p5")})')
    chk(A.get('p2') is None and A.get('p3') is None and A.get('p7') is None, f'A2 ploščica 4/301/abc → null (meje 5..300) (dejansko {A.get("p2")}/{A.get("p3")}/{A.get("p7")})')
    chk(A.get('p6') == 60, f'A3 ploščica 60,4 → 60 (round) (dejansko {A.get("p6")})')
    chk(A.get('s1') == 12 and A.get('s3') == 0 and A.get('s5') == 20, f'A4 število 12/0/20 veljavna (dejansko {A.get("s1")}/{A.get("s3")}/{A.get("s5")})')
    chk(A.get('s2') is None and A.get('s6') is None and A.get('s7') is None, f'A5 število 999/null/−1 → null (izven meja) (dejansko {A.get("s2")}/{A.get("s6")}/{A.get("s7")})')
    chk(A.get('s4') == 1, f'A6 število 0,6 → 1 (round) (dejansko {A.get("s4")})')

# ═══ B) parseInspectJson: novi razdelki (bun) ══════════════════════════════
print('── B) parser: splošni gradbeni razdelki')
B = bun_js(r'''
const ic = await import('./src/lib/inspect-core')
const out = {}
// B-veljaven: jeOgraja=true + polni splošni del (WPC + železo, TORX/INOX, porcelanat 60×60, vogali 90°, mere SIRINA)
const veljaven = `{
  "jeOgraja": true,
  "scene": "Terasa z leseno ograjo",
  "tipOgraje": "TERASNA",
  "rocnik": { "material": "LES", "opis": "toploto obdelan smrekov ročnik", "barva": "naravna", "zaupanje": 0.85 },
  "polnilo": { "vrsta": "NAVPICNE_CEVI", "opis": "cevi med stebri", "zaupanje": 0.7 },
  "stebri": { "material": "ZELEZO", "steviloOcena": 6, "opis": "pocinkani stebri", "zaupanje": 0.75 },
  "okovje": { "kljuka": false, "tecaji": null, "kljucavnica": null, "opis": null },
  "stanje": "DOBRO",
  "stanjeOpis": "brez poškodb",
  "ocenaVisineCm": 105,
  "ocenaDolzineCm": 420,
  "opombe": ["fuge razpokane na enem steboru"],
  "materiali": [
    { "vrsta": "WPC", "kje": "tla terase", "opis": "terasa iz WPC deske, homogen profil", "zaupanje": 0.9 },
    { "vrsta": "ZELEZO", "kje": "stebri", "opis": "pocinkana ploščevina, mat sivkasta", "zaupanje": 0.7 },
    { "vrsta": "INOX", "kje": "vijaki", "opis": "svetleče se glave", "zaupanje": 0.65 },
    { "vrsta": "NEZNANO", "kje": "šum", "opis": "nevšečnost", "zaupanje": 0.99 }
  ],
  "vijaki": { "vidni": true, "tip": "TORX", "material": "INOX", "steviloOcena": 12, "kje": "stebri + ročnik", "zaupanje": 0.55 },
  "tla": { "vrsta": "PORCELANAT", "opis": "sive ploščice z globo koro", "ploscicaDolzinaCm": 60, "ploscicaSirinaCm": 60, "zaupanje": 0.8 },
  "vogali": { "steviloOcena": 2, "tipGlavni": "NOTRANJI", "kot": 90, "opis": "L-oblika terase", "zaupanje": 0.7 },
  "mere": [
    { "predmet": "hodnik", "osa": "SIRINA", "ocenaCm": 110, "referenca": "vrata 200 cm", "zaupanje": 0.6 },
    { "predmet": "brez ose", "osa": "DIAGONALA", "ocenaCm": 50, "referenca": "x", "zaupanje": 0.9 },
    { "predmet": "", "osa": "VISINA", "ocenaCm": 90, "referenca": "y", "zaupanje": 0.9 },
    { "predmet": "odprtina", "osa": "VISINA", "ocenaCm": null, "referenca": "ni reference", "zaupanje": 0.5 }
  ]
}`
out.veljaven = ic.parseInspectJson(veljaven)
// B-ni-ograje-splosno: jeOgraja=false, SPLOŠNI del pa obstaja → preživiti
const nisplosno = `{
  "jeOgraja": false,
  "scene": "Notranji hodnik s keramičnimi tlemi",
  "tipOgraje": "BALKONSKA",
  "rocnik": { "material": "LES", "opis": "ostanek", "zaupanje": 0.9 },
  "stanje": "NOVO",
  "opombe": ["ostanek"],
  "materiali": [
    { "vrsta": "KERAMIKA", "kje": "tla", "opis": "keramične ploščice", "zaupanje": 0.9 }
  ],
  "vijaki": { "vidni": false, "tip": "TORX", "material": "INOX", "steviloOcena": 5, "kje": "x", "zaupanje": 0.8 },
  "tla": { "vrsta": "KERAMICNE_PLOSCICE", "opis": "bež ploščice", "ploscicaDolzinaCm": 45, "ploscicaSirinaCm": 45, "zaupanje": 0.85 },
  "vogali": { "steviloOcena": 1, "tipGlavni": "NOTRANJI", "kot": 90, "opis": "stičišče sten", "zaupanje": 0.75 },
  "mere": [ { "predmet": "hodnik", "osa": "DOLZINA", "ocenaCm": 320, "referenca": "vrata 200 cm", "zaupanje": 0.65 } ]
}`
out.nisplosno = ic.parseInspectJson(nisplosno)
// B-stari: r559 format BREZ novih ključev → privzete vrednosti
const stari = `{
  "jeOgraja": true,
  "scene": "Stopniščna ograja",
  "tipOgraje": "STOPNISKA",
  "rocnik": { "material": "KERAMIKA", "opis": "keramični ročnik", "barva": "antracit", "zaupanje": 0.75 },
  "polnilo": { "vrsta": "STEKLO", "opis": "varno steklo", "zaupanje": 0.6 },
  "stebri": { "material": "INOX", "steviloOcena": 7, "opis": "okrogli", "zaupanje": 0.8 },
  "okovje": { "kljuka": true, "tecaji": null, "kljucavnica": false, "opis": null },
  "stanje": "DOBRO",
  "stanjeOpis": "ok",
  "ocenaVisineCm": 105,
  "ocenaDolzineCm": 320,
  "opombe": []
}`
out.stari = ic.parseInspectJson(stari)
// B-šum: cap-ovi, neveljavni enumi, čezmejne vrednosti
const materiali9 = []
for (let i = 0; i < 9; i++) materiali9.push({ "vrsta": "BETON", "kje": "k" + i, "opis": "o" + i, "zaupanje": 0.5 })
materiali9.push({ "vrsta": "NEZNANO", "kje": "sum", "opis": "s", "zaupanje": 0.99 })
const mere10 = []
for (let i = 0; i < 10; i++) mere10.push({ "predmet": "p" + i, "osa": "DOLZINA", "ocenaCm": 100 + i, "referenca": "r" + i, "zaupanje": 0.5 })
const sum = `{
  "jeOgraja": true,
  "scene": "Balkon",
  "tipOgraje": "BALKONSKA",
  "rocnik": { "material": "LES", "opis": "les", "barva": null, "zaupanje": 0.7 },
  "polnilo": { "vrsta": "STEKLO", "opis": "steklo", "zaupanje": 0.7 },
  "stebri": { "material": "INOX", "steviloOcena": 4, "opis": "inox", "zaupanje": 0.7 },
  "okovje": { "kljuka": true, "tecaji": null, "kljucavnica": null, "opis": null },
  "stanje": "DOBRO",
  "stanjeOpis": "ok",
  "opombe": [],
  "materiali": ${JSON.stringify(materiali9)},
  "vijaki": { "vidni": false, "tip": "TORX", "material": "INOX", "steviloOcena": 8, "kje": "x", "zaupanje": 0.9 },
  "tla": { "vrsta": "KAMEN", "opis": "kamnita tlakovina", "ploscicaDolzinaCm": 4, "ploscicaSirinaCm": 301, "zaupanje": 0.7 },
  "vogali": { "steviloOcena": 999, "tipGlavni": "NOTRANJI", "kot": 5, "opis": "x", "zaupanje": 0.9 },
  "mere": ${JSON.stringify(mere10)}
}`
out.sum = ic.parseInspectJson(sum)
console.log(JSON.stringify(out))
''')
if '_err' in B:
    bad(f'B uvoz: {B["_err"][:200]}')
else:
    v = B.get('veljaven') or {}
    mat = v.get('materiali') or []
    chk(len(mat) == 3 and mat[0].get('vrsta') == 'WPC' and mat[1].get('vrsta') == 'ZELEZO' and mat[2].get('vrsta') == 'INOX',
        f'B1 veljaven materiali: 3 (WPC/ZELEZO/INOX), NEZNANO ven (dejansko {len(mat)}: {[m.get("vrsta") for m in mat]})')
    chk(mat[0].get('kje') == 'tla terase' and mat[0].get('zaupanje') == 0.9, f'B2 materiali kje/zaupanje se sanitizirajo (dejansko {mat[0]})')
    vj = v.get('vijaki') or {}
    chk(vj.get('vidni') is True and vj.get('tip') == 'TORX' and vj.get('material') == 'INOX' and vj.get('steviloOcena') == 12,
        f'B3 veljaven vijaki: TORX/INOX/≈12 (dejansko {vj})')
    tl = v.get('tla') or {}
    chk(tl.get('vrsta') == 'PORCELANAT' and tl.get('ploscicaDolzinaCm') == 60 and tl.get('ploscicaSirinaCm') == 60,
        f'B4 veljaven tla: PORCELANAT 60×60 (dejansko {tl})')
    vg = v.get('vogali') or {}
    chk(vg.get('steviloOcena') == 2 and vg.get('tipGlavni') == 'NOTRANJI' and vg.get('kot') == 90,
        f'B5 veljaven vogali: 2× NOTRANJI 90° (dejansko {vg})')
    mer = v.get('mere') or []
    chk(len(mer) == 2 and mer[0].get('osa') == 'SIRINA' and mer[0].get('ocenaCm') == 110 and mer[1].get('ocenaCm') is None,
        f'B6 veljaven mere: 2 (SIRINA 110 + odprtina brez reference); neveljavna osa/prazen predmet VEN (dejansko {mer})')
    n = B.get('nisplosno') or {}
    chk(n.get('jeOgraja') is False and n.get('tipOgraje') == 'NEZNANO' and (n.get('rocnik') or {}).get('material') == 'NEZNANO' and n.get('opombe') == [],
        f'B7 ni-ograje: ograja del POČIŠČEN kljub šumnim poljem (jedro R559 nespremenjeno)')
    nmat = n.get('materiali') or []
    ntl = n.get('tla') or {}
    nvg = n.get('vogali') or {}
    nmer = n.get('mere') or []
    chk(len(nmat) == 1 and nmat[0].get('vrsta') == 'KERAMIKA' and ntl.get('vrsta') == 'KERAMICNE_PLOSCICE' and ntl.get('ploscicaDolzinaCm') == 45,
        f'B8 ni-ograje + SPLOŠNI del PREŽIVI: materiali KERAMIKA + tla 45×45 (jedro R560!) (dejansko {nmat}/{ntl.get("vrsta")})')
    chk((n.get('vijaki') or {}).get('vidni') is False and (n.get('vijaki') or {}).get('tip') == 'NEZNANO' and (n.get('vijaki') or {}).get('steviloOcena') is None,
        f'B9 vijaki vidni=false → trditve OČIŠČENE tudi v splošnem delu (dejansko {n.get("vijaki")})')
    chk(nvg.get('steviloOcena') == 1 and nvg.get('kot') == 90 and len(nmer) == 1 and nmer[0].get('osa') == 'DOLZINA',
        f'B10 vogali + mere preživijo (1× NOTRANJI 90°, DOLZINA 320) (dejansko {nvg}/{nmer})')
    st = B.get('stari') or {}
    stm = st.get('materiali') or []
    stv = st.get('vijaki') or {}
    stt = st.get('tla') or {}
    stvg = st.get('vogali') or {}
    chk(stm == [] and stv.get('vidni') is None and stv.get('tip') == 'NEZNANO' and stv.get('steviloOcena') is None,
        f'B11 stari r559 format: materiali [] + vijaki privzeti (NEZNANO/null) (dejansko {stm}/{stv})')
    chk(stt.get('vrsta') == 'NEZNANO' and stt.get('ploscicaDolzinaCm') is None and stvg.get('steviloOcena') is None and st.get('mere') == [],
        f'B12 stari format: tla NEZNANO + vogali null + mere [] (nazadnje združljiv odgovor VLM)')
    s = B.get('sum') or {}
    smat = s.get('materiali') or []
    chk(len(smat) == 6 and all(m.get('vrsta') == 'BETON' for m in smat),
        f'B13 šum materiali: 9 veljavnih → cap 6, NEZNANO ven (dejansko {len(smat)})')
    svj = s.get('vijaki') or {}
    chk(svj.get('vidni') is False and svj.get('tip') == 'NEZNANO' and svj.get('steviloOcena') is None and svj.get('zaupanje') == 0,
        f'B14 šum vijaki vidni=false: tip/število/zaupanje POČIŠČENI (dejansko {svj})')
    stl = s.get('tla') or {}
    chk(stl.get('vrsta') == 'KAMEN' and stl.get('ploscicaDolzinaCm') is None and stl.get('ploscicaSirinaCm') is None,
        f'B15 šum tla: ploščica 4/301 → null/null (meje 5..300) (dejansko {stl})')
    svg = s.get('vogali') or {}
    chk(svg.get('steviloOcena') is None and svg.get('tipGlavni') == 'NEZNANO' and svg.get('kot') is None and svg.get('zaupanje') == 0,
        f'B16 šum vogali: število 999/kot 5 → CEL razdelek počiščen (dejansko {svg})')
    smer = s.get('mere') or []
    chk(len(smer) == 8 and smer[0].get('predmet') == 'p0',
        f'B17 šum mere: 10 → cap 8 (dejansko {len(smer)})')

# ═══ C) prompt pravila + žičenje (grep) ════════════════════════════════════
print('── C) prompt poštenostna pravila + žičenje')
c1 = [
    (f'{LIB}/inspect-core.ts', 'WPC je lastna kategorija', 'prompt: WPC lastna kategorija (ne LES)'),
    (f'{LIB}/inspect-core.ts', 'nikoli ne ugibaj zlitine', 'prompt: A2/A4 ni vizualno ločljivo'),
    (f'{LIB}/inspect-core.ts', 'mero oceni SAMO iz referenc', 'prompt: mere samo iz referenc'),
    (f'{LIB}/inspect-core.ts', 'vidni=true SAMO, če so glave res vidne', 'prompt: vijaki le ob res vidnih glavah'),
    (f'{LIB}/inspect-core.ts', 'železo = pocinkano/jeklo', 'prompt: železo vs inox ločeno'),
    (f'{LIB}/inspect-core.ts', 'export function varnaPloscicaCm', 'core izvozi ploščico helper'),
    (f'{LIB}/inspect-core.ts', 'export function varnoStevilo', 'core izvozi število helper'),
    ('src/app/api/ar/inspect/route.ts', 'tlaVrsta', 'ruta: audit tlaVrsta'),
    ('src/app/api/ar/inspect/route.ts', 'materialiStevilo', 'ruta: audit materialiStevilo'),
    (f'{AR}/tipi.ts', 'GradbeniMaterial', 'tipi: re-export splošnih tipov'),
    (f'{AR}/prepoznava-panel.tsx', 'Gradbišče — splošno prepoznavanje', 'panel: naslov splošnega dela'),
    (f'{AR}/prepoznava-panel.tsx', 'Vijaki', 'panel: kartica vijaki'),
    (f'{AR}/prepoznava-panel.tsx', 'Tla', 'panel: kartica tla'),
    (f'{AR}/prepoznava-panel.tsx', 'Vogali', 'panel: kartica vogali'),
    (f'{AR}/prepoznava-panel.tsx', 'Mere (ocena iz referenc)', 'panel: kartica mere'),
    (f'{AR}/prepoznava-panel.tsx', 'ploščica ≈', 'panel: dimenzije ploščice'),
    (f'{AR}/prepoznava-panel.tsx', 'Inox (rostfraj)', 'panel: oznaka rostfraj'),
    (f'{AR}/prepoznava-panel.tsx', 'ocene ni', 'panel: mera brez reference pošteno'),
]
for rel, needle, msg in c1:
    chk(src_has(rel, needle), f'C1 ŽIČENJE: {msg}')

# ═══ D) HTTP inspect: 401 + živ VLM z novo shemo ════════════════════════════
print('── D) HTTP: /api/ar/inspect splošni razdelki')
PNG = mini_png()
monter = login('monter@roksal.si', 'Monter123!')
s, d, _ = call('POST', '/api/ar/inspect', None, {'photo': PNG})
chk(s == 401, f'D1 brez žetona → 401 (dejansko {s})')
s, d, _ = call('POST', '/api/ar/inspect', monter, {'photo': PNG, 'hint': TAG})
if s == 200:
    data = d.get('data', {})
    chk(isinstance(data.get('materiali'), list), 'D2 živ VLM → 200: materiali seznam')
    chk('vrsta' in (data.get('tla') or {}) and 'ploscicaDolzinaCm' in (data.get('tla') or {}), 'D3 tla struktura (vrsta + ploščica)')
    chk('vidni' in (data.get('vijaki') or {}) and 'steviloOcena' in (data.get('vogali') or {}), 'D4 vijaki/vogali struktura')
    chk(isinstance(data.get('mere'), list), 'D5 mere seznam')
    chk(data.get('jeOgraja') is False or data.get('jeOgraja') is True, 'D6 jeOgraja bool (siva 32×32 → pošteno)')
elif s == 422:
    skip('D2 živ VLM: 422 (VLM ni vrnil uporabnega JSON — zunanja storitev)')
elif s == 502:
    skip('D2 živ VLM: 502 (zunanja storitev trenutno nedosegljiva — ne aplikacijska napaka)')
else:
    bad(f'D2 živ VLM → {s} (pričakovano 200/422/502): {json.dumps(d)[:160]}')

# ═══ E) registracija + regresije ═══════════════════════════════════════════
print('── E) registracija + regresije')
import re as _re
mat = src('tests/ci-matrix.sh')
chk(_re.search(r'(?<![\w-])r560(?![\w-])', mat) is not None and mat.count('r560') >= 2,
    'E1 ci-matrix.sh: r560 v GRUPE in CLANI')
yml = src('.github/workflows/ci.yml')
chk(_re.search(r'(?<![\w-])r560(?![\w-])', yml) is not None, 'E2 ci.yml: r560 v matriki')
rd = src('README.md')
chk(_re.search(r'64\. skupin|64 skupin|64/64', rd) is not None, 'E3 README: 64. skupina odražena')
chk('v1.75.0' in rd, 'E4 README: izdaja v1.75.0')
pkg = src('package.json')
chk('"version": "1.76.0"' in pkg, 'E5 package.json: verzija 1.76.0 (dvignil R561 — vzorec r553/r554)')

e6 = [
    (f'{LIB}/inspect-core.ts', 'NIKOLI NE UGIBAJ', 'REGRESIJA r559: prepoved ugibanja ostaja'),
    (f'{LIB}/inspect-core.ts', 'tehnološki les', 'REGRESIJA r559: WPC v rocnik.material pravilo ostaja'),
    (f'{LIB}/inspect-core.ts', 'ploščice na tleh niso material ograje', 'REGRESIJA r559: keramika ≠ tla ostaja'),
    ('src/app/api/ar/inspect/route.ts', "import { INSPECT_PROMPT, parseInspectJson } from '@/lib/inspect-core'", 'REGRESIJA r559: ruta uvozi jedro'),
    ('src/app/api/ar/inspect/route.ts', 'AR_INSPECT', 'REGRESIJA r559: audit dejanje'),
    ('src/app/api/ar/inspect/route.ts', 'measurements.write', 'REGRESIJA r559: vrata'),
    (f'{AR}/prepoznava-panel.tsx', 'Prepoznaj ograjo', 'REGRESIJA r559: gumb prepoznavanja'),
    (f'{AR}/prepoznava-panel.tsx', 'potrdite na terenu', 'REGRESIJA r559: poštenostna nota'),
    (f'{AR}/prepoznava-panel.tsx', 'Zajemi kader iz predogleda', 'REGRESIJA r559: zajem kadra'),
    (f'{AR}/prepoznava-panel.tsx', 'prepoznano · ', 'REGRESIJA r559: badge zaupanja'),
    (f'{MOD}/ar.tsx', '<PrepoznavaPanel', 'REGRESIJA r559: vključitev panela'),
    (f'{MOD}/ar.tsx', "zajemiKader={mode === 'on'", 'REGRESIJA r559: zajem SAMO ob živi kameri'),
    ('src/app/api/ar/analyze/route.ts', 'Si svetovalec za postavitev ograj in teras', 'REGRESIJA R454: analyze nedotaknjena'),
    ('src/app/api/ar/analyze-multi/route.ts', 'PREČKA', 'REGRESIJA R558: analyze-multi nedotaknjen'),
    (f'{AR}/precka-panel.tsx', 'Izvedi prečko', 'REGRESIJA R558: prečka panel'),
    (f'{AR}/tipi.ts', 'PreckaAnalysis', 'REGRESIJA R558: tip PreckaAnalysis'),
]
for rel, needle, msg in e6:
    chk(src_has(rel, needle), f'E6 {msg}')

print(f'════ r560 konec: {PASS} ✓ / {FAIL} ✗ / {SKIP} skip ════')
exit(1 if FAIL > 0 else 0)
