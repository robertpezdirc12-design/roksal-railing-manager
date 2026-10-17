#!/usr/bin/env python3
# r547 — RAZBITJE SREDNJIH MODULOV: zajem (1372), servis (1283), ogradnja (1211)
#
# Nadaljevanje recepta R546 (razbitje velikanov) na naslednjo trojico iz
# odprtih točk README (tehnični dolg sinteze R543): kirurški refactoring
# BREZ spremembe obnašanja (0 odvisnosti, 0 DB sprememb):
#   zajem    → shared + new + qa + geo + replay + detail   [1372 → 161]
#   servis   → shared + garancije + reklamacije + primeri  [1283 → 53]
#   ogradnja → shared + carovnik + verify + detail         [1211 → 157]
#
# Posebnosti:
#   - zajem-detail.tsx je PODKOREN (sestavlja geo/qa/replay — enosmerno, aciklično)
#   - ogradnja ima 3-nivojski aciklični graf: shared → verify → carovnik;
#     glavni poveže carovnik + detail (verify dosegljiv le prek carovnika)
#   - ogradnja-shared.tsx je edini shared z JSX (QualityDot/ReviewRow/
#     ValidationList so drobni gradniki z več potrošniki — en vir resnice)
#
# Preverjanja:
#   A) statično: 14 novih datotek, 'use client', default export v glavnih,
#      velikostni pragovi (<700), komponente na pričakovanih lokacijah,
#      ENOSMEREN aciklični graf uvozov (dovoljeni seznami po datoteki),
#      module-view NEDOTAKNJEN (3 poti ostajajo, 0 novih vnosov)
#   B) sidro r486 (shrinkThumb/'Dodaj posnetek') sledi fizičnemu premiku v
#      zajem-detail.tsx; brez podvojenih definicij (premik, ne kopija)
#   C) HTTP: globoke povezave vseh treh modulov + goli / (živi strežnik)
#   D) registracija: ci-matrix + ci.yml + README (pozicijsko neodvisno)
#
# Zagon: python3 tests/r547.py  (ali bash tests/ci-matrix.sh r547)

import os
import re
import urllib.request

PASS, FAIL, SKIP = 0, 0, 0
TAG = 'R547'
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


def lines (relpath):
    try:
        return len(src(relpath).splitlines())
    except Exception:
        return 10 ** 9


MOD = 'src/components/roksal/modules'

# ═══ A) statično: struktura razbitja ═══════════════════════════════════════
print('── A) struktura: 14 novih datotek, meje, enosmerni uvozi ──')

NOVE = [
    f'{MOD}/zajem-shared.ts', f'{MOD}/zajem-new.tsx', f'{MOD}/zajem-qa.tsx',
    f'{MOD}/zajem-geo.tsx', f'{MOD}/zajem-replay.tsx', f'{MOD}/zajem-detail.tsx',
    f'{MOD}/servis-shared.ts', f'{MOD}/servis-garancije.tsx',
    f'{MOD}/servis-reklamacije.tsx', f'{MOD}/servis-primeri.tsx',
    f'{MOD}/ogradnja-shared.tsx', f'{MOD}/ogradnja-carovnik.tsx',
    f'{MOD}/ogradnja-verify.tsx', f'{MOD}/ogradnja-detail.tsx',
]
for f in NOVE:
    chk(os.path.isfile(os.path.join(REPO, f)), f'A1 obstaja {f.split("/")[-1]}')

# 'use client' na vseh JSX poddatotekah (ogradnja-shared.tsx ima JSX gradnike
# — QualityDot/ReviewRow/ValidationList — zato je .tsx z uporabniško izjemo)
for f in NOVE:
    if f.endswith('.tsx'):
        chk(src_has(f, "'use client'"), f"A2 'use client' v {f.split('/')[-1]}")

# velikostni pragovi — podmnožične trditve (ne točna števila!)
for f in NOVE + [f'{MOD}/zajem.tsx', f'{MOD}/servis.tsx', f'{MOD}/ogradnja.tsx']:
    chk(lines(f) < 700, f'A3 {f.split("/")[-1]} pod 700 vrstic (dejansko {lines(f)})')
