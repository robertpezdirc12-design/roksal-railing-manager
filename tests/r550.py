#!/usr/bin/env python3
# r550 — R550 (KAMERA NAD GRAVOM): izboljšave po vzorcu najboljših implementacij
# na spletu (raziskava: web.dev PTZ, Chrome Image Capture samples, Dynamsoft,
# webrtchacks, MDN). Primerjava naša↔najboljša je dala ŠEST VRZELI, vse
# odprte v tej izdaji, po obstoječi disciplini poštenja (PODPRTO /
# NI_PODPRE / NI_DOKAZA — naprava POTRDI, mi ne trdimo):
#
#   1. ZOOM (drsnik)          — applyConstraints({advanced:[{zoom}]}) z
#                                razponom IZKLJUČNO iz getCapabilities();
#                                prikaz mnogokratnika najmanjšega približanja.
#   2. RESOLUCIJA TOKA        — width/height {ideal: 1920/1080}: brez teh
#                                omejitev brskalnik pogosto ponudi 640×480,
#                                kar je za merilne točke preslabo.
#   3. ZRCALJENJE PREDOGLEDA  — sprednja kamera: predogled ogledalen
#                                (-scale-x-100), zajem NE-zrcaljen (standard
#                                nativnih aplikacij — točke/meritve so
#                                fizično pravilne).
#   4. SHUTTER ODZIV          — beli blisk 180 ms + navigator.vibrate(25)
#                                (najboljša zmožnost, tiho).
#   5. NAPAKE PO IMENU (MDN)  — NotAllowed/NotFound/NotReadable/Overconstrained/
#                                Security vsak s svojim UKREPOM, ne generična
#                                »kamera ni dosegljiva«.
#   6. TAP-TO-FOCUS           — focusMode/pointsOfInterest (Chrome Android),
#                                POSKUS ne dokaz; obroč 700 ms na točki tapa.
#
# Kaj ostaja NEDOTAKNJENO (dokumentirano poštenje):
#   - ImageCapture.takePhoto() se NAMERNO ne uporabi: polna ločljivost
#     senzorja ni preview-paritetna (drugačen izrez), za MERILNE fotografije
#     (točke na sliki!) je pariteta pomembnejša od megapikselov.
#   - MAX_IMG_W ostaja 1600 (ravnovesje dataUrl/DB/osnutek); dvig resolucije
#     toka pomeni, da canvas 1920→1600 namesto 640→640.
#   - bliskavica/preklop/spomin (R508/R509) nedotaknjena — sidra skupin
#     r486/r487/r500/r501/r503/r508/r509/r513/r522 veljajo naprej.
#
# Preverjanja:
#   A) bun enote: zoomRazpon / nastaviZoom (priščevanje na step, ograje) /
#      poskusiOstrenje (POSKUS/NI_PODPRE/NAPAKA) / razloziNapakoKamere (vsa
#      imena) / zmogljivostiKamere z zoom+fokus / napisZmogljivosti razširitev
#   B) žičenje (source grep): resolucija 1920, diferencirana napaka v catch,
#      reset zooma ob zagonu/ustavitvi, zrcaljenje, shutter, gated drsnik,
#      gated tap, dostopnost aria, zajem NE-zrcaljen, props žičenje v main
#   C) HTTP: globoke povezave (kamera gosti v meritve + danes + katalog) + goli /
#   D) registracija: ci-matrix GRUPE+CLANI, ci.yml, README 57. skupin
#
# Zagon: python3 tests/r550.py  (ali bash tests/ci-matrix.sh r550)

import json
import os
import subprocess
import sys
import urllib.request

PASS, FAIL, SKIP = 0, 0, 0
TAG = 'R550'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('BASE_URL', 'http://localhost:3000')


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


MOD = 'src/components/roksal/modules'
LIB = 'src/lib/camera-capabilities.ts'
HOOK = f'{MOD}/meritve-kamera/use-kamera.ts'
ZAJEM = f'{MOD}/meritve-kamera/faza-zajem.tsx'
MAIN = f'{MOD}/meritve-kamera.tsx'

