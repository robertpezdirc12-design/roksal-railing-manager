#!/usr/bin/env python3
"""tests/r509.py — R509 (issue #7 §8 in §9): PISARNIŠKA VERIGA in SPOMIN NA
MONTERJEVE NASTAVITVE.

Kaj ta suite ščiti — štiri resnične napake, ne dekoracija:
  A) measurement-handoff (`odlociPaket`, čista funkcija): paket sme nastati samo
     tam, kjer je aritmetika nedvoumna. Brez projekta / brez izdelka / enota
     »kos« / neznana enota / manjkajoča ali ničelna dolžina / m2 brez višine →
     ZAVRNJENO z razlogom. Meritev, ki že ima paket → OBSTAJA (idempotentnost:
     ponovna potrditev NE ustvari drugega paketa). `m` in `m2` → USTVORI z
     zaokroženo količino. Noben izhod ne sme nositi cene ali marže — drugega
     cenovnega jedra issue #7 ne sme ustvariti.
  B) original-proof: iz params meritve dobimo SKLICANE fotografije (glavni
     pogled + dodatni pogledi, brez podvojitev); iz dataUrl dobimo SHA-256 in
     število bajtov, preverjena PROTIV neodvisnega izračuna (Python hashlib).
     Manjkajoča ali ne-slikovna dataUrl → pošten `sha256 = null`, `bayti = 0`,
     ne izmišljen odtis.
  C) camera-prefs: neveljaven zapis pade na PRIVZETO, nikoli na izmišljeno smer;
     zapis svetilke NI ukaz napravi; shramba, ki zavrne pisanje → `false` in ne
     padec; SSR (brez `window`) → shramba je `null`.
  D) žičenje (source grep): confirm ruta zahteva `quotes.create` in izrecen
     izdelek, calcJson prenosa je brez cen; izvoz nosi originali + CELA zgodovina
     in uporablja ISTI dokaz originala kot PDF; PDF merilnega paketa rude avtorja,
     zgodovino in originale; UI iz spomina NE sme sam prižgati svetilke
     (`nastaviTorch(` samo v monterjevem aktu). MAX_VIEWS ostane 4 — r455 mejo
     testira, dvig bi oslabil merilo sprejetja.

Suite NE potrebuje strežnika in NE piše v bazo. Brez novih odvisnosti, brez AI.
"""
import base64
import hashlib
import json
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASS, FAIL = 0, 0


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)


def bun_js (script, extra_env=None):
    """bun → node nadomestek (tests/toolshim.sh); TS uvozi prek ts-resolve hooka."""
    env = {**os.environ}
    env.setdefault('NODE_OPTIONS', '--import ./tests/ts-resolve-register.mjs')
    if extra_env: env.update(extra_env)
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True, cwd=REPO, env=env)
    out = (r.stdout or '').strip().splitlines()
    for line in reversed(out):
        if line.startswith('{'):
            try:
                return json.loads(line)
            except Exception:
                break
    return {'_err': (r.stderr or r.stdout or '')[:900]}


def src (rel):
    with open(os.path.join(REPO, rel), encoding='utf-8') as f:
        return f.read()


print('════ R509 — pisarniška veriga (§8) + spomin na nastavitve (§9) (issue #7) ════')

# ═══ A) odlociPaket: paket samo, kjer je aritmetika nedvoumna ═══════════════
print('── A) measurement-handoff: fail-closed odločitev o prenosu')
A = bun_js(r'''
const { odlociPaket, zaokroziKolicino, HANDOFF_VERSION } = await import('./src/lib/measurement-handoff')
const v = (o) => odlociPaket({ projectId: 'pr1', productId: 'p1', unit: 'm', lengthCm: 500, heightCm: null, ...o })
console.log(JSON.stringify({
  VERSION: HANDOFF_VERSION,
  brezProjekta: v({ projectId: null }),
  brezIzdelka: v({ productId: null }),
  kos: v({ unit: 'kos' }),
  neznana: v({ unit: 'mm' }),
  brezDolzine: v({ lengthCm: null }),
  nicelnaDolzina: v({ lengthCm: 0 }),
  m500: v({ lengthCm: 500 }),
  m12345: v({ lengthCm: 123.456 }),
  m2: v({ unit: 'm2', lengthCm: 500, heightCm: 120 }),
  m2Brez: v({ unit: 'm2', lengthCm: 500, heightCm: null }),
  obstojeci: v({ postojeciPaketId: 'pak9' }),
  okrog: [zaokroziKolicino(1.005), zaokroziKolicino(2.5), zaokroziKolicino(0)],
}))
''')
if '_err' in A:
    bad(f'bun A: {A["_err"]}')
