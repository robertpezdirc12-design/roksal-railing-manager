#!/usr/bin/env python3
"""tests/r511.py — R511 (issue #7 §8/§10, issue #3 §4E): KOSOVNICA IZ POTRJENE
OGRAJNE GEOMETRIJE.

Kaj ta suite ščiti — štiri resnične napake, ne dekoracija:
  A) izberiGeometrijo (čista funkcija): obseg sme priti iz tekača SAMO, kadar je
     tekač en sam in potrjen, veriga je zaprta in urejena, vsak segment je
     poslovno uporaben, projekt se ujema. Vse ostalo → PREDLOGA z razlogom in
     opozorilno kodo (brez tihe domišljije, brez tiha na novo).
  B) pretvorba v obstoječi m-format: ključi seg-N v vrstnem redu teka, cm → m na
     cel cm, višina null kadar je ni; determinizem neurejenega vhoda;
     idempotentnost (dva klica = isti izhod); izhod NE nosi cene ali marže.
  C) žičenje (source grep): R501 poslovna vrata ostanejo PRVA; geometrija se
     računa samo, kadar konfiguratorjih segmentov ni in je mera vezana;
     planBom je EN KLIC (isto jedro); odlok je zapisan v kalkulacijo, revizijo,
     opombo kosovnice in ga vidi pisarna v UI.
  D) meje: modul je čist (brez Prisma/next/DOM), nima drugega pretvornika
     segmentov, ne spreminja sheme, ne dodaja odvisnosti, ne dotika
     segmentne matematike ali cenovnega jedra.

Suite NE potrebuje strežnika in NE piše v bazo. Brez novih odvisnosti, brez AI.
"""
import json
import os
import re
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


print('════ R511 — kosovnica iz potrjene ograjne geometrije (issue #7 §8/§10) ════')

# ═══ A) izberiGeometrijo: obseg samo, kadar je dokazan ══════════════════════
print('── A) izbira vira: fail-closed odločitev o geometriji')
A = bun_js(r'''
const { izberiGeometrijo, GEOMETRY_SOURCE_VERSION } = await import('./src/lib/measure-geometry-source')
const SEG = (o = {}) => ({ order: 0, fromAtCm: 0, toAtCm: 500, lengthCm: 500, heightCm: 120, status: 'VERIFIED', ...o })
const TEKOC = (o = {}) => ({ id: 'tek-1', status: 'POTRJEN', projectId: 'pr1', segmenti: [SEG()], ...o })
const V = (o = {}) => ({ paketProjectId: 'pr1', paketZeImaSegmente: false, razmikStebrovCm: null, tekoci: [TEKOC()], ...o })
const izp = (v) => { const r = izberiGeometrijo(v); return { odlok: r.odlok, razlog: r.razlog, opozorila: r.opozorila, row: r.rows.length, run: r.fenceRunId, dolzina: r.dolzinaCm } }
console.log(JSON.stringify({
  VERSION: GEOMETRY_SOURCE_VERSION,
  konfigur: izp(V({ paketZeImaSegmente: true, razmikStebrovCm: 150 })),
  brezTekoca: izp(V({ tekoci: [] })),
  osnutek: izp(V({ tekoci: [TEKOC({ id: 'tek-9', status: 'OSNUTEK' })] })),
  dvaPotrjena: izp(V({ tekoci: [TEKOC({ id: 'tek-a' }), TEKOC({ id: 'tek-b' })] })),
  tujProjekt: izp(V({ tekoci: [TEKOC({ projectId: 'pr2' })] })),
  prazni: izp(V({ tekoci: [TEKOC({ segmenti: [] })] })),
  prazniNull: izp(V({ tekoci: [TEKOC({ segmenti: null })] })),
  zacetekNi0: izp(V({ tekoci: [TEKOC({ segmenti: [SEG({ order: 1 })] })] })),
  nezaporeden: izp(V({ tekoci: [TEKOC({ segmenti: [SEG(), SEG({ order: 2, fromAtCm: 500, toAtCm: 900, lengthCm: 400 })] })] })),
  nicelnaDolzina: izp(V({ tekoci: [TEKOC({ segmenti: [SEG({ lengthCm: 0 })] })] })),
  negativna: izp(V({ tekoci: [TEKOC({ segmenti: [SEG({ lengthCm: -300 })] })] })),
  brezPoloZaja: izp(V({ tekoci: [TEKOC({ segmenti: [SEG({ fromAtCm: null })] })] })),
  zacetekOdmaknjen: izp(V({ tekoci: [TEKOC({ segmenti: [SEG({ fromAtCm: 40 })] })] })),
  pretrg: izp(V({ tekoci: [TEKOC({ segmenti: [SEG(), SEG({ order: 1, fromAtCm: 560, toAtCm: 900, lengthCm: 340 })] })] })),
  prekrivanje: izp(V({ tekoci: [TEKOC({ segmenti: [SEG(), SEG({ order: 1, fromAtCm: 480, toAtCm: 900, lengthCm: 420 })] })] })),
  mejniPretrg: izp(V({ tekoci: [TEKOC({ segmenti: [SEG(), SEG({ order: 1, fromAtCm: 501, toAtCm: 900, lengthCm: 399 })] })] })),
  slabiSegmenti: izp(V({ tekoci: [TEKOC({ segmenti: [SEG(), SEG({ order: 1, fromAtCm: 500, toAtCm: 900, lengthCm: 400, status: 'ESTIMATED' })] })] })),
  razveljavljen: izp(V({ tekoci: [TEKOC({ segmenti: [SEG({ status: 'INVALIDATED' })] })] })),
  neznanoStanje: izp(V({ tekoci: [TEKOC({ segmenti: [SEG({ status: 'PRISLO' })] })] })),
  ok: izp(V()),
  razmik: izp(V({ razmikStebrovCm: 180 })),
}))
''')
if '_err' in A:
    bad(f'bun A: {A["_err"]}')