print(f'════ {TAG} — kamera nad gravom: zoom, resolucija, zrcaljenje, shutter, napake, ostrenje ════')

# ═══ A) bun enote: lib camera-capabilities (DOM-free) ═════════════════════
print('── A) zoomRazpon / nastaviZoom / poskusiOstrenje / razloziNapakoKamere')
A = bun_js(r'''
const { zoomRazpon, zmogljivostiKamere, nastaviZoom, poskusiOstrenje, razloziNapakoKamere, napisZmogljivosti } = await import('./src/lib/camera-capabilities')
const kliciZoom = []
const kliciFokus = []

// zoom razpon — tri stanja, en vir (getCapabilities)
const zr = {
  potrjeno: zoomRazpon({ zoom: { min: 100, max: 400, step: 10 } }),
  manjkaStep: zoomRazpon({ zoom: { min: 100, max: 400 } }),
  manjkaMax: zoomRazpon({ zoom: { min: 100 } }),
  obratno: zoomRazpon({ zoom: { min: 400, max: 100 } }),
  seznam: zoomRazpon({ zoom: [1, 2] }),
  brez: zoomRazpon({}),
  nic: zoomRazpon(null),
}

// zmogljivostiKamere — zoom in fokus iz ISTEGA vira
const tr = (cap) => ({ getCapabilities: () => cap })
const z1 = zmogljivostiKamere(tr({ torch: true, zoom: { min: 100, max: 400, step: 10 }, focusMode: ['continuous', 'single-shot'] }), 2)
const z2 = zmogljivostiKamere(tr({ torch: true }), 2)
const z3 = zmogljivostiKamere({}, 2)

// nastaviZoom — priščevanje na step, ograje [min,max], zavrnjeni ukaz
const zoomTrack = { applyConstraints: async (c) => { kliciZoom.push(c) }, getCapabilities: () => ({ zoom: { min: 100, max: 400, step: 25 } }) }
const zoomBrez = { applyConstraints: async (c) => { kliciZoom.push(c) }, getCapabilities: () => ({}) }
const zoomLomi = { applyConstraints: async (c) => { kliciZoom.push(c); throw new Error('ne') }, getCapabilities: () => ({ zoom: { min: 100, max: 400, step: 25 } }) }
const nz = {
  vTrecini: await nastaviZoom(zoomTrack, 333),
  spodaj: await nastaviZoom(zoomTrack, 50),
  zgoraj: await nastaviZoom(zoomTrack, 999),
  nic: await nastaviZoom(zoomTrack, 100),
  nepodprto: await nastaviZoom(zoomBrez, 200),
  pokano: await nastaviZoom(zoomLomi, 300),
  niTracka: await nastaviZoom(null, 200),
}

// poskusiOstrenje — POSKUS ne dokaz
const focusTrack = { applyConstraints: async (c) => { kliciFokus.push(c) }, getCapabilities: () => ({ focusMode: ['continuous', 'single-shot'] }) }
const focusBrez = { applyConstraints: async (c) => { kliciFokus.push(c) }, getCapabilities: () => ({}) }
const focusLomi = { applyConstraints: async (c) => { kliciFokus.push(c); throw new Error('ne') }, getCapabilities: () => ({ focusMode: ['continuous'] }) }
const po = {
  sredina: await poskusiOstrenje(focusTrack, { x: 0.7, y: 0.3 }),
  ograji: await poskusiOstrenje(focusTrack, { x: 2, y: -1 }),
  neSteje: await poskusiOstrenje(focusTrack, { x: NaN, y: Infinity }),
  nepodprto: await poskusiOstrenje(focusBrez, { x: 0.5, y: 0.5 }),
  pokano: await poskusiOstrenje(focusLomi, { x: 0.5, y: 0.5 }),
  niTracka: await poskusiOstrenje(null, { x: 0.5, y: 0.5 }),
}

// razloziNapakoKamere — napaka po IMENU (MDN)
const mk = (name) => { const e = new Error('x'); e.name = name; return e }
const rn = {
  zavrnjeno: razloziNapakoKamere(mk('NotAllowedError')),
  niKamere: razloziNapakoKamere(mk('NotFoundError')),
  zasedeno: razloziNapakoKamere(mk('NotReadableError')),
  pretesnjeno: razloziNapakoKamere(mk('OverconstrainedError')),
  nevarno: razloziNapakoKamere(mk('SecurityError')),
  neznano: razloziNapakoKamere(mk('NekiNovegaError')),
  objektZImenom: razloziNapakoKamere({ name: 'NotAllowedError' }),
  nic: razloziNapakoKamere(null),
}

// napisZmogljivosti — razširitev samo ob potrditvi
const napis = {
  z1: napisZmogljivosti(z1),
  z2: napisZmogljivosti(z2),
  z3: napisZmogljivosti(z3),
}

console.log(JSON.stringify({ zr, z1: { zoom: z1.zoom, fokus: z1.fokus }, z2: { zoom: z2.zoom, fokus: z2.fokus }, z3: { zoom: z3.zoom, fokus: z3.fokus }, nz, po, rn, napis, zoomKlici: kliciZoom, fokusKlici: kliciFokus }))
''')
if '_err' in A:
    bad(f'bun A: {A["_err"]}')
