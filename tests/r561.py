#!/usr/bin/env python3
# r561 — R561 (vprašanje lastnika: »kako TI zaznavaš, kaj je na fotografiji —
# če ti dam sliko, veš VSE, kar je na njej; naj program tudi razume VSE, kar
# je na sliki«): ODPRTA INVENTURA.
#
# Stanje PRED R561 (preverjeno v kodi): R559 je prepoznal obstoječo ograjo,
# R560 splošne gradbene kategorije (materiali/vijaki/tla/vogali/mere) — VSE
# po FIXNEM seznamu. Program VLM nikoli ni vprašal ODPRTO (»naštej vse, kar
# vidiš«) — orodja, lestve, kabli, pohištvo, rastlinje, vozila, živali,
# prizor (svetloba/vreme/delo v teku) in varnostna opažanja niso obstajali.
#
# Preverja:
#   A) parseInspectJson nove razdelke prek bun: prizor (tip/svetloba/vreme/
#      deloVTeku), objekti (prosto ime + kategorija + število), varnost.
#   B) parser pogodbe: veljaven odprt odgovor; jeOgraja=false → odprti del
#      PREŽIVI (jedro R561); stari r560 format (brez novih ključev) →
#      privzete vrednosti (nazaj združljiv); šum (cap 20/5, neveljavna
#      kategorija → DRUGO, število 0/999 → null, vreme cap 60); POPRAVEK
#      žive VLM napake (izpuščen narekovaj ključa + gol ključ + podpijaj —
#      dejanski 4,7 kB odgovor 45 s bi bil 422) + veljaven odgovor z
#      vrednostjo »TORX: …« ostane nedotaknjen.
#   C) žičenje (grep): prompt pravila (NAŠTEJ VSE vidne predmete, ODPRT
#      seznam, OSEBA brez imen/obrazov — zasebnost, varnost samo dejansko
#      videno), ruta audit (prizorTip/objektiStevilo/varnostStevilo), tipi
#      re-export, panel nove kartice (Vse na fotografiji/Predmeti/
#      Varnostna opažanja/delo v teku).
#   D) HTTP: 401 brez žetona + 1 živ VLM klic z generirano 32×32 PNG
#      (siva — VLM pošteno odgovori; struktura NOVIH razdelkov).
#   E) registracija (ci-matrix/ci.yml/README 65./v1.77.0) + REGRESIJE:
#      r559/r560 pogodbe + verziji pin r553/r556/r559/r560 dvignjeni na
#      1.77.0 (vzorec »r553 D5 verzija dvignjena« iz R554) + analyze
#      (R454) + analyze-multi (R558) nedotaknjena.

import base64
import json
import os
import struct
import subprocess
import urllib.request
import urllib.error
import zlib

PASS, FAIL, SKIP = 0, 0, 0
TAG = 'R561-TEST'
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

print(f'════ r561 — odprta inventura: program razume VSE, kar je na sliki ════')

