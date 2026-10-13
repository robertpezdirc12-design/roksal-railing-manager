#!/usr/bin/env python3
"""tests/r502.py — issue #15 Faza 3: fotogrametrija brez AI (dokazni protokol)

Ne preverja napisov v UI-ju, ampak DEJANSKO rekonstrukcijo: izpit zgradi
merilno ploščo z znano istino (ravnine, [R|t], K), jo izriše skozi dve pinhole
kameri in po klasični verigi (Shi-Tomasi → NCC ujemanje → normaliziran DLT →
RANSAC → E → razcep s chevraliteto → triangulacija → merilo iz reference)
rekonstruira nazaj. Brez baze, brez strežnika, brez AI, brez novih odvisnosti.

Kaj dokazuje (po točkah issue #15, faza 3):
  A) MATEMATIKA: lastni razcep, SVD, rang-2, triangulacija in DLT na čistih
     projektih — ostanki so strojno majhni (1e-14), ne "približno ok".
  B) MERILO: jedro zavrne manjkajočo, negativno, ničelno, preveliko in
     sovpadajočo referenco; veljavna referenca da natanko traženi cm/enoto.
  C) RANSAC PROTI IZSTOPKI: izstopki so dokazani z ISTINO (znana homografija,
     zamik ≥ 20 px); nobeno resnično ujemanje ne sme biti zavrnjeno, večina
     izstopkov mora biti zavrnjenih. Koliko zdrsne skozi, je zapisano.
  D) SCENARIJI: sedem pogojev, vsak z DOLOČENO odločitvijo (SPREJET /
     ZAVRNJEN / DODATNI_POSNETKI) in poimenovanim razlogom za zavrnitev.
  E) SPREJETI MODEL: rotacija < 1°, premik < 2°, mediana epipolarne < 0,5 px,
     mediana projekcijske < 1 px, delež preverjenih > 80 %, parallaksa > 5°,
     merilna napaka < 1 %, globinska napaka < 1 %.
  F) Podedovanje napake: referenca, izmerjena za 1 % narobe, podeduje ~1 %
     napako v merilo in globino — protokol je ne prikriva.
  G) Brez fizične reference rekonstrukcija NI metrična (ZAVRNJEN, cm ne obstajajo).
  H) Degenerirani primeri (brez teksture, čista rotacija, ponavljajoč vzorec,
     premaknjena kamera za 2 mm) so ZAVRNJENI/DODATNI_POSNETKI z imenovanym
     razlogom — ne tiho.
  I) Determinizem: isti zagon dà identičen raport (fiksen seed, brez Math.random).
  J) Vir: jedro nima uvozov (nič odvisnosti), dokaz uvozi samo jedro,
     measure-engine še vedno izrecno pravi, da 3D-rekonstrukcije NI, in
     noben UI modul fotogrametrije še ne uvaža (faza 3 je offline dokaz).

Artefakt: docs/artefacts/fotogrametrija-dokaz.json (zapiše se vsakič znova,
zato ne more ostati star). Licenčni pregled: docs/PHOTOGRAMMETRY-3D.md.
"""
import json, os, re, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTEFAKT = os.path.join('docs', 'artefacts', 'fotogrametrija-dokaz.json')
PASS, FAIL = 0, 0


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)


def bun_ts (skripta, cas=240):
    r = subprocess.run(['bun', '-e', skripta], capture_output=True, text=True, cwd=REPO, timeout=cas)
    return r.stdout, r.stderr[:1200]


def bun_out (skripta, cas=240):
    out, err = bun_ts(skripta, cas)
    try:
        return json.loads(out)
    except Exception:
        return {'_err': (err or out)[:400]}


def read_src (relpath):
    with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
        return f.read()


def src_lacks (relpath, pattern):
    try:
        return re.search(pattern, read_src(relpath)) is None
    except Exception:
        return False


def src_has (relpath, needle):
    try:
        return needle in read_src(relpath)
    except Exception:
        return False