else:
    zr = A['zr']
    chk(zr['potrjeno']['stanje'] == 'PODPRTO' and zr['potrjeno']['min'] == 100 and zr['potrjeno']['max'] == 400 and zr['potrjeno']['step'] == 10, 'zoomRazpon: potrjen razpon {100..400 step 10}')
    chk(zr['manjkaStep']['stanje'] == 'PODPRTO' and zr['manjkaStep']['step'] == 1, 'zoomRazpon: manjkajoč step pade na 1 (ne domneva o 0)')
    chk(zr['manjkaMax']['stanje'] == 'NI_PODPRE' and zr['obratno']['stanje'] == 'NI_PODPRE', 'zoomRazpon: manjkajoč/obraten max → NI_PODPRE (drsnik se NE prikaže)')
    chk(zr['seznam']['stanje'] == 'NI_PODPRE' and zr['brez']['stanje'] == 'NI_PODPRE' and zr['nic']['stanje'] == 'NI_DOKAZA', 'zoomRazpon: seznam/brez → NI_PODPRE; brez capabilities → NI_DOKAZA')

    chk(A['z1']['zoom']['stanje'] == 'PODPRTO' and A['z1']['fokus'] == 'PODPRTO', 'zmogljivostiKamere: zoom + focusMode potrjena → PODPRTO')
    chk(A['z2']['zoom']['stanje'] == 'NI_PODPRE' and A['z2']['fokus'] == 'NI_PODPRE', 'zmogljivostiKamere: capabilities brez zoom/focusMode → NI_PODPRE')
    chk(A['z3']['zoom']['stanje'] == 'NI_DOKAZA' and A['z3']['fokus'] == 'NI_DOKAZA', 'zmogljivostiKamere: brez API-ja → NI_DOKAZA (ne laž)')

    nz = A['nz']
    chk(nz['vTrecini']['uspesno'] is True and nz['vTrecini']['uporabljena'] == 325, f'nastaviZoom: 333 priščeto na step 25 → 325 (dejansko {nz["vTrecini"]["uporabljena"]})')
    chk(nz['spodaj']['uporabljena'] == 100 and nz['zgoraj']['uporabljena'] == 400, 'nastaviZoom: ograji [min,max] — 50→100, 999→400')
    chk(nz['nic']['uporabljena'] == 100 and nz['nic']['uspesno'] is True, 'nastaviZoom: točno min → min brez napake')
    chk(nz['nepodprto']['uspesno'] is False and nz['nepodprto']['uporabljena'] is None, 'nastaviZoom: brez zmožnosti → zavrnjeno, BREZ uporabljene vrednosti')
    chk(nz['pokano']['uspesno'] is False and 'mogoče' in nz['pokano']['sporocilo'], 'nastaviZoom: zavrnjen ukaz → napaka z rešitvijo')
    chk(nz['niTracka']['uspesno'] is False, 'nastaviZoom: brez tracka → zavrnjeno')
    # applyConstraints poklican SAMO za podprte (track s/zmožnostjo): vTrecini+spodaj+zgoraj+nic+ pokano = 5; nepodprto/niTracka NE
    zoomCalls = A['zoomKlici']
    chk(len(zoomCalls) == 5, f'nastaviZoom: applyConstraints klican 5× (samo PODPRTI) — dejansko {len(zoomCalls)}')
    chk(all(isinstance(c, dict) and isinstance(c.get('advanced'), list) and isinstance(c['advanced'][0], dict) and 'zoom' in c['advanced'][0] for c in zoomCalls), 'nastaviZoom: oblika {advanced:[{zoom}]} kot v web.dev')

    po = A['po']
    chk(po['sredina']['stanje'] == 'POSKUS' and 'preveri v kadru' in po['sredina']['sporocilo'], 'poskusiOstrenje: posredovan → POSKUS (ne dokaz)')
    chk(po['ograji']['stanje'] == 'POSKUS' and po['neSteje']['stanje'] == 'POSKUS', 'poskusiOstrenje: točke nad/pod okvirom in ne-številke NE sesujejo poskusa')
    chk(po['nepodprto']['stanje'] == 'NI_PODPRE' and po['niTracka']['stanje'] == 'NI_PODPRE', 'poskusiOstrenje: brez focusMode/tracka → NI_PODPRE')
    chk(po['pokano']['stanje'] == 'NAPAKA' and 'premikanjem kamere' in po['pokano']['sporocilo'], 'poskusiOstrenje: zavrnjeno → NAPAKA z rešitvijo')
    fk = A['fokusKlici']
    chk(len(fk) == 4, f'poskusiOstrenje: applyConstraints klican 4× (sredina+ograji+neSteje+pokano — vsi PODPRTI) — dejansko {len(fk)}')
    if fk:
        adv = fk[0].get('advanced', [])
        poi = adv[1] if len(adv) > 1 else None
        chk(poi is not None and poi.get('pointsOfInterest', [{}])[0].get('x') == 0.7, 'poskusiOstrenje: pointsOfInterest {x:0.7} posredovan (špecifikacija)')
    if len(fk) > 1:
        adv2 = fk[1].get('advanced', [])
        poi2 = adv2[1] if len(adv2) > 1 else None
        chk(poi2 is not None and poi2.get('pointsOfInterest', [{}])[0].get('x') == 1 and poi2.get('pointsOfInterest', [{}])[0].get('y') == 0, 'poskusiOstrenje: točka 2,-1 ograjena na 1,0')

    rn = A['rn']
    chk('zavrnjeno' in rn['zavrnjeno']['naslov'].lower() and 'nastavitvah' in rn['zavrnjeno']['opis'], 'razloziNapakoKamere: NotAllowedError → zavrnjeno + UKREP (nastavitve)')
    chk('najti' in rn['niKamere']['naslov'].lower(), 'razloziNapakoKamere: NotFoundError → ni kamere')
    chk('zasedena' in rn['zasedeno']['naslov'].lower(), 'razloziNapakoKamere: NotReadableError → kamera zasedena')
    chk('ne zmore' in rn['pretesnjeno']['naslov'].lower(), 'razloziNapakoKamere: OverconstrainedError → ne zmore zahteve')
    chk('varno povezavo' in rn['nevarno']['naslov'].lower(), 'razloziNapakoKamere: SecurityError → varna povezava')
    chk(rn['neznano']['naslov'] == 'Kamera ni dosegljiva.' and rn['nic']['naslov'] == 'Kamera ni dosegljiva.', 'razloziNapakoKamere: neznano/null → generični padec (nazadnje, ne prvič)')
    chk('zavrnjeno' in rn['objektZImenom']['naslov'].lower(), 'razloziNapakoKamere: ne-Error objekt z name se razloži')

    napis = A['napis']
    chk('približevanje' in napis['z1'] and 'ostrenje na točko' in napis['z1'], 'napisZmogljivosti: potrjena zoom+fokus se OMENUJE')
    chk('približevanje' not in napis['z2'] and 'ostrenje' not in napis['z2'], 'napisZmogljivosti: nepotrjeno se NE omenja (brez lažnih obljub)')
    chk('ni potrjena' in napis['z3'], 'napisZmogljivosti: NI_DOKAZA oblika ostaja (nazadnjezdružljivo s R508)')