# ═══ A) inspect-core: novi razdelki (bun) ═══════════════════════════════════
print('── A) prizor / objekti / varnost prek parseInspectJson')
A = bun_js(r'''
const ic = await import('./src/lib/inspect-core')
const out = {}
// A-odprt: veljavna odprta inventura (zunaj, delo v teku, 3 predmeti + varnost)
const odprt = `{
  "jeOgraja": true,
  "scene": "Terasa z ograjo med montažo",
  "tipOgraje": "TERASNA",
  "rocnik": { "material": "LES", "opis": "hrast", "barva": null, "zaupanje": 0.8 },
  "polnilo": { "vrsta": "STEKLO", "opis": "steklo", "zaupanje": 0.7 },
  "stebri": { "material": "INOX", "steviloOcena": 4, "opis": "inox", "zaupanje": 0.7 },
  "okovje": { "kljuka": null, "tecaji": null, "kljucavnica": null, "opis": null },
  "stanje": "DOBRO",
  "stanjeOpis": "ok",
  "ocenaVisineCm": 105,
  "ocenaDolzineCm": 400,
  "opombe": [],
  "materiali": [],
  "vijaki": { "vidni": null, "tip": "NEZNANO", "material": "NEZNANO", "steviloOcena": null, "kje": "", "zaupanje": 0 },
  "tla": { "vrsta": "NEZNANO", "opis": "", "ploscicaDolzinaCm": null, "ploscicaSirinaCm": null, "zaupanje": 0 },
  "vogali": { "steviloOcena": null, "tipGlavni": "NEZNANO", "kot": null, "opis": "", "zaupanje": 0 },
  "mere": [],
  "prizor": { "tip": "TERASA", "opis": "zunanja terasa z delno vgrajeno ograjo", "svetloba": "dnevna, pola senca", "vreme": "sončno", "deloVTeku": true, "zaupanje": 0.85 },
  "objekti": [
    { "ime": "aluminijasta lestev", "kategorija": "OPREMA", "steviloOcena": 1, "kje": "levo ob steni", "opis": "razprta, trimetrska", "zaupanje": 0.9 },
    { "ime": "akumulatorski vijačnik", "kategorija": "ORODJE", "steviloOcena": 2, "kje": "na tleh", "opis": "zeleni ohišji", "zaupanje": 0.8 },
    { "ime": "oseba s čelado", "kategorija": "OSEBA", "steviloOcena": 1, "kje": "desna polovica", "opis": "delovna obleka, rumena čelada — brez identifikacije", "zaupanje": 0.75 }
  ],
  "varnost": ["kabel vijačnika leži čez hodno pot", "lestev stoji na clonem tlaku"]
}`
out.odprt = ic.parseInspectJson(odprt)
// A-stari: r560 format BREZ novih ključev → privzete vrednosti
const stari = `{
  "jeOgraja": false,
  "scene": "Hodnik",
  "materiali": [],
  "vijaki": { "vidni": false },
  "tla": { "vrsta": "LAMINAT" },
  "vogali": {},
  "mere": []
}`
out.stari = ic.parseInspectJson(stari)
// A-šum: cap-ovi, neveljavni enumi, čezmejne vrednosti
// (lekcija R559: .repeat() znotraj JSON template NI veljaven JSON → ${} interpolacija)
const objekti25 = []
for (let i = 0; i < 25; i++) objekti25.push({ "ime": "predmet " + i, "kategorija": i === 0 ? "SVINJA" : "ORODJE", "steviloOcena": i % 3 === 0 ? 0 : (i % 4 === 0 ? 999 : 3), "kje": "k" + i, "opis": "o" + i, "zaupanje": 0.5 })
objekti25.push({ "ime": "", "kategorija": "ORODJE", "steviloOcena": 5, "kje": "x", "opis": "prazen ime naj ne gre", "zaupanje": 0.9 })
const varnost7 = []
for (let i = 0; i < 7; i++) varnost7.push("nevarnost " + i)
varnost7.push(42)
const sum = `{
  "jeOgraja": false,
  "scene": "x",
  "prizor": { "tip": "VESOLJE", "opis": ${JSON.stringify('o'.repeat(400))}, "svetloba": ${JSON.stringify('s'.repeat(100))}, "vreme": ${JSON.stringify('v'.repeat(100))}, "deloVTeku": "mogoce", "zaupanje": 5 },
  "objekti": ${JSON.stringify(objekti25)},
  "varnost": ${JSON.stringify(varnost7)}
}`
out.sum = ic.parseInspectJson(sum)
console.log(JSON.stringify(out))
''')
if '_err' in A:
    bad(f'A uvoz: {A["_err"][:200]}')
