#!/usr/bin/env python3
# r556 — R556 (PRODUKCIJSKI SPREHOD, POPRAVKI): kandidati, najdeni na
# Vercel produkciji (R555) in sprehodu R554, so bili ŽIVO reproducirani
# na https://roksal-railing-manager.vercel.app pred popravki. Izsledki:
#
#   POPRAVLJENO (5; 5. živo najden v sprehodu R556 samemu):
#   1. SUROVA DOLŽINA V POPRAVKU — detail meritve → Popravek je polje
#      Dolžina (cm) kazalo plavajoče-vejični šum px→cm zmnožka
#      (430.6000061035156) namesto 430,6. DVEPLASTNA rešitev:
#      (a) VIR — finalLengthCm (ena-pogled pot) zdaj zaokroži na 0,1 cm,
#      ISTA konvencija kot več-pogled pot, nagib v confirm in round1
#      (fence-run); točke + kalibracija ostanejo v polni natančnosti;
#      (b) PRIKAZ — fmtNumInput v popravljalnem obrazcu (obrambno za
#      ŽE shranjene vrstice s šumom, npr. na produkciji).
#   2. AUDITORSKI ZAPIS — manualOverride.computedLengthCm (ena-pogled
#      veja) je bil prav tako surov; isti round1 v obeh poteh (confirm +
#      offline vrsta).
#   3. TOAST V NAPAČNI FAZI — »Fotografija shranjena. Zdaj kalibrirajte
#      merilo…« se je pokazal TUDI v fazi POTRDITVE (gumb »Najprej naloži
#      fotografijo«), kjer je uporabnik že za kalibracijo. uploadPhoto
#      dobi NAMEN ('KALIBRACIJA' | 'POTRDITEV'); opis je fazno pošten.
#   4. TIPKARSKA — »blaskavica ni potrjena« → »bliskavica ni potrjena«
#      (napisZmogljivosti, statusna vrstica kamere).
#   5. ENOTE ROČNEGA POPRAVKA (R556-e) — vnos »Dolžina (m)« (oznaka +
#      predizpolnitev finalLengthCm/100) je šel NEPRETVORJEN v finalLengthCm
#      (ki je v CENTIMETRIH): 5,20 m se je shranilo kot lengthCm 5,2 (100×
#      premalo; toast je rekel »0,1 m«). Živo ujeto, ko je sprehod prvič
#      izvedel override do konca; napaka od R455, brez testnega pokritja
#      (r455 preverja le API-paket manualOverride, ne odjemalške pretvorbe).
#      Popravek: Math.round(v*1000)/10 (m→cm po round1 konvenciji R556-a).
#
#   LAŽNA ALARMA R555 (živo dokazana, BREZ popravka — dokumentacija):
#   - »Priporočena metoda:« NI bila prazna na produkciji (INNERTEXT
#     vsebuje »Kamera + več pogledov (statistika)…«; opažanje je bil
#     odrezan a11y izrezek).
#   - Kamera NA produkciji NI tiha: toast »Kamere ni bilo mogoče najti.«
#     pride ~1 s po kliku (NotFoundError). R555 je iskal z napačnim
#     izbirnikom — [data-radix-toast-viewport] v tej različici Radixa
#     NE obstaja; pravi viewport je ol.fixed.top-0 (videno živo).
#   - Obvestila ×10 »Stranka je izbrala varianto…« so PO ZASNOVI: vsak
#     javni izbor (viz-choice) = svoje obvestilo z dedup po choice id;
#     deset identičnih je nastalo med testnimi kliki sprehoda.
#   - A11Y VREDNOSTI NUMBER INPUTOV (2× živo, sprehod R556): snapshot je za
#     vnos z DOM vrednostjo »5.20« pokazal 5.199999809265137 (fantomski
#     plavajoči šum); a11y drevo NI resnica za vrednosti — vedno preveri
#     prek #id .value. (Predizpolnitev s toFixed(2) je bila pravilna ves čas.)
#
# Preverjanja:
#   A) bun enote: napisZmogljivosti (trije torch stani, tipkarska,
#      zoom/fokus dodatek samo ob POTRDBI)
#   B) žičenje (source grep): fmtNumInput definicija + 5 uporab, BREZ
#      String(initial.*; finalLengthCm round1; computedLengthCm round1 ×2;
#      uploadPhoto(namen) podpis + obe kliki + obe besedili + NEGATIVNO
#      stari nepogojni opis; brez blaskavice; regresije r550/r553
#   C) HTTP: globoke povezave + goli /
#   D) registracija: ci-matrix GRUPE+CLANI, ci.yml, README 61. skupin
#
# Zagon: python3 tests/r556.py  (ali bash tests/ci-matrix.sh r556)