# ═══ B) žičenje v UI (source grep) ═════════════════════════════════════════
print('── B) use-kamera / faza-zajem / main: šest vrzeli zaprto')
b1 = [
    (HOOK, 'width: { ideal: 1920 }', 'RESOLUCIJA: ideal 1920 v getUserMedia (ne privzeta 640×480)'),
    (HOOK, 'height: { ideal: 1080 }', 'RESOLUCIJA: ideal 1080 v getUserMedia'),
    (HOOK, 'razloziNapakoKamere(e)', 'NAPAKE: catch razloži napako PO IMENU (ne generično)'),
    (HOOK, 'facingMode: { ideal: smer }', 'SMER: facingMode ideal ostaja (graceful, ne exact)'),
    (HOOK, 'setZoomVrednost(null)', 'ZOOM reset: ob zagonu/ustavitvi vrednost pade (ni pavša)'),
    (HOOK, 'ostrenjeNaTocki', 'FOKUS: hook izpostavi ostrenjeNaTocki (lastništvo tracka v hooku)'),
    (LIB, 'pointsOfInterest', 'FOKUS: knjižnica pozna pointsOfInterest (špecifikacija)'),
    (LIB, 'zoomRazpon', 'ZOOM: knjižnica izvozi zoomRazpon'),
    (LIB, 'nastaviZoom', 'ZOOM: knjižnica izvozi nastaviZoom'),
    (LIB, 'poskusiOstrenje', 'FOKUS: knjižnica izvozi poskusiOstrenje'),
    (LIB, 'razloziNapakoKamere', 'NAPAKE: knjižnica izvozi razloziNapakoKamere'),
]
for rel, needle, msg in b1:
    chk(src_has(rel, needle), f'B1 {msg}')