else:
    o = A.get('odprt') or {}
    pr = o.get('prizor') or {}
    chk(pr.get('tip') == 'TERASA' and pr.get('deloVTeku') is True and pr.get('vreme') == 'sončno',
        f'A1 prizor: TERASA + sončno + delo v teku da (dejansko {pr})')
    chk(pr.get('svetloba') == 'dnevna, pola senca' and pr.get('zaupanje') == 0.85,
        f'A2 prizor: svetloba + zaupanje se ohranita (dejansko {pr.get("svetloba")}/{pr.get("zaupanje")})')
    ob = o.get('objekti') or []
    chk(len(ob) == 3 and ob[0].get('ime') == 'aluminijasta lestev' and ob[0].get('kategorija') == 'OPREMA' and ob[1].get('steviloOcena') == 2,
        f'A3 objekti: 3 s PROSTIMI imeni (lestev/vijačnik/oseba) + števila (dejansko {len(ob)})')
    chk(ob[2].get('kategorija') == 'OSEBA' and 'brez identifikacije' in ob[2].get('opis', ''),
        f'A4 objekti: OSEBA kategorija deluje (zasebnostna opomba v opisu) (dejansko {ob[2] if len(ob) > 2 else None})')
    chk(o.get('varnost') == ['kabel vijačnika leži čez hodno pot', 'lestev stoji na clonem tlaku'],
        f'A5 varnost: 2 opažanja se ohranita (dejansko {o.get("varnost")})')
    st = A.get('stari') or {}
    spr = st.get('prizor') or {}
    chk(spr.get('tip') == 'NEZNANO' and spr.get('opis') == '' and spr.get('vreme') is None and spr.get('deloVTeku') is None and spr.get('zaupanje') == 0,
        f'A6 stari r560 format: prizor privzeti (NEZNANO/null/0) (dejansko {spr})')
    chk(st.get('objekti') == [] and st.get('varnost') == [],
        f'A7 stari format: objekti [] + varnost [] (nazaj združljiv odgovor VLM)')
    chk(st.get('tla', {}).get('vrsta') == 'LAMINAT' and st.get('jeOgraja') is False,
        f'A8 stari format: starejši razdelki nedotaknjeni (tla LAMINAT ostanejo)')
    s = A.get('sum') or {}
    sprs = s.get('prizor') or {}
    chk(sprs.get('tip') == 'NEZNANO' and len(sprs.get('opis', '')) == 300 and len(sprs.get('svetloba', '')) == 60 and len(sprs.get('vreme', '')) == 60,
        f'A9 šum prizor: tip VESOLJE → NEZNANO, opis cap 300, svetloba/vreme cap 60 (dejansko {sprs.get("tip")}/{len(sprs.get("opis", ""))}/{len(sprs.get("svetloba", ""))}/{len(sprs.get("vreme", ""))})')
    chk(sprs.get('deloVTeku') is None and sprs.get('zaupanje') == 1,
        f'A10 šum prizor: deloVTeku "mogoce" → null, zaupanje 5 → 1 (dejansko {sprs.get("deloVTeku")}/{sprs.get("zaupanje")})')
    sob = s.get('objekti') or []
    chk(len(sob) == 20 and sob[0].get('kategorija') == 'DRUGO' and sob[0].get('steviloOcena') is None,
        f'A11 šum objekti: 26 vnosov → cap 20; kategorija SVINJA → DRUGO; število 0 → null; prazen ime VEN (dejansko {len(sob)})')
    chk(all(x.get('steviloOcena') in (None, 3) for x in sob),
        f'A12 šum objekti: število 999 → null, 3 ostane (dejansko {[x.get("steviloOcena") for x in sob[:6]]})')
    chk(len(s.get('varnost') or []) == 5, f'A13 šum varnost: 7 nizov + 1 int → cap 5 nizov (dejansko {len(s.get("varnost") or [])})')