for glavni in ['zajem.tsx', 'servis.tsx', 'ogradnja.tsx']:
    chk(lines(f'{MOD}/{glavni}') < 400,
        f'A3 {glavni} tanka lupina pod 400 (dejansko {lines(f"{MOD}/{glavni}")})')

# default export (lupina lenega nalaganja) ostaja v glavnih treh
for glavni in ['zajem.tsx', 'servis.tsx', 'ogradnja.tsx']:
    chk(re.search(r'export default function', src(f'{MOD}/{glavni}')) is not None,
        f'A4 default export ostaja v {glavni} (module-view lazy pot nedotaknjena)')

# komponente na pričakovanih lokacijah (kirurški izrez, ne izum)
LOKACIJE = {
    f'{MOD}/zajem-shared.ts': [
        'export interface SessionRow', 'export interface AnalysisPayload',
        'export interface SessionDetail', 'export const STATUS_BADGE',
    ],
    f'{MOD}/zajem-new.tsx': [
        'export interface ProjectOption', 'export interface RunOption',
        'export function NewSessionDialog',
    ],
    f'{MOD}/zajem-qa.tsx': ['export interface QaPayload', 'export function ElementQaPanel'],
    f'{MOD}/zajem-geo.tsx': ['export interface GeoCtx', 'export function GeoPanel'],
    f'{MOD}/zajem-replay.tsx': [
        'export interface ReplayStep', 'export interface ReplayPayload',
        'export function ReplayPanel',
    ],
    f'{MOD}/zajem-detail.tsx': ['export function SessionDetailBody'],
    f'{MOD}/servis-shared.ts': [
        'export interface WarrantyRow', 'export interface ClaimRow',
        'export interface VisitRow', 'export interface ServiceCaseRow',
        'export const CLAIM_STATUSI', 'export const CASE_STATUSI',
        'export const KANALI', 'export const ODLOCITVE', 'export const ODLOCITEV_CLS',
        'export const kanalLabel', 'export const odlocitevLabel',
        'export function isOffice', 'export function garancijaVelja',
    ],
    f'{MOD}/servis-garancije.tsx': [
        'export function GarancijeTab', 'function WarrantyDetailDialog',
        'function NewWarrantyDialog',
    ],
    f'{MOD}/servis-reklamacije.tsx': [
        'export function ReklamacijeTab', 'function KanaliIconInline',
        'function ClaimDetailDialog', 'function NewClaimDialog',
    ],
    f'{MOD}/servis-primeri.tsx': [
        'export function ServisTab', 'function CaseDetailDialog', 'function NewCaseDialog',
    ],
    f'{MOD}/ogradnja-shared.tsx': [
        'export interface RunRow', 'export interface SegmentRow',
        'export interface AnalysisPayload', 'export interface RunDetail',
        'export const PHASES', 'export const STATUS_BADGES',
        'export const fmtM', 'export const num',
        'export function QualityDot', 'export function gateLabel',
        'export function ReviewRow', 'export function ValidationList',
    ],
    f'{MOD}/ogradnja-carovnik.tsx': ['interface WizardState', 'export function WizardDialog'],
    f'{MOD}/ogradnja-verify.tsx': ['export function VerifyPhase', 'function VerifyDialog'],
    f'{MOD}/ogradnja-detail.tsx': ['export function DetailDialog'],
}
lok_check = 0
for f, simboli in LOKACIJE.items():
    for s in simboli:
        lok_check += 1
        chk(src_has(f, s), f'A5 {s.replace("export ", "").replace("function ", "").replace("interface ", "").replace("const ", "")} je na lokaciji {f.split("/")[-1]}')
chk(lok_check == 55, f'A5 štej kirurške izreze: {lok_check}/55 (vzorec se nadaljuje)')

# glavni moduli še vedno DRŽIJO svoje odgovornosti
chk(src_has(f'{MOD}/zajem.tsx', 'export default function ZajemModule'),
    'A6 zajem.tsx: glavni modul (seznam + podrobnost) ostaja')