hook_src = src(HOOK)
zajem_src = src(ZAJEM)
main_src = src(MAIN)
chk(hook_src.count('setZoomVrednost(null)') >= 2, 'B1 ZOOM reset: startCamera IN stopCamera (×2)')
chk('smerKamere' in hook_src.split('return {', 1)[1], 'B1 SMER: hook izvozi smerKamere (za zrcaljenje predogleda)')
chk(src_has(ZAJEM, '-scale-x-100') and "smerKamere === 'user'" in zajem_src, 'B2 ZRCALJENJE: predogled sprednje kamere je ogledalen (-scale-x-100)')
chk(src_has(ZAJEM, 'NE-ZRCALJENA'), 'B2 ZRCALJENJE: zajem ostaja ne-zrcaljen (dokumentirano — točke so fizično pravilne)')
chk(src_has(ZAJEM, 'navigator.vibrate'), 'B3 SHUTTER: vibracija po najboljši zmožnosti (tiho, ne obljuba)')
chk(src_has(ZAJEM, 'bg-white/90'), 'B3 SHUTTER: beli blisk nad predogledom')
chk(src_has(ZAJEM, "zmoKamere?.zoom.stanje === 'PODPRTO'"), 'B4 ZOOM: drsnik viden SAMO ob potrditvi razpona')
chk(src_has(ZAJEM, 'aria-label="Približanje kamere"'), 'B4 ZOOM: drsnik ima aria-label (dostopnost)')
chk(src_has(ZAJEM, "zmoKamere?.fokus === 'PODPRTO'"), 'B5 FOKUS: tap deluje SAMO ob potrditvi focusMode')
chk(src_has(ZAJEM, 'onClick={naTapPredogled}'), 'B5 FOKUS: tap veže na predogled')
chk(src_has(ZAJEM, 'cursor-crosshair'), 'B5 FOKUS: kazalec križ (namenjenost točke)')
chk('smerKamere={smerKamere}' in main_src and 'zoomVrednost={zoomVrednost}' in main_src, 'B6 ŽIČENJE: main poda smer+zoom FazaZajemu')
chk('ostrenjeNaTocki={ostrenjeNaTocki}' in main_src and 'nastaviZoomVrednost={nastaviZoomVrednost}' in main_src, 'B6 ŽIČENJE: main poda ostrenje+nastavljanje zooma')
chk('Kamera ni dosegljiva.' not in hook_src.split('const startCamera')[1].split('}, [')[0] or 'razloziNapakoKamere' in hook_src, 'B7 NAPAKE: sporočilo pride iz razlage, ne iz niza v hooku')
chk('Uporabite nalaganje fotografije' in src(LIB), 'B7 NAPAKE: generični padec ŽIVI v lib-u (en vir)')
# ImageCapture se NAMERNO ne uporabi (preview-pariteta) — dokazano spoštovanje
chk('ImageCapture' not in zajem_src.replace('ImageCapture se NAMERNO', '').replace('// ImageCapture', ''), 'B8 PARITETA: brez takePhoto — zajem riše predogled (točke so na SLIKI, ki jo vidi monter)')
for prepoved in ('@zxing', 'quagga', 'opencv', '@tensorflow'):
    chk(prepoved not in src('package.json'), f'B9 BREZ nove odvisnosti: {prepoved}')