else:
    chk(A['VERSION'] == 'measurement-handoff/1.0', 'pogodba prenosa ima fiksen verzijo (sledljivost revizij)')
    chk(A['brezProjekta']['odlok'] == 'ZAVRNJENO' and 'projekta' in A['brezProjekta']['razlog'], 'brez projekta → ZAVRNJENO (paket mora viseti na projektu)')
    chk(A['brezIzdelka']['odlok'] == 'ZAVRNJENO' and 'cenovni razred' in A['brezIzdelka']['razlog'], 'brez izdelka ga NE DOMIŠLJAMO (sicer tiho izberemo cenovni razred)')
    chk(A['kos']['odlok'] == 'ZAVRNJENO' and 'kosov' in A['kos']['razlog'], 'enota kos: iz dolžine ni mogoče izpeljati kosov → ZAVRNJENO')
    chk(A['neznana']['odlok'] == 'ZAVRNJENO' and 'Nepoznana prodajna enota' in A['neznana']['razlog'], 'neznana prodajna enota → ZAVRNJENO, ne uganjeno')
    chk(A['brezDolzine']['odlok'] == 'ZAVRNJENO' and A['nicelnaDolzina']['odlok'] == 'ZAVRNJENO', 'brez dolžine / ničelna dolžina → ZAVRNJENO (količina iz niča)')
    chk(A['m500']['odlok'] == 'USTVORI' and A['m500']['qty'] == 5 and A['m500']['unit'] == 'm', '500 cm pri enoti m → 5 m')
    chk(A['m12345']['qty'] == 1.23, '123,456 cm → 1,23 m (zaokrožitev na 2 decimalki, ne na celo)')
    chk(A['m2']['odlok'] == 'USTVORI' and A['m2']['qty'] == 6 and A['m2']['unit'] == 'm2', '500 × 120 cm pri enoti m2 → 6 m2')
    chk(A['m2Brez']['odlok'] == 'ZAVRNJENO' and 'višino' in A['m2Brez']['razlog'], 'm2 brez višine → ZAVRNJENO (površine iz domišljene višine)')
    chk(A['obstojeci']['odlok'] == 'OBSTAJA' and 'novega ne ustvarjamo' in A['obstojeci']['razlog'], 'že povezan paket → OBSTAJA (ponovna potrditev ne ustvari drugega)')
    chk(A['okrog'] == [1, 2.5, 0], 'zaokroziKolicino je determinističen (1.005 → 1, 2.5 → 2.5, 0 → 0)')
    # cena in marža ne smata biti del odločitve — drugo cenovno jedro ni dovoljeno
    stekleno = json.dumps({k: x for k, x in A.items() if isinstance(x, dict)}, ensure_ascii=False).lower()
    chk(all(p not in stekleno for p in ('cena', 'marža', 'marza', 'popust', 'neto', 'bruto')), 'noben izhod odlociPaket ne nosi cene ali marže')