# ═══ B) parser: jeOgraja=false → odprti del PREŽIVI (jedro R561) ════════════
print('── B) neodvisnost od jeOgraja + popravek VLM JSON')
B = bun_js(r'''
const ic = await import('./src/lib/inspect-core')
const out = {}
const brez = `{
  "jeOgraja": false,
  "scene": "Vrt brez ograje",
  "rocnik": { "material": "LES", "opis": "šum", "zaupanje": 0.9 },
  "prizor": { "tip": "VRT", "opis": "zasebni vrt s travo", "svetloba": "oblačno", "vreme": "deževno", "deloVTeku": false, "zaupanje": 0.7 },
  "objekti": [
    { "ime": "tulipani", "kategorija": "RASTLINJE", "steviloOcena": 12, "kje": "sredina", "opis": "rdeči", "zaupanje": 0.85 },
    { "ime": "lopa za orodje", "kategorija": "STAVBNI_ELEMENT", "steviloOcena": 1, "kje": "ozadje", "opis": "lesena, siva", "zaupanje": 0.8 }
  ],
  "varnost": ["mokra trava — zdrsa"]
}`
out.brez = ic.parseInspectJson(brez)
// B-popravek: ŽIVA napaka glm-4.6v (45 s / 4,7 kB) — tri napake hkrati:
// (a) "ploscicaDolzinaCm: 60 (izpuščen zaklepajoči narekovaj ključa)
// (b) ploscicaSirinaCm: 60 (ključ brez obeh narekovajev) + (c) podpijaj pred } ]
const pokvarjen = `{
  "jeOgraja": true,
  "scene": "Terasa z ograjo",
  "tipOgraje": "TERASNA",
  "rocnik": { "material": "LES", "opis": "hrast", "barva": null, "zaupanje": 0.8 },
  "polnilo": { "vrsta": "STEKLO", "opis": "steklo", "zaupanje": 0.7 },
  "stebri": { "material": "INOX", "steviloOcena": 4, "opis": "inox", "zaupanje": 0.7 },
  "okovje": { "kljuka": null, "tecaji": null, "kljucavnica": null, "opis": null },
  "stanje": "DOBRO",
  "stanjeOpis": "ok",
  "ocenaVisineCm": 105,
  "ocenaDolzineCm": 400,
  "opombe": [],
  "materiali": [],
  "vijaki": { "vidni": null, "tip": "NEZNANO", "material": "NEZNANO", "steviloOcena": null, "kje": "", "zaupanje": 0 },
  "tla": { "vrsta": "KERAMICNE_PLOSCICE", "opis": "sive velike keramične ploščice, verjetno porcelanat", "ploscicaDolzinaCm: 60, ploscicaSirinaCm: 60, "zaupanje": 0.8 },
  "vogali": { "steviloOcena": 1, "tipGlavni": "NOTRANJI", "kot": 90, "opis": "L", "zaupanje": 0.75 },
  "mere": [],
  "prizor": { "tip": "TERASA", "opis": "teresa med montažo", "svetloba": "dnevna", "vreme": "sončno", "deloVTeku": true, "zaupanje": 0.85 },
  "objekti": [
    { "ime": "lestev", "kategorija": "OPREMA", "steviloOcena": 1, "kje": "levo", "opis": "aluminijasta", "zaupanje": 0.9 },
    { "ime": "vedro", "kategorija": "OPREMA", "steviloOcena": 2, "kje": "na tleh", "opis": "sivo", "zaupanje": 0.85, }
  ],
  "varnost": ["kabel čez hodno pot",]
}`
out.pokvarjen = ic.parseInspectJson(pokvarjen)
// B-popravek-nedotaknjeno: veljaven JSON z vrednostjo, ki se začne kot »ključ: «
const cist = `{"jeOgraja": true, "opombe": ["TORX: zvezdasta glava"], "prizor": {"tip": "GRADBISCE", "svetloba": "oblačno", "vreme": null, "deloVTeku": true, "zaupanje": 0.9}}`
out.cist = ic.parseInspectJson(cist)
out.cistRepair = ic.popraviVlmJson('{"a": "TORX: zvezdasta glava"}')
console.log(JSON.stringify(out))
''')
if '_err' in B:
    bad(f'B uvoz: {B["_err"][:200]}')