UVOZ = """
const core = require('./src/lib/photogrammetry-core.ts');
const proof = require('./src/lib/photogrammetry-proof.ts');
"""

# ── A–I: celoten dokazni raport (en zagon, artefakt se zapiše) ────────────────
print('R502 faza 3 — fotogrametrija brez AI (dokazni protokol)')
print('─ A) matematika verige (ostanki proti znani istini)')
RAPORT = bun_out(UVOZ + """
const r = proof.porociloDokaz();
const fs = require('fs');
fs.mkdirSync('docs/artefacts', { recursive: true });
fs.writeFileSync('docs/artefacts/fotogrametrija-dokaz.json', JSON.stringify(r, null, 2) + '\\n');
console.log(JSON.stringify(r));
""")
if '_err' in RAPORT:
    bad(f'porociloDokaz se ni izvedel: {RAPORT["_err"][:200]}')
    print(f'\nR502: {PASS} OK / {FAIL} NAPAK')
    sys.exit(1)

MAT = RAPORT.get('matematicna', {})
MEJAE = {
    'a_lastni_ostanek': 1e-9,
    'a_lastni_ortonormiranost': 1e-9,
    'a_svd_ostanek': 1e-9,
    'a_rang2_determinanta': 1e-9,
    'a_triangulacija_ostanek_cm': 1e-6,
    'd_epipolarna_ostanek_px': 1e-3,
    'd_rotacija_ostanek_deg': 1e-3,
    'd_translacija_ostanek_deg': 1e-3,
    'd_triangulacija_cista_px': 1e-3,
}
for kljuc, meja in MEJAE.items():
    v = MAT.get(kljuc)
    chk(isinstance(v, (int, float)) and abs(v) <= meja, f'{kljuc} = {v} ≤ {meja}')
for kljuc in ('d_F_znajden', 'd_chevraliteta_vsi'):
    chk(MAT.get(kljuc) is True, f'{kljuc} je res (DLT najde F; vse triangulirane točke pred obema kamerama)')

print('─ B) merilo: jedro zavrne neveljavno referenco')
MER = RAPORT.get('meriloPreizkusi', {})
for kljuc in ('manjka', 'negativen', 'nic', 'prevelik', 'sovpadajtoc', 'veljaven', 'natancen'):
    chk(MER.get(kljuc) is True, f'merilo/{kljuc}: jedro ravna pravilno')

print('─ C) RANSAC proti izstopki, dokazanim z istino')
RS = RAPORT.get('ransacZOutlierji', {})
chk(RS.get('izstopekVgrajenih', 0) >= 8, f'izpit je vgradil {RS.get("izstopekVgrajenih")} dokazano napačnih parov (≥ 8)')
chk(RS.get('vsiDobriOhranjeni') is True, 'nobeno resnično ujemanje ni bilo zavrnjeno (poklicnost 100 %)')
chk(RS.get('delezZavrnjenihIzstopkov', 0) >= 0.8, f'zavrnjenih je {RS.get("delezZavrnjenihIzstopkov")} ≥ 0,8 izstopkov (pozornost)')
chk(RS.get('veliki', 0) >= 8, f'RANSAC je našel model (veliki = {RS.get("veliki")} ≥ 8)')
chk(RS.get('medianaNapakePx', 9) < 0.3, f'mediana napake veliki = {RS.get("medianaNapakePx")} px < 0,3 px')
if RS.get('velikiNapacni', 0) > 0:
    ok(f'pošteno zapisano: {RS["velikiNapacni"]} od {RS["izstopekVgrajenih"]} izstopkov je zdrsnilo skozi epipolarni '
       f'preizkus (raven panel → premik vzdolž epipolarne črte ne stane nič)')

