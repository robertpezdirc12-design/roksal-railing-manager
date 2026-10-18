#!/usr/bin/env python3
# r553 — R553 (KAMERA MAKSIMALNO, II. krog): druga seja ukaza
# »izboljšuj kamero« po vzorcu R550 (prvi krog je zaprl šest vrzeli).
# Spletna raziskava (MDN Pinch zoom gestures, Dynamsoft, web.dev PTZ,
# Twilio mediaDevices, Snap web considerations, medium auto-torch past)
# je pokazala, kje smo ŠE vedno za najboljšimi — ta izdaja zapira ŠEST
# vrzeli, po obstoječi disciplini poštenja (naprava POTRDI, mi ne trdimo):
#
#   1. PINČ-ZOOM              — dvoprstno približevanje nad predogledom
#                                (MDN: kazalci + touch-action none); isti
#                                vir kot drsnik (applyConstraints, priščevanje
#                                na step); pravkar končan pinč NE sproži
#                                ostrenja (zaščita tap-to-focus).
#   2. ŽIVA SVETLOBA           — vzorec predogleda (48 px, luma) vsakih 1,5 s,
#                                EWMA glajenje; SVETUJE (»prižgi bliskavico«),
#                                NIKOLI ne ukinja (avto-torch oscilacija —
#                                past iz raziskave; §7 poštenost).
#   3. POŠTENA RESOLUCIJA      — getSettings() je edini vir resnice (Snap):
#                                »tok 1920×1080« izpišemo, kar je naprava
#                                ZAGOTOVILA, ne kar smo prosili (ideal 1920).
#   4. IZBIRNIK OBJEKTIVA      — enumerateDevices z oznakami (Twilio/MDN):
#                                multi-lens telefoni; izbira po deviceId
#                                (exact), trenutna izbira IZ TOKA.
#   5. CELOZASLONSKI PREDOGLED  — Fullscreen API nad predogledom + vodili;
#                                useSyncExternalStore (brez setState v
#                                efektu); gumb SKRIT, kadar brskalnik
#                                ne podpira (iOS Safari).
#   6. MEJE SVETLOBE EN VIR    — TEMNA_MEJA/SVETLA_MEJA izvoženi iz
#                                kakovost.ts; analyzeQuality obnašanje
#                                bajtno enako (nazajzdružljivost).
#
# Kaj ostaja NEDOTAKNJENO (dokumentirano poštenje):
#   - ImageCapture.takePhoto() se NAMERNO ne uporabi (r550: preview-pariteta
#     nad megapiksli); MAX_IMG_W ostaja 1600.
#   - Žiroskopska vodoravnica ZAVESTNO ODLAŠANA: formula za roll iz
#     beta/gamma pri pokončnem držanju (gimbal) ni overjena — NAPAČEN
#     indikator vodoravnosti bi bil laž; statična vodila ostajajo.
#   - vsa sidra r486/r487/r500/r501/r503/r508/r509/r513/r522/r550 veljajo
#     naprej (regresijske preverbe v B).
#
# Preverjanja:
#   A) bun enote: napisResolucije (veljavno/0/negativno/niz/zaokrožitev),
#      izberiNaprave (označene/neoznačene/audio/nezavarovan/null),
#      oceniSvetlobo (meje 45/225, null, NaN)
#   B) žičenje (source grep): pinč (touch-none + kazalci + zaščita tapa),
#      živa svetloba (interval + EWMA + svetovanje), resolucija (getSettings
#      + izpis), izbirnik (deviceId exact + aria + Select), fullscreen
#      (useSyncExternalStore + fullscreenchange), meje (TEMNA/SVETLA),
#      main props, regresije r550 (zrcaljenje/shutter/pariteta/reset)
#   C) HTTP: globoke povezave + goli /
#   D) registracija: ci-matrix GRUPE+CLANI, ci.yml, README 60. skupin
#
# Zagon: python3 tests/r553.py  (ali bash tests/ci-matrix.sh r553)

import json
import os
import subprocess
import sys
import urllib.request

PASS, FAIL, SKIP = 0, 0, 0
TAG = 'R553'
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
KAKOVOST = f'{MOD}/meritve-kamera/kakovost.ts'
MAIN = f'{MOD}/meritve-kamera.tsx'