else:
    b = B.get('brez') or {}
    chk(b.get('jeOgraja') is False and (b.get('rocnik') or {}).get('material') == 'NEZNANO',
        'B1 jeOgraja=false: ograjni del POČIŠČEN (r559 jedro)')
    bp = b.get('prizor') or {}
    chk(bp.get('tip') == 'VRT' and bp.get('vreme') == 'deževno' and bp.get('deloVTeku') is False,
        f'B2 jeOgraja=false: prizor VRT + deževno + delo ne PREŽIVI (jedro R561!) (dejansko {bp})')
    bo = b.get('objekti') or []
    chk(len(bo) == 2 and bo[0].get('ime') == 'tulipani' and bo[1].get('kategorija') == 'STAVBNI_ELEMENT',
        f'B3 jeOgraja=false: objekti (tulipani + lopa) PREŽIVIJO (dejansko {[x.get("ime") for x in bo]})')
    chk(b.get('varnost') == ['mokra trava — zdrsa'], f'B4 jeOgraja=false: varnost PREŽIVI (dejansko {b.get("varnost")})')
    p = B.get('pokvarjen')
    chk(p is not None, 'B5 POPRAVEK žive napake: pokvarjen vzorec (izpuščen zaklepajoči narekovaj + gol ključ + 2 podpijaja) se REŠI (brez popravka bi bil 422!)')
    if p:
        chk(p.get('tla', {}).get('ploscicaDolzinaCm') == 60 and p.get('tla', {}).get('ploscicaSirinaCm') == 60 and p.get('tla', {}).get('zaupanje') == 0.8,
            f'B6 POPRAVEK tla: 60×60 + zaupanje 0,8 obnovljeni (dejansko {p.get("tla")})')
        chk((p.get('prizor') or {}).get('tip') == 'TERASA' and len(p.get('objekti') or []) == 2 and p.get('varnost') == ['kabel čez hodno pot'],
            f'B7 POPRAVEK odprti del: prizor TERASA + 2 objekta + varnost obnovljeni (dejansko {(p.get("prizor") or {}).get("tip")}/{len(p.get("objekti") or [])}/{p.get("varnost")})')
    c = B.get('cist') or {}
    chk(c.get('opombe') == ['TORX: zvezdasta glava'],
        f'B8 VELJAVEN odgovor nedotaknjen: vrednost »TORX: …« se NE pokvari (dejansko {c.get("opombe")})')
    chk(B.get('cistRepair') == '{"a": "TORX: zvezdasta glava"}',
        f'B9 popraviVlmJson na veljavnem: identičen izhod (dejansko {B.get("cistRepair")})')


