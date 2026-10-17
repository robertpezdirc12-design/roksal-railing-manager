#!/usr/bin/env python3
# r548 — RAZBITJE NASLEDNJE VRSTE: katalog (1099), danes (1096), viz (1061), nalogi (1057)
#
# Tretji krog recepta R546/R547 (kirurški refactoring BREZ spremembe obnašanja;
# 0 odvisnosti, 0 DB sprememb):
#   katalog → shared + izdelki + ceniki + gradiva          [1099 → 43]
#   danes   → shared + detail + sekcije + vreme            [1096 → 207]
#   viz     → shared + risanje                             [1061 → 731]
#   nalogi  → shared + detail + offline + create           [1057 → 304]
#
# Posebnosti:
#   - viz main ostane ~731 (prag <760): stanjski del konfiguratorja je koheziven
#     (closures nad ~15 stanji); kirurško izrezano risalno jedro (computeGeometry/
#     RailingSvg + pomočniki) in skupni tipi — nadaljnja delitev bi zahtevala
#     hook-ekstrakcijo, ki NI bajtno-identična (disciplina recepta).
#   - danes-detail je podkoren (sestavlja sekcije + kamera dialog);
#     PlaybookStrip živi v detail (ne v karticah) — sicer bi nastal krog
#     kartice → detail → kartice.
#   - viz-risanje uvaža './viz-3d' (fmtM) — legitimna zunanja odvisnost soseda
#     (isti vzorec kot projekti-sections → viz-3d v R546).
#
# Sidra sosednjih skupin so sledila fizičnim premikom POŠTENO:
#   r486 (danes blok → danes-detail.tsx)
#   r493/r494/r495/r516 (katalog družina → gradiva/izdelki/ceniki;
#     negativna trditev 'samodejn' velja za VSE datoteke družine)
#   r464-pricing OSTAJA na viz.tsx in JE preživel razbitje
#     ('/api/price-lists/calculate' je še vedno v viz.tsx — izrez ni smel
#     odnesti strežniškega klica cenika)
#
# Preverjanja:
#   A) statično: 14 novih datotek, 'use client', pragovi, komponente na
#      lokacijah, enosmerni aciklični graf, module-view NEDOTAKNJEN
#   B) sidra po premiku + brez podvojenih definicij + r464-preživetje
#   C) HTTP: globoke povezave vseh štirih modulov + goli /
#   D) registracija: ci-matrix + ci.yml + README (pozicijsko neodvisno)
#
# Zagon: python3 tests/r548.py  (ali bash tests/ci-matrix.sh r548)

import os
import re
import urllib.request

PASS, FAIL, SKIP = 0, 0, 0
TAG = 'R548'
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
    f'{MOD}/katalog-shared.ts', f'{MOD}/katalog-izdelki.tsx', f'{MOD}/katalog-ceniki.tsx', f'{MOD}/katalog-gradiva.tsx',
    f'{MOD}/danes-shared.ts', f'{MOD}/danes-detail.tsx', f'{MOD}/danes-sekcije.tsx', f'{MOD}/danes-vreme.tsx',
    f'{MOD}/viz-shared.ts', f'{MOD}/viz-risanje.tsx',
    f'{MOD}/nalogi-shared.tsx', f'{MOD}/nalogi-detail.tsx', f'{MOD}/nalogi-offline.tsx', f'{MOD}/nalogi-create.tsx',
]
for f in NOVE:
    chk(os.path.isfile(os.path.join(REPO, f)), f'A1 obstaja {f.split("/")[-1]}')

# 'use client' na vseh JSX poddatotekah (shared .ts ostajajo čisti; nalogi-shared
# je .tsx z JSX — MeasurementTypeBadge ima več potrošnikov, vzorec ogradnja-shared)
for f in NOVE:
    if f.endswith('.tsx'):
        chk(src_has(f, "'use client'"), f"A2 'use client' v {f.split('/')[-1]}")