print('─ D–H) scenariji: odločitev in razlog')
SC = {s['scenarij']: s for s in RAPORT.get('scenariji', [])}
CAKOVANE = {
    'panel_dva_pogleda': 'SPREJET',
    'enotna_plosca_brez_teksture': 'DODATNI_POSNETKI',
    'cista_rotacija_brez_baseline': 'DODATNI_POSNETKI',
    'ponavljajoc_se_vzorec': 'DODATNI_POSNETKI',
    'premajhen_premik': 'DODATNI_POSNETKI',
    'ni_fizicne_reference': 'ZAVRNJEN',
    'referenca_nihka_1_proc': 'SPREJET',
}
chk(set(SC) == set(CAKOVANE), f'vseh {len(CAKOVANE)} scenarijev je prisotnih ({len(SC)})')
for ime, cakovanje in CAKOVANE.items():
    s = SC.get(ime, {})
    chk(s.get('odlozitev') == cakovanje, f'{ime}: odločitev {s.get("odlozitev")} = pričakovana {cakovanje}')

P = SC.get('panel_dva_pogleda', {})
print('─ E) meritve sprejetega modela (panel_dva_pogleda)')
chk(P.get('rotacijaNapakaDeg', 99) < 1.0, f'napaka rotacije {P.get("rotacijaNapakaDeg")}° < 1°')
chk(P.get('translacijaNapakaDeg', 99) < 2.0, f'napaka smeri premika {P.get("translacijaNapakaDeg")}° < 2°')
chk(P.get('medianaEpipolarnePx', 9) < 0.5, f'mediana epipolarne napake {P.get("medianaEpipolarnePx")} px < 0,5 px')
chk(P.get('medianaProjekcijskePx', 9) < 1.0, f'mediana projekcijske napake {P.get("medianaProjekcijskePx")} px < 1 px')
chk(P.get('delezPravilnih', 0) > 0.8, f'delež pravilnih ujemanj {P.get("delezPravilnih")} > 0,8')
chk(P.get('delezVelikih', 0) > 0.8, f'delež preverjenih ujemanj {P.get("delezVelikih")} > 0,8')
chk(P.get('paralaksaDeg', 0) > 5.0, f'paralaksa {P.get("paralaksaDeg")}° > 5°')
chk(P.get('rekonstruiraneTocke', 0) >= 8, f'rekonstruiranih točk {P.get("rekonstruiraneTocke")} ≥ 8')
chk(P.get('skalnaNapakaPct', 9) < 1.0, f'merilna napaka {P.get("skalnaNapakaPct")} % < 1 %')
chk(P.get('globinskaNapakaPct', 9) < 1.0, f'globinska napaka {P.get("globinskaNapakaPct")} % < 1 %')
chk(P.get('meriloZnan') is True and isinstance(P.get('cmNaEnoto'), (int, float)),
    f'merilo je izpeljano iz fizične reference ({P.get("cmNaEnoto")} cm/enoto)')
chk(P.get('referencnaRazdaljaCm') and abs(P['referencnaRazdaljaCm'] - 20) < 0.5,
    f'referenčna razdalja {P.get("referencnaRazdaljaCm")} cm ≈ 20 cm (monterjeva mera)')

R1 = SC.get('referenca_nihka_1_proc', {})
print('─ F) podedovanje napake reference (1 % na referenci)')
chk(R1.get('odlozitev') == 'SPREJET', '1 % napaka reference modela ne zavrne — napaka se podeduje, ne prikriva')
chk(0.5 < (R1.get('skalnaNapakaPct') or 0) < 2.5, f'merilna napaka {R1.get("skalnaNapakaPct")} % je ~1 % (podedovana iz reference)')
chk(0.5 < (R1.get('globinskaNapakaPct') or 0) < 2.5, f'globinska napaka {R1.get("globinskaNapakaPct")} % je ~1 % (enako podedovana)')
chk((R1.get('skalnaNapakaPct') or 0) > (P.get('skalnaNapakaPct') or 0),
    f'napaka merila je večja kot pri čisti referenci ({R1.get("skalnaNapakaPct")} % > {P.get("skalnaNapakaPct")} %)')