# ═══ C) prompt pravila + žičenje (grep) ════════════════════════════════════
print('── C) prompt poštenostna pravila + žičenje')
c1 = [
    (f'{LIB}/inspect-core.ts', 'NAŠTEJ VSE vidne predmete', 'prompt: odprta inventura'),
    (f'{LIB}/inspect-core.ts', 'ODPRT seznam', 'prompt: odprt seznam, ne le gradbeni materiali'),
    (f'{LIB}/inspect-core.ts', 'BREZ imen, obrazov ali identifikacije', 'prompt: OSEBA zasebnost (r485!)'),
    (f'{LIB}/inspect-core.ts', 'samo DEJANSKO VIDNE nevarnosti', 'prompt: varnost brez ugibanja'),
    (f'{LIB}/inspect-core.ts', 'enake predmete ZDRUŽI z oceno števila', 'prompt: združevanje predmetov'),
    (f'{LIB}/inspect-core.ts', 'function parseObjekti', 'core: parser objektov'),
    (f'{LIB}/inspect-core.ts', 'function parsePrizor', 'core: parser prizora'),
    (f'{LIB}/inspect-core.ts', 'function parseVarnost', 'core: parser varnosti'),
    (f'{LIB}/inspect-core.ts', 'export function popraviVlmJson', 'core: izvozi popravek VLM JSON'),
    (f'{LIB}/inspect-core.ts', 'popraviVlmJson(raw.slice(start, end + 1))', 'core: parser poskusi popravek ob padcu parse'),
    (f'{LIB}/inspect-core.ts', 'prizor: InspectPrizor', 'core: tip v InspectOgraja'),
    (f'{LIB}/inspect-core.ts', 'objekti: InspectObjekt[]', 'core: seznam v InspectOgraja'),
    (f'{LIB}/inspect-core.ts', 'varnost: string[]', 'core: varnost v InspectOgraja'),
    ('src/app/api/ar/inspect/route.ts', 'prizorTip', 'ruta: audit prizorTip'),
    ('src/app/api/ar/inspect/route.ts', 'objektiStevilo', 'ruta: audit objektiStevilo'),
    ('src/app/api/ar/inspect/route.ts', 'varnostStevilo', 'ruta: audit varnostStevilo'),
    (f'{AR}/tipi.ts', 'InspectObjekt', 'tipi: re-export objektov'),
    (f'{AR}/tipi.ts', 'InspectPrizor', 'tipi: re-export prizora'),
    (f'{AR}/tipi.ts', 'ObjektKategorija', 'tipi: re-export kategorije'),
    (f'{AR}/tipi.ts', 'PrizorTip', 'tipi: re-export tipa prizora'),
    (f'{AR}/prepoznava-panel.tsx', 'Vse na fotografiji — odprta inventura', 'panel: naslov odprte inventure'),
    (f'{AR}/prepoznava-panel.tsx', 'Varnostna opažanja za monterja', 'panel: varnostna opažanja'),
    (f'{AR}/prepoznava-panel.tsx', 'delo v teku', 'panel: badge dela'),
    (f'{AR}/prepoznava-panel.tsx', 'Predmeti (', 'panel: seznam predmetov s številom'),
    (f'{AR}/prepoznava-panel.tsx', 'Cesta / prihod', 'panel: oznaka prizora CESTA'),
    (f'{AR}/prepoznava-panel.tsx', 'Žival', 'panel: oznaka kategorije ZIVAL'),
    (f'{AR}/prepoznava-panel.tsx', 'max-h-72', 'panel: dolg seznam scroll (UI pravilo)'),
    (f'{AR}/prepoznava-panel.tsx', 'normalizirajInspect', 'panel: odporna normalizacija odgovora (stari deploy/offline brez padca)'),
    (f'{AR}/prepoznava-panel.tsx', 'const rez = normalizirajInspect(res.data)', 'panel: setRezultat čez normalizacijo'),
]
for rel, needle, msg in c1:
    chk(src_has(rel, needle), f'C1 ŽIČENJE: {msg}')

# ═══ D) HTTP inspect: 401 + živ VLM z odprto shemo ══════════════════════════
print('── D) HTTP: /api/ar/inspect odprta inventura')
PNG = mini_png()
monter = login('monter@roksal.si', 'Monter123!')
s, d, _ = call('POST', '/api/ar/inspect', None, {'photo': PNG})
chk(s == 401, f'D1 brez žetona → 401 (dejansko {s})')
s, d, _ = call('POST', '/api/ar/inspect', monter, {'photo': PNG, 'hint': TAG})
if s == 200:
    data = d.get('data', {})
    chk(isinstance(data.get('prizor'), dict) and 'tip' in data.get('prizor', {}) and 'deloVTeku' in data.get('prizor', {}),
        f'D2 živ VLM → 200: prizor struktura (tip/svetloba/vreme/deloVTeku) (dejansko {data.get("prizor")})')
    chk(isinstance(data.get('objekti'), list), 'D3 živ VLM: objekti seznam (odprta inventura)')
    chk(isinstance(data.get('varnost'), list), 'D4 živ VLM: varnost seznam')
    chk(data.get('prizor', {}).get('tip') in ('TERASA', 'BALKON', 'STOPNISCE', 'VRT', 'DVORISCE', 'NOTRANJOST', 'GRADBISCE', 'STREHA', 'CESTA', 'DRUGO', 'NEZNANO'),
        f'D5 prizor tip v dovoljenih vrednostih (siva 32×32 → pošteno NEZNANO/DRUGO) (dejansko {data.get("prizor", {}).get("tip")})')
    chk(all('ime' in x and 'kategorija' in x for x in data.get('objekti', [])),
        'D6 objekti imajo prosto ime + kategorijo (struktura)')
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
chk(_re.search(r'(?<![\w-])r561(?![\w-])', mat) is not None and mat.count('r561') >= 2,
    'E1 ci-matrix.sh: r561 v GRUPE in CLANI')
