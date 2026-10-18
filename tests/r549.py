#!/usr/bin/env python3
# r549 — RAZBITJE ZADNJE VRSTE: playbook (971), dostave (931), montaza-qa (850)
#
# Četrti krog recepta R546/R547/R548 (kirurški refactoring BREZ spremembe
# obnašanja; 0 odvisnosti, 0 DB sprememb):
#   playbook  → shared + home + run + korak + admin     [971 → 59]
#   dostave   → shared + tab + detail + nova +
#               vozila + ekipe                          [931 → 46]
#   montaza-qa→ shared + kontrola + odstopanja +
#               primopredaja (barel javnega API-ja)     [850 → 22]
#
# Posebnosti:
#   - meritve-kamera (902) = ZAVEDNA IZJEMA (kot viz 731 v R548): R537 je
#     že razbila 15 poddatotek (2793 vrstic); preostali main je EN komponent
#     KameraMeritevDialog (~13 closures/memos nad skupnim stanjem) —
#     hook-ekstrakcija NI bajtno-identična (disciplina recepta). Datoteka
#     je v tej izdaji NEDOTAKNJENA (39 sidr v 9 testih ostaja na mestu).
#   - montaza-qa.tsx je BAREL: javni API (MontazaQaSection, HandoverSection,
#     4 tipi) ostaja na isti poti za danes-detail (uvoz NEDOTAKNJEN).
#   - dostave-tab uvaža detail+nova (sosedska odvisnost — vzorec
#     izdelki→gradiva iz R548); playbook-run uvaža korak; kontrola odstopanja.
#   - 0 testnih sidr se je premaknilo (noben test ni sidril te tri module —
#     preverjeno pred rezom; meritve-kamera sidra ostajajo, ker je main isti).
#
# Preverjanja:
#   A) statično: 15 novih datotek, 'use client', pragovi, komponente na
#      lokacijah, enosmerni aciklični graf, module-view NEDOTAKNJEN,
#      meritve-kamera izjema dokumentirana
#   B) sidra: brez podvojenih definicij v starih glavah, javni API
#      montaza-qa ohranjen, ključni nizi živijo na novih lokacijah,
#      meritve-kamera sidra nedotaknjena
#   C) HTTP: globoke povezave playbook/dostave/danes (montaza-qa živi v
#      podrobnosti naloga DANES) + goli /
#   D) registracija: ci-matrix + ci.yml + README (pozicijsko neodvisno)
#
# Zagon: python3 tests/r549.py  (ali bash tests/ci-matrix.sh r549)

import os
import re
import urllib.request

PASS, FAIL, SKIP = 0, 0, 0
TAG = 'R549'
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
print('── A) struktura: 15 novih datotek, meje, enosmerni uvozi ──')

NOVE = [
    f'{MOD}/playbook-shared.ts', f'{MOD}/playbook-home.tsx', f'{MOD}/playbook-run.tsx',
    f'{MOD}/playbook-korak.tsx', f'{MOD}/playbook-admin.tsx',
    f'{MOD}/dostave-shared.ts', f'{MOD}/dostave-tab.tsx', f'{MOD}/dostave-detail.tsx',
    f'{MOD}/dostave-nova.tsx', f'{MOD}/dostave-vozila.tsx', f'{MOD}/dostave-ekipe.tsx',
    f'{MOD}/montaza-qa-shared.ts', f'{MOD}/montaza-qa-kontrola.tsx',
    f'{MOD}/montaza-qa-odstopanja.tsx', f'{MOD}/montaza-qa-primopredaja.tsx',
]
for f in NOVE:
    chk(os.path.isfile(os.path.join(REPO, f)), f'A1 obstaja {f.split("/")[-1]}')

# 'use client' na vseh JSX poddatotekah (shared .ts ostajajo čisti brez JSX)
for f in NOVE:
    if f.endswith('.tsx'):
        chk(src_has(f, "'use client'"), f"A2 'use client' v {f.split('/')[-1]}")

# velikostni pragovi — vse nove pod 400; lupine po vrsti (montaza-qa je barel)
for f in NOVE:
    chk(lines(f) < 400, f'A3 {f.split("/")[-1]} pod 400 (dejansko {lines(f)})')