# velikostni pragovi — vse nove pod 700; lupine po vrsti (viz <760 je ZAVEDNA
# izjema: koheziven stanjski del, kirurški izrez risalnega jedra + skupnih tipov)
for f in NOVE:
    chk(lines(f) < 700, f'A3 {f.split("/")[-1]} pod 700 (dejansko {lines(f)})')
for glavni, prag in [('katalog.tsx', 200), ('danes.tsx', 300), ('viz.tsx', 760), ('nalogi.tsx', 400)]:
    chk(lines(f'{MOD}/{glavni}') < prag,
        f'A3 {glavni} tanka lupina pod {prag} (dejansko {lines(f"{MOD}/{glavni}")})')

# default export (lupina lenega nalaganja) ostaja v glavnih štirih
for glavni in ['katalog.tsx', 'danes.tsx', 'viz.tsx', 'nalogi.tsx']:
    chk(re.search(r'export default function', src(f'{MOD}/{glavni}')) is not None,
        f'A4 default export ostaja v {glavni} (module-view lazy pot nedotaknjena)')

# komponente na pričakovanih lokacijah (kirurški izrez, ne izum)
LOKACIJE = {
    f'{MOD}/katalog-shared.ts': [
        'export interface FamilyRow', 'export interface VariantRow', 'export interface ComponentRow',
        'export interface ProductRow', 'export interface ProductDetail', 'export interface BomPlanLine',
        'export interface BomPlan', 'export interface PriceRuleRow', 'export interface PriceListRow',
        'export const KONFIG_RULE_LABELS', 'export const konfigLabel', 'export const FAMILY_LABELS',
        'export function familyLabel',
    ],
    f'{MOD}/katalog-izdelki.tsx': ['export function ProductsTab', 'export function ProductDialog', 'function MiniStat'],
    f'{MOD}/katalog-ceniki.tsx': [
        'export const PL_TYPE_LABELS', 'export function PriceListsTab',
        'export interface CenikImportResult', 'function ImportCenikDialog', 'function EditRuleDialog',
    ],
    f'{MOD}/katalog-gradiva.tsx': [
        'export interface AssetRow', 'export const ASSET_KIND_LABEL', 'export const STATUS_BADGE',
        'export function ProductAssetsSection',
    ],
    f'{MOD}/danes-shared.ts': [
        'export interface WorkOrderRow', 'export interface WorkOrderDetailRow', 'export interface ChecklistRow',
        'export interface UsageRow', 'export interface StockRow', 'export interface WeatherDay',
        'export const FAZE', 'export function phaseIndex', 'export const NEXT_ACTION',
    ],
    f'{MOD}/danes-detail.tsx': [
        'export interface PlaybookRunRow', 'export function PlaybookStrip', 'export function WorkOrderDetail',
        'export function Stepper7', 'export function PhaseHint',
    ],
    f'{MOD}/danes-sekcije.tsx': [
        'export function ChecklistSection', 'export function MaterialSection',
        'export function TroubleSection', 'export function PredajaReport',
    ],
    f'{MOD}/danes-vreme.tsx': [
        'export const W_ICONS', 'export const DAY_NAMES', 'export function scoreLabel', 'export function WeatherCard',
    ],
    f'{MOD}/viz-shared.ts': [
        'export interface ProfileRow', 'export interface ProjectRow', 'export interface MeasurementRow',
        'export interface VizRow', 'export const toNum',
        'export interface CenaPostavka', 'export interface CenaRezultat',
    ],
    f'{MOD}/viz-risanje.tsx': [
        'export interface RailingSvgProps', 'export function RailingSvg', 'export interface Geo',
        'export function computeGeometry', 'export function PlanView', 'export function GridLines',
        'export function DimLine', 'export function DimLineV',
    ],
    f'{MOD}/nalogi-shared.tsx': [
        'export interface WorkOrderRow', 'export interface WorkOrderDetail', 'export interface HistoryRow',
        'export const SCOPES', 'export const STATUSES', 'export const TRANSITIONS', 'export const EVENT_META',
        'export const fmtM', 'export const MEASUREMENT_TYPES', 'export function MeasurementTypeBadge',
    ],
    f'{MOD}/nalogi-detail.tsx': ['export function QaSummarySection', 'export function rowToDetail', 'export function NalogDetail'],
    f'{MOD}/nalogi-offline.tsx': ['export function OfflineActionsSection'],
    f'{MOD}/nalogi-create.tsx': ['export function CreateNalogDialog'],
}
lok_check = 0
for f, simboli in LOKACIJE.items():
    for s in simboli:
        lok_check += 1
        chk(src_has(f, s), f'A5 {s.replace("export ", "").replace("function ", "").replace("interface ", "").replace("const ", "")} je na lokaciji {f.split("/")[-1]}')