print(f'════ {TAG} — kamera maksimalno II: pinč, živa svetloba, resolucija, objektivi, fullscreen ════')

# ═══ A) bun enote: lib + kakovost (DOM-free) ═══════════════════════════════
print('── A) napisResolucije / izberiNaprave / oceniSvetlobo')
A = bun_js(r'''
const { napisResolucije, izberiNaprave } = await import('./src/lib/camera-capabilities')
const { oceniSvetlobo, TEMNA_MEJA, SVETLA_MEJA } = await import('./src/components/roksal/modules/meritve-kamera/kakovost')

// napisResolucije — poštena resolucija IZ getSettings (ne iz ideal)
const nr = {
  veljavno: napisResolucije({ width: 1920, height: 1080 }),
  sodo: napisResolucije({ width: 640, height: 480 }),
  zaokrozitev: napisResolucije({ width: 1919.6, height: 1080.4 }),
  nicelna: napisResolucije({ width: 0, height: 1080 }),
  negativna: napisResolucije({ width: -640, height: 480 }),
  nizW: napisResolucije({ width: '1920', height: 1080 }),
  manjkaH: napisResolucije({ width: 1920 }),
  prazno: napisResolucije({}),
  nic: napisResolucije(null),
  brez: napisResolucije(undefined),
}

// izberiNaprave — samo OZNAČENE video vhode (labels po odobritvi)
const napraveSeznam = [
  { kind: 'videoinput', deviceId: 'd1', label: 'back camera 2x telephoto' },
  { kind: 'videoinput', deviceId: 'd2', label: '  ultra wide  ' },
  { kind: 'videoinput', deviceId: 'd3', label: '' },
  { kind: 'videoinput', deviceId: '', label: 'back main' },
  { kind: 'audioinput', deviceId: 'a1', label: 'microfon' },
  { kind: 'videoinput', deviceId: 'd4' },
]
const in_ = {
  vse: izberiNaprave(napraveSeznam, true),
  nezavarovano: izberiNaprave(napraveSeznam, false),
  nic: izberiNaprave(null, true),
  prazno: izberiNaprave([], true),
}

// oceniSvetlobo — iste meje kot analyzeQuality (EN vir)
const os_ = {
  temno: oceniSvetlobo(30),
  mejaPod: oceniSvetlobo(44.9),
  mejaTemno: oceniSvetlobo(45),
  sredina: oceniSvetlobo(128),
  mejaSvetlo: oceniSvetlobo(225),
  mejaNad: oceniSvetlobo(225.1),
  presvetlo: oceniSvetlobo(250),
  nic: oceniSvetlobo(null),
  nan: oceniSvetlobo(NaN),
}

console.log(JSON.stringify({ nr, in_, os_, meje: { TEMNA_MEJA, SVETLA_MEJA } }))
''')
if '_err' in A:
    bad(f'bun A: {A["_err"]}')