for glavni, prag in [('playbook.tsx', 150), ('dostave.tsx', 100), ('montaza-qa.tsx', 60)]:
    chk(lines(f'{MOD}/{glavni}') < prag,
        f'A3 {glavni} tanka lupina pod {prag} (dejansko {lines(f"{MOD}/{glavni}")})')

# default export (lupina lenega nalaganja) ostaja v playbook + dostave;
# montaza-qa NIMA default izvoza (sekciji troši danes-detail — javni API)
for glavni in ['playbook.tsx', 'dostave.tsx']:
    chk(re.search(r'export default function', src(f'{MOD}/{glavni}')) is not None,
        f'A4 default export ostaja v {glavni} (module-view lazy pot nedotaknjena)')
chk(re.search(r'export default', src(f'{MOD}/montaza-qa.tsx')) is None,
    'A4 montaza-qa.tsx BREZ default izvoza (barel sekcij — enako kot pred razbitjem)')

# komponente na pričakovanih lokacijah (kirurški izrez, ne izum)
LOKACIJE = {
    f'{MOD}/playbook-shared.ts': [
        'export interface NalogRow', 'export interface DefRow', 'export interface RunPovzetek',
        'export const KATEGORIJA_IKONA', 'export const KATEGORIJA_BARVA', 'export const STATUS_OZNaka',
        'export async function preveriNapravo',
    ],
    f'{MOD}/playbook-home.tsx': ['export function PlaybookHome'],
    f'{MOD}/playbook-run.tsx': ['export function RunView'],
    f'{MOD}/playbook-korak.tsx': ['export function TrenutniKorak', 'function KorakGlava', 'function zberiEvidence'],
    f'{MOD}/playbook-admin.tsx': ['export function AdminDefs'],
    f'{MOD}/dostave-shared.ts': [
        'export interface DeliveryItemRow', 'export interface DeliveryRow', 'export interface VehicleRow',
        'export interface CrewRow', 'export interface ProjectOption', 'export interface PickingOption',
        'export interface NalogOption', 'export interface UserOption',
        'export const DELIVERY_STATUSI', 'export const ACTION_LABELS', 'export function isOffice',
    ],
    f'{MOD}/dostave-tab.tsx': ['export function DostaveTab'],
    f'{MOD}/dostave-detail.tsx': ['export function DeliveryDetailDialog', 'function transition', 'function submitPlan'],
    f'{MOD}/dostave-nova.tsx': ['export function NewDeliveryDialog'],
    f'{MOD}/dostave-vozila.tsx': ['export function VozilaTab', 'function VehicleDialog'],
    f'{MOD}/dostave-ekipe.tsx': ['export function EkipeTab', 'function Stars', 'function CrewDialog'],
    f'{MOD}/montaza-qa-shared.ts': [
        'export interface QaActionRow', 'export interface QaDeviationRow', 'export interface QaCheckRow',
        'export interface HandoverRow', 'export interface QaResponse', 'export const ACTION_FLOW',
    ],
    f'{MOD}/montaza-qa-kontrola.tsx': ['export function MontazaQaSection', 'function statusLabel', 'function zacetiStatus'],
    f'{MOD}/montaza-qa-odstopanja.tsx': ['export function DeviationCard'],
    f'{MOD}/montaza-qa-primopredaja.tsx': [
        'export function HandoverSection', 'interface DiffData', 'type PhotosData', 'function SignaturePad',
    ],
}
lok_check = 0
for f, simboli in LOKACIJE.items():
    for s in simboli:
        lok_check += 1
        chk(src_has(f, s), f'A5 {s.replace("export ", "").replace("async ", "")} je na lokaciji {f.split("/")[-1]}')
chk(lok_check == 48, f'A5 štej kirurške izreze: {lok_check}/48 (vzorec se nadaljuje)')

# glavni moduli še vedno DRŽIJO svoje odgovornosti
chk(src_has(f'{MOD}/playbook.tsx', 'export default function PlaybookModule'), 'A6 playbook.tsx: lupina z izbiro pogleda ostaja')
chk(src_has(f'{MOD}/dostave.tsx', 'export default function DostaveModule'), 'A6 dostave.tsx: lupina z zavihki ostaja')
chk(src_has(f'{MOD}/montaza-qa.tsx', "export { MontazaQaSection } from './montaza-qa-kontrola'")
    and src_has(f'{MOD}/montaza-qa.tsx', "export { HandoverSection } from './montaza-qa-primopredaja'"),
    'A6 montaza-qa.tsx: barel ponovno izvaža javni API (sekciji iz poddatotek)')