else:
    chk(A['VERSION'] == 'measure-geometry-source/1.0', 'pogodba vira geometrije ima fiksno verzijo (sledljivost odločitve)')
    k = A['konfigur']
    chk(k['odlok'] == 'KONFIGURATOR' and k['row'] == 0 and k['run'] is None, 'konfiguratorjevi segmenti imajo PREDNOST — tekač jih ne prepisuje (brez posega v obstoječi tok)')
    chk(k['razlog'].startswith('Paket že nosi'), 'odlok KONFIGURATOR nosi razlog, ne prazne vrstice')
    chk(A['brezTekoca']['odlok'] == 'PREDLOGA' and 'nima ograjnega tekača' in A['brezTekoca']['razlog'], 'brez tekača → pošten padec na predlogo z razlogom (obstoječe vedenje ostane)')
    chk(A['osnutek']['odlok'] == 'PREDLOGA' and 'POTRJEN' in A['osnutek']['razlog'] and 'tek-9' in A['osnutek']['razlog'], 'OSNUTEK tekača ni dokazan obseg — zavrnjeno in v razlogu je ID in stanje')
    d = A['dvaPotrjena']
    chk(d['odlok'] == 'PREDLOGA' and 'VECPOTRJENIH' in d['opozorila'], 'dva potrjena tekača = dva vira resnice → NE izbere prvega namesto pisarne')
    chk('tek-a' in d['razlog'] and 'tek-b' in d['razlog'], 'razlog našteje oba tekača, da je odločitev dejanska')
    chk(A['tujProjekt']['odlok'] == 'PREDLOGA' and 'TUJI_PROJEKT' in A['tujProjekt']['opozorila'], 'tekač drugega projekta ne napaja kosovnice tega paketa (IDOR v podatkih)')
    chk(A['prazni']['odlok'] == 'PREDLOGA' and 'BREZ_SEGMENTOV' in A['prazni']['opozorila'], 'potrjen tekač brez segmentov ne dobi količin iz prazne verige')
    chk(A['prazniNull']['odlok'] == 'PREDLOGA', 'segmenti = null → zavrnjeno, ne padec (robusten vhod)')
    for kljuc, kod, opis in (
        ('zacetekNi0', 'PRETRGANA_VERIGA', 'veriga, ki se ne začne pri 0'),
        ('nezaporeden', 'PRETRGANA_VERIGA', 'vrstni red brez zaporedne številke'),
        ('nicelnaDolzina', 'BREZ_DOLZINE', 'ničelna dolžina segmenta'),
        ('negativna', 'BREZ_DOLZINE', 'negativna dolžina segmenta'),
        ('brezPoloZaja', 'BREZ_POLOZAJA', 'manjkajoč položaj ob teku'),
        ('zacetekOdmaknjen', 'PRETRGANA_VERIGA', 'začetek teka zamaknjen za 40 cm'),
        ('pretrg', 'PRETRGANA_VERIGA', '60 cm pretrg med segmentoma'),
        ('prekrivanje', 'PREKRIVANJE', '20 cm prekrivanje segmentov'),
    ):
        r = A[kljuc]
        chk(r['odlok'] == 'PREDLOGA' and kod in r['opozorila'], f'poškodna geometrija → PREDLOGA + {kod}: {opis}')
        chk(r['row'] == 0, f'{kljuc}: poškodovana veriga NE vrne rows (sicer bi bile količine iz luknje)')
    chk(A['mejniPretrg']['odlok'] == 'TEKOC', '1 cm pretrg je še znotraj tolerance zaokrožitve (sicer bi zavrnili vsak tekač s cm roundingom)')
    sl = A['slabiSegmenti']
    chk(sl['odlok'] == 'PREDLOGA' and 'SEGMENT_NI_POTRJEN' in sl['opozorila'], 'segment raven ESTIMATED → celoten tekač je zavrnjen (kosovnica iz ocene ni dovoljena)')
    chk('1 (ESTIMATED)' in sl['razlog'], 'razlog pove KATERI segment je slab — monter ve, kaj mora ponovno izmeriti')
    chk(A['razveljavljen']['odlok'] == 'PREDLOGA' and 'INVALIDATED' in A['razveljavljen']['razlog'], 'razveljavljen segment blokira enako kot mera (ISTA vrata kot R501)')
    chk(A['neznanoStanje']['odlok'] == 'PREDLOGA', 'neznano stanje segmenta ni poslovna mera (fail-closed v obe smeri)')
    chk(A['ok']['odlok'] == 'TEKOC' and A['ok']['row'] == 1 and A['ok']['run'] == 'tek-1' and A['ok']['dolzina'] == 500, 'potrjen, zaprt, en tekač → TEKOC z dolžino verige')
    chk('BREZ_RAZMIKA' in A['ok']['opozorila'], 'brez razmika se razmik NE izmišljuje — obstoječa matematika javi BREZ_RAZMIKA')
    chk('BREZ_RAZMIKA' not in A['razmik']['opozorila'], 'vnosni razmik 180 cm se prenese naprej (viri: vnos > pravilo, kot ga že pozna R475)')