else:
    nr = A['nr']
    chk(nr['veljavno'] == '1920×1080', f'napisResolucije: {nr["veljavno"]} (poštena, ne obljuba)')
    chk(nr['sodo'] == '640×480', 'napisResolucije: naprava, ki da 640×480, dobi RESNICO izpisano (640×480, ne 1080p)')
    chk(nr['zaokrozitev'] == '1920×1080', f'napisResolucije: 1919.6×1080.4 zaokroženo → {nr["zaokrozitev"]}')
    chk(nr['nicelna'] is None and nr['negativna'] is None, 'napisResolucije: 0/negativne dimenzije → null (brez izpisa)')
    chk(nr['nizW'] is None and nr['manjkaH'] is None, 'napisResolucije: niz namesto številke / manjkajoča višina → null')
    chk(nr['prazno'] is None and nr['nic'] is None and nr['brez'] is None, 'napisResolucije: prazen/null/undefined → null')

    in_ = A['in_']
    chk(len(in_['vse']) == 2, f'izberiNaprave: samo DVE OZNAČENI kameri od 6 vhodov (d3 brez oznake, d4 brez deviceId, a1 audio) — dejansko {len(in_["vse"])}')
    if len(in_['vse']) == 2:
        chk(in_['vse'][0]['deviceId'] == 'd1' and in_['vse'][0]['label'] == 'back camera 2x telephoto', 'izberiNaprave: oznaka se SHRANI ne skrajša')
        chk(in_['vse'][1]['label'] == 'ultra wide', 'izberiNaprave: presledki okoli oznake se OBREŽEJO')
    chk(in_['nezavarovano'] == [] and in_['nic'] == [] and in_['prazno'] == [], 'izberiNaprave: nezavarovan kontekst/null/prazno → prazen seznam (ne laž o kamerah)')

    os_ = A['os_']
    chk(os_['temno'] == 'PRETEMNO' and os_['mejaPod'] == 'PRETEMNO', 'oceniSvetlobo: pod mejo 45 → PRETEMNO')
    chk(os_['mejaTemno'] == 'V_REDU' and os_['sredina'] == 'V_REDU', 'oceniSvetlobo: 45 in sredina → V_REDU (meja je <45, ne ≤)')
    chk(os_['mejaSvetlo'] == 'V_REDU' and os_['mejaNad'] == 'PRESVETLO' and os_['presvetlo'] == 'PRESVETLO', 'oceniSvetlobo: nad mejo 225 → PRESVETLO (meja je >225)')
    chk(os_['nic'] == 'NI_PODATKA' and os_['nan'] == 'NI_PODATKA', 'oceniSvetlobo: null/NaN → NI_PODATKA (ne »v redu«)')
    chk(A['meje']['TEMNA_MEJA'] == 45 and A['meje']['SVETLA_MEJA'] == 225, 'meji izvoženi: TEMNA_MEJA 45 + SVETLA_MEJA 225 (EN vir z analyzeQuality)')

# ═══ B) žičenje v UI (source grep) ═════════════════════════════════════════
print('── B) pinč / svetloba / resolucija / izbirnik / fullscreen / regresije')
b1 = [
    (LIB, 'export function napisResolucije', 'RESOLUCIJA: lib izvozi napisResolucije'),
    (LIB, 'export function izberiNaprave', 'OBJEKTIVI: lib izvozi izberiNaprave'),
    (LIB, 'getSettings? (): unknown', 'RESOLUCIJA: TrackLike pozna getSettings (testni lažnjak possible)'),
    (HOOK, 'deviceId: { exact:', 'OBJEKTIVI: izbira po deviceId EXACT (sicer bi brskalnik vrnil katerokoli)'),
    (HOOK, 'getSettings', 'RESOLUCIJA: hook bere getSettings (vir resnice, ne ideal)'),
    (HOOK, 'izberiNaprave', 'OBJEKTIVI: hook gradi seznam iz enumerateDevices'),
    (HOOK, 'vzorecSvetlobe', 'SVETLOBA: hook vzorči svetlost predogleda'),
    (HOOK, 'setInterval', 'SVETLOBA: vzorčenje na interval (ne zanka)'),
    (HOOK, 'window.clearInterval', 'SVETLOBA: interval se POČISTI (ne pušča v ozadju)'),
    (HOOK, 'preklopiNapravo', 'OBJEKTIVI: hook izpostavi preklopiNapravo'),
    (ZAJEM, 'touch-none', 'PINČ: touch-action none nad predogledom (pinč NE povečuje strani)'),
    (ZAJEM, 'onPointerDown={shraniKazalec}', 'PINČ: kazalci se zabeležijo ob dotiku (MDN Pinch zoom gestures)'),
    (ZAJEM, 'onPointerMove={premikKazalca}', 'PINČ: premik kazalca vodi razmerje'),
    (ZAJEM, 'onPointerUp={odpustiKazalec}', 'PINČ: umik kazalca konča potezo'),
    (ZAJEM, 'setPointerCapture', 'PINČ: zajem kazalca (prst izpred videa ne pobegne)'),
    (ZAJEM, 'pinchZadnjiRef.current < 500', 'PINČ: zaščita tapa — pravkar končan pinč NE sproži ostrenja'),
    (ZAJEM, 'Prižgi bliskavico', 'SVETLOBA: svetovanje s klikom na bliskavico (ne ukaz)'),
    (ZAJEM, 'Slaba svetloba — zajem bo temen', 'SVETLOBA: PRETEMNO besedilo pošteno (opozori, ne blokira)'),
    (ZAJEM, 'Presvetlo — prestavi se v senco', 'SVETLOBA: PRESVETLO besedilo'),
    (ZAJEM, 'aria-label="Izbira kamere"', 'OBJEKTIVI: izbirnik ima aria-label (dostopnost)'),
    (ZAJEM, 'requestFullscreen', 'FULLSCREEN: zahteva prek API-ja (ne CSS prevare)'),
    (ZAJEM, 'fullscreenchange', 'FULLSCREEN: stanje sledi dogodku (ne domneva)'),
    (ZAJEM, 'useSyncExternalStore', 'FULLSCREEN: useSyncExternalStore (brez setState v efektu)'),
    (ZAJEM, 'max-h-[75vh]', 'FULLSCREEN: predogled v celozaslonskem večji (360px → 75vh)'),
    (KAKOVOST, 'export const TEMNA_MEJA = 45', 'MEJE: TEMNA_MEJA izvožena (en vir)'),
    (KAKOVOST, 'export const SVETLA_MEJA = 225', 'MEJE: SVETLA_MEJA izvožena (en vir)'),
    (KAKOVOST, 'brightness < TEMNA_MEJA', 'MEJE: analyzeQuality uporablja TEMNA_MEJA (ne dvojnik 45)'),
    (KAKOVOST, 'brightness > SVETLA_MEJA', 'MEJE: analyzeQuality uporablja SVETLA_MEJA (ne dvojnik 225)'),
    (KAKOVOST, 'export function oceniSvetlobo', 'SVETLOBA: čista klasifikacija izvožena'),
    (KAKOVOST, 'export async function vzorecSvetlobe', 'SVETLOBA: vzorec živega predogleda izvožen'),
]
for rel, needle, msg in b1:
    chk(src_has(rel, needle), f'B1 {msg}')