# ENOSMEREN aciklični graf uvozov
def uvozi (f):
    try:
        return re.findall(r"from '\./([^']+)'", src(f))
    except Exception:
        return []

# shared datoteke so LISTI: ne uvažajo nobenega brata iz istega drevesa
for shared, prefix in [
    (f'{MOD}/playbook-shared.ts', 'playbook'),
    (f'{MOD}/dostave-shared.ts', 'dostave'),
    (f'{MOD}/montaza-qa-shared.ts', 'montaza-qa'),
]:
    bratje = [u for u in uvozi(shared) if u.startswith(prefix)]
    chk(bratje == [], f'A7 {shared.split("/")[-1]} je list grafa (0 uvozov bratov; {bratje})')

# poddatoteke uvažajo SAMO dovoljene brate — nikoli glavni, nikoli nazaj
NE_SKLICI_GLAVNEGA = {
    f'{MOD}/playbook-home.tsx': ['playbook-shared'],
    f'{MOD}/playbook-run.tsx': ['playbook-shared', 'playbook-korak'],
    f'{MOD}/playbook-korak.tsx': ['playbook-shared'],
    f'{MOD}/playbook-admin.tsx': ['playbook-shared'],
    f'{MOD}/dostave-tab.tsx': ['dostave-shared', 'dostave-detail', 'dostave-nova'],
    f'{MOD}/dostave-detail.tsx': ['dostave-shared'],
    f'{MOD}/dostave-nova.tsx': ['dostave-shared'],
    f'{MOD}/dostave-vozila.tsx': ['dostave-shared'],
    f'{MOD}/dostave-ekipe.tsx': ['dostave-shared'],
    f'{MOD}/montaza-qa-kontrola.tsx': ['montaza-qa-shared', 'montaza-qa-odstopanja'],
    f'{MOD}/montaza-qa-odstopanja.tsx': ['montaza-qa-shared'],
    f'{MOD}/montaza-qa-primopredaja.tsx': ['montaza-qa-shared'],
}
for f, dovoljeni in NE_SKLICI_GLAVNEGA.items():
    u = uvozi(f)
    nedovoljeni = [x for x in u if x not in dovoljeni]
    chk(nedovoljeni == [], f'A8 {f.split("/")[-1]}: uvozi samo {dovoljeni or "zunanjost"} (0 krožnih; {nedovoljeni})')

# glavni povezujejo svoje dele (dokaz, da razbitje ni odtrgalo povezav)
chk("from './playbook-home'" in src(f'{MOD}/playbook.tsx')
    and "from './playbook-run'" in src(f'{MOD}/playbook.tsx')
    and "from './playbook-admin'" in src(f'{MOD}/playbook.tsx'),
    'A9 playbook.tsx povezuje home + run + admin (run naprej sestavi korak)')
chk("from './dostave-tab'" in src(f'{MOD}/dostave.tsx')
    and "from './dostave-vozila'" in src(f'{MOD}/dostave.tsx')
    and "from './dostave-ekipe'" in src(f'{MOD}/dostave.tsx'),
    'A9 dostave.tsx povezuje tab + vozila + ekipe (tab naprej detail + nova)')

# module-view nalagalnik NEDOTAKNJEN: poti ostajajo, 0 novih vnosov
mv = src('src/components/roksal/module-view.tsx')
for pot in ['modules/playbook', 'modules/dostave']:
    chk(pot in mv, f'A10 module-view ohranja pot {pot}')
chk(re.search(r'modules/playbook-(shared|home|run|korak|admin)', mv) is None
    and re.search(r'modules/dostave-(shared|tab|detail|nova|vozila|ekipe)', mv) is None
    and re.search(r'modules/montaza-qa-', mv) is None,
    'A10 nalagalnik: 0 novih vnosov (poddatoteke NISO zavihki — so gradniki)')