N = SC.get('ni_fizicne_reference', {})
print('─ G) brez reference ni metričnih številk')
chk(N.get('meriloZnan') is False, 'brez reference merilo ni znano')
chk(N.get('cmNaEnoto') is None, f'cmNaEnoto = {N.get("cmNaEnoto")} (nič se ne izmišlja)')
chk(any('referenčna' in r for r in N.get('razlogi', [])), 'razlog imenuje manjkajočo fizično referenco')
chk(any('metrična' in r for r in N.get('razlogi', [])), 'razlog imenuje, da rekonstrukcija NI metrična')
chk(N.get('rotacijaNapakaDeg', 9) < 1.0 and N.get('medianaProjekcijskePx', 9) < 1.0,
    f'geometrija je kljub temu dobra ({N.get("rotacijaNapakaDeg")}°, {N.get("medianaProjekcijskePx")} px) — zavrnjen je samo metrični izpis')

print('─ H) degenerirani primeri so zavrnjeni z imenovanim razlogom')
IMENOVANI = {
    'enotna_plosca_brez_teksture': 'premalo kornjev',
    'cista_rotacija_brez_baseline': 'paralaktični kot',
    'ponavljajoc_se_vzorec': 'ponavljajoč se vzorec',
    'premajhen_premik': 'paralaktični kot',
}
for ime, fraza in IMENOVANI.items():
    razlogi = SC.get(ime, {}).get('razlogi', [])
    chk(any(fraza in r for r in razlogi), f'{ime}: razlog vsebuje "{fraza}"')
chk(SC.get('enotna_plosca_brez_teksture', {}).get('kornjiA') == 0,
    'enotna plošča: kornjev res ni (detektor ne izmišluje točk na gladki površini)')
chk(SC.get('ponavljajoc_se_vzorec', {}).get('ujemanja', 99) <= 2,
    f'ponavljajoč se vzorec: enoznačnih ujemanj je {SC.get("ponavljajoc_se_vzorec", {}).get("ujemanja")} (dvoumnost je razkrita)')
chk(SC.get('premajhen_premik', {}).get('paralaksaDeg', 9) < 1.0,
    f'baseline 2 mm: parallaksa {SC.get("premajhen_premik", {}).get("paralaksaDeg")}° < 1°')

print('─ I) determinizem')
chk(RAPORT.get('determinizem') is True, 'dva zaporedna zbira raportov sta identična (fiksen seed, brez Math.random/Date)')

# ── J) izvor: nič odvisnosti, nič previsnih trditev ───────────────────────────
print('─ J) vir in obseg (faza 3 je offline dokaz, ne UI obljuba)')
CORE = 'src/lib/photogrammetry-core.ts'
PROOF = 'src/lib/photogrammetry-proof.ts'
chk(src_lacks(CORE, r'(?m)^\s*(import\s|const\s+\{[^}]*\}\s*=\s*require\(|import\s*\()]'),
    'photogrammetry-core: nič ne uvaža — algoritem je izpeljan v repozitoriju (nič GPL/OpenCV-odvisnosti)')
PROOF_UVOZI = sorted(set(re.findall(r"""\bfrom\s*['"]([^'"]+)['"]""", read_src(PROOF))))
chk(PROOF_UVOZI == ['./photogrammetry-core'],
    f'photogrammetry-proof: uvaža samo lastno jedro (uvozi: {", ".join(PROOF_UVOZI) or "nihče"})')
chk(src_lacks('package.json', r'(?i)"(opencv|colmap|pycolmap|openmvg|meshroom|three|@tensorflow|onnx|glslang)'),
    'package.json: nobena nova odvisnost za 3D/CV (faza 3 je brez AI in brezplačna)')
chk(src_has('src/lib/measure-engine.ts', 'NI izvedena'),
    'measure-engine še vedno izrecno pravi, da prava 3D-rekonstrukcija (SfM) v aplikaciji NI izvedena')
chk(src_lacks('src/lib/measure-engine.ts', r'photogrammetry'),
    'measure-engine NE uvaža fotogrametrije — dokazni protokol ni (še) priklopljen na odločanje o meri')