yml = src('.github/workflows/ci.yml')
chk(_re.search(r'(?<![\w-])r561(?![\w-])', yml) is not None, 'E2 ci.yml: r561 v matriki')
rd = src('README.md')
chk(_re.search(r'65\. skupin|65 skupin|65/65', rd) is not None, 'E3 README: 65. skupina odražena')
chk('v1.77.0' in rd, 'E4 README: izdaja v1.77.0')
pkg = src('package.json')
chk('"version": "1.77.0"' in pkg, 'E5 package.json: verzija 1.77.0')

# verzije pin starejših skupin dvignjene na trenutno (vzorec »r553 D5 verzija
# dvignjena« iz R554/R556 — sicer polni pas pade na stare reference)
for stara in ('r553', 'r556', 'r559', 'r560'):
    chk(f'"version": "1.77.0"' in src(f'tests/{stara}.py'), f'E6-{stara} verzija pin dvignjena na 1.77.0')

e7 = [
    (f'{LIB}/inspect-core.ts', 'NIKOLI NE UGIBAJ', 'REGRESIJA r559: prepoved ugibanja ostaja'),
    (f'{LIB}/inspect-core.ts', 'tehnološki les', 'REGRESIJA r559: WPC v rocnik.material pravilo ostaja'),
    (f'{LIB}/inspect-core.ts', 'ploščice na tleh niso material ograje', 'REGRESIJA r559: keramika ≠ tla ostaja'),
    (f'{LIB}/inspect-core.ts', 'WPC je lastna kategorija', 'REGRESIJA r560: WPC lastna kategorija ostaja'),
    (f'{LIB}/inspect-core.ts', 'nikoli ne ugibaj zlitine', 'REGRESIJA r560: A2/A4 ni ločljivo ostaja'),
    (f'{LIB}/inspect-core.ts', 'mero oceni SAMO iz referenc', 'REGRESIJA r560: mere samo iz referenc ostaja'),
    ('src/app/api/ar/inspect/route.ts', 'AR_INSPECT', 'REGRESIJA r559: audit dejanje'),
    ('src/app/api/ar/inspect/route.ts', 'measurements.write', 'REGRESIJA r559: vrata'),
    (f'{AR}/prepoznava-panel.tsx', 'Prepoznaj ograjo', 'REGRESIJA r559: gumb prepoznavanja'),
    (f'{AR}/prepoznava-panel.tsx', 'potrdite na terenu', 'REGRESIJA r559: poštenostna nota'),
    (f'{AR}/prepoznava-panel.tsx', 'Gradbišče — splošno prepoznavanje', 'REGRESIJA r560: splošni del ostaja'),
    (f'{AR}/prepoznava-panel.tsx', 'Inox (rostfraj)', 'REGRESIJA r560: oznaka rostfraj ostaja'),
    (f'{MOD}/ar.tsx', '<PrepoznavaPanel', 'REGRESIJA r559: vključitev panela'),
    ('src/app/api/ar/analyze/route.ts', 'Si svetovalec za postavitev ograj in teras', 'REGRESIJA R454: analyze nedotaknjena'),
    ('src/app/api/ar/analyze-multi/route.ts', 'PREČKA', 'REGRESIJA R558: analyze-multi nedotaknjen'),
    (f'{AR}/precka-panel.tsx', 'Izvedi prečko', 'REGRESIJA R558: prečka panel'),
]
for rel, needle, msg in e7:
    chk(src_has(rel, needle), f'E7 {msg}')

print(f'════ r561 konec: {PASS} ✓ / {FAIL} ✗ / {SKIP} skip ════')
exit(1 if FAIL > 0 else 0)
