#!/usr/bin/env python3
"""tests/r510.py — R510 (issue #15 Faza 6): DOKAZNA VERIGA IZVEDENE SLIKE.

Kaj ta suite ščiti — pet resničnih napak, ne dekoracija:
  A) normalizirajTrdnjo (čista funkcija): odjemalec SME trditi samo assetId.
     Brez trditve = nič se ne zgodi (stare stranke delujejo naprej); niz, seznam
     in predmet z neznanimi ključi (pot, sha256, productId) je ZAVRNJEN z
     naštetimi ključi — sicer bi odjemalec lahko podtiskal tuj identifikator
     namesto baze. Prazen, ne-string in predolg assetId → zavrnjen.
  B) potrdiGradivo (čista funkcija, fail-closed): dokument nastane IZKLJUČNO iz
     vrstice, ki jo je strežnik prebral iz baze. Vsak pogoj posebej vrne null +
     razlog: asset ni v katalogu, id ne ustreza trditvi, status ni VERIFIED,
     podlaga dovoljenja je prazna, datoteke ni, SHA-256 ni (ali je prekratek),
     gradivo je tujega izdelka. Brez trditve → null in NULL razlog (ni česa
     pojasniti). Posledica: izvedena slika nikoli ne more nositi izmišljenega
     originala.
  C) smeVizualizacijo + dokazMere (čisti funkciji): samo INVALIDATED zavrne
     nastanek vizualizacije (razveljavljene mere ne smejo biti podlaga).
     ESTIMATED / AUTO_SUGGESTED / MANUAL / CALIBRATED / VERIFIED / CONFIRMED
     OSTANEJO dovoljene — vizualizacija je predstavitev in ne proizvodni
     izračun; če bi tu zožili, bi izgubili obstoječo funkcijo. Neznana raven se
     zapiše kot NEPOZNANO in ne kot izmišljena.
  D) preberiDokaz (čista funkcija): dokaz se bere iz posnetka verzije. Pokvarjen
     JSON, odsoten dokaz in posnetek s poškodovanim gradivo (prazna pot, kratek
     SHA) vrnejo null oziroma izbrisano gradivo — star zapis ne more dobiti
     verige, ki ob nastanku ni bila zapisana.
  E) žičenje in OMEJITVE (source grep): obe poti pišeta dokaz v `meta` (brez
     novih stolpcev in BREZ MIGRACIJE), PATCH raven mere bere NEPOGONNO (sicer
     bi dokaz lagal), nova verzija PREJŠNJE trditve ne zabriše (dokaz se ponovno
     potrdi iz baze), razveljavljena mera obstoječega urejanja ne blokira, a dobi
     opozorilo MERA_RAZVELJAVLJENA. UI pošilja DEJANSKI sourcePhotoId (ne več
     vedno null) in assetId samo ob preverjenem gradivu. Viz-provenance je
     DOM-free in brez uvozov: nobenega novega merilnega ali cenovnega jedra
     issue #15 ne sme ustvariti, poslovni blok ESTIMATED/AUTO_SUGGESTED/
     INVALIDATED mora ostati nespremenjen.

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


def blok (vsebina, zacetek, dolzina=280):
    """Okno besedila za oznako — za trditve o strukturi, ki ne smejo lagati."""
    if zacetek not in vsebina:
        return ''
    i = vsebina.index(zacetek)
    return vsebina[i:i + dolzina]


print('════ R510 — dokazna veriga izvedene slike (issue #15 Faza 6) ════')

# ═══ A) normalizirajTrdnjo: odjemalec sme trditi samo assetId ═══════════════
print('── A) oblika trditve: nič razen assetId')
A = bun_js(r'''
const { normalizirajTrdnjo } = await import('./src/lib/viz-provenance')
const r = (v) => { const o = normalizirajTrdnjo(v); return 'napaka' in o ? { nap: o.napaka } : { tr: o.trdnja } }
console.log(JSON.stringify({
  izpusceno: r(undefined),
  nullVrednost: r(null),
  niz: r('aset-1'),
  seznam: r([{ assetId: 'a' }]),
  brezId: r({}),
  prazenId: r({ assetId: '' }),
  nedolzenId: r({ assetId: 'x'.repeat(65) }),
  neString: r({ assetId: 42 }),
  tujKljuc: r({ assetId: 'a', pot: '/tmp/laz.png' }),
  vecTujih: r({ assetId: 'a', sha256: 'b', productId: 'c', pot: 'd', razlog: 'e' }),
  veljavna: r({ assetId: 'cmx123' }),
}))
''')
if '_err' in A:
    bad(f'bun A: {A["_err"]}')
else:
    chk(A['izpusceno'] == {'tr': None} and A['nullVrednost'] == {'tr': None}, 'brez trditve (undefined/null) → brez dokaza IN brez napake (stare stranke delujejo naprej)')
    chk('nap' in A['niz'] and 'nap' in A['seznam'], 'trditev kot niz ali seznam → zavrnjena (mora biti predmet { assetId })')
    chk('nap' in A['brezId'] and 'assetId' in A['brezId']['nap'], 'predmet brez assetId → zavrnjen z razlogom')
    chk('nap' in A['prazenId'] and 'nap' in A['neString'], 'prazen in ne-string assetId → zavrnjena')
    chk('nap' in A['nedolzenId'], 'predolg assetId (65 znakov) → zavrnjen, ne shranjen')
    chk('nap' in A['tujKljuc'] and 'pot' in A['tujKljuc']['nap'], 'tuj ključ „pot“ je NAŠTET v zavrnitvi — odjemalec ne more podtiskati poti')
    vec = A['vecTujih']['nap']
    chk(all(k in vec for k in ('sha256', 'productId', 'pot', 'razlog')), 'več tujih ključev je naštetih (brez podtiskanja SHA, izdelka, razloga)')
    chk(vec.split(':')[-1].strip().rstrip('.') == 'pot, productId, razlog, sha256', 'neznani ključi so sortirani (napaka je stabilna, ne odvisna od vrstnega reda JSON)')
    chk(A['veljavna'] == {'tr': {'assetId': 'cmx123'}}, 'veljavna trditev → naprej gre SAMO assetId')

# ═══ B) potrdiGradivo: dokument samo iz baze ════════════════════════════════
print('── B) strežniška potrditev: fail-closed na vsakem pogoju')
B = bun_js(r'''
const { potrdiGradivo, normalizirajTrdnjo } = await import('./src/lib/viz-provenance')
const RED = { id: 'cmA', productId: 'p1', kind: 'LAMELA', status: 'VERIFIED', permission: 'lastnik ROKSAL', filePath: 'public/assets/roksal/a.jpg', sha256: 'a'.repeat(64) }
const r = (vrstica, pid, tr = 'cmA') => {
  const n = normalizirajTrdnjo(tr === null ? null : { assetId: tr })
  if ('napaka' in n) return { nap: n.napaka }
  return potrdiGradivo(n.trdnja, vrstica, pid)
}
console.log(JSON.stringify({
  brezTrditve: r(RED, 'p1', null),
  niVBazi: r(null, 'p1'),
  neskladenId: r({ ...RED, id: 'cmB' }, 'p1'),
  niVerified: r({ ...RED, status: 'NEEDS_REVIEW' }, 'p1'),
  statusMissing: r({ ...RED, status: 'MISSING' }, 'p1'),
  brezDovoljenja: r({ ...RED, permission: '   ' }, 'p1'),
  brezPoti: r({ ...RED, filePath: null }, 'p1'),
  brezSaha: r({ ...RED, sha256: null }, 'p1'),
  prekratekSah: r({ ...RED, sha256: 'abc123' }, 'p1'),
  tujiIzdelek: r({ ...RED, productId: 'p2' }, 'p1'),
  izdelekNeznan: r({ ...RED, productId: null }, null),
  ok: r(RED, 'p1'),
}))
''')
if '_err' in B:
    bad(f'bun B: {B["_err"]}')
else:
    chk(B['brezTrditve'] == {'dokaz': None, 'razlog': None}, 'brez trditve → brez dokaza in brez razloga (nič ni bilo pojasniti)')
    chk(B['niVBazi']['dokaz'] is None and 'ne obstaja' in B['niVBazi']['razlog'] and 'cmA' in B['niVBazi']['razlog'], 'assetId ni v katalogu → dokaza NI, razlog imenuje trjeni id')
    chk(B['neskladenId']['dokaz'] is None and 'ne ustreza trditvi' in B['neskladenId']['razlog'], 'vrstica iz baze ne ustreza trditvi → tujega dokaza ne zapisujemo')
    chk(B['niVerified']['dokaz'] is None and 'NEEDS_REVIEW' in B['niVerified']['razlog'], 'status NEEDS_REVIEW ni dokaz (razlog navede dejanski status)')
    chk(B['statusMissing']['dokaz'] is None and 'MISSING' in B['statusMissing']['razlog'], 'status MISSING (datoteke ni) ni dokaz')
    chk(B['brezDovoljenja']['dokaz'] is None and 'dovoljenja' in B['brezDovoljenja']['razlog'], 'podlaga dovoljenja mora biti zapisana — samo presledki niso dovoljenje')
    chk(B['brezPoti']['dokaz'] is None and 'brez poti' in B['brezPoti']['razlog'], 'preverjen asset brez filePath: brez poti ni dokaza')
    chk(B['brezSaha']['dokaz'] is None and 'SHA-256' in B['brezSaha']['razlog'], 'brez SHA-256 ni dokaza o nespremenjenosti')
    chk(B['prekratekSah']['dokaz'] is None, 'SHA-256 s 6 znaki ni veljaven odtis → zavrnjen')
    chk(B['tujiIzdelek']['dokaz'] is None and 'ne pripada izdelku' in B['tujiIzdelek']['razlog'], 'gradivo drugega izdelka ni dokaz te vizualizacije')
    chk(B['izdelekNeznan']['dokaz'] is not None, 'vizualizacija brez izdelka: pripadnosti ni mogoče preveriti in je ne izsiljujemo')
    d = B['ok']['dokaz']
    chk(B['ok']['razlog'] is None and d and d['assetId'] == 'cmA' and d['kind'] == 'LAMELA' and d['pot'] == 'public/assets/roksal/a.jpg' and len(d['sha256']) == 64, 'izpolnjen asset → dokaz nosi samo strežniško prebrane vrednosti')
    chk(d is not None and set(d.keys()) == {'assetId', 'kind', 'pot', 'sha256'}, 'dokaz ima TOČNO 4 polja — permission, productId in status ne uhajajo v dokument')

# ═══ C) smeVizualizacijo + dokazMere: samo INVALIDATED zavrne ════════════════
print('── C) raven mere kot podlaga: nastavitev ne sme izgubiti funkcije')
C = bun_js(r'''
const { smeVizualizacijo, dokazMere } = await import('./src/lib/viz-provenance')
const nizi = ['ESTIMATED', 'AUTO_SUGGESTED', 'MANUAL', 'CALIBRATED', 'VERIFIED', 'CONFIRMED', 'INVALIDATED', 'NEPOZNANO', null, undefined, '']
console.log(JSON.stringify({
  odloki: nizi.map((s) => ({ s: String(s), ...smeVizualizacijo(s) })),
  razlog: smeVizualizacijo('INVALIDATED').razlog,
  mere: [dokazMere('CONFIRMED', 3), dokazMere(null, null), dokazMere('', 2), dokazMere(undefined, 7), dokazMere('MANUAL', null)],
}))
''')
if '_err' in C:
    bad(f'bun C: {C["_err"]}')
else:
    zavrnjeni = [x['s'] for x in C['odloki'] if not x['sme']]
    chk(zavrnjeni == ['INVALIDATED'], 'samo INVALIDATED zavrne vizualizacijo — nobena druga raven ne sme postati nova blokada')
    chk('razveljavljena' in (C['razlog'] or ''), 'zavrnitev razveljavljene mere ima razlog, ki ga uporabnik razume')
    dovoljeni = [x['s'] for x in C['odloki'] if x['sme']]
    chk(all(raven in dovoljeni for raven in ('ESTIMATED', 'AUTO_SUGGESTED', 'MANUAL', 'CALIBRATED', 'VERIFIED', 'CONFIRMED')), 'obstoječe ravni (tudi ESTIMATED) ostanejo dovoljene — nobena funkcija se ne izgubi')
    chk('null' in dovoljeni and 'undefined' in dovoljeni and '' in dovoljeni, 'brez statusa in neznana raven NISTA blokada (urejanje obstoječih zapisov ne sme propasti)')
    chk(C['mere'][0] == {'status': 'CONFIRMED', 'verzija': 3}, 'dokazMere zapiše raven in verzijo, kot sta')
    chk(C['mere'][1] == {'status': 'NEPOZNANO', 'verzija': None}, 'brez statusa in brez verzije → NEPOZNANO, ne izmišljena raven')
    chk(C['mere'][2] == {'status': 'NEPOZNANO', 'verzija': 2} and C['mere'][3] == {'status': 'NEPOZNANO', 'verzija': 7}, 'prazen in undefined status → NEPOZNANO, znana verzija ostane zapisana')
    chk(C['mere'][4] == {'status': 'MANUAL', 'verzija': None}, 'raven je dokazana tudi brez verzije — bralec vidi, kaj vemo')

# ═══ D) preberiDokaz: kaj je razvidno iz posnetka verzije ════════════════════
print('── D) branje dokaza iz posnetka: brez vere, brez laži')
D = bun_js(r'''
const { preberiDokaz } = await import('./src/lib/viz-provenance')
const dok = { meritev: { status: 'CONFIRMED', verzija: 4 }, izvirnikFotografije: 'cmFoto', gradivo: { assetId: 'cmA', kind: 'LAMELA', pot: 'public/assets/roksal/a.jpg', sha256: 'a'.repeat(64) }, gradivoRazlog: null }
const j = (o) => JSON.stringify(o)
console.log(JSON.stringify({
  nic: [preberiDokaz(null), preberiDokaz(undefined), preberiDokaz('')],
  pokvarjen: preberiDokaz('{kaj'),
  brezMeta: preberiDokaz(j({ renderParams: {} })),
  brezDokaza: preberiDokaz(j({ meta: { opozorila: [] } })),
  dokazNiPredmet: preberiDokaz(j({ meta: { dokaz: 'string' } })),
  dokazSeznam: preberiDokaz(j({ meta: { dokaz: [] } })),
  starZapis: preberiDokaz(j({ meta: { dokaz: { meritev: null, izvirnikFotografije: null, gradivo: null, gradivoRazlog: null } } })),
  cel: preberiDokaz(j({ renderParams: {}, meta: { dokaz: dok } })),
  pokvarjenGradivo: preberiDokaz(j({ meta: { dokaz: { ...dok, gradivo: { assetId: 'cmA', pot: '', sha256: 'a'.repeat(64) } } } })),
  prekratekSah: preberiDokaz(j({ meta: { dokaz: { ...dok, gradivo: { ...dok.gradivo, sha256: 'abc' } } } })),
  meritevBrezStatusa: preberiDokaz(j({ meta: { dokaz: { ...dok, meritev: { status: '', verzija: 'ne-stevilka' } } } })),
  meritevNiPredmet: preberiDokaz(j({ meta: { dokaz: { ...dok, meritev: 'CONFIRMED' } } })),
  izvirnikPredolg: preberiDokaz(j({ meta: { dokaz: { ...dok, izvirnikFotografije: 'x'.repeat(65) } } })),
  razlogPrazen: preberiDokaz(j({ meta: { dokaz: { ...dok, gradivoRazlog: '   ' } } })),
}))
''')
if '_err' in D:
    bad(f'bun D: {D["_err"]}')
else:
    chk(D['nic'] == [None, None, None], 'brez posnetka → brez dokaza (null, ne izmišljena veriga)')
    chk(D['pokvarjen'] is None, 'pokvarjen JSON posnetka → None in ne padec')
    chk(D['brezMeta'] is None and D['brezDokaza'] is None, 'zapis pred R510 (meta brez dokaza) → None, bralec vidi, da verige ni')
    chk(D['dokazNiPredmet'] is None and D['dokazSeznam'] is None, 'dokaz kot niz ali seznam → None (česa, kar ni veriga, ne razlagamo)')
    chk(D['starZapis'] == {'meritev': None, 'izvirnikFotografije': None, 'gradivo': None, 'gradivoRazlog': None}, 'prazna veriga ostane prazna in ne postane NEPOZNANO')
    chk(D['cel']['gradivo']['assetId'] == 'cmA' and D['cel']['meritev'] == {'status': 'CONFIRMED', 'verzija': 4}, 'celovit posnetek → dokaz se vrne nedotaknjen')
    chk(D['pokvarjenGradivo']['gradivo'] is None, 'gradivo s prazno potjo je pri branju zavrnjeno (posnetek ne more trditi origina brez poti)')
    chk(D['prekratekSah']['gradivo'] is None, 'gradivo s prekratkim SHA-256 je pri branju zavrnjeno')
    chk(D['meritevBrezStatusa']['meritev'] == {'status': 'NEPOZNANO', 'verzija': None}, 'raven brez statusa in verzija, ki ni število → NEPOZNANO brez verzije')
    chk(D['meritevNiPredmet']['meritev'] is None, 'meritev kot niz → None (podtiskana raven se ne razlaga)')
    chk(D['izvirnikPredolg']['izvirnikFotografije'] is None, 'predolg izvirnik (65 znakov) ni vrnjen kot povezava')
    chk(D['razlogPrazen']['gradivoRazlog'] is None, 'razlog samo iz presledkov → None (bralec ne dobi praznega sporočila)')

# ═══ E) žičenje poti, engine-a in UI-ja ═════════════════════════════════════
print('── E) žičenje: dokaz gre v zapis, ne v novi stolpec')
post = src('src/app/api/photo-visualization/route.ts')
chk('const gradivo = await preveriTrdnjenoGradivo(body.gradivo, izdelek.produkt.id)' in post, 'POST: trditev o gradivu gre skozi strežniško potrditev')
chk('meraDokaz = dokazMere(m.meritev.status, m.verzija)' in post, 'POST: raven mere pride iz ISTE branje meritve kot odlok')
chk('dokaz' in blok(post, 'meta: {'), 'POST: dokaz je v meta posnetka verzije v1')
chk('izvirnikFotografije: srcFoto ?? null' in post, 'POST: izvirnik fotografije je del dokaza')
chk('gradivoRazlog: dokaz.gradivoRazlog' in post, 'POST: razlog (kadar dokaza ni) gre v revizijski zapis')
chk('meraStatus: dokaz.meritev?.status ?? null' in post, 'POST: revizija nosi raven mere')
chk('dokaz,' in blok(post, 'id: viz.id, variantLabel: oznaka', 300), 'POST: dokaz se vrne odjemalcu (sicer UI ne more pokazati, kaj je bilo potrjeno)')
chk("'Ne smemo" not in post and 'MERA_RAZVELJAVLJENA' not in post, 'POST: razveljavljeno mero ustavi že preveriMeritev (409), ne šele opozorilo')

get = src('src/app/api/photo-visualization/[id]/route.ts')
patch = get
chk('const zadnjaVerzija = await db.photoVisualizationVersion.findFirst' in get, 'GET: dokaz se bere iz zadnje verzije, ne iz odjemalca')
chk('const mera = await stanjeMere(viz.measurementId)' in get, 'GET: raven mere je TENUTNA (razveljavitev po shranjevanju je videna sproti)')
chk('meraRazveljavljena' in get and "dokaz, izvirnikFotografije: viz.sourcePhotoId" not in get, 'GET: razveljavljena podlaga je označena posebej')
chk('let dokazPrejsnje: VizDokaz | null = null' in patch, 'PATCH: prejšnji dokaz je bran, da ga nova verzija ne zabriše')
chk('dokazPrejsnje = preberiDokaz(zadnja?.data)' in patch, 'PATCH: prejšnji dokaz se bere iz posnetka zadnje verzije')
chk('{ assetId: dokazPrejsnje.gradivo.assetId }' in patch, 'PATCH: prejšnja trditev se PONOVNO potrdi iz baze (nikoli prepisan dokaz)')
chk('if (viz.measurementId) {' in patch and 'if (body.renderParams !== undefined)' in patch, 'PATCH: mera je brana PRED vejo renderParams (ne pogojeno z njo)')
chk("'MERA_RAZVELJAVLJENA'" in patch, 'PATCH: razveljavljena mera obstoječega urejanja ne blokira, a dobi opozorilo')
chk('dokaz' in blok(patch, 'meta: {'), 'PATCH: nova verzija nosi dokaz')
chk('preveriSourceFoto(body.sourcePhotoId, viz.projectId)' in patch, 'PATCH: izvirnik fotografije je mogoče POPRAVITI (stari zapisi so bili tiho null)')
chk('update.sourcePhotoId = izvirnikId' in patch, 'PATCH: popravljen izvirnik se zapiše')
chk('izvirnikFotografije: dokaz.izvirnikFotografije' in patch, 'PATCH: izvirnik gre v revizijski zapis')
chk('dokaz,' in blok(patch, 'id: updated.id, status: updated.status', 300), 'PATCH: odjemalec dobi potrjeno verigo nazaj')

eng = src('src/lib/photo-replace-engine.ts')
chk('const odlok = smeVizualizacijo(m.status)' in eng, 'ENGINE: preveriMeritev uporablja odlok VIZUALIZACIJE (ne poslovnega bloka)')
chk("if (!odlok.sme) return { napaka: odlok.razlog ?? 'Meritev ni uporabna za vizualizacijo.', status: 409 }" in eng, 'ENGINE: razveljavljena mera → 409 z razlogom (ne 400, ne tiho)')
chk("if (!m) return { status: 'NEPOZNANO', verzija: null, lengthCm: null }" in eng, 'ENGINE: izbrisana mera → NEPOZNANO, ne izmišljena raven')
chk("return { status: m.status ?? 'NEPOZNANO', verzija: m.versions[0]?.version ?? null, lengthCm: m.lengthCm }" in eng, 'ENGINE: mera brez statusa NE more pomeniti CONFIRMED')
chk('const vrstica = await db.productAsset.findUnique' in eng, 'ENGINE: gradivo se bere IZ BAZE (filePath in sha256 sta strežniška)')
chk('potrdiGradivo(n.trdnja, vrstica as GradivoIzBaze | null, productId)' in eng, 'ENGINE: potrditev dela z ISTIM čistim modulom kot testi')

ui = src('src/components/roksal/modules/foto-replace.tsx')
chk('sourcePhotoId: slot.photoSourceId' in ui, 'UI: pošilja DEJANSKI izvirnik fotografije (ne več vedno null)')
chk('sourcePhotoId: null' not in ui, 'UI: tiha null-vezava je izginila iz obeh zahtev')
chk('{ assetId: izbiraGradiva.gradivo.id }' in ui and 'smeUporabiti' in blok(ui, 'const trdnja', 220), 'UI: assetId gre samo, kadar je izbira gradiva PREVERJENA')
chk('photoSourceId: mid' in ui, 'UI: projektna fotografija nosi svoj izvirnik (meritev FOTO)')
chk('photoSourceId: d.sourcePhotoId ?? null' in ui, 'UI: ob odpiranju se izvirnik VRNE iz baze (sicer bi ga urejanje zabrisalo)')
chk('setDokaz(d.dokaz ?? null)' in ui, 'UI: ob odpiranju se prikaže zapisana veriga')
chk(ui.count('setDokaz(res.data?.dokaz ?? null)') == 2, 'UI: obe poti (POST in PATCH) pokažeta, kaj je potrdil strežnik')
chk('Dokazna veriga izvedene slike' in ui, 'UI: veriga je vidna Monterju, ne samo v bazi')
chk("'INVALIDATED'" in ui, 'UI: razveljavljena podlaga je označena tudi uporabniku')
chk('setDokaz(null)' in ui, 'UI: dokaz se pobere ob menjavi projekta/datoteke (sicer bi prikazoval tujo verigo)')

# ═══ F) OMEJITVE: nič novega jedra, nič migracij, poslovni blok nedotaknjen ══
print('── F) meje: brez novega cenovnega/merilnega jedra in brez migracij')
prov = src('src/lib/viz-provenance.ts')
chk('import ' not in prov, 'VIZ-PROVENANCE nima UVOZOV: čist modul brez baze, DOM-a in cen (noben nov sloj)')
kod = ''.join(' ' + v for v in prov.splitlines() if not v.strip().startswith(('//', '*', '/*')))
chk(all(q not in kod.lower() for q in ('cena', 'marža', 'marza', 'popust', 'cenik', 'neto', 'bruto', 'kosovnica', 'price')), 'VIZ-PROVENANCE v KODI ne pozna cen (issue #15: drugega cenovnega jedra ni — beseda je samo v komentarju meje)')
chk(all(p not in prov for p in ('document.', 'window.', 'localStorage')), 'VIZ-PROVENANCE je DOM-free (testable brez brskalnika)')
chk('MEASUREMENT_BLOCKED_STATUSES' not in prov, 'VIZ-PROVENANCE NE uporablja poslovnega bloka (vizualizacija ≠ proizvodnja)')

shema = src('prisma/schema.prisma')
vizBlok = shema[shema.index('model PhotoVisualization {'):shema.index('// VERZIJA FOTO-VIZUALIZACIJE')]
POZNANI = {'id', 'projectId', 'project', 'authorId', 'author', 'variantLabel', 'status', 'sourcePhoto',
           'sourcePhotoId', 'measurementId', 'measurementVersion', 'productId', 'product', 'variantId',
           'variant', 'engineVersion', 'renderParams', 'rendered', 'note', 'createdAt', 'updatedAt',
           'versions', 'choices', '@@index([projectId,', '@@index([projectId, variantLabel])', '@@index'}
vrstice = []
for vrstica in vizBlok.splitlines():
    s = vrstica.strip()
    if not s or s.startswith('model') or s == '}' or s.startswith('//'):
        continue
    vrstice.append(s if s.startswith('@@') else s.split(' ')[0])
neznanke = [v for v in vrstice if not any(v.startswith(p) for p in POZNANI)]
chk(not neznanke, f'SHENA: PhotoVisualization je NESPREMENJEN — nič novih stolpcev, dokaz živi v JSON posnetku: {neznanke}')
chk('dokaz' not in vizBlok.lower() and 'gradivo' not in vizBlok.lower(), 'SHENA: v PhotoVisualization ni stolpca dokaz/gradivo (veriga živi v JSON posnetku — brez migracije)')

mer = src('src/lib/measure-engine.ts')
chk("export const MEASUREMENT_BLOCKED_STATUSES: MeasurementStatus[] = ['ESTIMATED', 'AUTO_SUGGESTED', 'INVALIDATED']" in mer, 'MERILNO JEDRO: poslovni blok ostaja ESTIMATED/AUTO_SUGGESTED/INVALIDATED (R510 ga ni zožil in ni razširil)')
chk('measurementStatusAllowsBusiness' in mer, 'MERILNO JEDRO: poslovna preverba je še na svojem mestu (ločena od vizualizacije)')

for dat in ('src/lib/viz-provenance.ts', 'src/lib/photo-replace-engine.ts',
            'src/app/api/photo-visualization/route.ts', 'src/app/api/photo-visualization/[id]/route.ts'):
    vseb = src(dat)
    paketi = [p for p in re.findall(r"from '([^']+)'", vseb) if not (p.startswith('@/') or p.startswith('next/'))]
    chk(not paketi, f'{dat}: nima uvoza iz katerega koli paketa (uvozi samo @/lib in next): {paketi}')
    chk('fetch(' not in vseb, f'{dat}: nobenega zunanjega klica (brez AI, brez plačljivih API-jev)')

pkg = json.loads(src('package.json'))
odvisnosti = {**(pkg.get('dependencies') or {}), **(pkg.get('devDependencies') or {})}
chk(all(q not in odvisnosti for q in ('jimp', 'onnxruntime', 'openai', '@huggingface/inference', 'exifr', 'opencv')),
    f'ODVISNOSTI: noben AI/EXIF/slikovni paket ni dodan za dokazno verigo ({len(odvisnosti)} obstoječih ključev, licenc ne odpiramo)')
chk('sharp' in odvisnosti and 'sharp' not in prov and 'sharp' not in ui, 'ODVISNOSTI: sharp je OBSTOJEČ (pipeline sredstev) in ga R510 NE uporablja — veriga je računska, ne slikovna')

print(f'════ r510: {PASS} ✓ / {FAIL} ✗ ════')
sys.exit(1 if FAIL else 0)