# ═══ C) HTTP: globoke povezave ═════════════════════════════════════════════
print('── C) HTTP (kamera gosti v meritve — moduli se nalagajo) ──')


def http_get (path):
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + path), timeout=30) as rr:
            return rr.status
    except Exception:
        return 0


for m in ['meritve', 'danes', 'katalog']:
    st = http_get(f'/?m={m}')
    chk(st == 200, f'C1 globoka povezava /?m={m} → 200 (izboljšave ne sesujejo nalaganja; dejansko {st})')
st = http_get('/?m=meritve&x=1')
chk(st == 200, f'C2 /?m=meritve&x=1 → 200 (dodatni query; dejansko {st})')
st = http_get('/')
chk(st == 200, f'C3 goli / → 200 (lupina; dejansko {st})')

# ═══ D) registracija: matrika + README ═════════════════════════════════════
print('── D) registracija (ci-matrix / ci.yml / README) ──')

import re as _re
mat = src('tests/ci-matrix.sh')
chk(_re.search(r'(?<![\w-])r550(?![\w-])', mat) is not None and mat.count('r550') >= 2,
    'D1 ci-matrix.sh: r550 v GRUPE in CLANI (pozicijsko neodvisno)')
yml = src('.github/workflows/ci.yml')
chk(_re.search(r'(?<![\w-])r550(?![\w-])', yml) is not None, 'D2 .github/workflows/ci.yml: r550 v matriki')
rd = src('README.md')
chk(_re.search(r'57\. skupin|57 skupin|57/57', rd) is not None, 'D3 README: 57. skupina odražena')
chk('R550' in rd and 'zoom' in rd.lower(), 'D4 README: R550 kamera izboljšave popisane')

print(f'═══ {TAG} KONEC: {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸ ═══')
raise SystemExit(0 if FAIL == 0 else 1)