import json
import os
import subprocess
import sys
import urllib.request

PASS, FAIL, SKIP = 0, 0, 0
TAG = 'R556'
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
MER = f'{MOD}/meritve.tsx'
MAIN = f'{MOD}/meritve-kamera.tsx'
POTR = f'{MOD}/meritve-kamera/faza-potrditev.tsx'
KALB = f'{MOD}/meritve-kamera/faza-kalibracija.tsx'
ZAJEM = f'{MOD}/meritve-kamera/faza-zajem.tsx'

print(f'════ {TAG} — produkcija: čista dolžina, fazno pošten toast, tipkarska ════')

# ═══ A) bun enote: napisZmogljivosti (statusna vrstica kamere) ═════════════
print('── A) napisZmogljivosti — trije stani torcha, tipkarska, zoom/fokus')
A = bun_js(r'''
const { napisZmogljivosti } = await import('./src/lib/camera-capabilities')

const baza = { preklop: 'NI_PODPRE', razlogPreklopa: 'ena-kamera', zoom: { stanje: 'NI_PODPRE', min: 0, max: 0, step: 1 }, fokus: 'NI_PODPRE' }
const izpisi = {
  podprto: napisZmogljivosti({ ...baza, torch: 'PODPRTO' }),
  niPodpre: napisZmogljivosti({ ...baza, torch: 'NI_PODPRE' }),
  niDokaza: napisZmogljivosti({ ...baza, torch: 'NI_DOKAZA' }),
  zZoomom: napisZmogljivosti({ ...baza, torch: 'PODPRTO', zoom: { stanje: 'PODPRTO', min: 100, max: 400, step: 25 } }),
  sFokusom: napisZmogljivosti({ ...baza, torch: 'PODPRTO', fokus: 'PODPRTO' }),
}
const blaskavica = Object.values(izpisi).some((s) => s.includes('blaskavica'))
console.log(JSON.stringify({ izpisi, blaskavica }))
''')
if '_err' in A:
    bad(f'A uvoz propadel: {A["_err"][:200]}')
else:
    iz = A.get('izpisi', {})
    chk(iz.get('podprto', '').startswith('bliskavica'), f'A1 PODPRTO: »bliskavica · …« (dejansko: {iz.get("podprto", "")!r})')
    chk('brez bliskavice' in iz.get('niPodpre', ''), f'A2 NI_PODPRE: »brez bliskavice« (dejansko: {iz.get("niPodpre", "")!r})')
    chk('bliskavica ni potrjena' in iz.get('niDokaza', ''), f'A3 NI_DOKAZA: pošteno »bliskavica ni potrjena« (dejansko: {iz.get("niDokaza", "")!r})')
    chk(A.get('blaskavica') is False, 'A4 TIPKARSKA: »blaskavica« ne obstaja več v NOVEM izpisu (popravek R556)')
    chk('približevanje' in iz.get('zZoomom', ''), 'A5 zoom: omenjen SAMO ob potrjeni razponu (r550 sidro ostaja)')
    chk('približevanje' not in iz.get('podprto', ''), 'A6 zoom: BREZ potrditve NI omenjen (brez lažne ponudbe)')
    chk('ostrenje na točko' in iz.get('sFokusom', ''), 'A7 fokus: omenjen SAMO ob potrditvi (r550 sidro ostaja)')

# ═══ B) žičenje (source grep) ══════════════════════════════════════════════
print('── B) žičenje: fmtNumInput / round1 / uploadPhoto(namen) / regresije')

mer_src = src(MER)
main_src = src(MAIN)
potr_src = src(POTR)
kalb_src = src(KALB)