UI_UVAZA = []
for mapa in ('src/components', 'src/app'):
    for koren, _, datoteke in os.walk(os.path.join(REPO, mapa)):
        for dat in datoteke:
            if dat.endswith(('.tsx', '.ts')):
                pot = os.path.join(koren, dat)
                try:
                    if 'photogrammetry' in read_src(os.path.relpath(pot, REPO).replace(os.sep, '/')):
                        UI_UVAZA.append(os.path.relpath(pot, REPO))
                except Exception:
                    pass
chk(not UI_UVAZA, f'noben UI/aplikacijski modul ne uvaža fotogrametrije (najdeno: {", ".join(UI_UVAZA) or "nič"})')
OPOMBE = ' '.join(RAPORT.get('opomba', []))
chk('NI priklopljen' in OPOMBE and 'AI' in OPOMBE,
    'raport v opombi sam pove, da protokol ni priklopljen na UI in da ni AI-ja')

# ── K) jedro samo: zavrnitev brez merila, kljub popolni geometriji ───────────
print('─ K) protokol zavrne neveljavno merilo, tudi če je geometrija dobra')
K = bun_out(UVOZ + """
const kakovost = { steviloSlik: 2, kornjiA: 90, kornjiB: 90, steviloUjemanj: 38, steviloVelikih: 37, delezVelikih: 0.97,
  medianaEpipolarneNapakePx: 0.2, medianaProjekcijskeNapakePx: 0.4, paralaksaDeg: 11, rekonstruiraneTocke: 37, slabiPogledi: [] };
const brez = core.presodi(kakovost, { znan: false, cmNaEnoto: null, razlogi: ['referenca ni bila podana'] });
const z = core.presodi(kakovost, { znan: true, cmNaEnoto: 25.24, razlogi: ['referenca 19,93 cm'] });
const slab = core.presodi({ ...kakovost, delezVelikih: 0.2, medianaProjekcijskeNapakePx: 4.2, paralaksaDeg: 0.3 },
  { znan: true, cmNaEnoto: 25.24, razlogi: ['referenca'] });
console.log(JSON.stringify({ brez: brez.odlozitev, z: z.odlozitev, slab: slab.odlozitev,
  razlogiBrez: brez.razlogi.length, razlogiSlab: slab.razlogi.length }));
""")
chk(K.get('brez') != 'SPREJET', f'popolna geometrija brez merila → {K.get("brez")} (ne SPREJET)')
chk(K.get('z') == 'SPREJET', f'ista geometrija z veljavno references → {K.get("z")}')
chk(K.get('slab') not in ('SPREJET', None), f'poslabšana kakovost → {K.get("slab")}')
chk(K.get('razlogiSlab', 0) >= 3, f'slab model ima {K.get("razlogiSlab")} imenovanih razlogov (≥ 3)')

# ── L) artefakt ──────────────────────────────────────────────────────────────
print('─ L) artefakt')
try:
    with open(os.path.join(REPO, ARTEFAKT), encoding='utf-8') as f:
        a = json.load(f)
    chk(a.get('pogodba') == 'fotogrametrija-dokaz/1.0', f'artefakt {ARTEFAKT}: pogodba {a.get("pogodba")}')
    chk(len(a.get('scenariji', [])) == len(CAKOVANE), 'artefakt vsebuje vseh sedem scenarijev')
    chk(a.get('determinizem') is True, 'artefakt potrjuje determinizem')
    chk(json.dumps(a.get('scenariji'), sort_keys=True) == json.dumps(RAPORT.get('scenariji'), sort_keys=True),
        'artefakt je svež (enak zgolj izračunanemu raportu — ne more biti star)')
except Exception as e:
    bad(f'artefakt {ARTEFAKT}: {e}')

print(f'\nR502: {PASS} OK / {FAIL} NAPAK')
sys.exit(1 if FAIL else 0)