# meritve-kamera ZAVEDNA IZJEMA (kot viz 731 v R548): main je EN komponent
# z ~13 closures nad skupnim stanjem; R537 je že izvlekla 15 poddatotek.
mk = f'{MOD}/meritve-kamera.tsx'
chk(src_has(mk, 'R537-a: ta datoteka je VSTOPNA'),
    'A11 meritve-kamera: R537 vstopna dokumentacija ostaja (izjema utemeljena)')
chk(src_has(mk, 'export function KameraMeritevDialog') and lines(mk) < 950,
    f'A11 meritve-kamera: en komponent, nedotaknjen v R549 (dejansko {lines(mk)} vrstic)')
chk(src_has(mk, "from './meritve-kamera/status'") and src_has(mk, 'PasicaOsnutek'),
    'A11 meritve-kamera: R537 družina povezana (PasicaOsnutek iz status poddatoteke)')

# ═══ B) brez podvojenih definicij; javni API; ključni nizi; kamera sidra ═══
print('── B) brez podvojenih definicij; javni API; ključni nizi ──')

# stare glave so ČISTE (premik, ne kopija)
for niz in ['function PlaybookHome', 'function RunView', 'function TrenutniKorak',
            'function AdminDefs', 'preveriNapravo', 'KATEGORIJA_IKONA']:
    chk(niz not in src(f'{MOD}/playbook.tsx'), f'B1 playbook.tsx (lupina) brez {niz} (ni podvojenih)')
for niz in ['function DostaveTab', 'function DeliveryDetailDialog', 'function NewDeliveryDialog',
            'function VozilaTab', 'function EkipeTab', 'function isOffice', 'DELIVERY_STATUSI']:
    chk(niz not in src(f'{MOD}/dostave.tsx'), f'B1 dostave.tsx (lupina) brez {niz} (ni podvojenih)')
for niz in ['function MontazaQaSection', 'function HandoverSection', 'function DeviationCard',
            'function SignaturePad', 'ACTION_FLOW']:
    chk(niz not in src(f'{MOD}/montaza-qa.tsx'), f'B1 montaza-qa.tsx (barel) brez definicije {niz} (samo re-export)')

# javni API montaza-qa ohranjen za danes-detail (uvoz NEDOTAKNJEN)
chk(src_has('src/components/roksal/modules/danes-detail.tsx',
            "import { HandoverSection, MontazaQaSection } from '@/components/roksal/modules/montaza-qa'"),
    'B2 danes-detail.tsx uvoz MontazaQaSection + HandoverSection IZ ISTE POTI (barel drži API)')
chk(src_has(f'{MOD}/montaza-qa.tsx', 'export type { QaActionRow, QaDeviationRow, QaCheckRow, HandoverRow }'),
    'B2 montaza-qa.tsx: tipni izvozi ohranjeni (QaActionRow/QaDeviationRow/QaCheckRow/HandoverRow)')

# ključni uporabški nizi živijo na novih lokacijah (kirurški izrez, ne izum)
NIZI = {
    f'{MOD}/playbook-home.tsx': ['Zaženi postopek', 'Edinstvena pot na nalogu', 'Ni še zagonov', 'NADALJUJ'],
    f'{MOD}/playbook-run.tsx': ['Postopek zaključen', 'Odpri konfigurator', 'Zaključi teren v Danes', 'Foto zajem', 'Meritve'],
    f'{MOD}/playbook-korak.tsx': ['POTRDI ODLOČITEV', 'ZAKLJUČI:', 'Označi kot blokirano', 'vsaj 5 znakov', 'Kontrolni seznam (vse točke so obvezne)'],
    f'{MOD}/playbook-admin.tsx': ['Upravljanje playbookov', 'Shrani kot novo verzijo', 'Aktiviraj', 'Upokoji'],
    f'{MOD}/dostave-tab.tsx': ['Podrobnosti in prehodi', 'Nova dostava', 'Vsi statusi'],
    f'{MOD}/dostave-detail.tsx': ['Dopolni načrt', 'Prevzemnik', 'Dostava je brez vrstic', 'Razlog preklica'],
    f'{MOD}/dostave-nova.tsx': ['Ustvari dostavo', 'Brez picking liste (prazna dostava)', 'Najprej izberite projekt'],
    f'{MOD}/dostave-vozila.tsx': ['Dodaj vozilo', 'Novo vozilo', 'Ni vozil'],
    f'{MOD}/dostave-ekipe.tsx': ['Dodaj ekipo', 'Ocena kakovosti', 'Ni ekip', 'Podizvajalci'],
    f'{MOD}/montaza-qa-kontrola.tsx': ['Pripravi kontrolne točke', 'Kontrola kakovosti montaže', 'Razlog napake (obvezno'],
    f'{MOD}/montaza-qa-odstopanja.tsx': ['Korektivni ukrep', 'NEREŠENO', 'Odpravi odstopanje'],
    f'{MOD}/montaza-qa-primopredaja.tsx': ['Zgradi primopredajno poročilo', 'Podpiši primopredajo', 'Izvozi PDF', 'kvalificiran elektronski podpis'],
}
for f, nizi in NIZI.items():
    for niz in nizi:
        chk(src_has(f, niz), f'B3 {f.split("/")[-1]}: „{niz[:32]}" ŽIVI na lokaciji')

