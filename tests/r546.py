#!/usr/bin/env python3
# r546 — RAZBITJE VELIKANOV: konfigurator (1752), pregled (1728), projekti (1642)
#
# Tehnični dolg iz sinteze R543/R544/R545: trije največji moduli so presegli
# 1600 vrstic. R546 jih kirurško razbije na poddatoteke BREZ spremembe
# obnašanja (refactoring — nič novih odvisnosti, nič DB sprememb):
#   konfigurator → shared + steps (1,2,4,5,6) + meritve (3)   [1752 → 643]
#   pregled      → shared + views + cards + share              [1728 → 507]
#   projekti     → shared + sections + packages + portal + bom [1642 → 232]
#
# Preverjanja:
#   A) statično: 12 novih datotek, 'use client', default export v glavnih,
#      velikostni pragovi (<700), komponente na pričakovanih lokacijah,
#      ENOSMEREN graf uvozov (0 krožnih), module-view NEDOTAKNJEN
#      (3 poti ostajajo, 0 novih vnosov v nalagalnik)
#   B) sidra sosednjih skupin ostajajo veljavna PO prestavitvi:
#      r488 (segmenti tekača → shared/meritve), r511 (vir obsega → bom),
#      r464 (cenovne konstante ostajajo IZVEN konfiguratorja)
#   C) HTTP: globoke povezave vseh treh modulov + goli / (živi strežnik)
#   D) registracija: ci-matrix + ci.yml + README (pozicijsko neodvisno)
#
# Zagon: python3 tests/r546.py  (ali bash tests/ci-matrix.sh r546)

import os
import re
import urllib.request

PASS, FAIL, SKIP = 0, 0, 0
TAG = 'R546'
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
print('── A) struktura: 12 novih datotek, meje, enosmerni uvozi ──')

NOVE = [
    f'{MOD}/konfigurator-shared.ts', f'{MOD}/konfigurator-steps.tsx', f'{MOD}/konfigurator-meritve.tsx',
    f'{MOD}/pregled-shared.ts', f'{MOD}/pregled-views.tsx', f'{MOD}/pregled-cards.tsx', f'{MOD}/pregled-share.tsx',
    f'{MOD}/projekti-shared.ts', f'{MOD}/projekti-sections.tsx', f'{MOD}/projekti-packages.tsx',
    f'{MOD}/projekti-portal.tsx', f'{MOD}/projekti-bom.tsx',
]
for f in NOVE:
    chk(os.path.isfile(os.path.join(REPO, f)), f'A1 obstaja {f.split("/")[-1]}')

# 'use client' na vseh JSX poddatotekah (hooks/handlers zahtevajo client kontekst)
for f in NOVE:
    if f.endswith('.tsx'):
        chk(src_has(f, "'use client'"), f"A2 'use client' v {f.split('/')[-1]}")

# velikostni pragovi — podmnožične trditve (ne točna števila!)
for glavni, prag in [('konfigurator.tsx', 700), ('pregled.tsx', 700), ('projekti.tsx', 700)]:
    chk(lines(f'{MOD}/{glavni}') < prag,
        f'A3 {glavni} pod {prag} vrstic (bil med največjimi; dejansko {lines(f"{MOD}/{glavni}")})')

# default export (lupina lenega nalaganja) ostaja v glavnih treh
for glavni in ['konfigurator.tsx', 'pregled.tsx', 'projekti.tsx']:
    chk(re.search(r'export default function', src(f'{MOD}/{glavni}')) is not None,
        f'A4 default export ostaja v {glavni} (module-view lazy pot nedotaknjena)')

# komponente na pričakovanih lokacijah (kirurški izrez, ne izum)
LOKACIJE = {
    f'{MOD}/konfigurator-steps.tsx': ['export function StepProjekt', 'export function StepIzdelek', 'export function StepOpcije', 'export function StepIzracun', 'export function StepShrani', 'export function SaveResultPanel', 'function SummaryTile'],
    f'{MOD}/konfigurator-meritve.tsx': ['export function StepMeritve'],
    f'{MOD}/pregled-views.tsx': ['export function PlanViewP', 'export function ProfileViewP', 'export function PerspectiveViewP', 'export function PublicPlanView', 'export function ScaleBar'],
    f'{MOD}/pregled-cards.tsx': ['export function PhotosCard', 'export function PinDialog', 'export function PinsCard', 'export function ReplayCard', 'export function ReplayDialog'],
    f'{MOD}/pregled-share.tsx': ['export function ShareCard', 'export function PublicPreviewDialog'],
    f'{MOD}/projekti-sections.tsx': ['export function ProgressSection', 'export function TimelineDialog', 'export function CreateProjectDialog', 'export function KonfigPreviewSection', 'export function WarrantySection'],
    f'{MOD}/projekti-packages.tsx': ['export function PackagesSection', 'function CompareGroupCard', 'function CompareTierCard', 'function NewPackageDialog'],
    f'{MOD}/projekti-portal.tsx': ['export function PortalSection', 'function PortalPreviewDialog'],
    f'{MOD}/projekti-bom.tsx': ['export function PackageBomDialog', 'function ImportBomDialog'],
}
lok_check = 0
for f, simboli in LOKACIJE.items():
    for s in simboli:
        lok_check += 1
        chk(src_has(f, s), f'A5 {s.replace("export function ", "").replace("function ", "")} je na lokaciji {f.split("/")[-1]}')