# ═══ B) pretvorba v obstoječi m-format — determinizem in eno samo jedro ═════
print('── B) rows: isti m-format kot konfigurator, determinističen in brez cen')
B = bun_js(r'''
const { izberiGeometrijo } = await import('./src/lib/measure-geometry-source')
const SEG = (o) => ({ order: o.order, fromAtCm: o.from, toAtCm: o.to, lengthCm: o.len, heightCm: o.h ?? null, status: o.st ?? 'CONFIRMED' })
const tri = [SEG({ order: 0, from: 0, to: 500, len: 500, h: 120 }), SEG({ order: 1, from: 500, to: 900, len: 400 }), SEG({ order: 2, from: 900, to: 1420, len: 520, h: 95.5 })]
const V = (segi) => ({ paketProjectId: 'pr1', paketZeImaSegmente: false, razmikStebrovCm: 200, tekoci: [{ id: 'tek-x', status: 'POTRJEN', projectId: 'pr1', segmenti: segi }] })
const en = izberiGeometrijo(V(tri))
const neurejen = izberiGeometrijo(V([tri[2], tri[0], tri[1]]))
const ponovljen = izberiGeometrijo(V(tri))
// 1 cm pretrg je znotraj tolerance zaokrožitve, a zaključni položaj (901 cm) se
// razide z vsoto merjenih dolžin (900 cm) — kosovnico napaja dolžina, ne položaj.
const toleranca = izberiGeometrijo(V([SEG({ order: 0, from: 0, to: 500, len: 500, h: 120 }), SEG({ order: 1, from: 501, to: 901, len: 400, h: 120 })]))
console.log(JSON.stringify({
  rows: en.rows, dolzina: en.dolzinaCm, razlog: en.razlog, razmik: en.razmikStebrovCm,
  neurejenRows: neurejen.rows, neurejenDolzina: neurejen.dolzinaCm,
  tolerancaOdlok: toleranca.odlok, tolerancaDolzina: toleranca.dolzinaCm,
  idempotentno: JSON.stringify(ponovljen) === JSON.stringify(en),
  kljuci: en.rows.map((r) => r.kljuc),
  polja: [...new Set(en.rows.flatMap((r) => Object.keys(r)))].sort(),
  izhodPolja: Object.keys(en).sort(),
  razlog2: neurejen.razlog,
}))
''')
if '_err' in B:
    bad(f'bun B: {B["_err"]}')