# ═══ B) original-proof: SHA-256 originala, preverjen proti hashlib ══════════
print('── B) original-proof: dokaz, da se zajem ni spremenil')
SUROVO = b'roksal dokazna veriga'
B64 = base64.b64encode(SUROVO).decode()
OCAK = hashlib.sha256(SUROVO).hexdigest()
B = bun_js(r'''
const { fotografiIzParametrov, originalDokaz } = await import('./src/lib/original-proof')
const B64 = process.env.R509_B64
const js = (o) => JSON.stringify(o)
const a = originalDokaz({ id: 'f1', location: 'vrt', source: 'KAMERA', params: js({ photo: 'data:image/jpeg;base64,' + B64 }) })
const ni = originalDokaz({ id: 'f2', location: null, source: 'KAMERA', params: js({ stage: 'ZAJEM' }) })
const neSlika = originalDokaz({ id: 'f3', params: js({ photo: 'data:text/html;base64,xx' }) })
console.log(JSON.stringify({
  idGlavni: fotografiIzParametrov(js({ photoId: 'f1' })),
  idPogledi: fotografiIzParametrov(js({ photoId: 'f1', views: [{ photoId: 'f2' }, { photoId: 'f3' }] })),
  idPodvojeni: fotografiIzParametrov(js({ photoId: 'f1', views: [{ photoId: 'f1' }, { photoId: 'f2' }] })),
  idSmeti: [fotografiIzParametrov(null), fotografiIzParametrov('{}'), fotografiIzParametrov('{kaj'), fotografiIzParametrov(js({ views: 'ne seznam' }))],
  zSliko: { ...a, dataUrl: typeof a.dataUrl },
  brezSlike: ni,
  neSlika,
}))
''', {'R509_B64': B64})
if '_err' in B:
    bad(f'bun B: {B["_err"]}')
else:
    chk(B['idGlavni'] == ['f1'], 'samo glavni pogled → ena fotografija')
    chk(B['idPogledi'] == ['f1', 'f2', 'f3'], 'dodatni pogledi so del dokazne verige (vrstni red ohranjen)')
    chk(B['idPodvojeni'] == ['f1', 'f2'], 'podvojena fotografija se šteje ENKRAT')
    chk(B['idSmeti'] == [[], [], [], []], 'brez params / prazen JSON / okvarjen JSON / ne-seznam → prazno in ne padec')
    z = B['zSliko']
    chk(z['sha256'] == OCAK, f'SHA-256 sovpada z neodvisnim izračunom (hashlib): {OCAK[:12]}…')
    chk(z['bayti'] == len(SUROVO), f'velikost = {len(SUROVO)} B (dejanski bajti, ne dolžina base64)')
    chk(z['format'] == 'image/jpeg' and z['vir'] == 'KAMERA' and z['lokacija'] == 'vrt', 'izvod nosi format, vir in lokacijo originala')
    chk(z['dataUrl'] == 'string', 'binarna vsebina je na voljo (pot jo izroči samo ob izrecni zahtevi)')
    chk(z['zajeto'] is None, 'brez createdAt v vhodu → datum ni izmišljen')
    chk(B['brezSlike']['sha256'] is None and B['brezSlike']['bayti'] == 0, 'zajem brez slike → sha256 = null, bayti = 0 (brez izmišljenega odtisa)')
    chk(B['neSlika']['sha256'] is None and B['neSlika']['format'] is None, 'ne-slika (data:text/html) ni šteta kot original')