chk(lok_check == 77, f'A5 štej kirurške izreze: {lok_check}/77 (vzorec se nadaljuje)')

# glavni moduli še vedno DRŽIJO svoje odgovornosti
chk(src_has(f'{MOD}/katalog.tsx', 'export default function KatalogModule'), 'A6 katalog.tsx: lupina z zavihki ostaja')
chk(src_has(f'{MOD}/danes.tsx', 'export default function DanesModule'), 'A6 danes.tsx: statika dneva + kartice ostajajo')
chk(src_has(f'{MOD}/viz.tsx', 'export default function VizModule'), 'A6 viz.tsx: stanjski del konfiguratorja ostaja')
chk(src_has(f'{MOD}/nalogi.tsx', 'export default function NalogiModule'), 'A6 nalogi.tsx: filtri/seznam/razširitve ostajajo')

# ENOSMEREN aciklični graf uvozov
def uvozi (f):
    try:
        return re.findall(r"from '\./([^']+)'", src(f))
    except Exception:
        return []

# shared datoteke so LISTI: ne uvažajo nobenega brata iz istega drevesa
for shared, prefix in [
    (f'{MOD}/katalog-shared.ts', 'katalog'),
    (f'{MOD}/danes-shared.ts', 'danes'),
    (f'{MOD}/viz-shared.ts', 'viz'),
    (f'{MOD}/nalogi-shared.tsx', 'nalogi'),
]:
    bratje = [u for u in uvozi(shared) if u.startswith(prefix)]
    chk(bratje == [], f'A7 {shared.split("/")[-1]} je list grafa (0 uvozov bratov; {bratje})')

# poddatoteke uvažajo SAMO dovoljene brate — nikoli glavni, nikoli nazaj
NE_SKLICI_GLAVNEGA = {
    f'{MOD}/katalog-izdelki.tsx': ['katalog-shared', 'katalog-gradiva'],
    f'{MOD}/katalog-ceniki.tsx': ['katalog-shared'],
    f'{MOD}/katalog-gradiva.tsx': [],
    f'{MOD}/danes-detail.tsx': ['danes-shared', 'danes-sekcije'],
    f'{MOD}/danes-sekcije.tsx': ['danes-shared'],
    f'{MOD}/danes-vreme.tsx': ['danes-shared'],
    # viz-3d: legitimna zunanja odvisnost soseda (fmtM) — vzorec projekti-sections iz R546
    f'{MOD}/viz-risanje.tsx': ['viz-3d'],
    f'{MOD}/nalogi-detail.tsx': ['nalogi-shared', 'nalogi-offline'],
    f'{MOD}/nalogi-offline.tsx': ['nalogi-shared'],
    f'{MOD}/nalogi-create.tsx': [],
}
for f, dovoljeni in NE_SKLICI_GLAVNEGA.items():
    u = uvozi(f)
    nedovoljeni = [x for x in u if x not in dovoljeni]
    chk(nedovoljeni == [], f'A8 {f.split("/")[-1]}: uvozi samo {dovoljeni or "zunanjost"} (0 krožnih; {nedovoljeni})')