chk(src_has(f'{MOD}/servis.tsx', 'export default function ServisModule'),
    'A6 servis.tsx: glavni modul (zavihki) ostaja')
chk(src_has(f'{MOD}/ogradnja.tsx', 'export default function OgradnjaModule'),
    'A6 ogradnja.tsx: glavni modul (seznam tekačev) ostaja')

# ENOSMEREN aciklični graf uvozov — 0 krožnih (shared je list, glavni so koren)
def uvozi (f):
    try:
        return re.findall(r"from '\./([^']+)'", src(f))
    except Exception:
        return []

# shared datoteke so LISTI: ne uvažajo nobenega brata iz istega drevesa
for shared, prefix in [
    (f'{MOD}/zajem-shared.ts', 'zajem'),
    (f'{MOD}/servis-shared.ts', 'servis'),
    (f'{MOD}/ogradnja-shared.tsx', 'ogradnja'),
]:
    bratje = [u for u in uvozi(shared) if u.startswith(prefix)]
    chk(bratje == [], f'A7 {shared.split("/")[-1]} je list grafa (0 uvozov bratov; {bratje})')

# poddatoteke uvažajo SAMO dovoljene brate — nikoli glavni, nikoli nazaj po grafu
NE_SKLICI_GLAVNEGA = {
    f'{MOD}/zajem-new.tsx': [],
    f'{MOD}/zajem-qa.tsx': [],
    f'{MOD}/zajem-geo.tsx': [],
    f'{MOD}/zajem-replay.tsx': [],
    # zajem-detail je PODKOREN: sestavlja geo+qa+replay nad shared
    f'{MOD}/zajem-detail.tsx': ['zajem-shared', 'zajem-geo', 'zajem-qa', 'zajem-replay'],
    f'{MOD}/servis-garancije.tsx': ['servis-shared'],
    f'{MOD}/servis-reklamacije.tsx': ['servis-shared'],
    f'{MOD}/servis-primeri.tsx': ['servis-shared'],
    # ogradnja: 3-nivojski DAG — carovnik nad verify (verify ne sme nazaj)
    f'{MOD}/ogradnja-carovnik.tsx': ['ogradnja-shared', 'ogradnja-verify'],
    f'{MOD}/ogradnja-verify.tsx': ['ogradnja-shared'],
    f'{MOD}/ogradnja-detail.tsx': ['ogradnja-shared'],
}
for f, dovoljeni in NE_SKLICI_GLAVNEGA.items():
    u = uvozi(f)
    nedovoljeni = [x for x in u if x not in dovoljeni]
    chk(nedovoljeni == [], f'A8 {f.split("/")[-1]}: uvozi samo {dovoljeni or "zunanjost"} (0 krožnih; {nedovoljeni})')

# glavni trije povezujejo svoje dele (dokaz, da razbitje ni odtrgalo povezav)
chk("from './zajem-new'" in src(f'{MOD}/zajem.tsx')
    and "from './zajem-detail'" in src(f'{MOD}/zajem.tsx'),
    'A9 zajem.tsx povezuje new + detail (detail naprej sestavi geo/qa/replay)')
chk("from './servis-garancije'" in src(f'{MOD}/servis.tsx')
    and "from './servis-reklamacije'" in src(f'{MOD}/servis.tsx')
    and "from './servis-primeri'" in src(f'{MOD}/servis.tsx'),
    'A9 servis.tsx povezuje garancije + reklamacije + primeri')
chk("from './ogradnja-carovnik'" in src(f'{MOD}/ogradnja.tsx')
    and "from './ogradnja-detail'" in src(f'{MOD}/ogradnja.tsx'),
    'A9 ogradnja.tsx povezuje carovnik + detail (verify prek carovnika)')

# module-view nalagalnik NEDOTAKNJEN: 3 poti ostajajo, 0 novih vnosov
mv = src('src/components/roksal/module-view.tsx')
for pot in ['modules/zajem', 'modules/servis', 'modules/ogradnja']:
    chk(pot in mv, f'A10 module-view ohranja pot {pot}')