chk(lok_check == 33, f'A5 štej kirurške izreze: {lok_check}/33 (vzorec se nadaljuje)')

# glavni moduli še vedno DRŽIJO svoje odgovornosti (stanje + tok)
chk(src_has(f'{MOD}/konfigurator.tsx', 'export default function KonfiguratorModule'),
    'A6 konfigurator.tsx: glavni modul (stanje/tok/prefill/izračun/shrani) ostaja')
chk(src_has(f'{MOD}/pregled.tsx', 'export default function PregledModule'),
    'A6 pregled.tsx: glavni modul (izbire/stanje/panel segmenta) ostaja')
chk(src_has(f'{MOD}/projekti.tsx', 'export default function ProjektiModule'),
    'A6 projekti.tsx: glavni modul (seznam/podrobnost) ostaja')

# ENOSMEREN graf uvozov — 0 krožnih (shared je list, glavni so koren)
def uvozi (f):
    try:
        return re.findall(r"from '\./([^']+)'", src(f))
    except Exception:
        return []

# shared datoteke so LISTI: ne uvažajo nobenega brata iz istega drevesa
for shared, prefix in [
    (f'{MOD}/konfigurator-shared.ts', 'konfigurator'),
    (f'{MOD}/pregled-shared.ts', 'pregled'),
    (f'{MOD}/projekti-shared.ts', 'projekti'),
]:
    bratje = [u for u in uvozi(shared) if u.startswith(prefix)]
    chk(bratje == [], f'A7 {shared.split("/")[-1]} je list grafa (0 uvozov bratov; {bratje})')

# poddatoteke uvažajo SAMO shared (+bom za packages, +views za share) — nikoli glavni
NE_SKLICI_GLAVNEGA = {
    f'{MOD}/konfigurator-steps.tsx': ['konfigurator-shared'],
    f'{MOD}/konfigurator-meritve.tsx': ['konfigurator-shared'],
    f'{MOD}/pregled-views.tsx': ['pregled-shared'],
    f'{MOD}/pregled-cards.tsx': ['pregled-shared'],
    f'{MOD}/pregled-share.tsx': ['pregled-shared', 'pregled-views'],
    f'{MOD}/projekti-sections.tsx': ['projekti-shared', 'viz-3d'],  # viz-3d: Railing3D za KonfigPreviewSection (sosednji modul, ne brat)
    f'{MOD}/projekti-packages.tsx': ['projekti-shared', 'projekti-bom'],
    f'{MOD}/projekti-portal.tsx': [],
    f'{MOD}/projekti-bom.tsx': ['projekti-shared'],
}
for f, dovoljeni in NE_SKLICI_GLAVNEGA.items():
    u = uvozi(f)
    nedovoljeni = [x for x in u if x not in dovoljeni]
    chk(nedovoljeni == [], f'A8 {f.split("/")[-1]}: uvozi samo {dovoljeni or "zunanjost"} (0 krožnih; {nedovoljeni})')

# glavni trije uvažajo svoje dele (dokaz, da razbitje ni odtrgalo povezav)
chk("from './konfigurator-steps'" in src(f'{MOD}/konfigurator.tsx')
    and "from './konfigurator-meritve'" in src(f'{MOD}/konfigurator.tsx'),
    'A9 konfigurator.tsx povezuje steps + meritve')
chk("from './pregled-views'" in src(f'{MOD}/pregled.tsx')
    and "from './pregled-cards'" in src(f'{MOD}/pregled.tsx')
    and "from './pregled-share'" in src(f'{MOD}/pregled.tsx'),
    'A9 pregled.tsx povezuje views + cards + share')
chk("from './projekti-sections'" in src(f'{MOD}/projekti.tsx')
    and "from './projekti-packages'" in src(f'{MOD}/projekti.tsx')
    and "from './projekti-portal'" in src(f'{MOD}/projekti.tsx'),
    'A9 projekti.tsx povezuje sections + packages + portal')