# glavni štirje povezujejo svoje dele (dokaz, da razbitje ni odtrgalo povezav)
chk("from './katalog-izdelki'" in src(f'{MOD}/katalog.tsx') and "from './katalog-ceniki'" in src(f'{MOD}/katalog.tsx'),
    'A9 katalog.tsx povezuje izdelki + ceniki')
chk("from './danes-detail'" in src(f'{MOD}/danes.tsx') and "from './danes-vreme'" in src(f'{MOD}/danes.tsx'),
    'A9 danes.tsx povezuje detail + vreme (detail naprej sestavi sekcije)')
chk("from './viz-risanje'" in src(f'{MOD}/viz.tsx') and "from './viz-shared'" in src(f'{MOD}/viz.tsx'),
    'A9 viz.tsx povezuje risanje + shared (nad viz-3d sosedom)')
chk("from './nalogi-detail'" in src(f'{MOD}/nalogi.tsx') and "from './nalogi-create'" in src(f'{MOD}/nalogi.tsx'),
    'A9 nalogi.tsx povezuje detail + create')

# module-view nalagalnik NEDOTAKNJEN: 4 poti ostajajo, 0 novih vnosov
mv = src('src/components/roksal/module-view.tsx')
for pot in ['modules/katalog', 'modules/danes', 'modules/viz', 'modules/nalogi']:
    chk(pot in mv, f'A10 module-view ohranja pot {pot}')
chk(re.search(r'modules/katalog-(shared|izdelki|ceniki|gradiva)', mv) is None
    and re.search(r'modules/danes-(shared|detail|sekcije|vreme)', mv) is None
    and re.search(r'modules/viz-(shared|risanje)', mv) is None
    and re.search(r'modules/nalogi-(shared|detail|offline|create)', mv) is None,
    'A10 nalagalnik: 0 novih vnosov (poddatoteke NISO zavihki — so gradniki)')

# ═══ B) sidra po premiku; brez podvojenih definicij; r464-preživetje ════════
print('── B) sidra r486/r493/r494/r495/r516 po prestavitvi; r464 preživetje ──')

# r486: cel danes blok (ZAČNI MERITEV tok) živi v danes-detail.tsx
for niz in ['ZAČNI MERITEV', 'Nadaljuj nedokončano', 'Dodaj fotografijo', 'KameraMeritevDialog', 'setMeasureCtx', 'initialWorkOrderId']:
    chk(src_has(f'{MOD}/danes-detail.tsx', niz), f'B1 r486: „{niz}" ŽIVI v danes-detail.tsx (fizični premik)')
chk(src_has('tests/r486.py', 'danes-detail.tsx'), 'B1 r486 test sledi novi strukturi (posodobljeno pošteno)')
chk(not src_has(f'{MOD}/danes.tsx', 'function WorkOrderDetail') and not src_has(f'{MOD}/danes.tsx', 'setMeasureCtx'),
    'B2 r486: danes.tsx (lupina) brez WorkOrderDetail/setMeasureCtx (ni podvojitev)')

# katalog družina: sidra živijo v novih datotekah, testi sledijo
for niz in ['Produktna gradiva', 'VLM ocena, ni uradno ime', 'Uradna barvna lestvica', 'Imena odtenkov', 'object-contain', 'Golden teak in White', '(potrjena)']:
    chk(src_has(f'{MOD}/katalog-gradiva.tsx', niz), f'B3 katalog: „{niz[:30]}" ŽIVI v katalog-gradiva.tsx')
chk(src_has(f'{MOD}/katalog-izdelki.tsx', 'približek'), 'B3 katalog: „približek" ŽIVI v katalog-izdelki.tsx (opomba variant)')
for niz in ['/api/import/cenik', 'Uvozi cenik', 'Uredi pravilo']:
    chk(src_has(f'{MOD}/katalog-ceniki.tsx', niz), f'B4 katalog: „{niz}" ŽIVI v katalog-ceniki.tsx')