chk(re.search(r'modules/zajem-(shared|new|geo|qa|replay|detail)', mv) is None
    and re.search(r'modules/servis-(shared|garancije|reklamacije|primeri)', mv) is None
    and re.search(r'modules/ogradnja-(shared|carovnik|verify|detail)', mv) is None,
    'A10 nalagalnik: 0 novih vnosov (poddatoteke NISO zavihki — so gradniki)')

# ═══ B) sidro r486 sledi fizičnemu premiku (zajem-detail) ══════════════════
print('── B) sidro r486 po prestavitvi; brez podvojenih definicij ──')

chk(src_has(f'{MOD}/zajem-detail.tsx', 'shrinkThumb'),
    'B1 r486: shrinkThumb ŽIVI v zajem-detail.tsx (fizični premik, enako obnašanje)')
chk(src_has(f'{MOD}/zajem-detail.tsx', 'Dodaj posnetek'),
    'B2 r486: gumb „Dodaj posnetek" ŽIVI v zajem-detail.tsx')
chk(src_has('tests/r486.py', 'zajem-detail.tsx'),
    'B3 r486 test sledi novi strukturi (posodobljeno pošteno ob premiku)')

# premik, ne kopija: stara lokacija NE drži več definicij
chk(not src_has(f'{MOD}/zajem.tsx', 'function shrinkThumb')
    and not src_has(f'{MOD}/zajem.tsx', 'Dodaj posnetek'),
    'B4 r486: zajem.tsx (lupina) brez shrinkThumb/Dodaj posnetek (ni podvojitev)')
chk(not src_has(f'{MOD}/servis.tsx', 'function isOffice')
    and not src_has(f'{MOD}/servis.tsx', 'function garancijaVelja'),
    'B5 servis.tsx (lupina) brez isOffice/garancijaVelja (so v servis-shared)')
chk(not src_has(f'{MOD}/ogradnja.tsx', 'function WizardDialog')
    and not src_has(f'{MOD}/ogradnja.tsx', 'function ValidationList'),
    'B6 ogradnja.tsx (lupina) brez WizardDialog/ValidationList (so v carovnik/shared)')

# ═══ C) HTTP: žive globoke povezave razbitih modulov ═══════════════════════
print('── C) HTTP (razbiti moduli se nalagajo) ──')


def http_get (path):
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + path), timeout=30) as rr:
            return rr.status
    except Exception:
        return 0


for m in ['zajem', 'servis', 'ogradnja']:
    st = http_get(f'/?m={m}')
    chk(st == 200, f'C1 globoka povezava /?m={m} → 200 (razbitje ne sesuje nalaganja; dejansko {st})')
st = http_get('/?m=servis&x=1')
chk(st == 200, f'C2 /?m=servis&x=1 → 200 (dodatni query; dejansko {st})')
st = http_get('/')
chk(st == 200, f'C3 goli / → 200 (lupina; dejansko {st})')

# ═══ D) registracija: matrika + README (pozicijsko neodvisno) ══════════════
print('── D) registracija (ci-matrix / ci.yml / README) ──')

mat = src('tests/ci-matrix.sh')
chk(re.search(r'(?<![\w-])r547(?![\w-])', mat) is not None and mat.count('r547') >= 2,
    'D1 ci-matrix.sh: r547 v GRUPE in CLANI (pozicijsko neodvisno)')
yml = src('.github/workflows/ci.yml')
chk(re.search(r'(?<![\w-])r547(?![\w-])', yml) is not None,
    'D2 .github/workflows/ci.yml: r547 v matriki')
rd = src('README.md')
chk(re.search(r'54\. skupin|54 skupin|54/54', rd) is not None,
    'D3 README: 54. skupina odražena')
chk('R547' in rd and ('razbitje' in rd or 'razbil' in rd),
    'D4 README: R547 razbitje srednjih modulov popisano')

print(f'═══ R547 KONEC: {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸ ═══')
raise SystemExit(0 if FAIL == 0 else 1)