# ═══ C) camera-prefs: spomin, ki ne ukazuje napravi ═════════════════════════
print('── C) camera-prefs: neveljavno → privzeto; zapis ≠ ukaz napravi')
C = bun_js(r'''
const { preberiNastavitve, zapisiNastavitve, nastaviSmer, nastaviSvetilko, napisNastavitev, shramba, PRIVZETE_NASTAVITVE, PREFS_KLJUC } = await import('./src/lib/camera-prefs')
const mk = (zacetno = {}, vrze = false) => { const m = { ...zacetno }; return {
  getItem: (k) => (k in m ? m[k] : null),
  setItem: (k, v) => { if (vrze) throw new Error('poln disk'); m[k] = v },
} }
const skupna = mk()
nastaviSmer(skupna, 'user')
nastaviSvetilko(skupna, true)
const pisatiNeMore = mk({}, true)
console.log(JSON.stringify({
  PRIVZETE: PRIVZETE_NASTAVITVE,
  niShrambe: preberiNastavitve(null),
  prazna: preberiNastavitve(mk()),
  shranjeno: preberiNastavitve(mk({ [PREFS_KLJUC]: JSON.stringify({ smer: 'user', svetilkaNazadnje: true }) })),
  smeti: preberiNastavitve(mk({ [PREFS_KLJUC]: '{kaj' })),
  neveljavna: preberiNastavitve(mk({ [PREFS_KLJUC]: JSON.stringify({ smer: 'stranska', svetilkaNazadnje: 'da' }) })),
  zavrnjenoPisanje: [nastaviSmer(pisatiNeMore, 'user'), nastaviSvetilko(pisatiNeMore, true), zapisiNastavitve(null, { smer: 'user', svetilkaNazadnje: false })],
  poObeh: preberiNastavitve(skupna),
  napisSvetilka: napisNastavitev({ smer: 'user', svetilkaNazadnje: true }, false),
  napisZePrižgana: napisNastavitev({ smer: 'user', svetilkaNazadnje: true }, true),
  napisPrivzeta: napisNastavitev(PRIVZETE_NASTAVITVE, false),
  ssr: shramba(),
}))
''')
if '_err' in C:
    bad(f'bun C: {C["_err"]}')
else:
    chk(C['PRIVZETE'] == {'smer': 'environment', 'svetilkaNazadnje': False}, 'privzeto je zadnja kamera in izklopljena svetilka')
    chk(C['niShrambe'] == C['PRIVZETE'] and C['prazna'] == C['PRIVZETE'], 'brez shrambe / prazna shramba → privzeto (nič ne trdimo)')
    chk(C['shranjeno'] == {'smer': 'user', 'svetilkaNazadnje': True}, 'shranjene nastavitve se vrnejo kot shranjene')
    chk(C['smeti'] == C['PRIVZETE'], 'okvarjen JSON → privzeto in ne padec')
    chk(C['neveljavna']['smer'] == 'environment' and C['neveljavna']['svetilkaNazadnje'] is False, 'neznan niz smeri in ne-boolean svetilke → privzeto, nikoli izmišljena smer')
    chk(C['zavrnjenoPisanje'] == [False, False, False], 'shramba, ki zavrne pisanje → false (monter ne dobi lažnega potrdila)')
    chk(C['poObeh'] == {'smer': 'user', 'svetilkaNazadnje': True}, 'druga nastavitev NE pobriše prve (merge, ne prepis)')
    chk('sprednja' in C['napisSvetilka'] and 'svetilko' in C['napisSvetilka'], 'napis pove smer in opomni na nazadnje prižgano svetilko')
    chk('svetilko' not in C['napisZePrižgana'], 'če je svetilka ZE prižgana, opomina ni (šum, ki bi vodil v napačno akcijo)')
    chk('svetilko' not in C['napisPrivzeta'], 'privzeto stanje ne opominja na svetilko, ki je monter nikoli ni prižgal')
    chk(C['ssr'] is None, 'SSR (brez window) → shramba je null, dostopa do brskalnika ni')

# ═══ D) žičenje: potrditev → paket, izvoz in PDF → isti dokaz ═══════════════
print('── D) žičenje poti in UI (source grep)')
confirm = src('src/app/api/measurement/confirm/route.ts')
chk('const { user, perms } = auth' in confirm, 'CONFIRM: seja pozna tudi pravice (perms) — pogoj za prenos')
chk('handoffProductId' in confirm and "perms.includes('quotes.create')" in confirm, 'CONFIRM: prenos zahteva IZRECEN izdelek in pravico quotes.create')
chk("'IZMERA'" in confirm and 'MEASUREMENT_HANDOFF' in confirm, 'CONFIRM: paket nastane v statusu IZMERA in je zabeležen v reviziji')
chk('odlociPaket' in confirm and 'postojeciPaketId' in confirm, 'CONFIRM: odločitev gre skozi čist modul (idempotentnost pred ustvarjanjem)')
rok = confirm[confirm.index('calcJson:'):confirm.index('note: `§8 prenos')]
chk(all(p not in rok.lower() for p in ('cena', 'marža', 'marza', 'popust', 'bom', 'neto', 'bruto')), 'CONFIRM: calcJson prenosa je BREZ cen, marž in kosovnice (en sam cenovni vir)')
chk('return NextResponse.json({ data: measurement, ...(paket !== null ? { paket } : {}) }' in confirm, 'CONFIRM: prenos je ADITIVEN (data ostaja, paket je dodan)')
chk('const MAX_VIEWS = 4' in confirm, 'CONFIRM: MAX_VIEWS ostaja 4 (r455 testira mejo — dvig bi oslabil merilo sprejetja)')