else:
    chk(B['kljuci'] == ['seg-1', 'seg-2', 'seg-3'], 'ključi so seg-N po vrstnem redu teka — ISTA konvencija kot fence-run in digitalni dvojček')
    r1, r2, r3 = B['rows']
    chk(r1['dolzina'] == 5 and r1['visina'] == 1.2, '500 cm → 5 m in 120 cm → 1,2 m (m-format, zaokroženo na cel cm)')
    chk(r2['visina'] is None, 'segment brez višine → visina null, ne 0 (BREZ_VISINE mora ostati viden)')
    chk(r3['dolzina'] == 5.2 and r3['visina'] == 0.96, 'višina 95,5 cm → 0,96 m (zaokrožitev na cel cm, ne na decimeter)')
    chk(B['dolzina'] == 1420, 'dolzinaCm = vsota merjenih dolžin (500+400+520 = 1420 cm), ne število spojev')
    chk(B['tolerancaOdlok'] == 'TEKOC' and B['tolerancaDolzina'] == 900, '1 cm pretrg je še sprejet, a dolzinaCm šteje dolžine (900 cm), ne zaključni položaj (901 cm) — količine se ne podvojijo')
    chk(B['neurejenRows'] == B['rows'] and B['neurejenDolzina'] == B['dolzina'], 'neurejen vhod (2,0,1) da ISTI rezultat — veriga se uredi po `order`, izvorni vrstni red ni odločilen')
    chk(B['idempotentno'], 'dva klica z istim vhodom = identičen izhod (determinizem za revizijsko sled)')
    chk(B['polja'] == ['dolzina', 'kljuc', 'visina'], 'rows nosi SAMO tri ključe, ki jih normalizeSegments razume (brez skrivnostnih polj)')
    chk(B['razmik'] == 200 and B['izhodPolja'] == ['dolzinaCm', 'fenceRunId', 'odlok', 'opozorila', 'razlog', 'razmikStebrovCm', 'rows'], 'izhod ima točno pogodba polja — nobeno od tod ne more prinesti cene')
    strukturni = json.dumps({'rows': B['rows'], 'dolzina': B['dolzina'], 'razmik': B['razmik'], 'polja': B['izhodPolja']}, ensure_ascii=False).lower()
    chk(all(p not in strukturni for p in ('cena', 'marža', 'marza', 'popust', 'neto', 'bruto', 'price', 'cost', 'eur')), 'strukturni izhod (rows, dolžina, razmik, polja) ne nosi cene ali marže — en sam cenovni vir ostane product-core')

# ═══ C) žičenje: R501 vrata ostanejo prva, planBom ostane ENO ═══════════════
print('── C) žičenje poti (source grep)')
bom = src('src/app/api/project-packages/[id]/bom/route.ts')