chk(src_has('tests/r493.py', 'katalog-gradiva.tsx') and src_has('tests/r494.py', 'katalog-gradiva.tsx')
    and src_has('tests/r516.py', 'katalog-ceniki.tsx'),
    'B5 testi r493/r494/r516 sledijo novi strukturi (posodobljeno pošteno)')
chk(src_has('tests/r495.py', 'KATALOG_DRUZINA'), 'B5 r495: negativna trditev razširjena na VSO družino (5 datotek)')
chk(not src_has(f'{MOD}/katalog.tsx', 'Produktna gradiva') and not src_has(f'{MOD}/katalog.tsx', 'Uvozi cenik'),
    'B6 katalog.tsx (lupina) brez gradiv/uzvoza (ni podvojitev)')

# r464-pricing: sidro na viz.tsx JE PREŽIVELO razbitje (strežniški klic ostaja v main)
chk(src_has(f'{MOD}/viz.tsx', '/api/price-lists/calculate'),
    'B7 r464: „/api/price-lists/calculate" JE ŠE VEDNO v viz.tsx (razbitje ni odneslo strežniškega klica)')
for fam in [f'{MOD}/viz.tsx', f'{MOD}/viz-shared.ts', f'{MOD}/viz-risanje.tsx']:
    chk('izracunajCeno' not in src(fam), f'B7 r464: {fam.split("/")[-1]} BREZ izracunajCeno (cene so strežniške)')
    chk('35 €/m' not in src(fam), f'B7 r464: {fam.split("/")[-1]} brez hardcoded montažne cene')
for konst in ['POST_PRICE', 'ROCNIK_PRICE_M', 'STEKLO_PRICE_M2', 'MONTAZA_PRICE_M', 'PRIPRAVA_PCT', 'PROFIL_OCENA_M']:
    vse = src(f'{MOD}/viz.tsx') + src(f'{MOD}/viz-shared.ts') + src(f'{MOD}/viz-risanje.tsx')
    chk(konst not in vse, f'B7 r464: viz družina brez konstante {konst} (cene živijo samo v ceniku)')

# ═══ C) HTTP: žive globoke povezave razbitih modulov ═══════════════════════
print('── C) HTTP (razbiti moduli se nalagajo) ──')


def http_get (path):
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + path), timeout=30) as rr:
            return rr.status
    except Exception:
        return 0


for m in ['katalog', 'danes', 'viz', 'nalogi']:
    st = http_get(f'/?m={m}')
    chk(st == 200, f'C1 globoka povezava /?m={m} → 200 (razbitje ne sesuje nalaganja; dejansko {st})')
st = http_get('/?m=viz&x=1')
chk(st == 200, f'C2 /?m=viz&x=1 → 200 (dodatni query; dejansko {st})')
st = http_get('/')
chk(st == 200, f'C3 goli / → 200 (lupina; dejansko {st})')

# ═══ D) registracija: matrika + README (pozicijsko neodvisno) ══════════════
print('── D) registracija (ci-matrix / ci.yml / README) ──')

mat = src('tests/ci-matrix.sh')
chk(re.search(r'(?<![\w-])r548(?![\w-])', mat) is not None and mat.count('r548') >= 2,
    'D1 ci-matrix.sh: r548 v GRUPE in CLANI (pozicijsko neodvisno)')
yml = src('.github/workflows/ci.yml')
chk(re.search(r'(?<![\w-])r548(?![\w-])', yml) is not None, 'D2 .github/workflows/ci.yml: r548 v matriki')
rd = src('README.md')
chk(re.search(r'55\. skupin|55 skupin|55/55', rd) is not None, 'D3 README: 55. skupina odražena')
chk('R548' in rd and ('razbitje' in rd or 'razbil' in rd), 'D4 README: R548 razbitje naslednje vrste popisano')

print(f'═══ R548 KONEC: {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸ ═══')
raise SystemExit(0 if FAIL == 0 else 1)