hook_src = src(HOOK)
zajem_src = src(ZAJEM)
main_src = src(MAIN)

# R553 reset discipline: svetloba/resolucija/naprava padejo ob zagonu/ustavitvi
chk(hook_src.count('setSvetloba(null)') >= 2, 'B2 SVETLOBA reset: ob zagonu/ustavitvi (×2+)')
chk(hook_src.count('setResToka(null)') >= 2, 'B2 RESOLUCIJA reset: napaka/ustavitev NE pusti stale 1080p')
chk(hook_src.count('setZoomVrednost(null)') >= 2, 'B2 ZOOM reset (r550): start IN stop ostaneta (regresija)')

# EWMA glajenje — utripanje ob meji
chk('prej * 0.5 + b * 0.5' in hook_src, 'B3 SVETLOBA: EWMA glajenje (prej*0,5 + novo*0,5) — meja ne utripa')
chk('1500' in hook_src, 'B3 SVETLOBA: vzorčenje vsakih 1,5 s (ne vsak okvir — CPU)')

# Izbirnik: trenutna izbira IZ TOKA (getSettings), ne iz domneve o facing
chk('settings.deviceId' in hook_src or "s.deviceId" in hook_src or '(s as { deviceId?: unknown }).deviceId' in hook_src, 'B4 OBJEKTIVI: trenutni deviceId pride iz getSettings')
chk("naprave.length >= 2" in zajem_src, 'B4 OBJEKTIVI: izbirnik viden SAMO pri ≥2 OZNAČENIH kamerah')
chk('toast({ title: \'Izbira kamere\'' in hook_src, 'B4 OBJEKTIVI: uspeh se trdi SAMO po dejanskem zagonu (isti vzorec kot preklop smeri)')

# Resolucija: izpis samo ob dokazu
chk('tok ${resToka}' in zajem_src, 'B5 RESOLUCIJA: izpis » · tok WxH« samo, kadar obstaja (null → nič)')
chk("zmoKamere?.torch === 'PODPRTO' && !torchNa" in zajem_src, 'B5 SVETLOBA: gumb prižiga SAMO ob potrjeni torch + izklopljeni (ne mrtva ponudba)')