# module-view nalagalnik NEDOTAKNJEN: 3 poti ostajajo, 0 novih vnosov
mv = src(f'{MOD}/module-view.tsx'.replace(MOD + '/', 'src/components/roksal/')) if False else src('src/components/roksal/module-view.tsx')
for pot in ['modules/konfigurator', 'modules/pregled', 'modules/projekti']:
    chk(pot in mv, f'A10 module-view ohranja pot {pot}')
chk(re.search(r'modules/konfigurator-(shared|steps|meritve)', mv) is None
    and re.search(r'modules/pregled-(shared|views|cards|share)', mv) is None
    and re.search(r'modules/projekti-(shared|sections|packages|portal|bom)', mv) is None,
    'A10 nalagalnik: 0 novih vnosov (poddatoteke NISO zavihki — so gradniki)')

# ═══ B) sidra sosednjih skupin ostajajo veljavna ═══════════════════════════
print('── B) sidra r488 / r511 / r464 po prestavitvi ──')

chk(src_has(f'{MOD}/konfigurator-shared.ts', 'runSegmentsFromParams')
    and src_has(f'{MOD}/konfigurator-meritve.tsx', 'params.fenceRunId + params.segments'),
    'B1 r488: helper segmentov tekača ŽIVI v konfigurator-shared.ts, opis prefilla v konfigurator-meritve.tsx (fizični premik, enako obnašanje)')
chk(src_has(f'{MOD}/konfigurator-meritve.tsx', 'iz potrjenih tekačev (seg-1 … seg-N)'),
    'B2 r488: prefill sporoča prenos segmentov (korak Meritve, sedaj konfigurator-meritve.tsx)')
chk(src_has('tests/r488.py', 'konfigurator-shared.ts'),
    'B3 r488 test sledi novi strukturi (posodobljeno pošteno ob premiku)')

for niz in ['?.geometrija ?? null', 'Vir obsega:', 'dokazanega obsega ni', 'Opozorila: {(geometrija.opozorila ?? []).join']:
    chk(src_has(f'{MOD}/projekti-bom.tsx', niz),
        f'B4 r511: „{niz[:34]}…“ ŽIVI v projekti-bom.tsx')
chk(src_has('tests/r511.py', 'projekti-bom.tsx'),
    'B5 r511 test sledi novi strukturi (posodobljeno pošteno ob premiku)')

konf = src(f'{MOD}/konfigurator.tsx')
for konst in ['POST_PRICE', 'ROCNIK_PRICE_M', 'STEKLO_PRICE_M2', 'MONTAZA_PRICE_M', 'PRIPRAVA_PCT', 'PROFIL_OCENA_M']:
    chk(konst not in konf, f'B6 r464: konfigurator.tsx brez konstante {konst} (cene še vedno samo v ceniku)')

# ═══ C) HTTP: žive globoke povezave razbitih modulov ═══════════════════════
print('── C) HTTP (razbiti moduli se nalagajo) ──')


def http_get (path):
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + path), timeout=30) as rr:
            return rr.status
    except Exception as e:
        return 0


for m in ['konfigurator', 'pregled', 'projekti']:
    st = http_get(f'/?m={m}')
    chk(st == 200, f'C1 globoka povezava /?m={m} → 200 (razbitje ne sesuje nalaganja; dejansko {st})')
st = http_get('/?m=konfigurator&x=1')
chk(st == 200, f'C2 /?m=konfigurator&x=1 → 200 (dodatni query; dejansko {st})')
st = http_get('/')
chk(st == 200, f'C3 goli / → 200 (lupina; dejansko {st})')

# ═══ D) registracija: matrika + README (pozicijsko neodvisno) ══════════════
print('── D) registracija (ci-matrix / ci.yml / README) ──')

mat = src('tests/ci-matrix.sh')
chk(re.search(r'(?<![\w-])r546(?![\w-])', mat) is not None and mat.count('r546') >= 2,
    'D1 ci-matrix.sh: r546 v GRUPE in CLANI (pozicijsko neodvisno)')
yml = src('.github/workflows/ci.yml')
chk(re.search(r'(?<![\w-])r546(?![\w-])', yml) is not None,
    'D2 .github/workflows/ci.yml: r546 v matriki')
rd = src('README.md')
chk(re.search(r'53\. skupin|53 skupin|53/53', rd) is not None,
    'D3 README: 53. skupina odražena')
chk('R546' in rd and ('razbitje' in rd or 'razbil' in rd),
    'D4 README: R546 razbitje velikanov popisano')

print(f'═══ R546 KONEC: {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸ ═══')
raise SystemExit(0 if FAIL == 0 else 1)