# B1 — prikaz: fmtNumInput v popravljalnem obrazcu (obrambno za obstoječe vrstice)
b1 = [
    (MER, 'const fmtNumInput = (v: number | null | undefined): string', 'fmtNumInput definiran s tipom (null/undefined → prazno)'),
    (MER, 'lengthCm: fmtNumInput(initial?.lengthCm)', 'dolžina IZ BAZE skozi fmtNumInput'),
    (MER, 'heightCm: fmtNumInput(initial?.heightCm)', 'višina skozi fmtNumInput'),
    (MER, 'posts: fmtNumInput(initial?.posts)', 'stebri skozi fmtNumInput'),
    (MER, 'segments: fmtNumInput(initial?.segments)', 'segmenti skozi fmtNumInput'),
    (MER, 'slopeDeg: fmtNumInput(initial?.slopeDeg)', 'nagib skozi fmtNumInput'),
]
for rel, needle, msg in b1:
    chk(src_has(rel, needle), f'B1 {msg}')
chk('Math.round(v * 10) / 10' in mer_src, 'B1 fmtNumInput zaokroži na 0,1 (ISTA konvencija kot round1)')
chk('String(initial.lengthCm)' not in mer_src and 'String(initial.heightCm)' not in mer_src
    and 'String(initial.slopeDeg)' not in mer_src, 'B1 NEGATIVNO: surovi String(initial.*) so ODSTRANJENI')

# B2 — vir: finalLengthCm ena-pogled pot zaokroži (šum px→cm ne gre v bazo)
chk('Math.round(calc.totalCm * 10) / 10' in main_src, 'B2 finalLengthCm: ena-pogled pot zaokroži na 0,1 (vir šuma zaprt)')
chk('calc.totalCm !== null ? Math.round(calc.totalCm * 10) / 10 : null' in main_src, 'B2 finalLengthCm: null ostane null (brez lažne 0)')
chk('Math.round(multi.mean * 10) / 10' in main_src, 'B2 REGRESIJA: več-pogled zaokrožitev ostaja (r487 sidro)')

# B3 — auditorski zapis: computedLengthCm round1 v OBEH poteh (confirm + offline)
chk(potr_src.count('Math.round(calc.totalCm * 10) / 10') >= 2, 'B3 computedLengthCm: round1 v confirm IN offline vrsti (×2)')
chk('calc.totalCm ?? 0' not in potr_src, 'B3 NEGATIVNO: surova ena-pogled veja (?? 0) odstranjena')

# B4 — uploadPhoto(namen): fazno pošten opis tosta
chk("async function uploadPhoto (namen: 'KALIBRACIJA' | 'POTRDITEV' = 'KALIBRACIJA')" in main_src,
    'B4 uploadPhoto podpis: namen s privzetim KALIBRACIJA (nazajzdružljivo)')
chk("uploadPhoto('KALIBRACIJA')" in kalb_src, 'B4 faza-kalibracija kliče z namenom KALIBRACIJA')
chk("uploadPhoto('POTRDITEV')" in potr_src, 'B4 faza-potrditev kliče z namenom POTRDITEV')
chk('Fotografija je pripeta k meritvi — nadaljujte s potrditvijo.' in main_src, 'B4 opis POTRDITEV: ne govori kalibracije')
chk('Zdaj kalibrirajte merilo in označite točke.' in main_src, 'B4 opis KALIBRACIJA ostaja za prvo fazo')
chk("description: 'Zdaj kalibrirajte merilo in označite točke.'" not in main_src,
    'B4 NEGATIVNO: nepogojni (fazno NAPAČNI) opis ne obstaja več')
chk("uploadPhoto: (namen?: 'KALIBRACIJA' | 'POTRDITEV') => Promise<void>" in kalb_src
    and "uploadPhoto: (namen?: 'KALIBRACIJA' | 'POTRDITEV') => Promise<void>" in potr_src,
    'B4 tip propa posodobljen v OBEH fazah')

# B5 — tipkarska: blaskavica iztrebljena iz liba
lib_src = src(LIB)
chk('blaskavica' not in lib_src, 'B5 lib BREZ »blaskavica« (tipkarska popravljena)')
chk('bliskavica ni potrjena' in lib_src, 'B5 »bliskavica ni potrjena« na mestu')