iVrata = bom.index('measurementStatusAllowsBusiness(pkg.measurement.status)')
iGeom = bom.index('izberiGeometrijo(')
iPlan = bom.index('await planBom(')
chk(iVrata < iGeom < iPlan, 'VRSTNI RED: R501 poslovna vrata → geometrija → planBom (meritev ocene ne more priti niti do izbire vira)')
chk(bom.count('await planBom(') == 1, 'planBom je poklican ENKRAT (isto cenovno/merilno jedro, ne dva)')
chk('if (segments.length === 0 && pkg.measurement?.id)' in bom, 'geometrija se računa SAMO, kadar konfiguratorjih segmentov ni in je mera vezana (obstoječi tokovi se ne dotaknejo)')
chk('where: { measurementId: pkg.measurement.id }' in bom, 'tekači se iščejo PO MERITVI paketa, ne po projectu (kanonična mera §17)')
chk("orderBy: { order: 'asc' }" in bom, 'segmenti se berejo urejeni po teku (vrstni red je del geometrije)')
chk('select: { order: true, fromAtCm: true, toAtCm: true, lengthCm: true, heightCm: true, status: true }' in bom, 'branch bere samo polja, ki jih odločitev potrebuje (brez selekcije celi vrstice)')
chk("if (geometrija.odlok === 'TEKOC') segments = normalizeSegments(geometrija.rows)" in bom, 'rows gredo naprej skozi OBSTOJEČI normalizeSegments (drugega pretvornika ni)')
chk('GEOMETRY_SOURCE_VERSION' in bom and 'geometrijaOdlok' in bom, 'izbrana verzija in odlok gresta v revizijo (BOM_GENERATE)')
chk('segmentov: geometrija.rows.length' in bom, 'kalkulacija zabeleži število segmentov, iz katerih so količine')
chk('odlok: geometrija.odlok' in bom and 'razlog: geometrija.razlog' in bom, 'kalkulacija zabeleži odlok IN razlog (odločitev je berljiva čez tri mesece)')
chk('obseg iz potrjenega tekača' in bom, 'opombo kosovnice pove, da je obseg iz tekača')
chk('obseg tekač ne more dokazati' in bom, 'opombo pove tudi, kadar obseg NI dokazan (predloga × mera je vidna, ne tiha)')
chk('...(geometrija ? { geometrija } : {})' in bom, 'odlok je vrnjen pisarni v odgovoru, ne samo shranjen')
chk('const MAX_VIEWS = 4' in src('src/app/api/measurement/confirm/route.ts'), 'CONFIRM: merilo sprejetja r455 (MAX_VIEWS = 4) ostaja nedotaknjeno')

ui = src('src/components/roksal/modules/projekti.tsx')
chk('?.geometrija ?? null' in ui, 'UI: dialog kosovnice prebere vir geometrije iz kalkulacije')
chk('Vir obsega:' in ui, 'UI: pisarna vidi naslov "Vir obsega" — ne samo število vrstic')
chk('dokazanega obsega ni' in ui, 'UI: padec na predlogo je napisan z besedami, ne samo z kodo')
chk('Opozorila: {(geometrija.opozorila ?? []).join' in ui, 'UI: opozorila (BREZ_RAZMIKA / BREZ_VISINE) so vidna')

# ═══ D) meje: čist modul, nobenega novega jedra, nobene sheme ═══════════════
print('── D) OMEJITVE: eno merilno/cenovno jedro, brez novih stolpcev in odvisnosti')
gm = src('src/lib/measure-geometry-source.ts')
# komentarje smemo kršiti besedilu, kode ne — zato ločena pregleda
koda = '\n'.join(l for l in gm.splitlines() if not l.strip().startswith('//'))

chk('import { measurementStatusAllowsBusiness } from' in koda and 'R501' in gm, 'modul UPORABLJA obstoječa poslovna vrata (R501), jih ne definira ponovno — ena lestvica statusov')
chk("import type { RawSegmentRow } from '@/lib/segment-bom'" in koda, 'od segmentne matematike modul pozna SAMO tip vrstice (type import — brez vrednosti, brez krožne odvisnosti)')
chk('normalizeSegments(' not in koda and 'planBom(' not in koda and 'resolveSegmentRules' not in koda, 'modul NE kliče normalizeSegments, planBom ali resolveSegmentRules — pravila in količine ostanejo v obstoječem jedru')
for prepoved in ('@prisma', 'next/server', 'react', 'document.', 'window.', 'fetch('):
    chk(prepoved not in koda, f'ČIST MODUL: brez {prepoved}')