# Fullscreen: gumb SKRIT brez podpore (iOS Safari)
chk('fullscreenEnabled' in zajem_src, 'B6 FULLSCREEN: preverja fullscreenEnabled (iOS Safari → gumb NI, ne okvarjen)')
chk('getServerSnapshot' in zajem_src or '() => false' in zajem_src, 'B6 FULLSCREEN: strežni posnetek false (SSR/hidracija brez neskladja)')

# Main žičenje R553
w = [
    ('resToka={resToka}', 'RESOLUCIJA'),
    ('naprave={naprave}', 'OBJEKTIVI seznam'),
    ('trenutnaNaprava={trenutnaNaprava}', 'OBJEKTIVI trenutna'),
    ('preklopiNapravo={preklopiNapravo}', 'OBJEKTIVI preklop'),
    ('svetloba={svetloba}', 'SVETLOBA'),
]
for needle, msg in w:
    chk(needle in main_src, f'B7 ŽIČENJE: main poda {msg} FazaZajemu')

# Regresije r550 — sidra ostajajo (dokaz, da R553 ni razbilo prvega kroga)
r550 = [
    (ZAJEM, '-scale-x-100', 'zrcaljenje sprednje kamere'),
    (ZAJEM, 'NE-ZRCALJENA', 'zajem ne-zrcaljen (dokumentirano)'),
    (ZAJEM, 'bg-white/90', 'shutter blisk'),
    (ZAJEM, 'navigator.vibrate', 'shutter vibracija'),
    (ZAJEM, 'onClick={naTapPredogled}', 'tap veže na predogled'),
    (ZAJEM, 'cursor-crosshair', 'kazalec križ ob ostrenju'),
    (ZAJEM, 'aria-label="Približanje kamere"', 'drsnik aria'),
    (HOOK, 'width: { ideal: 1920 }', 'ideal 1920 (getUserMedia)'),
    (HOOK, 'facingMode: { ideal: smer }', 'facingMode ideal (graceful)'),
    (HOOK, 'razloziNapakoKamere(e)', 'napake po imenu v catch'),
    (MAIN, 'smerKamere={smerKamere}', 'main: smer'),
    (MAIN, 'zoomVrednost={zoomVrednost}', 'main: zoom'),
    (MAIN, 'ostrenjeNaTocki={ostrenjeNaTocki}', 'main: ostrenje'),
    (MAIN, 'nastaviZoomVrednost={nastaviZoomVrednost}', 'main: nastavljanje zooma'),
]
for rel, needle, msg in r550:
    chk(src_has(rel, needle), f'B8 REGRESIJA r550: {msg}')

chk('ImageCapture' not in zajem_src, 'B8 PARITETA (r550): brez takePhoto — predogled-pariteta ostaja')
chk('takePhoto' not in zajem_src and 'takePhoto' not in hook_src, 'B8 PARITETA: takePhoto nikjer v živem zajemu')
for prepoved in ('@zxing', 'quagga', 'opencv', '@tensorflow'):
    chk(prepoved not in src('package.json'), f'B9 BREZ nove odvisnosti: {prepoved}')

# ═══ C) HTTP: globoke povezave ════════════════════════════════════════════
print('── C) HTTP (kamera gosti v meritve — moduli se nalagajo) ──')


def http_get (path):
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + path, headers={'User-Agent': 'r553-test'}), timeout=30) as rr:
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
chk(_re.search(r'(?<![\w-])r553(?![\w-])', mat) is not None and mat.count('r553') >= 2,
    'D1 ci-matrix.sh: r553 v GRUPE in CLANI (pozicijsko neodvisno)')
yml = src('.github/workflows/ci.yml')
chk(_re.search(r'(?<![\w-])r553(?![\w-])', yml) is not None, 'D2 .github/workflows/ci.yml: r553 v matriki')
rd = src('README.md')
chk(_re.search(r'60\. skupin|60 skupin|60/60', rd) is not None, 'D3 README: 60. skupina odražena')
chk('R553' in rd and 'pinč' in rd.lower(), 'D4 README: R553 kamera izboljšave popisane')
pkg = src('package.json')
chk('"version": "1.72.0"' in pkg, 'D5 package.json: različica 1.72.0')

print(f'═══ {TAG} KONEC: {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸ ═══')
raise SystemExit(0 if FAIL == 0 else 1)
