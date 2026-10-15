#!/usr/bin/env python3
"""tests/r520.py — R520 (issue #14): FASADE in TERASE v fotomontaži.

Nadaljevanje R517/R518 (ograje): po lastnikovem vrstnem redu zdaj še dve
površini — KUBO WPC fasada in WoodCore WPC terasa. Suite ščiti resnične pasti:

  A) URADNI PODATKI (roksal.com — enak vir ki ga navaja tech.vir): KUBO 80×42
     SAMO navpično; razmik letvic poljuben (privzeti 20 mm iz izmere
     namestitvenih fotografij); terasna reža 5–6 mm (FAQ) → privzeto 6.
  B) sirinaIzImena: mera deske IZ IMENA izdelka (»KLASIK 150×25« → 150 mm),
     ker tech nima ne profil ne lamele ključa. Meje 40..300, smeti → null.
  C) generirajRazpored FASADA/TERASA: čist raster čez CELO območje — brez
     stebrov, brez ročnika, brez vidnih vijakov (KUBO: pritrditev zadaj,
     uradno). Reže NATANKO iz konfiguracije (8+2 cm korak, 15+0.6).
     Ograjne veje (POKOCNA/PRECNA) se NE spremenijo (regresija).
  D) preveriConfig: FASADA/TERASA sprejeta (višina/globina do 2000 cm), TERASA
     BREZ posts je veljavna, POKOCNA brez posts je NAPAKA (regresija meja).
  E) izmeriIzrezNavpicnePalice: sintetični svetlostni profil (deske 40 px +
     reže 6 px) → izrez ene deske; brez perioda → null (DETAJL posnetek ene
     deske ostane cel); rebrasta površina (ozki trakovi) → null (ne režemo).
  F) manifest: 6 primerov, novi FASADA/TERASA vnosi veljavni (quad, sha,
     katalog, izbira gradiva SPLOSNO → UPORABLJENO s pričakovano datoteko).
  G) živi katalog: ROK-FAS-KUBO brez profil/razmak v tech (→ UI uradna
     privzeta vrednost), ROK-TER-KLASIK/RUSTIC ime nosi 150×25, TER-ALU-001
     0 gradiv → NI_PREVERJENO (pošteni približek, ne lažna tekstura).
  H) žičenje UI: izbor FASADA/TERASA družine nastavi tip, prednastavi mere
     (KUBO 80/20, terasa 150/6); gradiva gredo čez SPLOSNO orientacijo.
  I) dokazni artefakti: ops/r520-render.mjs zrcali UI cevovod (isti moduli,
     isto zaporedje slojev), slike obstajajo in niso prazne, žig §15 na POTEM.
  J) živi API (samo ob delujočem strežniku): POST tip FASADA preživi krog —
     renderParams.tip/lamelaMm/rezaMm nespremenjeni, nato idempotentno čiščenje.

Brez AI, brez novih odvisnosti, brez mrežnih klicov (razen lokalni strežnik).
"""
import json
import os
import subprocess
import sys
import urllib.request
import urllib.error

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
PASS, FAIL = 0, 0

sys.path.insert(0, os.path.join(REPO, 'tests'))
import dbenv  # noqa: E402

DBURL = dbenv.db_url(REPO)


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)


def bun_js (script):
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


def bun_db (script):
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       cwd=REPO, env={**os.environ, 'DATABASE_URL': DBURL})
    out = (r.stdout or '').strip().splitlines()
    for line in reversed(out):
        if line.startswith('{'):
            try:
                return json.loads(line)
            except Exception:
                break
    return {'_err': (r.stderr or r.stdout or '')[:900]}


def src_has (relpath, needle):
    try:
        with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
            return needle in f.read()
    except Exception:
        return False


def callj (method, path, token=None, body=None, timeout=90):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode('utf-8', 'replace'))
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode('utf-8', 'replace'))
        except Exception: return e.code, {}
    except Exception as e:
        return 0, {'error': str(e)}