chk('db.' not in koda, 'modul ne sega v bazo (branje pusti strežniku — odločitev ostane čista in testljiva)')
for stolpec in ('salePrice', 'materialCost', 'priceSource', 'marginPct', 'margin', 'popust', 'EUR'):
    chk(stolpec not in koda, f'koda modula ne pozna pojma {stolpec} (cene ostanejo v product-core)')

core = src('src/lib/product-core.ts')
chk('segments?: SegmentInput[]' in core and 'spacingCm?: number' in core, 'planBom ima obstoječa vhoda segments/spacingCm — R511 napaja ISTA vrata, ne novih')

porabniki, ai_poti = [], []
for root, _dirs, files in os.walk(os.path.join(REPO, 'src')):
    for f in files:
        if not f.endswith(('.ts', '.tsx')):
            continue
        rel = os.path.relpath(os.path.join(root, f), REPO).replace(os.sep, '/')
        vsebina = src(rel)
        if 'measure-geometry-source' in rel.rsplit('/', 1)[-1]:
            continue
        if 'measure-geometry-source' in vsebina:
            porabniki.append(rel)
        if 'z-ai-web-dev-sdk' in vsebina:
            ai_poti.append(rel)
chk(porabniki == ['src/app/api/project-packages/[id]/bom/route.ts'], f'ENO SAMO PORABNIK modula (sicer bi druga pot lahko obšla R501 vrata) — najdeno: {porabniki}')
chk('src/app/api/project-packages/[id]/bom/route.ts' not in ai_poti, 'KOSOVNICA NE kliče AI modela — količine smejo izhajati iz dokazane mere, ne iz ocene (issue #15: AI ostaja samo pri predlogih)')

schema = src('prisma/schema.prisma')
for model, polja in (
    ('FenceRun', ('measurementId', 'projectId', 'status')),
    ('FenceSegment', ('order', 'fromAtCm', 'toAtCm', 'lengthCm', 'heightCm', 'status')),
    ('ProjectPackage', ('calcJson', 'measurementId', 'productId', 'qty')),
):
    m = re.search(r'\nmodel ' + model + r' \{\n(.*?)\n\}', schema, re.S)
    chk(m is not None, f'SHEMA: model {model} obstaja')
    if m:
        telo = m.group(1)
        for p in polja:
            chk(re.search(r'^\s{2}' + p + r'\b', telo, re.M) is not None, f'SHEMA: {model}.{p} je obstoječe polje (pot bere samo že obstoječa)')
chk(not re.search(r'^\s{2}\w*(geometri\w*|geometrySource|seg\w*Source)\w*\s', schema, re.M), 'SHEMA: noben stolpec za vir geometrije — odločitev živi v calcJson in reviziji')
migracije = [d for d in os.listdir(os.path.join(REPO, 'prisma', 'migrations')) if 'r511' in d.lower() or 'geometry' in d.lower()]
chk(migracije == [], f'BREZ nove migracije za R511 (najdeno: {migracije})')

deps = list(json.loads(src('package.json')).get('dependencies', {}))
chk(not any('geometry' in d or 'measure' in d for d in deps), 'ODVISNOSTI: R511 ni dodal paketa po imenu geometrije/merjenja (izpeljava živi v obstoječih modulih)')
chk(all(v not in deps for v in ('@tensorflow/tfjs', 'onnxruntime-node', 'opencv', '@huggingface/inference', 'replicate', 'transformers')), 'ODVISNOSTI: R511 ni prinesel novega inferenčnega paketa (issue #15: merilno jedro ostane deterministično)')
chk('z-ai-web-dev-sdk' in deps, 'OBSTOJEČA AI odvisnost (detect/AR/foto-zamenjava) je dokumentirana meja, ne nova — R511 je ne sme prenesti v količinsko pot')
chk(len(ai_poti) >= 1 and all('/api/ar/' in p or '/api/measurement/' in p or 'photo-replace' in p or 'foto-replace' in p for p in ai_poti), f'AI klici so omejeni na predlagalne poti (detect/AR/foto-zamenjava) — najdeno: {sorted(ai_poti)}')
chk('sharp' in deps, 'obstoječi sharp (pipeline sredstev) ostaja nedotaknjen')

print(f'════ R511: {PASS} ✓ / {FAIL} ✗ ════')
sys.exit(1 if FAIL else 0)
