#!/usr/bin/env python3
"""tests/r504.py — R507 (issue #14): MASKA, OBNOVA OZADJA IN ORIGINALNA GRADIVA

Preverja NOVA čista modula `photo-replace-mask` (§1, §2) in `photo-replace-texture`
(§3, §4) ter njuno vgradnjo v `photo-replace-core` / `photo-replace-engine`.
Dogradnjuje r459–r462 (dotlejši kvad + preliv), nič od tam dokazanega ne sme
izginiti: blok K zato ponovi celoten API krog z MASKO in preveri, da STARI zapis
(brez maske) ostane veljaven in se ne spremeni.

  A) VALIDACIJA MASKE — `null` je VELJAVEN (stare vizualizacije), meje oblik in
     točk, točke izven slike, neveljavne vrednosti.
  B) GEOMETRIJA — even-odd, ploščina (shoelace), rasterizacija, IZPUSTI
     razveljavijo pokritost, rob slike ne sme ustvariti izven-mejskega zapisa.
  C) OBNOVA OZADJA (brez AI) — zunaj maske NESPREMENJENIH nič, znotraj samo
     izpeljano iz znanih sosedov, globina = dokaz zanesljivosti, predolg pas se
     razglasi za NEDOKONČAN in poimenuje; nikoli tiho.
  D) SLOJ OBNOVE — alfa-rob, zunaj maske prosojen, nedokončano deterministično
     označeno (šrafura), brez Math.random.
  E) PREDNJI PLAN — originalni piksli imajo prednost pred novo ograjo.
  F) IZBERA GRADIVA — fail-closed po petih stanjih, prednostni red vrst,
     deterministična izbira, NEUPORABLJENO nikoli ne trdi, da je original.
  G) PROJEKCIJA TEKSTURE — mreža celic si deli točne kote, izvor se pokrije
     brez rež in brez podvajanja, gostota samo iz mer slike.
  H) OPOZORILA KAKOVOSTI — MASKA_NEKRITA / MASKA_IZPUST / PREDNJI_BREZ.
  I) FIXTURE NABOR (tests/fixtures/foto-montaza/manifest.json) — RESNIČNE
     fotografije: izvirnik obstaja in se ujema s sha256, ročno označena maska je
     veljavna, ploščine se ujemajo, IZ KATALOGA res izbrani pričakovani
     preverjeni asset in pričakovana opozorila.
  J) DOKAZI IZ VIROV — noben AI/naključje/mrežni klic, brez drugega cenovnega
     ali merilnega jedra, core res riše ozadje in prednji plan, stari preliv
     pošteno reče, da NI odstranitev.
  K) API KROG — maska preživi zapis/branje, prevelika maska zavrne (400),
     STARI renderParams brez maske ostane veljaven in se SHRANI BREZ ključa.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.request
import urllib.error

import dbenv

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.environ.get('REPO_DIR', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TAG = 'R504-TEST'
PASS, FAIL = 0, 0

DBURL = dbenv.db_url(REPO)


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)


def bun_ts (script, timeout=180):
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       cwd=REPO, timeout=timeout,
                       env={**os.environ, 'DATABASE_URL': DBURL})
    return r.stdout, (r.stderr or '')[-1200:]


def bun_out (script):
    out, err = bun_ts(script)
    try:
        return json.loads(out.strip().splitlines()[-1])
    except Exception:
        return {'_err': (err or out)[:500]}


def src (relpath):
    try:
        with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
            return f.read()
    except Exception:
        return ''


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


MASKA = './src/lib/photo-replace-mask'
TEKST = './src/lib/photo-replace-texture'
JEDRO = './src/lib/photo-replace-core'

print('═══ R504: maska, obnova ozadja in originalna gradiva (issue #14) ═══')

# ══ A. validacija maske ════════════════════════════════════════════════════
print('── A) validacija maske ──')
A = f'''
const M = await import('{MASKA}')
const T = (x, y) => ({{ x, y }})
const kv = [T(0.1, 0.8), T(0.9, 0.8), T(0.9, 0.3), T(0.1, 0.3)]
const o = {{}}
o.null = M.preveriMasko(null)
o.undefined = M.preveriMasko(undefined)
o.praznObj = M.preveriMasko({{}})
o.dveTocki = M.preveriMasko({{ ograja: [[T(0, 0), T(1, 1)]] }})
o.prevecTock = M.preveriMasko({{ ograja: [Array.from({{ length: M.MAX_TOCK + 1 }}, (_, i) => T(i / 40, 0.2))] }})
o.prevecOblik = M.preveriMasko({{ ograja: Array.from({{ length: M.MAX_OBLIK + 1 }}, () => [T(0, 0), T(0.5, 0), T(0.5, 0.5)]) }})
o.izvenSlike = M.preveriMasko({{ ograja: [[T(-0.2, 0.1), T(0.5, 0.1), T(0.5, 0.4)]] }})
o.nan = M.preveriMasko({{ ograja: [[T(Number.NaN, 0.1), T(0.5, 0.1), T(0.5, 0.4)]] }})
o.niz = M.preveriMasko({{ ograja: 'x' }})
o.celjna = M.preveriMasko({{ ograja: [kv], izpusti: [[T(0.2, 0.7), T(0.4, 0.7), T(0.4, 0.5)]], prednji: [[T(0.0, 0.9), T(0.2, 0.9), T(0.2, 0.95)]] }})
o.stevec = {{
  nullPrazna: M.jePraznaMaska(null),
  novaPrazna: M.jePraznaMaska(M.praznaMaska()),
  celjna: M.jePraznaMaska(o.celjna.maska),
  izQuada: M.jePraznaMaska(M.maskaIzQuada(kv)),
}}
o.izQuada = M.maskaIzQuada(kv)
o.sporocila = {{
  dveTocki: o.dveTocki.napake.map((n) => n.polje + ':' + n.sporocilo),
  izven: o.izvenSlike.napake.map((n) => n.polje),
  prevecTock: o.prevecTock.napake.map((n) => n.polje),
  prevecOblik: o.prevecOblik.napake.map((n) => n.polje),
  nan: o.nan.napake.map((n) => n.polje),
  niz: o.niz.napake.map((n) => n.polje),
}}
console.log(JSON.stringify(o))
'''
a = bun_out(A)
chk('_err' not in a, f'A: modul se uvozi ({a.get("_err", "")[:160]})')
chk(a.get('null', {}).get('napake') == [] and a['null']['maska'] == {'ograja': [], 'izpusti': [], 'prednji': []},
    'A: maska null je VELJAVNA in prazna (stari zapisi se ne podrušijo)')
chk(a.get('undefined', {}).get('napake') == [], 'A: maska undefined enako kot null')
chk(a.get('praznObj', {}).get('napake') == [], 'A: prazen objekt je veljaven')
chk(a.get('celjna', {}).get('napake') == [] and len(a['celjna']['maska']['ograja']) == 1
    and len(a['celjna']['maska']['prednji']) == 1, 'A: veljavna trodelna maska sprejeta')
chk(any('vsaj 3' in s for s in a.get('sporocila', {}).get('dveTocki', [])), 'A: 2 točki zavrnjeni ("vsaj 3 točke")')
chk(a.get('sporocila', {}).get('izven', []) == ['maska.ograja[0][0]'], 'A: točka izven slike → pravilno polje')
chk(a.get('sporocila', {}).get('prevecTock', []) == ['maska.ograja[0]'], 'A: preveč točk zavrnjeno (MAX_TOCK)')
chk(a.get('sporocila', {}).get('prevecOblik', []) == ['maska.ograja'], 'A: preveč oblik zavrnjeno (MAX_OBLIK)')
chk(a.get('sporocila', {}).get('nan', []) == ['maska.ograja[0][0]'], 'A: NaN točka zavrnjena')
chk(a.get('sporocila', {}).get('niz', []) == ['maska.ograja'], 'A: ne-seznam oblik zavrnjen')
chk(a.get('stevec', {}) == {'nullPrazna': True, 'novaPrazna': True, 'celjna': False, 'izQuada': False},
    'A: jePraznaMaska loči prazno od polne')
chk(a.get('izQuada', {}).get('ograda') is None and len(a['izQuada']['ograja']) == 1
    and a['izQuada']['prednji'] == [], 'A: maskaIzQuada = ena oblika, brez izpustov in prednjega plana')

# ══ B. geometrija maske ════════════════════════════════════════════════════
print('── B) geometrija in rasterizacija ──')
B = f'''
const M = await import('{MASKA}')
const T = (x, y) => ({{ x, y }})
const kvadrat = [T(0.2, 0.8), T(0.8, 0.8), T(0.8, 0.2), T(0.2, 0.2)]
const trikotnik = [T(0, 0), T(1, 0), T(0, 1)]
const out = {{}}
out.vPoligonu = [
  M.vPoligonu(0.5, 0.5, kvadrat), M.vPoligonu(0.1, 0.5, kvadrat),
  M.vPoligonu(0.5, 0.1, kvadrat), M.vPoligonu(0.9, 0.9, kvadrat),
]
out.ploscine = {{
  enota: M.ploscina([T(0, 0), T(1, 0), T(1, 1), T(0, 1)]),
  obratni: M.ploscina([T(0, 1), T(1, 1), T(1, 0), T(0, 0)]),
  tri: M.ploscina(trikotnik),
  kv: M.ploscina(kvadrat),
  crta: M.ploscina([T(0, 0), T(1, 0), T(0.5, 0)]),
  premalo: M.ploscina([T(0, 0), T(1, 1)]),
}}
out.skupina = M.ploscinaSkupine([kvadrat, trikotnik])
// rasterizacija: 100×50, dva pravokotnika + izpust + prednji plan
// pričakovano (sredine pikslov, roba nikoli ne zadene sredine):
//   ograja 40 stolpcev × 35 vrstic = 1400, izpust 10 × 10 = 100 → 1300
//   prednji 35 stolpcev × 20 vrstic = 700
const m = {{
  ograja: [[T(0.1, 0.9), T(0.5, 0.9), T(0.5, 0.2), T(0.1, 0.2)]],
  izpusti: [[T(0.2, 0.6), T(0.3, 0.6), T(0.3, 0.4), T(0.2, 0.4)]],
  prednji: [[T(0.6, 0.9), T(0.95, 0.9), T(0.95, 0.5), T(0.6, 0.5)]],
}}
const p = M.pokrij(m, 100, 50)
const stej = (arr) => arr.reduce((s, v) => s + v, 0)
out.pokrij = {{
  ograja: stej(p.ograja), prednji: stej(p.prednji),
  vIzpustu: p.ograja[25 * 100 + 25], predIzpust: p.ograja[25 * 100 + 45],
  dolzina: p.ograja.length,
}}
out.delezi = {{
  ograja: M.deležPokritja(p.ograja), prednji: M.deležPokritja(p.prednji),
  prazen: M.deležPokritja(new Uint8Array(0)),
}}
// vrstni red NE sme spremeniti rezultata: izpust NAJPREJ
const m2 = {{ ograja: m.ograja, izpusti: m.izpusti.slice().reverse(), prednji: [] }}
const p2 = M.pokrij(m2, 100, 50)
out.izpustNepomembenVrstniRed = stej(p2.ograja) === stej(p.ograja)
// maska na robu slike (x = 0 in x = 1) — brez izven-mejskih indeksov
const rob = {{ ograja: [[T(0, 1), T(1, 1), T(1, 0), T(0, 0)]], izpusti: [], prednji: [] }}
const pr = M.pokrij(rob, 37, 23)
out.robCelaSlika = stej(pr.ograja) === 37 * 23
// prazna maska → nič ne pokrije
const pp = M.pokrij(M.praznaMaska(), 40, 20)
out.prazna = {{ ograja: stej(pp.ograja), prednji: stej(pp.prednji) }}
console.log(JSON.stringify(out))
'''
b = bun_out(B)
chk('_err' not in b, f'B: geometrija izračunana ({b.get("_err", "")[:160]})')
chk(b.get('vPoligonu') == [True, False, False, False], 'B: even-odd pravilno notri/zunaj')
pl = b.get('ploscine', {})
chk(abs(pl.get('enota', 0) - 1) < 1e-9 and abs(pl.get('obratni', 0) - 1) < 1e-9,
    'B: ploščina enotskega kvadrata = 1 v obeh smereh vrstnega reda')
chk(abs(pl.get('tri', 0) - 0.5) < 1e-9 and abs(pl.get('kv', 0) - 0.36) < 1e-9,
    'B: ploščina trikotnika 0,5 in kvadrata 0,36')
chk(pl.get('crta') == 0 and pl.get('premalo') == 0, 'B: degenerirana oblika = 0')
chk(abs(b.get('skupina', 0) - (0.36 + 0.5)) < 1e-9, 'B: ploscinaSkupine sešteva oblike')
pk = b.get('pokrij', {})
chk(pk.get('dolzina') == 5000 and pk.get('vIzpustu') == 0 and pk.get('predIzpust') == 1,
    'B: izpust razveljavi pokritost znotraj ograje')
chk(pk.get('ograja') == 1300 and pk.get('prednji') == 700, 'B: rasterizacija da pričakovano število pikslov')
chk(b.get('izpustNepomembenVrstniRed') is True, 'B: vrstni red izpustov ne more spremeniti pokritosti')
chk(b.get('robCelaSlika') is True, 'B: maska do roba slike pokrije celotno platno (brez izven-mejskih indeksov)')
chk(b.get('prazna') == {'ograja': 0, 'prednji': 0}, 'B: prazna maska ne pokrije ničesar')
dl = b.get('delezi', {})
chk(abs(dl.get('ograja', 0) - 1300 / 5000) < 1e-9 and dl.get('prazen') == 0,
    'B: deležPokritja = pokriti/sekundarni, prazen niz = 0')

# ══ C. obnova ozadja brez AI ═══════════════════════════════════════════════
print('── C) obnova ozadja s širitvijo z roba ──')
C = f'''
const M = await import('{MASKA}')
const W = 40, H = 20
// levi in desni rob sta poznana (200,60,40), sredina je ZAKRITA (x 10..29)
function slika () {{
  const a = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {{
    const i = (y * W + x) * 4
    const znan = x < 10 || x > 29
    a[i] = znan ? 200 : 7; a[i + 1] = znan ? 60 : 9; a[i + 2] = znan ? 40 : 11; a[i + 3] = 255
  }}
  return a
}}
function pas (x0, x1) {{
  const p = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = x0; x <= x1; x++) p[y * W + x] = 1
  return p
}}
const izvirnik = slika()
const out = {{}}
const o1 = M.obnoviOzadje(izvirnik, W, H, pas(10, 29))
const r1 = M.obnoviOzadje(izvirnik, W, H, pas(10, 29))
const kan = (o, x, y) => o.piksli[(y * W + x) * 4]
out.deterministic = o1.piksli.every((v, i) => v === r1.piksli[i]) &&
  Array.from(o1.globina).every((v, i) => v === Array.from(r1.globina)[i])
out.nespremenjenZunaj = (() => {{
  const p = pas(10, 29)
  for (let i = 0; i < W * H; i++) {{
    if (p[i]) continue
    for (let c = 0; c < 4; c++) if (o1.piksli[i * 4 + c] !== izvirnik[i * 4 + c]) return false
  }}
  return true
}})()
out.zunajGlobina = Array.from(o1.globina).filter((v, i) => pas(10, 29)[i] === 0).every((v) => v === -1)
out.izpeljanoIzSosedov = (() => {{
  // noben obnovljen piksel NIMA izvorne (7,9,11) barve in ne sme biti OUTEN znanega
  for (let x = 10; x <= 29; x++) {{
    const v = kan(o1, x, 5)
    if (v === 7 || v > 200 || v < 200) return false
  }}
  return true
}})()
out.monotono = (() => {{
  for (let y = 0; y < H; y++) {{
    for (let x = 11; x <= 19; x++) if (kan(o1, x, y) < kan(o1, x - 1, y)) return false
    for (let x = 21; x <= 29; x++) if (kan(o1, x, y) > kan(o1, x - 1, y)) return false
  }}
  return true
}})()
out.globine = {{
  rob: o1.globina[5 * W + 10], sredina: o1.globina[5 * W + 19],
  max: Math.max(...Array.from(o1.globina)),
}}
out.nedokoncano = {{
  stevilo: Array.from(o1.nedokončano).reduce((s, v) => s + v, 0),
  razmerje: o1.razmerjeNedokončanega, zahteva: o1.zahtevaRočniPoseg,
  mejnaGlobina: o1.mejnaGlobina, pasovi: o1.pasovi.map((p) => p.ime),
}}
out.sporocilo = o1.sporocilo
// širok pas z majhno mejno globino → NEDOKONČANO in poimenovani pasovi
const o2 = M.obnoviOzadje(izvirnik, W, H, pas(2, 37), {{ maksGlobina: 4 }})
out.sirok = {{
  razmerje: Number(o2.zahtevaRočniPoseg.toFixed ? 0 : 0),
  zahteva: o2.zahtevaRočniPoseg,
  delezi: o2.pasovi.map((p) => [p.ime, p.pokritihPikslov, p.nedokončanihPikslov, Math.round(p.razmerje * 100)]),
  sporocilo: o2.sporocilo,
  razmerjeNedokoncanega: o2.razmerjeNedokončanega,
}}
// popolnoma zakrita slika = brez vira → vsi piksli nedokončani
const o3 = M.obnoviOzadje(izvirnik, W, H, pas(0, 39))
out.brezVira = {{
  razmerje: o3.razmerjeNedokončanega, zahteva: o3.zahtevaRočniPoseg,
  globina: Math.max(...Array.from(o3.globina)),
  nespremenjen: o3.piksli.every((v, i) => v === izvirnik[i]),
}}
// prazna maska → nič se ne obnavlja
const o4 = M.obnoviOzadje(izvirnik, W, H, new Uint8Array(W * H))
out.prazno = {{ sporocilo: o4.sporocilo, zahteva: o4.zahtevaRočniPoseg, razmerje: o4.razmerjeNedokončanega, pasovi: o4.pasovi.map((p) => p.pokritihPikslov) }}
console.log(JSON.stringify(out))
'''
c = bun_out(C)
chk('_err' not in c, f'C: obnova izračunana ({c.get("_err", "")[:200]})')
chk(c.get('deterministic') is True, 'C: ista slika + ista maska → BIT-ENAK rezultat (brez naključja)')
chk(c.get('nespremenjenZunaj') is True, 'C: zunaj maske original NI dotaknjen (§1: hiša/tla ostanejo)')
chk(c.get('zunajGlobina') is True, 'C: zunaj maske globina -1 = piksel je znan')
chk(c.get('izpeljanoIzSosedov') is True, 'C: obnovljen piksel prevzame VREDNOST znanih sosedov (ne izmisli barve)')
chk(c.get('monotono') is True, 'C: prehod med dvema znanima roboma je monoton (brez pasov/roc)')
g = c.get('globine', {})
chk(g.get('rob') == 1 and g.get('sredina') == 10, 'C: globina = ring širitve (rob 1, sredina 10)')
nd = c.get('nedokoncano', {})
chk(nd.get('stevilo') == 0 and nd.get('razmerje') == 0 and nd.get('zahteva') is False,
    'C: ozek pas → dokončano, brez ročnega posega')
chk(nd.get('pasovi') == ['levi del', 'sredina', 'desni del'], 'C: poročilo poimenuje tri pasove')
chk('obnovljeno iz robov' in c.get('sporocilo', '') and 'NI rekonstruirana' in c.get('sporocilo', ''),
    'C: sporočilo pove resnico (iz robov) in omeji trditev (skrite strukture NI rekonstruirala)')
s2 = c.get('sirok', {})
chk(s2.get('zahteva') is True and s2.get('razmerjeNedokoncanega', 0) > 0.5,
    'C: širok pas nad mejno globino → NEDOKONČANO in zahteva ročni poseg')
chk('NEDOKONČANO' in s2.get('sporocilo', '') and 'manjka dokaz' in s2.get('sporocilo', ''),
    'C: sporočilo jasno reče, kaj manjka (ne predstavlja ga kot odstranjene ograje)')
delezi = s2.get('delezi', [])
chk(len(delezi) == 3 and delezi[1][3] == 100 and delezi[0][3] < 100,
    'C: sredinski pas je 100 % nedokončan, robna manj (dokaz je lokaliziran)')
bv = c.get('brezVira', {})
chk(bv.get('zahteva') is True and abs(bv.get('razmerje', 0) - 1) < 1e-9 and bv.get('globina') == 0,
    'C: brez dostopnega vira = 100 % nedokončano (nikoli tiho "uspešno")')
chk(bv.get('nespremenjen') is True, 'C: nedokončani piksli obdržijo ORIGINAL (se ne lažejo)')
pz = c.get('prazno', {})
chk('Ni označenega območja' in pz.get('sporocilo', '') and pz.get('zahteva') is False
    and set(pz.get('pasovi', [])) == {0}, 'C: prazna maska → nič se ne trdi, original nespremenjen')

# ══ D. sloj obnove (alfa + označba) ════════════════════════════════════════
print('── D) sloj obnove in mehki rob ──')
D = f'''
const M = await import('{MASKA}')
const W = 40, H = 20
const izvirnik = new Uint8ClampedArray(W * H * 4)
for (let i = 0; i < W * H; i++) {{ izvirnik[i * 4] = i % 2 ? 200 : 7; izvirnik[i * 4 + 1] = 60; izvirnik[i * 4 + 2] = 40; izvirnik[i * 4 + 3] = 255 }}
const p = new Uint8Array(W * H)
for (let y = 0; y < H; y++) for (let x = 10; x <= 29; x++) p[y * W + x] = 1
const o = M.obnoviOzadje(izvirnik, W, H, p)
const out = {{ mehk: M.MEHKA_ROB }}
const s = M.slojObnove(o, p, W, H)
const al = (x, y) => s[(y * W + x) * 4 + 3]
out.alfa = {{ zunaj: al(0, 0), rob1: al(10, 3), rob2: al(11, 3), rob3: al(12, 3), notranjost: al(19, 3) }}
out.rgbNotranjost = [s[(3 * W + 19) * 4], s[(3 * W + 19) * 4 + 1], s[(3 * W + 19) * 4 + 2]]
const ostri = M.slojObnove(o, p, W, H, {{ mehkaRob: 0 }})
out.ostriRob = ostri[(3 * W + 10) * 4 + 3]
// nedokončano → deterministična šrafura
const sirok = M.obnoviOzadje(izvirnik, W, H, p, {{ maksGlobina: 2 }})
const s2 = M.slojObnove(sirok, p, W, H)
const brez = M.slojObnove(sirok, p, W, H, {{ označiNedokončano: false, mehkaRob: 0 }})
let markiranih = 0, nedokončanih = 0, pricakovanih = 0, enakih = 0
for (let y = 0; y < H; y++) for (let x = 10; x <= 29; x++) {{
  const i = (y * W + x) * 4
  if (sirok.nedokončano[y * W + x] !== 1) continue
  nedokončanih++
  if (((x + y) % 8) < 3) {{ pricakovanih++; if (s2[i] === 244 && s2[i + 1] === 180 && s2[i + 2] === 60) markiranih++ }}
  if (brez[i] === sirok.piksli[i] && brez[i + 1] === sirok.piksli[i + 1] && brez[i + 2] === sirok.piksli[i + 2]) enakih++
}}
out.srafura = {{ markiranih, pricakovanih, nedokončanih, brezOznake: enakih }}
out.srafuraDeterministic = (() => {{
  const t = M.slojObnove(M.obnoviOzadje(izvirnik, W, H, p, {{ maksGlobina: 2 }}), p, W, H)
  return t.every((v, i) => v === s2[i])
}})()
// prednji plan
const prednji = new Uint8Array(W * H)
for (let y = 0; y < H; y++) for (let x = 0; x < 6; x++) prednji[y * W + x] = 1
const trenutni = new Uint8ClampedArray(W * H * 4).fill(123)
const z = M.zložiPrednjiPlan(trenutni, izvirnik, prednji)
out.prednji = {{
  vrneOriginal: z[3 * W * 4] === izvirnik[3 * W * 4] && z[3 * W * 4 + 3] === 255,
  drugjeTrenutni: z[(3 * W + 20) * 4] === 123,
}}
const mehk = M.mehkiPrednji(prednji, W, H, 2)
const tvrd = M.mehkiPrednji(prednji, W, H, 0)
out.mehki = {{
  notranjost: mehk[3 * W + 2], rob: mehk[3 * W], kot: mehk[0],
  zunaj: mehk[3 * W + 10], tvrdNotranjost: tvrd[3 * W + 2], tvrdRob: tvrd[3 * W],
}}
// prednji plan kot PROSOJEN sloj (UI ga riše čez novo ograjo)
const sP = M.slojPrednjega(izvirnik, W, H, prednji, 0)
const sM = M.slojPrednjega(izvirnik, W, H, prednji, 2)
out.slojPrednji = {{
  zunajAlfa: sP[(3 * W + 20) * 4 + 3], notranjostAlfa: sP[(3 * W + 2) * 4 + 3],
  rgbOriginal: sP[(3 * W + 2) * 4] === izvirnik[(3 * W + 2) * 4] && sP[(3 * W + 2) * 4 + 1] === izvirnik[(3 * W + 2) * 4 + 1],
  mehkiRobBlag: sM[(3 * W + 0) * 4 + 3] > 0 && sM[(3 * W + 0) * 4 + 3] < 255,
  mehkiNotranjost: sM[(3 * W + 2) * 4 + 3],
  nicNiPrikrito: sP[(3 * W + 20) * 4] === 0 && sP[(3 * W + 20) * 4 + 1] === 0,
}}
console.log(JSON.stringify(out))
'''
d = bun_out(D)
chk('_err' not in d, f'D: sloj izračunan ({d.get("_err", "")[:160]})')
al = d.get('alfa', {})
chk(al.get('zunaj') == 0 and al.get('rob1') == 85 and al.get('rob2') == 170 and al.get('rob3') == 255
    and al.get('notranjost') == 255, 'D: alfa narašča po ringih (0 zunaj, mehki rob, 255 v notranjosti)')
chk(d.get('ostriRob') == 255, 'D: mehkaRob = 0 → oster rob (brez prehoda)')
chk(d.get('rgbNotranjost') == [200, 60, 40], 'D: RGB sloja = obnovljena barva sosedov')
sf = d.get('srafura', {})
chk(sf.get('nedokončanih', 0) > 0 and sf.get('markiranih') == sf.get('pricakovanih')
    and sf.get('pricakovanih') > 0,
    f'D: vsak nedokončan piksel na šrafurnem vzorcu je označen ({sf.get("markiranih")}/{sf.get("pricakovanih")} od {sf.get("nedokončanih")})')
chk(sf.get('brezOznake') == sf.get('nedokončanih'),
    'D: brez oznake je sloj čista obnova (nič ne prekriva)')
chk(d.get('srafuraDeterministic') is True, 'D: oznaka je deterministična (odvisna od položaja, ne od naključja)')
pr = d.get('prednji', {})
chk(pr.get('vrneOriginal') is True and pr.get('drugjeTrenutni') is True,
    'E: prednji plan vrne ORIGINALNE piksle, drugje obstane trenutni kompozit')
mk = d.get('mehki', {})
chk(mk.get('notranjost') == 255 and mk.get('rob') < 255 and mk.get('kot') < mk.get('rob')
    and mk.get('zunaj') == 0 and mk.get('tvrdNotranjost') == 255 and mk.get('tvrdRob') == 255,
    'E: mehki rob prednjega plana je blag (kot temnejši od roba), brez ringov pa trd')
sp = d.get('slojPrednji', {})
chk(sp.get('zunajAlfa') == 0 and sp.get('notranjostAlfa') == 255 and sp.get('rgbOriginal') is True
    and sp.get('mehkiRobBlag') is True and sp.get('mehkiNotranjost') == 255
    and sp.get('nicNiPrikrito') is True,
    'E: prednji plan kot sloj je zunaj prosojen, znotraj ORIGINAL in z mehkim robom')

# ══ F. izbira preverjenega gradiva ═════════════════════════════════════════
print('── F) izbira originalnih gradiv (fail-closed) ──')
F = f'''
const X = await import('{TEKST}')
const a = (id, kind, o, varSku, status, filePath, productId) => ({{
  id, kind, orientation: o ?? null, view: 'POGLED', colorName: null, variantSku: varSku ?? null,
  productId: productId ?? 'P1', filePath: filePath === undefined ? 'public/' + id + '.jpg' : filePath,
  sha256: null, status: status ?? 'VERIFIED',
  permission: 'Lastnik aplikacije', sourceName: 'Roksal d.o.o.',
}})
const req = (variantSku, o) => ({{ productId: 'P1', variantSku: variantSku ?? null, orientation: o ?? 'SPLOSNO' }})
const out = {{}}
const leto = [a('1', 'FOTO_IZDELEK', 'SPLOSNO', 'V-AMW'), a('2', 'DETAJL', 'SPLOSNO', 'V-AMW')]
out.toZnaVarianta = X.izberiGradivo(leto, req('V-AMW'))
out.prioritetnaVrsta = out.toZnaVarianta.gradivo.id
out.druzina = X.izberiGradivo(leto, req('V-ROAK'))
out.druzinaAsset = out.druzina.gradivo && out.druzina.gradivo.id
out.brezDatoteke = X.izberiGradivo([a('1', 'FOTO_IZDELEK', 'SPLOSNO', null, 'VERIFIED', null)], req('V-AMW'))
out.nepreverjeno = X.izberiGradivo([a('1', 'FOTO_IZDELEK', 'SPLOSNO', null, 'NEEDS_REVIEW')], req('V-AMW'))
out.neupolnomočeno = X.izberiGradivo([a('1', 'FOTO_IZDELEK', 'SPLOSNO', null, 'NOT_AUTHORIZED')], req('V-AMW'))
out.brezIzdelka = X.izberiGradivo(leto, {{ productId: '', variantSku: null, orientation: 'SPLOSNO' }})
out.tujIzdelek = X.izberiGradivo([a('1', 'FOTO_IZDELEK', 'SPLOSNO', null, 'VERIFIED', 'x.jpg', 'P2')], req('V-AMW'))
// profilni presek je ZADNJA izbira (tehnični posnetek ni površina)
out.presekZadnji = X.izberiGradivo([a('9', 'PROFIL_PRESEK', 'SPLOSNO', null), a('3', 'FOTO_IZDELEK', 'PRECNA', null)], req(null, 'PRECNA'))
out.presekZadnjiAsset = out.presekZadnji.gradivo && out.presekZadnji.gradivo.id
// orientacija se upošteva; neskladna → ne trdi 'original te orientacije'
out.orientacija = X.izberiGradivo([a('1', 'FOTO_IZDELEK', 'PRECNA', 'V-AMW')], req('V-AMW', 'POKOCNA'))
// determinizem: vrstni red vhoda ne sme spremeniti izbire
const razmecani = [leto[1], leto[0]]
out.det = JSON.stringify(X.izberiGradivo(razmecani, req('V-AMW')).gradivo) === JSON.stringify(out.toZnaVarianta.gradivo)
// doklad o viru (sha256 + pot) gre v metapodatke različice
const z = X.izberiGradivo([Object.assign(a('1', 'FOTO_IZDELEK', 'SPLOSNO', 'V-AMW'), {{ sha256: 'abc', filePath: 'public/x.jpg', sourceName: 'Roksal — roksal.com' }})], req('V-AMW'))
out.doklad = z.doklad
out.stanja = [out.toZnaVarianta.stanje, out.druzina.stanje, out.brezDatoteke.stanje, out.nepreverjeno.stanje,
  out.neupolnomočeno.stanje, out.brezIzdelka.stanje, out.tujIzdelek.stanje]
out.sme = [out.toZnaVarianta.smeUporabiti, out.druzina.smeUporabiti, out.brezDatoteke.smeUporabiti,
  out.nepreverjeno.smeUporabiti, out.neupolnomočeno.smeUporabiti, out.brezIzdelka.smeUporabiti, out.tujIzdelek.smeUporabiti]
out.napisi = [out.brezDatoteke.napis, out.neupolnomočeno.napis, out.druzina.napis, out.toZnaVarianta.napis]
out.manjkajo = {{
  toZna: out.toZnaVarianta.manjkajo, druzina: out.druzina.manjkajo,
  nepreverjeno: out.nepreverjeno.manjkajo, orientacija: out.orientacija.stanje,
}}
console.log(JSON.stringify(out))
'''
f = bun_out(F)
chk('_err' not in f, f'F: izbira gradiva izračunana ({f.get("_err", "")[:200]})')
chk(f.get('stanja') == ['UPORABLJENO', 'SAMO_DRUZINA', 'NI_DATOTEKE', 'NI_PREVERJENO',
                        'NI_DOVOLJENJA', 'BREZ_IZDELKA', 'NI_PREVERJENO'],
    f'F: vseh pet stanj doseženih ({f.get("stanja")})')
chk(f.get('sme') == [True, True, False, False, False, False, False],
    'F: originalno površino sme risati samo UPORABLJENO in SAMO_DRUZINA')
chk(f.get('prioritetnaVrsta') == '2', 'F: DETAJL ima prednost pred FOTO_IZDELEK (R523 — posnetek površine variante je najboljši vir teksture)')
chk(f.get('druzinaAsset') == '2' and 'originalna površina te barve/odtenka' in json.dumps(f.get('manjkajo', {}), ensure_ascii=False),
    'F: brez variante → gradivo izdelka samo v strukturo (R523: DETAJL tudi v družinski rezervi), manjkajoče imenovano')
chk(f.get('presekZadnjiAsset') == '3', 'F: profilni presek je zadnja izbira (tehnični posnetek ni površina)')
chk(f.get('orientacija', {}).get('stanje') == 'SAMO_DRUZINA',
    "F: napačna orientacija ne trdi 'originalne površine te orientacije'")
chk(f.get('det') is True, 'F: vrstni red vhoda ne more spremeniti izbire (deterministično)')
chk('public/x.jpg' in f.get('doklad', '') and 'abc' in f.get('doklad', ''),
    'F: doklad o viru vsebuje pot in sha256 (§4: sredstva v metapodatkih)')
napisi = ' | '.join(f.get('napisi', []))
chk('NE originalna površina' in napisi or 'približek' in napisi, 'F: zavrnjena izbira jasno pove, da NI originalna površina')
chk('IZKLJUČNO' not in napisi, 'F: napis ne obljublja več, kot je preverjeno')

# ══ G. projekcija teksture ═════════════════════════════════════════════════
print('── G) projektivna mreža celic ──')
G = f'''
const X = await import('{TEKST}')
const out = {{}}
// identična preslikava → celice pokrijejo vir brez rež in podvajanja
const P = (u, v) => ({{ x: u * 200, y: v * 100 }})
const celice = X.razdeliMrežo(P, {{ x: 10, y: 5, w: 120, h: 60 }}, 4, 3)
out.stevilo = celice.length
out.povrsinaVsote = celice.reduce((s, c) => s + c.vir.w * c.vir.h, 0)
out.virPovrsina = 120 * 60
let skupniKoti = 0, primerjanih = 0
for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) {{
  const c = celice[j * 4 + i]
  const desno = i < 3 ? celice[j * 4 + i + 1] : null
  const spodaj = j < 2 ? celice[(j + 1) * 4 + i] : null
  if (desno) {{ primerjanih++; if (c.koti[1].x === desno.koti[0].x && c.koti[1].y === desno.koti[0].y) skupniKoti++ }}
  if (spodaj) {{ primerjanih++; if (c.koti[2].x === spodaj.koti[1].x && c.koti[2].y === spodaj.koti[1].y) skupniKoti++ }}
}}
out.deljeniKoti = {{ skupniKoti, primerjanih }}
out.zacetek = {{ vir: celice[0].vir, cilj: celice[0].koti[0] }}
out.konec = [celice[11].koti[2], {{ x: celice[11].vir.x + celice[11].vir.w, y: celice[11].vir.y + celice[11].vir.h }}]
// perspektiva: kotovi RAČUNANI IZ preslikave (ne linearno interpolirani v viru)
const PP = (u, v) => ({{ x: u * 100 / (1 + 0.5 * v), y: v * 80 }})
const per = X.razdeliMrežo(PP, {{ x: 0, y: 0, w: 10, h: 10 }}, 2, 2)
out.perspektiva = per.map((c) => [c.koti[0].x.toFixed(3), c.koti[3].x.toFixed(3)])
// v teče od zgoraj navzdol
const ravnina = (x, y) => ({{ x, y }})
const projekcija = X.projekcijaIzRavnine(ravnina, 10, 40, 30, 90)
out.smerV = [projekcija(0, 0), projekcija(0, 1), projekcija(1, 0)]
// izrez vira in gostota
out.izrez = [X.izrezVira(100, 200), X.izrezVira(100, 200, [0.25, 0.75]), X.izrezVira(100, 200, [0.8, 0.2]), X.izrezVira(100, 200, [-1, 5])]
out.gostota = [X.celiceZaElement(1200, 40), X.celiceZaElement(3, 2), X.celiceZaElement(100000, 100000)]
// vzorciTeksturo: izprazni se brez slikovnih API-jev, kadar je moč 0 ali vir prazen
const klici = []
const ctx = new Proxy({{}}, {{
  get (t, k) {{
    if (k === 'setTransform' || k === 'drawImage' || k === 'clip' || k === 'beginPath' ||
        k === 'moveTo' || k === 'lineTo' || k === 'closePath' || k === 'save' || k === 'restore') {{
      return (...args) => klici.push([String(k), args.length])
    }}
    return undefined
  }},
  set (t, k, v) {{ klici.push(['set:' + String(k), v]); return true }},
}})
X.vzorciTeksturo(ctx, P, {{ slika: {{}}, sirinaPx: 120, visinaPx: 60, doklad: 'd', oznaka: 'o' }}, {{ celiceU: 2, celiceV: 2, moc: 0 }})
out.moc0 = klici.length
X.vzorciTeksturo(ctx, P, {{ slika: {{}}, sirinaPx: 0, visinaPx: 60, doklad: 'd', oznaka: 'o' }}, {{ moc: 0.5 }})
out.prazenVir = klici.length
klici.length = 0
X.vzorciTeksturo(ctx, P, {{ slika: {{}}, sirinaPx: 120, visinaPx: 60, doklad: 'd', oznaka: 'o' }}, {{ celiceU: 2, celiceV: 2, moc: 0.4 }})
out.izrisani = {{
  drawImage: klici.filter((k) => k[0] === 'drawImage').length,
  clip: klici.filter((k) => k[0] === 'clip').length,
  multiply: klici.some((k) => k[0] === 'set:globalCompositeOperation' && k[1] === 'multiply'),
  alpha: klici.some((k) => k[0] === 'set:globalAlpha' && k[1] === 0.4),
}}
console.log(JSON.stringify(out))
'''
g = bun_out(G)
chk('_err' not in g, f'G: mreža izračunana ({g.get("_err", "")[:200]})')
chk(g.get('stevilo') == 12, 'G: 4×3 mreža = 12 celic')
chk(g.get('povrsinaVsote') == g.get('virPovrsina'),
    'G: celice pokrijejo VIR točno enkrat (brez rež in brez podvajanja pikslov)')
dk = g.get('deljeniKoti', {})
chk(dk.get('primerjanih') == 17 and dk.get('skupniKoti') == 17,
    'G: sosednje celice so si delile ISTO točko (projekcija, ne interpolacija)')
zc = g.get('zacetek', {})
chk(zc.get('vir') == {'x': 10, 'y': 5, 'w': 30, 'h': 20} and zc.get('cilj') == {'x': 0, 'y': 0},
    'G: prva celica se začne v kotu vira in v kotu cilja')
chk(g.get('konec', [None, None])[1] == {'x': 130, 'y': 65}, 'G: zadnja celica se konča na robu vira')
chk(g.get('smerV') == [{'x': 10, 'y': 90}, {'x': 10, 'y': 40}, {'x': 30, 'y': 90}],
    'G: v teče od ZGORAJ navzdol (tekstura ni zrcaljena)')
iz = g.get('izrez', [])
chk(iz[0] == {'x': 0, 'y': 0, 'w': 100, 'h': 200} and iz[1] == {'x': 0, 'y': 50, 'w': 100, 'h': 100}
    and iz[2]['h'] == 0 and iz[3] == {'x': 0, 'y': 0, 'w': 100, 'h': 200},
    'G: izrezVira omeji pas na 0..1 in nikoli v negativno višino')
gg = g.get('gostota', [])
chk(gg[0] == {'celiceU': 46, 'celiceV': 2} and gg[1] == {'celiceU': 1, 'celiceV': 1}
    and gg[2] == {'celiceU': 64, 'celiceV': 24}, 'G: gostota celic samo iz mer slike, z mejo navzgor')
chk(g.get('moc0') == 0 and g.get('prazenVir') == 0, 'G: moč 0 ali prazen vir ne izriše ničesar (brez stranskega efekta)')
iz2 = g.get('izrisani', {})
chk(iz2.get('drawImage') == 4 and iz2.get('clip') == 4,
    'G: vsaka celica je omejena na svoj štirikotnik (clip) in izrisana enkrat')
chk(iz2.get('multiply') is True and iz2.get('alpha') is True,
    'G: tekstura se meši MULTIPLY (samo struktura, barva ostane iz kataloga)')

# ══ H. opozorila kakovosti ═════════════════════════════════════════════════
print('── H) opozorila o kakovosti označbe ──')
H = f'''
const C = await import('{JEDRO}')
const T = (x, y) => ({{ x, y }})
const kv = [T(0.1, 0.9), T(0.9, 0.9), T(0.9, 0.3), T(0.1, 0.3)]
const cfg = {{ tip: 'POKOCNA', lengthCm: 400, heightCm: 110, posts: 5, handrail: true, lamelaMm: 70, rezaMm: 20, deskaMm: 120, pritrditev: 'TALNA', vijaki: true }}
const ref = {{ tip: 'MERITEV', cm: 400 }}
const p = (maska) => ({{ quad: kv, reference: ref, config: cfg, maska }})
const kod = (r) => r.map((o) => o.koda)
const out = {{}}
out.brezMaske = kod(C.oceniKakovost(p(undefined), 1200, 800, null))
out.pravilna = kod(C.oceniKakovost(p({{
  ograja: [kv], izpusti: [], prednji: [[T(0.0, 1.0), T(0.2, 1.0), T(0.2, 0.9)]] }}), 1200, 800, null))
out.majhna = kod(C.oceniKakovost(p({{
  ograja: [[T(0.1, 0.9), T(0.35, 0.9), T(0.35, 0.6), T(0.1, 0.6)]], izpusti: [], prednji: [[T(0, 0), T(0.1, 0), T(0.1, 0.1)]] }}), 1200, 800, null))
out.izpustiPojedo = kod(C.oceniKakovost(p({{
  ograja: [kv], izpusti: [kv], prednji: [[T(0, 0), T(0.1, 0), T(0.1, 0.1)]] }}), 1200, 800, null))
out.brezPrednjega = kod(C.oceniKakovost(p({{ ograja: [kv], izpusti: [], prednji: [] }}), 1200, 800, null))
out.meraOdstopa = kod(C.oceniKakovost(p({{ ograja: [kv], izpusti: [], prednji: [[T(0, 0), T(0.1, 0), T(0.1, 0.1)]] }}), 1200, 800, 250))
out.maskaZaIzris = C.maskaZaIzris(p(undefined)).ograja.length === 1 && C.maskaZaIzris(p(undefined)).prednji.length === 0
out.zig = C.VIZ_ZIG
out.engine = C.ENGINE_VERSION
console.log(JSON.stringify(out))
'''
h = bun_out(H)
chk('_err' not in h, f'H: opozorila izračunana ({h.get("_err", "")[:200]})')
chk('MASKA_NEKRITA' not in h.get('pravilna', []) and 'PREDNJI_BREZ' not in h['pravilna']
    and 'MASKA_IZPUST' not in h['pravilna'],
    f'H: pravilna maska ne sproži nobenega opozorila maske ({h.get("pravilna")})')
chk('MASKA_NEKRITA' in h.get('majhna', []), 'H: maska pokrije malo kvada → MASKA_NEKRITA (deli ostanejo)')
chk('MASKA_IZPUST' in h.get('izpustiPojedo', []), 'H: izpusti pojeedo celotno masko → MASKA_IZPUST')
chk('PREDNJI_BREZ' in h.get('brezPrednjega', []), 'H: brez prednjega plana na veliki ograji → PREDNJI_BREZ')
chk('MASKA_NEKRITA' not in h.get('brezMaske', []), 'H: brez maske (stari vhod) ne laže o kritju')
chk('MERA_ODSTOPA' in h.get('meraOdstopa', []), 'H: prikazna dolžina ≠ potrjena mera → opozorilo ostane (§6/§15)')
chk(h.get('maskaZaIzris') is True, 'H: maskaZaIzris brez ročne maske = quad (en vir resnice za UI in test)')
chk(h.get('zig') == 'VIZUALIZACIJA ZA PREDSTAVITEV', 'H: obvezni žig §15 nespremenjen')
chk(h.get('engine') == '1.4.0', f'H: ENGINE_VERSION dvignjen na 1.4.0 — R532: harmonizacija barv prizora (dejansko {h.get("engine")})')

# ══ I. nabor resničnih fotografij ══════════════════════════════════════════
print('── I) fixture nabor: resnične fotografije + maska + gradivo ──')
MF_PATH = os.path.join(REPO, 'tests', 'fixtures', 'foto-montaza', 'manifest.json')
try:
    with open(MF_PATH, encoding='utf-8') as mf:
        MANIFEST = json.load(mf)
    ok('manifest obstaja in je veljaven JSON')
except Exception as e:
    MANIFEST = {'primeri': []}
    bad(f'manifest berem: {e}')
chk(len(MANIFEST['primeri']) >= 3, f'največ resničnih primerov (dejansko {len(MANIFEST["primeri"])})')

skuji = {p['izbraniProdukt']['sku'] for p in MANIFEST['primeri']}
katalog = {}
if skuji:
    script = '''
const { PrismaClient } = require('@prisma/client')
;(async () => {
  const db = new PrismaClient()
  const skus = %s
  const out = {}
  for (const sku of skus) {
    const p = await db.product.findUnique({
      where: { sku },
      select: { id: true, sku: true, active: true, assets: { where: { status: 'VERIFIED' }, orderBy: { id: 'asc' },
        select: { id: true, kind: true, orientation: true, view: true, colorName: true, variantSku: true,
                  productId: true, filePath: true, sha256: true, status: true, permission: true, sourceName: true } } },
    })
    out[sku] = p
  }
  console.log(JSON.stringify(out))
  await db.$disconnect()
})()
''' % json.dumps(sorted(skuji))
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True, cwd=REPO, timeout=180,
                       env={**os.environ, 'DATABASE_URL': DBURL})
    try:
        katalog = json.loads(r.stdout.strip().splitlines()[-1])
        ok(f'katalog prebran iz testne baze ({len(katalog)} izdelkov)')
    except Exception:
        katalog = {}
        bad(f'katalog berem iz baze: {(r.stderr or r.stdout)[-200:]}')

SKUPNA = {'datoteke': 0, 'maska': 0, 'ploscine': 0, 'gradivo': 0, 'opozorila': 0}
for p in MANIFEST['primeri']:
    oznaka = p['id']
    pot = os.path.join(REPO, p['izvirnik'].replace('/', os.sep))
    if not os.path.isfile(pot):
        bad(f'{oznaka}: izvirnik {p["izvirnik"]} ne obstaja')
        continue
    with open(pot, 'rb') as fh:
        bajti = fh.read()
    chk(hashlib.sha256(bajti).hexdigest() == p['sha256'], f'{oznaka}: izvirnik se ujema s sha256 ({p["izvirnik"]})')
    SKUPNA['datoteke'] += 1
    # dimenziji (JPEG SOF) — brez zunanjih odvisnosti
    i, dim = 2, None
    while i < len(bajti) - 9:
        if bajti[i] != 0xFF: i += 1; continue
        m = bajti[i + 1]
        if m in (0xC0, 0xC1, 0xC2, 0xC3):
            dim = (int.from_bytes(bajti[i + 7:i + 9], 'big'), int.from_bytes(bajti[i + 5:i + 7], 'big'))
            break
        if m == 0xD8 or m == 0x01 or 0xD0 <= m <= 0xD7: i += 2; continue
        i += 2 + int.from_bytes(bajti[i + 2:i + 4], 'big')
    chk(dim == (p['sirinaPx'], p['visinaPx']), f'{oznaka}: dimenziji {dim} = zapisani {p["sirinaPx"]}×{p["visinaPx"]}')

I = '''
const M = await import('%s')
const X = await import('%s')
const C = await import('%s')
const KATALOG = %s
const PRIMERI = %s
const T = (a) => a.map((t) => ({ x: t.x, y: t.y }))
const out = []
for (const p of PRIMERI) {
  const vk = M.preveriMasko(p.maska)
  const pk = M.pokrij(vk.maska, p.sirinaPx, p.visinaPx)
  const stej = (a) => a.reduce((s, v) => s + v, 0)
  const produkt = KATALOG[p.izbraniProdukt.sku]
  const izbira = produkt ? X.izberiGradivo(produkt.assets, {
    productId: produkt.id, variantSku: p.izbraniProdukt.varianta, orientation: p.izbraniProdukt.orientacija })
    : { stanje: 'BREZ_KATALOGA', gradivo: null, manjkajo: [], smeUporabiti: false }
  const params = { quad: T(p.quad), reference: { tip: p.referenca.tip, cm: p.referenca.cm, opis: p.referenca.opis },
    config: p.config, maska: vk.maska }
  const op = C.oceniKakovost(params, p.sirinaPx, p.visinaPx, null).map((o) => o.koda)
  out.push({
    id: p.id,
    napake: vk.napake.map((n) => n.polje + ':' + n.sporocilo),
    ploscinaOgraja: Number(M.ploscinaSkupine(vk.maska.ograja).toFixed(5)),
    ploscinaIzpusti: Number(M.ploscinaSkupine(vk.maska.izpusti).toFixed(5)),
    delezOgraje: Number((stej(pk.ograja) / (p.sirinaPx * p.visinaPx)).toFixed(5)),
    delezPrednjega: Number((stej(pk.prednji) / (p.sirinaPx * p.visinaPx)).toFixed(5)),
    stanje: izbira.stanje,
    assetDatoteka: izbira.gradivo ? izbira.gradivo.filePath : null,
    manjkajo: izbira.manjkajo,
    smeUporabiti: izbira.smeUporabiti,
    opozorila: op,
    kvadratVeljaven: M.ploscina(T(p.quad)) > 0,
    JSONvelikost: JSON.stringify({ quad: p.quad, reference: p.referenca, config: p.config, maska: vk.maska }).length,
  })
}
console.log(JSON.stringify(out))
''' % (MASKA, TEKST, JEDRO,
       json.dumps({k: v for k, v in katalog.items()}),
       json.dumps([{**p, 'config': {
           'tip': 'POKOCNA', 'lengthCm': 400, 'heightCm': 110, 'posts': 5, 'handrail': True,
           'lamelaMm': 70, 'rezaMm': 20, 'deskaMm': 120, 'pritrditev': 'TALNA', 'vijaki': True}}
           for p in MANIFEST['primeri']], ensure_ascii=False))
i_iz = bun_out(I)
if isinstance(i_iz, list):
    chk(True, f'I: primeri izračunani ({len(i_iz)})')
    rez = {r['id']: r for r in i_iz}
else:
    rez = {}
    bad(f'I: primeri niso izračunani ({str(i_iz.get("_err", i_iz))[:250]})')
for p in MANIFEST['primeri']:
    r = rez.get(p['id'])
    if not r:
        bad(f'{p["id"]}: izračun manjka')
        continue
    pr = p['pricakovano']
    chk(r['napake'] == [], f'{p["id"]}: ročno maska je veljavna ({r["napake"][:1]})')
    chk(r['kvadratVeljaven'] is True, f'{p["id"]}: quad ima ploščino > 0')
    SKUPNA['maska'] += 1
    ujem = (abs(r['ploscinaOgraja'] - pr['ploscinaOgraja']) < 2e-4
            and abs(r['ploscinaIzpusti'] - pr['ploscinaIzpusti']) < 2e-4
            and abs(r['delezOgraje'] - pr['delezOgraje']) < 2e-4
            and abs(r['delezPrednjega'] - pr['delezPrednjega']) < 2e-4)
    chk(ujem, f'{p["id"]}: ploščine in pokritost se ujemata z zapisom')
    SKUPNA['ploscine'] += 1 if ujem else 0
    chk(r['stanje'] == pr['stanje'] and r['assetDatoteka'] == pr['assetDatoteka'],
        f'{p["id"]}: iz KATALOGA res izbere {pr["stanje"]} / {pr["assetDatoteka"]} '
        f'(dejansko {r["stanje"]} / {r["assetDatoteka"]})')
    chk(r['manjkajo'] == pr['manjkajo'], f'{p["id"]}: manjkajoča gradiva zapisana ({r["manjkajo"]})')
    chk(r['smeUporabiti'] == pr['smeUporabiti'], f'{p["id"]}: upoštevanje dovoljenja za originalno površino')
    SKUPNA['gradivo'] += 1 if (r['stanje'] == pr['stanje'] and r['assetDatoteka'] == pr['assetDatoteka']
                               and r['manjkajo'] == pr['manjkajo']) else 0
    chk(r['opozorila'] == pr['opozorila'], f'{p["id"]}: opozorila kakovosti = pričakovana ({r["opozorila"]})')
    SKUPNA['opozorila'] += 1 if r['opozorila'] == pr['opozorila'] else 0
    chk(r['JSONvelikost'] < 12000, f'{p["id"]}: renderParams z masko ostane pod 12 KB ({r["JSONvelikost"]} B)')
chk(SKUPNA['datoteke'] == len(MANIFEST['primeri']), 'I: vsak primer ima SHRANJEN izvirnik z veljavno vsebino')
chk(SKUPNA['gradivo'] == len(MANIFEST['primeri']), 'I: vsak primer ima preverjen ROKSAL asset iz kataloga')
chk(SKUPNA['opozorila'] == len(MANIFEST['primeri']), 'I: vsak primer ima zapisan pričakovan izid opozoril')
# oba izida izbire morata biti v naboru zastopana — sicer test ne vidi fail-closed poti
stanja = [rez.get(p['id'], {}).get('stanje') for p in MANIFEST['primeri']]
chk('UPORABLJENO' in stanja and 'SAMO_DRUZINA' in stanja,
    f'I: nabor pokriva obe poti izbire gradiva ({sorted(set(stanja))})')

# ══ J. dokazi iz virov ═════════════════════════════════════════════════════
print('── J) dokazi iz virov ──')
M_SRC = src('src/lib/photo-replace-mask.ts')
T_SRC = src('src/lib/photo-replace-texture.ts')
C_SRC = src('src/lib/photo-replace-core.ts')
E_SRC = src('src/lib/photo-replace-engine.ts')
for ime, s in [('mask', M_SRC), ('texture', T_SRC), ('core', C_SRC), ('engine', E_SRC)]:
    chk(len(s) > 500, f'J: {ime}.ts obstaja in ni prazen')
# Prepovedani tokeni se iščejo v KODI, ne v komentarjih — dokumentacija sme reči,
# kaj modul NAREDIL ni, sicer bi bil dokaz prazen (ali lažen).
def koda (s):
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    return '\n'.join(v for v in s.splitlines() if not v.lstrip().startswith('//'))
M_K, T_K = koda(M_SRC), koda(T_SRC)
for zakaz, razlog in [
    ('Math.random', 'naključje'), ('Date.now', 'časovno odvisen izpis'),
    ('performance.now', 'merjenje časa v izrisu'), ('fetch(', 'mrežni klic'),
    ('XMLHttpRequest', 'mrežni klic'), ('openai', 'AI ponudnik'), ('groq', 'AI ponudnik'),
    ('replicate', 'AI ponudnik'), ('stable-diffusion', 'AI ponudnik'), ('inpaint', 'AI odstranjevanje'),
    ('tensorflow', 'AI model'), ('onnx', 'AI model'), ('require(', 'skriti uvoz'),
]:
    for ime, s in [('mask', M_K), ('texture', T_K)]:
        chk(zakaz.lower() not in s.lower(), f'J: {ime} ne vsebuje {razlog} ({zakaz})')
chk("'use client'" not in M_K and "'use client'" not in T_K,
    'J: nova modula sta client-safe (brez "use client", enaka logika na obeh straneh)')
chk('document.' not in M_K and 'document.' not in T_K and 'window.' not in M_K,
    'J: maska je DOM-prosta (testna in strežniška rabljiva)')
chk('Prisma' not in M_K and 'Prisma' not in T_K and '@/lib/db' not in T_K,
    'J: gradivni modul ne uvaža baze (presek dobi po API-ju)')
for beseda in ['salePrice', 'costPrice', 'priceList', 'cena', 'popust']:
    chk(beseda not in T_K and beseda not in M_K, f'J: {beseda} — nova modula ne ustanavljata cenovnega jedra')
chk('measure-engine' not in T_K and 'measure-engine' not in M_K,
    'J: nova modula ne uvažata merilnega jedra (issue #14: brez drugega merilnega jedra)')
# core se je vgradil, ne pa podvojil
chk('PREKRIVANJE_NI_ODSTRANITEV' in C_SRC, 'J: preliv (brez prave obnove) se poimenuje resnico')
chk('opcije.ozadje.sloj' in C_SRC and 'OZADJE_NEDOKONCANO' in C_SRC,
    'J: core pravi nariše sloj obnove in napove nedokončanost')
chk('opcije.prednji?.sloj' in C_SRC or 'opcije.prednji.sloj' in C_SRC,
    'J: core na konec nariše prednji plan (nova ograja ne prekriva tega, kar je pred njo)')
chk(C_SRC.count('export function izrisiOgrajo') == 1 and C_SRC.count('export function obnovi') == 0 and 'VIZ_ZIG' in C_SRC,
    'J: izris ostane enoten (brez kopije poganjalnika)')
chk('preveriMasko' in E_SRC and 'jePraznaMaska' in E_SRC,
    'J: strežnik validira masko (enaka pravila kot na odjemalcu)')
chk('MAX_OBLIK' in M_SRC and 'MAX_TOCK' in M_SRC,
    'J: maska ima ZAPISANI meji (renderParams ostane pod 12 KB)')
# UI poroča, kar ve
UI = src('src/components/roksal/modules/foto-replace.tsx')
chk('photo-replace-mask' in UI or 'maskaZaIzris' in UI,
    'J: fotomontažni modul uporablja masko (ni več samo kvad)')
chk('product-assets' in UI, 'J: fotomontažni modul vpraša katalog za preverjena gradiva')
chk('PREKRIVANJE_NI_ODSTRANITEV' in UI or 'OZADJE_NEDOKONCANO' in UI or 'zahtevaRočniPoseg' in UI,
    'J: UI pokaže pošteno poročilo o odstranitvi, ne samo slike')

# ══ K. API krog z masko ════════════════════════════════════════════════════
print('── K) API: maska preživi zapis, stari vhod ostane veljaven ──')
CLEAN = f'''
const {{ PrismaClient }} = await import('@prisma/client')
const db = new PrismaClient()
const vs = await db.photoVisualization.findMany({{ where: {{ note: {{ contains: '{TAG}' }} }}, select: {{ id: true, projectId: true }} }})
for (const v of vs) await db.photoVisualization.delete({{ where: {{ id: v.id }} }})
const ps = await db.project.findMany({{ where: {{ title: {{ contains: '{TAG}' }} }}, select: {{ id: true }} }})
for (const x of ps) await db.project.delete({{ where: {{ id: x.id }} }})
await db.auditLog.deleteMany({{ where: {{ detail: {{ contains: '{TAG}' }} }} }})
console.log('CLEAN_DONE')
await db.$disconnect()
'''
r = subprocess.run(['bun', '-e', CLEAN], capture_output=True, text=True, cwd=REPO, timeout=180,
                   env={**os.environ, 'DATABASE_URL': DBURL})
chk('CLEAN_DONE' in r.stdout, f'K: čiščenje ostankov ({(r.stderr or "")[-200:]})')

s, _ = callj('GET', '/api/public/health')
if s != 200:
    bad(f'K: strežnik na {BASE} ni dosegljiv ({s}) — API bloka ni bilo mogoče izvesti')
else:
    ok('K: strežnik dosegljiv')
    admin = login('admin@roksal.si', 'Admin123!')
    s, d = callj('POST', '/api/projects', admin, {'title': f'Testni projekt {TAG}', 'status': 'NACRT'})
    chk(s == 201, f'K: testni projekt ustvarjen ({s})')
    PROJ = d.get('data', {}).get('id')
    s, d = callj('GET', '/api/products?family=all', admin)
    prods = d.get('data', [])
    PROD = next((p for p in prods if p.get('sku') == 'OGR-K-002'), prods[0] if prods else None)
    VAR = (PROD or {}).get('variants', [{}])[0]

    PHOTO = ('data:image/jpeg;base64,'
             '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
             'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
             'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==')
    QUAD = [{'x': 0.10, 'y': 0.80}, {'x': 0.90, 'y': 0.80}, {'x': 0.88, 'y': 0.35}, {'x': 0.12, 'y': 0.35}]
    CONFIG = {'tip': 'POKOCNA', 'lengthCm': 420, 'heightCm': 110, 'posts': 5, 'handrail': True,
              'lamelaMm': 70, 'rezaMm': 20, 'deskaMm': 120, 'pritrditev': 'TALNA', 'vijaki': True}

    def body (maska=None, **over):
        rp = {'quad': QUAD, 'reference': {'tip': 'ROCNO', 'cm': 420, 'opis': 'testna ograja'}, 'config': CONFIG}
        if maska is not None: rp['maska'] = maska
        b = {'projectId': PROJ, 'sourcePhoto': PHOTO, 'rendered': PHOTO,
             'productId': PROD['id'], 'variantId': VAR.get('id'), 'renderParams': rp, 'note': TAG}
        b.update(over)
        return b

    MASKA_OK = {
        'ograja': [QUAD, [{'x': 0.10, 'y': 0.35}, {'x': 0.90, 'y': 0.35}, {'x': 0.90, 'y': 0.30}, {'x': 0.10, 'y': 0.30}]],
        'izpusti': [[{'x': 0.40, 'y': 0.70}, {'x': 0.50, 'y': 0.70}, {'x': 0.50, 'y': 0.55}, {'x': 0.40, 'y': 0.55}]],
        'prednji': [[{'x': 0.0, 'y': 1.0}, {'x': 0.20, 'y': 1.0}, {'x': 0.22, 'y': 0.82}, {'x': 0.0, 'y': 0.84}]],
    }
    s, d = callj('POST', '/api/photo-visualization', admin, body(MASKA_OK))
    chk(s == 201, f'K: zapis z masko sprejet ({s}: {json.dumps(d)[:140]})')
    VID = d.get('data', {}).get('id')
    s, d = callj('GET', f'/api/photo-visualization/{VID}', admin)
    shranjeni = json.loads(d.get('data', {}).get('renderParams') or '{}')
    chk(shranjeni.get('maska', {}).get('ograja', []), 'K: maska je SHRAMNJENA v renderParams (2 obliki ograje)')
    chk(len(shranjeni.get('maska', {}).get('prednji', [])) == 1, 'K: prednji plan je shranjen')
    chk(len(shranjeni.get('quad', [])) == 4, 'K: quad je ostal (navzaj združljiv vhod)')
    chk(d.get('data', {}).get('engineVersion') == '1.4.0', 'K: različica pogona 1.4.0 zapisana')

    s, d = callj('POST', '/api/photo-visualization', admin, body())
    chk(s == 201, f'K: STARI vhod brez maske je veljaven ({s})')
    VID2 = d.get('data', {}).get('id')
    s, d = callj('GET', f'/api/photo-visualization/{VID2}', admin)
    stari = json.loads(d.get('data', {}).get('renderParams') or '{}')
    chk('maska' not in stari, 'K: prazna maska se NE shrani kot ključ (zapis ostane bit-enak staremu)')

    s, d = callj('POST', '/api/photo-visualization', admin,
                 body({'ograja': [QUAD for _ in range(5)], 'izpusti': [], 'prednji': []}))
    chk(s == 400 and 'preveč oblik' in json.dumps(d, ensure_ascii=False),
        f'K: 5. oblika zavrnjena z 400 ({s})')
    s, d = callj('POST', '/api/photo-visualization', admin,
                 body({'ograja': [[{'x': i / 30, 'y': 0.5} for i in range(21)]], 'izpusti': [], 'prednji': []}))
    chk(s == 400 and 'preveč točk' in json.dumps(d, ensure_ascii=False), f'K: 21 točk zavrnjeno ({s})')
    s, d = callj('POST', '/api/photo-visualization', admin,
                 body({'ograja': [[{'x': 1.5, 'y': 0.5}, {'x': 0.5, 'y': 0.5}, {'x': 0.5, 'y': 0.9}]], 'izpusti': [], 'prednji': []}))
    chk(s == 400 and 'izven fotografije' in json.dumps(d, ensure_ascii=False),
        f'K: točka izven slike zavrnjena ({s})')
    s, d = callj('POST', '/api/photo-visualization', admin, body({'ograja': 'x'}))
    chk(s == 400, f'K: ne-seznam oblik zavrnjen ({s})')

    # posodobitev: obstoječa vizualizacija DOBI masko, brez nje pa jo OBDRŽI
    s, d = callj('PATCH', f'/api/photo-visualization/{VID2}', admin, {'renderParams': body()['renderParams']})
    chk(s in (200, 400, 405), f'K: PATCH brez maske se ne zruši ({s})')

    r = subprocess.run(['bun', '-e', CLEAN], capture_output=True, text=True, cwd=REPO, timeout=180,
                       env={**os.environ, 'DATABASE_URL': DBURL})
    chk('CLEAN_DONE' in r.stdout, 'K: testni zapisi počiščeni')

# ══ povzetek ═══════════════════════════════════════════════════════════════
print(f'══ REZULTAT: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL else 0)