export = src('src/app/api/measure-engine/export/route.ts')
chk('fotografiIzParametrov' in export and 'originalDokaz' in export, 'IZVOZ: originale računa ISTA funkcija kot PDF (izkaz se ne more razhajati)')
chk("url.searchParams.get('originals') === '1'" in export, 'IZVOZ: binarna vsebina samo ob izrecni zahtevi originals=1')
chk('zgodovina' in export and 'sha256' in export and 'bayti' in export, 'IZVOZ: JSON nosi zgodovino, SHA-256 in velikost')
chk("orderBy: { version: 'desc' }" in export and 'take: 1' not in export, 'IZVOZ: zgodovina je CELA (vse verzije), ne samo zadnja')
chk('originali: originali.map((o) => ({ id: o.id, sha256: o.sha256, bayti: o.bayti }))' in export, 'IZVOZ: revizija dokumentira odtise brez binarnih vsebin')
chk("'\\uFEFF' + exportCsv(src)" in export, 'IZVOZ: CSV pot ostane nespremenjena (r487 mora ostati zelen)')

pdf = src('src/app/api/pdf/[type]/[id]/route.ts')
chk('originaliZaMeritve' in pdf and 'fotografiIzParametrov' in pdf, 'PDF: izvirniki so poiskani iz params meritve, ne iz ročnega vnosa')
chk('ctx.run.measurementId' in pdf, 'PDF: dokazna veriga je vezana na KANONICNO meritev tekača (§17)')
chk('cutList, cutListNote, photos, checks, avtor, zgodovina, originali,' in pdf, 'PDF: avtor + zgodovina + originali grejo v renderer')
chk("orderBy: { version: 'desc' }" in pdf, 'PDF: tudi tu je zgodovina vseh verzij, ne samo zadnje')

pdfLib = src('src/lib/measure-package-pdf.ts')
chk("'DOKAZNA VERIGA DOKUMENTA'" in pdfLib, 'PDF: dokument ima izrecen blok dokazne verige')
chk("MEASURE_PACKAGE_VERSION = 'measure-package-pdf/1.1'" in pdfLib, 'PDF: verzija predloge je dvignjena (1.0 → 1.1)')
chk('ensure(doc, f, 12)' in pdfLib and 'ensure(doc, f, 13)' in pdfLib, 'PDF: blok upošteva prelom strani (ne seka vrstice čez rob)')

kamera = src('src/components/roksal/modules/meritve-kamera.tsx')
chk('preberiNastavitve(shramba())' in kamera, 'KAMERA: nastavitve se berejo prek DOM-free bralnika')
chk('nastaviSmer(shramba(), smer)' in kamera, 'KAMERA: uspešen zagon kamere shrani smer')
chk('nastaviSvetilko(shramba(), prižgana)' in kamera, 'KAMERA: svetilka se shrani samo za stanje, ki ga UI zares pokaže')
chk(kamera.count('nastaviTorch(') == 1, 'KAMERA: nastaviTorch je klican SAMO v monterjevem aktu (spomin ne prižge luči)')
chk('napisNastavitev(nastavitve, torchNa)' in kamera, 'KAMERA: opomnik o spominu je viden monterju')

lock = src('package.json')
for prepoved in ('@tensorflow', 'onnxruntime', 'opencv', 'huggingface', 'openai'):
    chk(prepoved not in lock, f'BREZ nove odvisnosti: {prepoved}')

print(f'════ R509: {PASS}✓ / {FAIL}✗ ════')
sys.exit(1 if FAIL else 0)