# B6 — regresije: sidra r550/r553/r555 na dotičnih datotekah (dokaz, da R556 ni razbil)
b6 = [
    (MAIN, 'const finalLengthCm = useMemo', 'memo končne dolžine ostaja (r487)'),
    (MAIN, 'multi.spreadPct !== null && multi.spreadPct > 5', 'konflikt pogledov BREZ tihega povprečja (r487)'),
    (POTR, 'lengthCm: finalLengthCm', 'confirm pošlje finalLengthCm (ne surovega totalCm)'),
    (POTR, 'slopeDeg: calc.segs.length === 1 ? Math.round(calc.segs[0].angleDeg * 10) / 10 : null', 'nagib round1 ostaja (r455)'),
    (POTR, 'Najprej naloži fotografijo', 'gumb potrditvene faze ostaja'),
    (KALB, 'Naloži fotografijo', 'gumb kalibracijske faze ostaja'),
    (ZAJEM, 'Priporočena metoda:', 'priporočena metoda izpis ostaja (R555 lažni alarm — deluje, ne sme se spremeniti)'),
    (LIB, 'export function razloziNapakoKamere', 'napake po imenu ostajajo (r550)'),
    (MAIN, 'title: \'Fotografija shranjena.\'', 'naslov tosta nespremenjen'),
]
for rel, needle, msg in b6:
    chk(src_has(rel, needle), f'B6 REGRESIJA: {msg}')

# B7 — R556-e: enote ročnega popravka (vnos v m, finalLengthCm v cm)
chk('Math.round(v * 1000) / 10' in main_src, 'B7 override: metri × 100 v cm z round1 (vnos »Dolžina (m)« → lengthCm v cm)')
chk("Number(overrideLen.replace(',', '.'))\n      return Number.isFinite(v) && v > 0 ? v : null" not in main_src,
    'B7 NEGATIVNO: surova vrnitev v (metri kot cm) v override veji odstranjena (parser v buildOptions je dovoljen — tam so vnosi že v cm)')
chk('(finalLengthCm / 100).toFixed(2)' in potr_src, 'B7 predizpolnitev ostaja v metrih s toFixed(2) (par s ×100 pretvorbo)')

# ═══ C) HTTP: globoke povezave ══════════════════════════════════════════════
print('── C) HTTP (moduli se nalagajo) ──')


def http_get (path):
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + path, headers={'User-Agent': 'r556-test'}), timeout=30) as rr:
            return rr.status
    except Exception:
        return 0


for m in ['meritve', 'danes']:
    st = http_get(f'/?m={m}')
    chk(st == 200, f'C1 globoka povezava /?m={m} → 200 (dejansko {st})')
st = http_get('/?m=meritve&popravek=1')
chk(st == 200, f'C2 /?m=meritve&popravek=1 → 200 (dejansko {st})')
st = http_get('/')
chk(st == 200, f'C3 goli / → 200 (dejansko {st})')

# ═══ D) registracija: matrika + README ═════════════════════════════════════
print('── D) registracija (ci-matrix / ci.yml / README) ──')

import re as _re
mat = src('tests/ci-matrix.sh')
chk(_re.search(r'(?<![\w-])r556(?![\w-])', mat) is not None and mat.count('r556') >= 2,
    'D1 ci-matrix.sh: r556 v GRUPE in CLANI (pozicijsko neodvisno)')
yml = src('.github/workflows/ci.yml')
chk(_re.search(r'(?<![\w-])r556(?![\w-])', yml) is not None, 'D2 .github/workflows/ci.yml: r556 v matriki')
rd = src('README.md')
chk(_re.search(r'61\. skupin|61 skupin|61/61', rd) is not None, 'D3 README: 61. skupina odražena')
chk('R556' in rd and 'fmtNumInput' in rd and '100×' in rd, 'D4 README: R556 popravki popisani (vključno z enotami ×100)')
pkg = src('package.json')
chk('"version": "1.77.0"' in pkg, 'D5 package.json: različica 1.77.0 (dvignil R561 — vzorec r553/r554)')

print(f'═══ {TAG} KONEC: {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸ ═══')
sys.exit(1 if FAIL else 0)