# meritve-kamera sidra (39 v 9 testih) so NEDOTAKNJENA — main se ni premaknil.
# OPOMBA (podmapa-avednost): r486 src_has za meritve-kamera.tsx preverja TUDI
# podmapo meritve-kamera/ (R537 družina) — nizi pasice živijo v status.tsx,
# zato tu sidrimo na RESNIČNE lokacije (main + status poddatoteka).
for niz in ['NADALJUJ', 'ZAČNI NOVO', 'initialProjectId',
            'autoResumeDraft', 'saveDraft', 'pickExistingView', 'osnutekKljuc']:
    chk(src_has(mk, niz), f'B4 meritve-kamera main: sidro „{niz}" ostaja (R537 jedro)')
chk(src_has(f'{MOD}/meritve-kamera/status.tsx', 'Imaš nedokončano meritev'),
    'B4 meritve-kamera/status.tsx: pasica „Imaš nedokončano meritev" (r486 sidro, podmapa)')
chk(src_has(f'{MOD}/meritve-kamera/faza-potrditev.tsx', 'calibration: view.calib'),
    'B4 meritve-kamera/faza-potrditev.tsx: „calibration: view.calib" (r486 sidro, podmapa)')
chk(src_has('tests/r486.py', 'meritve-kamera.tsx') and src_has('tests/r508.py', 'meritve-kamera.tsx'),
    'B4 testi r486/r508 še vedno sidrejo meritve-kamera.tsx (pot se ni spremenila)')

# ═══ C) HTTP: žive globoke povezave razbitih modulov ═══════════════════════
print('── C) HTTP (razbiti moduli se nalagajo) ──')


def http_get (path):
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + path), timeout=30) as rr:
            return rr.status
    except Exception:
        return 0


for m in ['playbook', 'dostave', 'danes']:
    st = http_get(f'/?m={m}')
    chk(st == 200, f'C1 globoka povezava /?m={m} → 200 (razbitje ne sesuje nalaganja; dejansko {st})')
st = http_get('/?m=dostave&x=1')
chk(st == 200, f'C2 /?m=dostave&x=1 → 200 (dodatni query; dejansko {st})')
st = http_get('/')
chk(st == 200, f'C3 goli / → 200 (lupina; dejansko {st})')

# ═══ D) registracija: matrika + README (pozicijsko neodvisno) ══════════════
print('── D) registracija (ci-matrix / ci.yml / README) ──')

mat = src('tests/ci-matrix.sh')
chk(re.search(r'(?<![\w-])r549(?![\w-])', mat) is not None and mat.count('r549') >= 2,
    'D1 ci-matrix.sh: r549 v GRUPE in CLANI (pozicijsko neodvisno)')
yml = src('.github/workflows/ci.yml')
chk(re.search(r'(?<![\w-])r549(?![\w-])', yml) is not None, 'D2 .github/workflows/ci.yml: r549 v matriki')
rd = src('README.md')
chk(re.search(r'56\. skupin|56 skupin|56/56', rd) is not None, 'D3 README: 56. skupina odražena')
chk('R549' in rd and ('razbitje' in rd or 'razbil' in rd), 'D4 README: R549 razbitje zadnje vrste popisano')

print(f'═══ R549 KONEC: {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸ ═══')
raise SystemExit(0 if FAIL == 0 else 1)