def login (email, pw):
    s, d = callj('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s}'
    return d['token']


print('═══ R520: fasade in terase — uradni podatki + 5 dokazanih primerov ═══')

# ═══ A) uradni podatki (konstante z viri) ════════════════════════════════════
print('── A) uradni ROKSAL podatki (roksal.com — vir tech.vir) ──')
A = bun_js(r'''
const C = await import('./src/lib/photo-replace-core')
console.log(JSON.stringify({
  kuboSirina: C.FASADA_SIRINA_MM, kuboReza: C.FASADA_REZA_MM, terasaReza: C.TERASA_REZA_MM,
}))
''')
chk(A.get('kuboSirina') == 80, f'KUBO profil 80 × 42 mm — uradno roksal.com (dejansko {A.get("kuboSirina")})')
chk(A.get('kuboReza') == 20, f'KUBO razmik poljuben → privzeti 20 mm iz izmere namestitev (dejansko {A.get("kuboReza")})')
chk(A.get('terasaReza') == 6, f'terasna reža 5–6 mm po uradnem FAQ → privzeto 6 (dejansko {A.get("terasaReza")})')
chk(src_has('src/lib/photo-replace-core.ts', 'roksal.com/en/woodcore-wpc-boards/wpc-facade-boards'), 'vir KUBO mere zapisan v komentarju jedra')
chk(src_has('src/lib/photo-replace-core.ts', 'Med deskami je razmak 5-6mm'), 'vir terasne reže zapisan v komentarju jedra')

# ═══ B) sirinaIzImena — mera deske iz IMENA izdelka ══════════════════════════
print('── B) sirinaIzImena (mere so v imenu, ne v tech) ──')
B = bun_js(r'''
const { sirinaIzImena } = await import('./src/lib/photo-replace-core')
const J = (v) => JSON.stringify(v)
console.log(JSON.stringify({
  klasik: sirinaIzImena('WoodCore WPC terasna deska KLASIK 150×25'),
  rustic: sirinaIzImena('WoodCore WPC terasna deska RUSTIC (staran les) 150×25'),
  alu: sirinaIzImena('Alu terasa 130×30'),
  xCrka: sirinaIzImena('WPC terasa Standard 150 x 25'),
  brez: sirinaIzImena('Fasada — KUBO profil'),
  kratek: sirinaIzImena('Deska 80'),
  preozko: sirinaIzImena('Plošča 30×25'),
  prevec: sirinaIzImena('Plošča 350×25'),
  null: sirinaIzImena(null),
  prazno: sirinaIzImena(''),
}))
''')
chk(B.get('klasik') == 150, f'»KLASIK 150×25« → 150 mm (dejansko {B.get("klasik")})')
chk(B.get('rustic') == 150, f'»RUSTIC (staran les) 150×25« → 150 mm (dejansko {B.get("rustic")})')
chk(B.get('alu') == 130, f'»Alu terasa 130×30« → 130 mm (dejansko {B.get("alu")})')
chk(B.get('xCrka') == 150, f'»150 x 25« (s presledkom) → 150 mm (dejansko {B.get("xCrka")})')
chk(B.get('brez') is None and B.get('null') is None and B.get('prazno') is None, 'ime brez mere / null / prazno → null (KUBO pade na uradno vrednost)')
chk(B.get('preozko') is None and B.get('prevec') is None and B.get('kratek') is None, 'mere izven 40..300 mm → null (ne rišemo nesmisla)')

# ═══ C) generirajRazpored — FASADA/TERASA čist raster, ograje nespremenjene ══
print('── C) generirajRazpored (FASADA/TERASA raster + regresija ograj) ──')
C = bun_js(r'''
const { generirajRazpored } = await import('./src/lib/photo-replace-core')
const fasada = generirajRazpored({ tip: 'FASADA', lengthCm: 300, heightCm: 280, posts: 5, handrail: true,
  lamelaMm: 80, rezaMm: 20, deskaMm: 80, pritrditev: 'TALNA', vijaki: true })
const terasa = generirajRazpored({ tip: 'TERASA', lengthCm: 480, heightCm: 350, posts: 5, handrail: true,
  lamelaMm: 150, rezaMm: 6, deskaMm: 150, pritrditev: 'TALNA', vijaki: true })
const pokocna = generirajRazpored({ tip: 'POKOCNA', lengthCm: 200, heightCm: 136, posts: 3, handrail: true,
  lamelaMm: 57, rezaMm: 20, deskaMm: 120, pritrditev: 'TALNA', vijaki: true })
const rezeF = fasada.palice.slice(1).map((p, i) => +(p.xCm - (fasada.palice[i].xCm + fasada.palice[i].sirinaCm)).toFixed(3))
const rezeT = terasa.deske.slice(1).map((d, i) => +(d.yCm - (terasa.deske[i].yCm + terasa.deske[i].visinaCm)).toFixed(3))
console.log(JSON.stringify({
  fPalice: fasada.palice.length, fStebri: fasada.posts.length, fVijaki: fasada.vijaki.length, fDeske: fasada.deske.length,
  fSirina: fasada.palice[0]?.sirinaCm, fPrva: fasada.palice[0]?.xCm, fZadnjaKonec: +(fasada.palice[fasada.palice.length - 1].xCm + 8).toFixed(1),
  rezeF: [...new Set(rezeF)],
  tDeske: terasa.deske.length, tStebri: terasa.posts.length, tVijaki: terasa.vijaki.length,
  tVisina: terasa.deske[0]?.visinaCm, tPrva: terasa.deske[0]?.yCm,
  rezeT: [...new Set(rezeT)],
  pokocnaPalice: pokocna.palice.length, pokocnaStebri: pokocna.posts.length, pokocnaVijaki: pokocna.vijaki.length,
}))
''')
chk(C.get('fPalice') == 30, f'FASADA 300 cm stene, 80+20 mm → 30 letvic (dejansko {C.get("fPalice")}) — primer F')
chk(C.get('fStebri') == 0 and C.get('fVijaki') == 0 and C.get('fDeske') == 0, 'FASADA: BREZ stebrov, vijakov in desk (KUBO pritrditev zadaj, uradno)')
chk(C.get('fSirina') == 8 and C.get('fPrva') == 0, f'letvica 8 cm od roba 0 (dejansko {C.get("fSirina")}/{C.get("fPrva")}) — celotno območje')
chk(C.get('rezeF') == [2.0], f'reža med letvicami NATANKO 2.0 cm (dejansko {C.get("rezeF")}) — iz konfiguracije')
chk(C.get('tDeske') == 22, f'TERASA 480×350, 150+6 mm → 22 desk (dejansko {C.get("tDeske")}) — primer T')
chk(C.get('tStebri') == 0 and C.get('tVijaki') == 0, 'TERASA: brez stebrov in vijakov (deska leži na podkonstrukciji)')
chk(C.get('tVisina') == 15 and C.get('tPrva') == 0, f'deska 15 cm od roba 0 (dejansko {C.get("tVisina")}/{C.get("tPrva")})')
chk(C.get('rezeT') == [0.6], f'reža med deskami NATANKO 0.6 cm — uradni FAQ 5–6 mm (dejansko {C.get("rezeT")})')
chk(C.get('pokocnaPalice') == 24 and C.get('pokocnaStebri') == 3 and C.get('pokocnaVijaki') == 9,
    f'regresija POKOCNA: 24 palic, 3 stebri, 9 vijakov nespremenjenih (dejansko {C.get("pokocnaPalice")}/{C.get("pokocnaStebri")}/{C.get("pokocnaVijaki")})')

# ═══ D) preveriConfig — nove vrste + odvisne meje ═════════════════════════════
print('── D) preveriConfig (FASADA/TERASA + regresija ograj) ──')
D = bun_js(r'''
const { preveriConfig } = await import('./src/lib/photo-replace-core')
const J = (o) => JSON.stringify(o)
const osnova = { lengthCm: 400, heightCm: 280, lamelaMm: 80, rezaMm: 20, deskaMm: 150, pritrditev: 'TALNA', vijaki: false, handrail: false }
const fasada = preveriConfig({ ...osnova, tip: 'FASADA' })
const terasaBrezPostov = preveriConfig({ ...osnova, tip: 'TERASA', heightCm: 1800 })
const terasaPrevisoka = preveriConfig({ ...osnova, tip: 'TERASA', heightCm: 2500 })
const ograjaPrevisoka = preveriConfig({ ...osnova, tip: 'POKOCNA', posts: 3 })
const ograjaBrezPostov = preveriConfig({ ...osnova, tip: 'POKOCNA' })
const smeti = preveriConfig('ni json')
console.log(JSON.stringify({
  fasadaTip: fasada.config?.tip, fasadaNapake: fasada.napake.length,
  terasaTip: terasaBrezPostov.config?.tip, terasaVisina: terasaBrezPostov.config?.heightCm, terasaNapake: terasaBrezPostov.napake.length,
  terasaPrevisokaNapake: terasaPrevisoka.napake.length,
  ograjaPrevisokaNapake: ograjaPrevisoka.napake.length,
  ograjaBrezPostovNapake: ograjaBrezPostov.napake.length,
  smetiNapake: smeti.napake.length,
}))
''')
chk(D.get('fasadaTip') == 'FASADA' and D.get('fasadaNapake') == 0, 'FASADA konfiguracija veljavna (posts/handrail/vijaki niso obvezni)')
chk(D.get('terasaTip') == 'TERASA' and D.get('terasaNapake') == 0 and D.get('terasaVisina') == 1800,
    f'TERASA brez posts + globina 1800 cm veljavna (dejansko {D.get("terasaVisina")}) — velika terasa')
chk(D.get('terasaPrevisokaNapake', 0) > 0, 'TERASA globina 2500 cm → napaka (meja 2000)')
chk(D.get('ograjaBrezPostovNapake', 0) > 0, 'regresija: POKOCNA brez posts → napaka (posts so za ograje obvezni, FASADA/TERASA pa jih ne rabijo)')

# ═══ E) izmeriIzrezNavpicnePalice — sintetični profili ═══════════════════════
print('── E) izmeriIzrezNavpicnePalice (izrez ene deske iz scene) ──')
E = bun_js(r'''
const { izmeriIzrezNavpicnePalice } = await import('./src/lib/photo-replace-texture')
// sintetična scena: 10 desk po 40 px (svetlo 0.8) z režami 6 px (temno 0.25)
const scena = (x) => { const f = x % 46; return f < 40 ? 0.8 : 0.25 }
const izrez = izmeriIzrezNavpicnePalice(scena, 460, 300)
// ena sama deska (DETAJL) — brez perioda
const detalj = izmeriIzrezNavpicnePalice(() => 0.72, 400, 300)
const brezPerioda = izmeriIzrezNavpicnePalice((x) => 0.5 + 0.4 * Math.sin(x / 97), 400, 300)
// rebrasta površina: ozki trakovi 4 px — ne sme postati »deska«
const rebra = izmeriIzrezNavpicnePalice((x) => (x % 8) < 4 ? 0.8 : 0.3, 400, 300)
console.log(JSON.stringify({
  sirina: izrez?.w, x: izrez?.x, visina: izrez?.h,
  detalj: detalj ?? null, brezPerioda: brezPerioda ?? null, rebra: rebra ?? null,
}))
''')
iz = E.get('sirina') or 0
chk(34 <= iz <= 42, f'scena 40 px desk + 6 px reže → izrez ene deske ≈ 40 px (dejansko {iz}, x={E.get("x")})')
chk(E.get('visina') == 300, 'izrez zajame CELO višino vira (letnica teče vzdolž profila)')
chk(E.get('detalj') is None, 'posnetek brez perioda (DETAJL ene deske) → null — cela slika, brez rezanja')
chk(E.get('brezPerioda') is None, 'gladki preliv brez desk → null (fail-closed)')
chk(E.get('rebra') is None, f'rebrasta površina (4 px traki) → null (dejansko {E.get("rebra")}) — rebra NISO deske, ne režemo')

# ═══ F) manifest — novi FASADA/TERASA vnosi ══════════════════════════════════
print('── F) manifest: kubo-fasada-hisa-levo + hotel-bazen-terasa-tla ──')
with open(os.path.join(REPO, 'tests/fixtures/foto-montaza/manifest.json'), encoding='utf-8') as f:
    MF = json.load(f)
chk(len(MF['primeri']) >= 6, f'manifest ima vsaj 6 primerov (dejansko {len(MF["primeri"])})')
fas = next((p for p in MF['primeri'] if p['id'] == 'kubo-fasada-hisa-levo'), None)
ter = next((p for p in MF['primeri'] if p['id'] == 'hotel-bazen-terasa-tla'), None)
chk(fas is not None, 'vnos kubo-fasada-hisa-levo obstaja')
chk(ter is not None, 'vnos hotel-bazen-terasa-tla obstaja')
if fas:
    chk(fas['izbirniOznaka'] if False else fas['izbraniProdukt']['sku'] == 'ROK-FAS-KUBO', 'fiks: KUBO fasada izdelek')
    chk(fas['izbraniProdukt']['varianta'] == 'ROK-FAS-KUBO-ROAK', 'fiks: varianta Rustic oak')
    chk(fas['referenca']['tip'] == 'ROCNO' and fas['referenca']['cm'] == 245, 'fiks: ročna referenca 245 cm (širina odseka)')
    chk(fas['pricakovano']['stanje'] == 'UPORABLJENO', 'fiks: pričakovano UPORABLJENO')
if ter:
    chk(ter['izbraniProdukt']['sku'] == 'ROK-TER-RUSTIC', 'fiks: RUSTIC terasa izdelek')
    chk(ter['izbraniProdukt']['varianta'] == 'ROK-TER-RUSTIC-ROAK', 'fiks: varianta Rustic oak')
    chk(len(ter['maska']['prednji']) == 3, 'fiks: 3 prednje maske (ležalniki ostanejo PRED teraso)')
    chk(ter['referenca']['cm'] == 480, 'fiks: referenca 480 cm (širina sprednjega roba)')

# ═══ G) živi katalog — mere in stanja gradiv ════════════════════════════════
print('── G) živi katalog: KUBO brez mer v tech, terasa 150×25 v imenu, ALU brez ──')
G = bun_db(r'''
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const { lameleIzTecha, rezaIzTecha, sirinaIzImena, barvaVariante } = await import('./src/lib/photo-replace-core')
const { izberiGradivo } = await import('./src/lib/photo-replace-texture')
const out = {}
for (const sku of ['ROK-FAS-KUBO', 'ROK-TER-KLASIK', 'ROK-TER-RUSTIC', 'TER-ALU-001', 'TER-WPC-001']) {
  const p = await db.product.findFirst({ where: { sku }, include: { variants: true } })
  if (!p) { out[sku] = { manjka: true }; continue }
  out[sku] = {
    ime: p.name,
    sirinaIme: sirinaIzImena(p.name),
    sirinaTech: lameleIzTecha(p.tech), rezaTech: rezaIzTecha(p.tech),
    stVariants: p.variants.length,
  }
}
const kubo = await db.product.findFirst({ where: { sku: 'ROK-FAS-KUBO' }, select: { id: true } })
const kuboAssets = await db.productAsset.findMany({
  where: { productId: kubo.id },
  select: { id: true, kind: true, orientation: true, view: true, colorName: true, variantSku: true, productId: true, filePath: true, sha256: true, status: true, permission: true, sourceName: true },
})
const roak = await db.productVariant.findFirst({ where: { sku: 'ROK-FAS-KUBO-ROAK' } })
out.kuboIzbira = izberiGradivo(kuboAssets, { productId: kubo.id, variantSku: roak?.sku ?? null, orientation: 'SPLOSNO' })
out.kuboIzbira = { stanje: out.kuboIzbira.stanje, datoteka: out.kuboIzbira.gradivo?.filePath?.split('/').pop() ?? null }
const rustic = await db.product.findFirst({ where: { sku: 'ROK-TER-RUSTIC' }, select: { id: true } })
const rusticAssets = await db.productAsset.findMany({
  where: { productId: rustic.id },
  select: { id: true, kind: true, orientation: true, view: true, colorName: true, variantSku: true, productId: true, filePath: true, sha256: true, status: true, permission: true, sourceName: true },
})
const terRoak = await db.productVariant.findFirst({ where: { sku: 'ROK-TER-RUSTIC-ROAK' } })
const ti = izberiGradivo(rusticAssets, { productId: rustic.id, variantSku: terRoak?.sku ?? null, orientation: 'SPLOSNO' })
out.terasaIzbira = { stanje: ti.stanje, datoteka: ti.gradivo?.filePath?.split('/').pop() ?? null }
const alu = await db.product.findFirst({ where: { sku: 'TER-ALU-001' }, select: { id: true } })
out.aluAssets = await db.productAsset.count({ where: { productId: alu.id } })
const ant = await db.productVariant.findFirst({ where: { sku: 'TER-ALU-001-ANT' } })
out.aluBarva = ant ? barvaVariante({ ral: ant.ral, color: ant.color }) : null
console.log(JSON.stringify(out))
await db.$disconnect()
''')
kubo = G.get('ROK-FAS-KUBO') or {}
ter1 = G.get('ROK-TER-KLASIK') or {}
ter2 = G.get('ROK-TER-RUSTIC') or {}
alu = G.get('TER-ALU-001') or {}
chk(not kubo.get('manjka') and kubo.get('sirinaTech') is None and kubo.get('rezaTech') is None and kubo.get('sirinaIme') is None,
    f'KUBO: tech nima niti profil niti razmak, ime brez mere → UI uporabi URADNO 80/20 (dejansko tech {kubo.get("sirinaTech")}/{kubo.get("rezaTech")})')
chk((G.get('kuboIzbira') or {}).get('stanje') == 'UPORABLJENO' and 'roksal-kubo-cip-roak' in ((G.get('kuboIzbira') or {}).get('datoteka') or ''),
    f'KUBO Rustic oak prek SPLOSNO → UPORABLJENO — R523: DETAJL čip uradne lestvice namesto scenične fotografije ({(G.get("kuboIzbira") or {}).get("datoteka")})')
chk(ter1.get('sirinaIme') == 150 and ter1.get('sirinaTech') is None,
    f'KLASIK: mera IZ IMENA »150×25« → 150 mm (dejansko {ter1.get("sirinaIme")}), tech brez')
chk(ter2.get('sirinaIme') == 150, f'RUSTIC: mera iz imena → 150 mm (dejansko {ter2.get("sirinaIme")})')
chk((G.get('terasaIzbira') or {}).get('stanje') == 'UPORABLJENO' and 'r495-woodcore-rustic-oak-zel' in ((G.get('terasaIzbira') or {}).get('datoteka') or ''),
    f'terasa Rustic oak → UPORABLJENO ({(G.get("terasaIzbira") or {}).get("datoteka")})')
chk(G.get('aluAssets') == 0 and (G.get('aluBarva') == '#383e42'),
    f'ALU terasa: 0 gradiv → pošteni barvni približek RAL 7016 (dejansko {G.get("aluAssets")} gradiv, {G.get("aluBarva")})')

# ═══ H) žičenje UI ══════════════════════════════════════════════════════════
print('── H) žičenje: UI nastavi tip/mere za FASADA/TERASA ──')
UI = 'src/components/roksal/modules/foto-replace.tsx'
chk(src_has(UI, "p.family.code === 'FASADA' || p.family.code === 'TERASA'"), 'UI ponuja tudi FASADA in TERASA izdelke')
chk(src_has(UI, "tip: jeFasada ? 'FASADA' : jeTerasa ? 'TERASA'"), 'izbor družine nastavi tip FASADA/TERASA')
chk(src_has(UI, 'sirinaIzImena(p.name)'), 'UI bere mero iz imena izdelka (150×25)')
chk(src_has(UI, 'FASADA_SIRINA_MM') and src_has(UI, 'TERASA_REZA_MM'), 'UI prednastavi uradni KUBO 80 mm + terasno režo 6 mm')
chk(src_has(UI, 'izmeriIzrezeNavpicnihPalic'), 'UI ob FASADA izreze VSE deske iz scenične teksture (R523: množica — vsaka letvica svoja)')
chk(src_has(UI, "slot.tip === 'PRECNA' ? 'PRECNA' : slot.tip === 'POKOCNA' ? 'POKOCNA' : 'SPLOSNO'"),
    'orientacija gradiva: FASADA/TERASA padata na SPLOSNO (DETAJL sredstva so SPLOSNO/SPREDAJ)')
chk(src_has(UI, "jePovrsina ? (slot.tip === 'FASADA' ? 'oblogo' : 'tla') : 'ograjo'"), 'UI besedila se prilagodijo površini (obloga/tla/ograja)')

# ═══ I) dokazni artefakti ════════════════════════════════════════════════════
print('── I) dokazni artefakti: 5 primerov × (potem + primerjava) + zoomi ──')
RENDER = 'ops/r520-render.mjs'
chk(src_has(RENDER, 'MASK.pokrij(maska, W, H)'), 'dokazni izris uporablja MASK.pokrij (ista koda)')
chk(src_has(RENDER, 'MASK.obnoviOzadje(izvirnik, W, H, pk.ograja)'), 'dokazni izris uporablja MASK.obnoviOzadje')
chk(src_has(RENDER, 'MASK.slojObnove(obnova, pk.ograja, W, H)'), 'dokazni izris uporablja MASK.slojObnove')
chk(src_has(RENDER, 'MASK.slojPrednjega(izvirnik, W, H, pk.prednji)'), 'dokazni izris uporablja MASK.slojPrednjega (ležalniki ostanejo pred)')
chk(src_has(RENDER, 'CORE.izrisiOgrajo(') and src_has(RENDER, 'CORE.izrisiPrimerjavo('), 'dokazni izris uporablja CORE.izrisiOgrajo/izrisiPrimerjavo')
chk(src_has(RENDER, 'TEKS.izberiGradivo(assets,'), 'gradivo izbere TEKS.izberiGradivo (fail-closed izbira)')
chk(src_has(RENDER, 'TEKS.izmeriIzrezeNavpicnihPalic('), 'FASADA tekstura: množica izrezov (R523 — ista izmera kot UI)')
chk(src_has(RENDER, 'zig: true'), 'dokazni izris POTEM nosi žig VIZUALIZACIJA ZA PREDSTAVITEV (§15)')
for artefakt, min_kb in [
    ('ops/r520-F-potem.png', 500), ('ops/r520-F-primerjava.png', 500), ('ops/r520-F-zoom.png', 300),
    ('ops/r520-F2-potem.png', 500), ('ops/r520-F2-primerjava.png', 500), ('ops/r520-F2-zoom.png', 300),
    ('ops/r520-T-potem.png', 500), ('ops/r520-T-primerjava.png', 500), ('ops/r520-T-zoom.png', 300),
    ('ops/r520-T2-potem.png', 500), ('ops/r520-T2-primerjava.png', 500), ('ops/r520-T2-zoom.png', 300),
    ('ops/r520-T3-potem.png', 400), ('ops/r520-T3-primerjava.png', 400),
]:
    try:
        velikost = os.path.getsize(os.path.join(REPO, artefakt))
        chk(velikost >= min_kb * 1000, f'{artefakt} obstaja ({velikost // 1024} kB ≥ {min_kb} kB)')
    except OSError:
        bad(f'{artefakt} manjka')

# ═══ J) živi API krog (samo ob delujočem strežniku) ═════════════════════════
print('── J) živi API: hotel-bazen terasa fixture + RUSTIC (150/6) ──')
try:
    with urllib.request.urlopen(BASE + '/', timeout=5) as r:
        pass
except Exception:
    print('  ⏸ strežnik ne teče na BASE_URL — blok J se preskoči (ne zeleno)')
else:
    TOKEN = login('admin@roksal.si', 'Admin123!')
    s, prods = callj('GET', '/api/products?family=all', TOKEN)
    rustic = next((p for p in prods.get('data', []) if p.get('sku') == 'ROK-TER-RUSTIC'), None)
    chk(rustic is not None, 'ROK-TER-RUSTIC dosegljiv prek API-ja')
    s, prjs = callj('GET', '/api/projects', TOKEN)
    projekt = next((p for p in prjs.get('data', [])), None)
    chk(projekt is not None, 'vsaj en projekt na voljo')
    if rustic and projekt:
        roak = next((v for v in rustic.get('variants', []) if v.get('sku') == 'ROK-TER-RUSTIC-ROAK'), None)
        chk(roak is not None, 'varianta ROAK (Rustic oak) na voljo prek API-ja')
        foto = ('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof'
                'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIy'
                'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEB'
                'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF8AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0Kx'
                'wRNS0WLwcJDhLWNENFdxcYIzRiZHKBkaFYoQEVFhYnfCBlSjNWVTJCVFYX//EABQBAQAAAAAAAAAAAAAAAAAAAAX/xAAU'
                'EQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=')
        render_params = {
            'quad': [{'x': 0.02, 'y': 0.995}, {'x': 0.75, 'y': 0.995}, {'x': 0.71, 'y': 0.79}, {'x': 0.06, 'y': 0.79}],
            'reference': {'tip': 'ROCNO', 'cm': 480, 'opis': 'širina terasne površine ob bazenu ≈ 480 cm'},
            'config': {'tip': 'TERASA', 'lengthCm': 480, 'heightCm': 350, 'posts': 2, 'handrail': False,
                       'lamelaMm': 150, 'rezaMm': 6, 'deskaMm': 150, 'pritrditev': 'TALNA', 'vijaki': False},
            'maska': {
                'ograja': [[{'x': 0.02, 'y': 0.995}, {'x': 0.75, 'y': 0.995}, {'x': 0.71, 'y': 0.79}, {'x': 0.06, 'y': 0.79}]],
                'izpusti': [],
                'prednji': [[{'x': 0.27, 'y': 1.0}, {'x': 0.425, 'y': 1.0}, {'x': 0.41, 'y': 0.915}, {'x': 0.28, 'y': 0.925}]],
            },
        }
        s, d = callj('POST', '/api/photo-visualization', TOKEN, {
            'projectId': projekt['id'], 'sourcePhoto': foto,
            'productId': rustic['id'], 'variantId': roak['id'],
            'renderParams': render_params, 'note': 'R520 test — terasa 150/6',
        })
        chk(s == 201, f'vizualizacija TERASA ustvarjena (201, dejansko {s})')
        vid = d.get('data', {}).get('id')
        if vid:
            V = bun_db(f'''
import {{ PrismaClient }} from '@prisma/client'
const db = new PrismaClient()
const v = await db.photoVisualization.findUnique({{ where: {{ id: '{vid}' }}, }})
const rp = v ? JSON.parse(v.renderParams) : {{}}
console.log(JSON.stringify({{
  tip: rp.config?.tip, deska: rp.config?.deskaMm, reza: rp.config?.rezaMm,
  globina: rp.config?.heightCm, maskaPrednji: rp.maska?.prednji?.length,
}}))
await db.$disconnect()
''')
            chk(V.get('tip') == 'TERASA' and V.get('deska') == 150, f'tip TERASA + deska 150 mm preživita krog (dejansko {V.get("tip")}/{V.get("deska")})')
            chk(V.get('reza') == 6 and V.get('globina') == 350, f'reža 6 mm (uradni FAQ!) + globina 350 preživita (dejansko {V.get("reza")}/{V.get("globina")})')
            chk(V.get('maskaPrednji') == 1, 'maska prednjega plana (ležalnik) preživi krog')
            for _ in range(2):
                C2 = bun_db(f'''
import {{ PrismaClient }} from '@prisma/client'
const db = new PrismaClient()
await db.photoVisualization.delete({{ where: {{ id: '{vid}' }}, }}).catch(() => {{}})
const n = await db.photoVisualization.count({{ where: {{ id: '{vid}' }}, }})
console.log(JSON.stringify({{ n }}))
await db.$disconnect()
''')
            chk(C2.get('n') == 0, 'testna vizualizacija počiščena (idempotentno ×2)')

print()
print(f'══ REZULTAT: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL > 0 else 0)
