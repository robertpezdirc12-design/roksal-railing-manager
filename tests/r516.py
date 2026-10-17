#!/usr/bin/env python3
"""tests/r516.py — R516 (issue #15 Faza 6, cenovni del brez lastnika):
AVTOMATSKI UVOZ CENIKOV — /api/import/cenik (CSV/XLSX/JSON).

Kaj ta suite ščiti — resnične pasti, ne dekoracija:
  A) validacija vrstic (čista funkcija): cena > 0, popust 0..100, min cena
     ≤ cena, datumi ISO/SI normalizacija in vrstni red, podvojen SKU = NAPAKA
     (ne zadnji zmaga — sicer bi cenik tiho vseboval napačno ceno).
  B) CSV razčlenitev: napačna glava = napaka; prazne vrstice = opozorilo;
     SI decimalna vejica deluje; enota je lahko prazna (resi katalog, vidno).
  C) JSON: kind=cenik + objekt z data ovijalnikom + gol array.
  D) predogled: NOVO/POSODOBLJENO/NEZNAN_SKU; resolucija enote datoteka→katalog;
     brez obeh = zavrto (fail-closed, ne privzeta enota).
  E) žičenje: vrsta cenik zahteva price.override (ne quotes.create); core modul
     je čist (brez Prisme/next); v core NI hardkodiranih cen (številke so samo
     pragovi 0/100 — pogodba »cene niso hardcoded« ostane nedotaknjena).
  F) živi API: RBAC (401/403), preveri ne piše, neznani SKU zavre CEL uvoz,
     uvozi ustvari cenik s pravili, ponovni uvoz NADOMESTI (ne sešteva),
     avditorij zapiše PRICE_LIST_IMPORT; idempotentno čiščenje ×2 (r513 vzorec).

Suite F dela SAMO kadar teče strežnik na BASE_URL; sicer se preskoči
(izpis SKIP, ne zeleno). Brez novih odvisnosti, brez AI.
"""
import io
import json
import os
import re
import subprocess
import sys
import urllib.request
import uuid

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
PASS, FAIL = 0, 0
SERVER_UP = False


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


def bun_ts (script):
    """Direkten dostop do baze (čiščenje) — r513 vzorec."""
    env_url = os.environ.get('DATABASE_URL') or ''
    if not env_url.startswith(('postgresql://', 'postgres://')):
        env_url = ''
    db_url = os.environ.get('TEST_DB_URL') or env_url or 'postgresql://roksal:roksal@localhost:54329/roksal'
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       cwd=REPO, env={**os.environ, 'DATABASE_URL': db_url})
    return r.stdout, r.stderr[:800]


def src_has (relpath, needle):
    try:
        with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
            return needle in f.read()
    except Exception:
        return False


print('════ R516 — avtomatski uvoz cenikov (issue #15 Faza 6, cene = podatek) ════')

# ═══ A) validacija vrstic — čista funkcija ═════════════════════════════════
print('── A) validacija: cena/popust/min cena/datumi/podvojitve')
A = bun_js(r'''
const { validateCenikRows, parseSiDate, PRICE_CSV_HEADER, PRICE_IMPORT_CORE_VERSION } = await import('./src/lib/price-import-core')
const RAW = (o = {}) => ({ sku: 'VIJ-INOX-M8', priceRaw: '12,50', unit: 'kos', discountRaw: null, minPriceRaw: null, validFromRaw: null, validToRaw: null, note: null, ...o })
const V = (rows) => { const r = validateCenikRows(rows); return { n: r.lines.length, e: r.errors } }
console.log(JSON.stringify({
  VERSION: PRICE_IMPORT_CORE_VERSION,
  HEADER: PRICE_CSV_HEADER,
  veljavna: V([RAW(), RAW({ sku: 'STEB-60', priceRaw: '45', discountRaw: '5', minPriceRaw: '40', validFromRaw: '2026-11-01', validToRaw: '2027-12-31', note: 'zimski' })]),
  cenaNic: V([RAW({ priceRaw: '0' })]),
  cenaNeg: V([RAW({ priceRaw: '-5' })]),
  cenaBrez: V([RAW({ priceRaw: '' })]),
  cenaNasmejsna: V([RAW({ priceRaw: '1.234,5' })]),
  popustPrevec: V([RAW({ discountRaw: '101' })]),
  popustNeg: V([RAW({ discountRaw: '-1' })]),
  popustMeja: V([RAW({ discountRaw: '100' })]),
  minNadCeno: V([RAW({ priceRaw: '10', minPriceRaw: '11' })]),
  minEnaka: V([RAW({ priceRaw: '10', minPriceRaw: '10' })]),
  datumSlabsi: V([RAW({ validFromRaw: '1.13.2026' })]),
  datumObrat: V([RAW({ validFromRaw: '2027-01-01', validToRaw: '2026-12-31' })]),
  podvojen: V([RAW(), RAW({ note: 'drugi' })]),
  prazniSku: V([RAW({ sku: '  ' })]),
  brezCeneTodaPopust: V([RAW({ priceRaw: '10', discountRaw: '0,5' })]),
  d1: parseSiDate('01.11.2026'),
  d2: parseSiDate('2026-11-01'),
  d3: parseSiDate('1.1.2027'),
  d4: parseSiDate('32.01.2026'),
  d5: parseSiDate(''),
}))
''')
if '_err' in A:
    bad(f'bun A: {A["_err"]}')
else:
    chk(A['VERSION'] == 'price-import-core/1.0', 'pogodba uvoza cenika ima fiksno verzijo (sledljivost)')
    chk(list(A['HEADER']) == ['SKU', 'Cena', 'Enota', 'Popust %', 'Min cena', 'Veljavno od', 'Veljavno do', 'Opomba'], 'glava CSV je dokumentirana in stabilna')
    chk(A['veljavna']['n'] == 2 and A['veljavna']['e'] == [], 'veljavni vrstici preideta (SI vejica, polja neobvezna)')
    chk(A['cenaNic']['n'] == 0 and A['cenaNic']['e'][0]['field'] == 'Cena', 'cena 0 je napaka (brezplačni artikel ni poslovna cena)')
    chk(A['cenaNeg']['n'] == 0, 'negativna cena je napaka')
    chk(A['cenaBrez']['n'] == 0, 'manjkajoča cena je napaka — ne privzeta 0')
    chk(A['cenaNasmejsna']['n'] == 0, 'tisočice z vejico so zavrnjene (dvoumno)')
    chk(A['popustPrevec']['n'] == 0 and A['popustPrevec']['e'][0]['field'] == 'Popust %', 'popust 101 % je napaka')
    chk(A['popustNeg']['n'] == 0, 'negativen popust je napaka')
    chk(A['popustMeja']['n'] == 1, 'popust 100 % je formalno veljaven (podaritev je zavestna odločitev)')
    chk(A['minNadCeno']['n'] == 0 and 'višja od cene' in A['minNadCeno']['e'][0]['problem'], 'min cena nad ceno je napaka (nesmiselno)')
    chk(A['minEnaka']['n'] == 1, 'min cena = cena je veljavna (fiksna cena)')
    chk(A['datumSlabsi']['n'] == 0 and A['datumSlabsi']['e'][0]['field'] == 'Veljavno od', 'neveljaven datum (1.13.) je napaka')
    chk(A['datumObrat']['n'] == 0 and 'za veljavno do' in A['datumObrat']['e'][0]['problem'], 'veljavno od > veljavno do je napaka')
    chk(A['podvojen']['n'] == 1 and A['podvojen']['e'][0]['field'] == 'SKU' and 'vrstici 2' in A['podvojen']['e'][0]['problem'], 'podvojen SKU je napaka z številko vrstic (ne zadnji tiho zmaga)')
    chk(A['prazniSku']['n'] == 0, 'prazen SKU je napaka')
    chk(A['brezCeneTodaPopust']['n'] == 1, 'popust s SI vejico (0,5) deluje')
    chk(A['d1'] == '2026-11-01' and A['d2'] == '2026-11-01', 'SI (DD.MM.YYYY) in ISO datumi se normalizirata na ISO')
    chk(A['d3'] == '2027-01-01', 'enomestni dan/mesec se dopolni (1.1.2027)')
    chk(A['d4'] is None and A['datumSlabsi']['n'] == 0, 'neveljaven dan/mesec (32.01., 1.13.) → zavrnjeno')
    chk(A['d5'] is None, 'prazen datum → null')

# ═══ B) CSV razčlenitev ════════════════════════════════════════════════════
print('── B) CSV: glava, prazne vrstice, SI vejica')
B = bun_js(r'''
const { parseCenikCsv } = await import('./src/lib/price-import-core')
const H = 'SKU;Cena;Enota;Popust %;Min cena;Veljavno od;Veljavno do;Opomba'
const good = H + '\r\nVIJ-INOX-M8;12,50;kos;;;;;\r\n\r\nSTEB-60;45;m;5;;;;zimski\r\n'
const badHead = 'sku;cena;enota\r\nA;1;kos\r\n'
const noRows = H + '\r\n'
console.log(JSON.stringify({
  good: (() => { const r = parseCenikCsv(good); return { n: r.lines.length, w: r.warnings, first: r.lines[0], second: r.lines[1] } })(),
  badHead: (() => { const r = parseCenikCsv(badHead); return { n: r.lines.length, f: r.errors[0].field } })(),
  noRows: (() => { const r = parseCenikCsv(noRows); return { n: r.lines.length, e: r.errors.length } })(),
}))
''')
if '_err' in B:
    bad(f'bun B: {B["_err"]}')
else:
    g = B['good']
    chk(g['n'] == 2, 'dve veljavni vrstici iz CSV (CRLF, SI vejica)')
    chk(g['first']['sku'] == 'VIJ-INOX-M8' and g['first']['price'] == 12.5 and g['first']['unit'] == 'kos' and g['first']['discountPct'] == 0 and g['first']['minPrice'] is None, 'prva vrstica: cena/enaota/popust 0/min brez')
    chk(g['second']['discountPct'] == 5 and g['second']['note'] == 'zimski' and g['second']['unit'] == 'm', 'druga vrstica: popust in opomba se preneseta')
    chk(len(g['w']) == 0, 'prazna vrstica v sredini se preskoči brez napake (isti parseCsv kot uvoz kosovnic)')
    chk(B['badHead']['n'] == 0 and B['badHead']['f'] == 'Glava', 'napačna glava (male črke) = napaka glave, ne tiho ugibanje')
    chk(B['noRows']['n'] == 0 and B['noRows']['e'] == 0, 'samo glava = ni vrstic (API bo javilo 400)')

# ═══ C) JSON razčlenitev ═══════════════════════════════════════════════════
print('── C) JSON: kind cenik, ovijalnik, gol array')
C = bun_js(r'''
const { parseCenikJson } = await import('./src/lib/price-import-core')
const lines = [{ sku: 'VIJ-INOX-M8', price: 12.5, unit: 'kos' }, { sku: 'STEB-60', price: '45', discountPct: 5 }]
console.log(JSON.stringify({
  kind: (() => { const r = parseCenikJson({ kind: 'cenik', lines }); return { n: r.lines.length, e: r.errors.length } })(),
  wrapper: (() => { const r = parseCenikJson({ data: { kind: 'cenik', lines } }); return { n: r.lines.length } })(),
  array: (() => { const r = parseCenikJson(lines); return { n: r.lines.length } })(),
  wrongKind: (() => { const r = parseCenikJson({ kind: 'bom', lines }); return { e: r.errors[0].field } })(),
  empty: (() => { const r = parseCenikJson({ kind: 'cenik', lines: [] }); return { e: r.errors[0].field } })(),
  strPrice: (() => { const r = parseCenikJson({ kind: 'cenik', lines: [{ sku: 'A', price: '1,5' }] }); return { p: r.lines[0]?.price } })(),
}))
''')
if '_err' in C:
    bad(f'bun C: {C["_err"]}')
else:
    chk(C['kind']['n'] == 2 and C['kind']['e'] == 0, 'kind=cenik z lines se razčleni')
    chk(C['wrapper']['n'] == 2, 'data ovijalnik se sprejme (round-trip)')
    chk(C['array']['n'] == 2, 'gol array vrstic se sprejme (preprosta priprava)')
    chk(C['wrongKind']['e'] == 'JSON', 'kind=bom ni cenik — zavrnjeno')
    chk(C['empty']['e'] == 'JSON', 'prazne vrstice v JSON — zavrnjeno')
    chk(C['strPrice']['p'] == 1.5, 'cena kot SI niz v JSON deluje')

# ═══ D) predogled — NOVO/POSODOBLJENO/NEZNAN_SKU + resolucija enote ═════════
print('── D) predogled: razredi vrstic in resolucija enote')
D = bun_js(r'''
const { cenikImportPreview, validateCenikRows } = await import('./src/lib/price-import-core')
const { lines } = validateCenikRows([
  { sku: 'VIJ-INOX-M8', priceRaw: '12,50', unit: 'kos', discountRaw: null, minPriceRaw: null, validFromRaw: null, validToRaw: null, note: null },
  { sku: 'STEB-60', priceRaw: '45', unit: '', discountRaw: null, minPriceRaw: null, validFromRaw: null, validToRaw: null, note: null },
  { sku: 'NE-OBSTAHA', priceRaw: '99', unit: '', discountRaw: null, minPriceRaw: null, validFromRaw: null, validToRaw: null, note: null },
  { sku: 'STEB-70', priceRaw: '60', unit: '', discountRaw: null, minPriceRaw: null, validFromRaw: null, validToRaw: null, note: null },
])
const known = new Set(['VIJ-INOX-M8', 'STEB-60', 'STEB-70'])
const units = new Map([['VIJ-INOX-M8', 'kos'], ['STEB-60', 'm'], ['STEB-70', '']])
const existing = new Map([['VIJ-INOX-M8', { price: 10 }]])
const d = cenikImportPreview(lines, known, units, existing)
console.log(JSON.stringify({ d }))
''')
if '_err' in D:
    bad(f'bun D: {D["_err"]}')
else:
    d = D['d']
    chk(d['novo'] == 2 and d['posodobljeno'] == 1 and len(d['neznani']) == 1, 'štetja: 2 novi, 1 nadomeščeno, 1 neznani')
    chk(d['neznani'] == ['NE-OBSTAHA'], 'neznan SKU je poimensko izpisan')
    e = {x['sku']: x for x in d['entries']}
    chk(e['VIJ-INOX-M8']['kind'] == 'POSODOBLJENO' and e['VIJ-INOX-M8']['fromPrice'] == 10 and e['VIJ-INOX-M8']['toPrice'] == 12.5, 'obstoječe pravilo → POSODOBLJENO z from/to ceno')
    chk(e['STEB-60']['kind'] == 'NOVO' and e['STEB-60']['unit'] == 'm', 'enota se razreši iz kataloga, ko je v datoteki ni (vidno v predogledu)')
    chk(e['STEB-70']['unit'] is None and d['brezEnote'] == ['STEB-70'], 'brez datotečne IN kataloške enote → brezEnote (uvoz bo zavrl)')
    chk(e['NE-OBSTAHA']['kind'] == 'NEZNAN_SKU', 'neznan SKU ima svoj razred (ne meša se z novim)')

# ═══ E) žičenje — varnostni prag in čistost jedra ══════════════════════════
print('── E) žičenje: dovoljenje, čistost, brez hardkodiranih cen')
route = 'src/app/api/import/[kind]/route.ts'
core = 'src/lib/price-import-core.ts'
chk(src_has(route, "kind === 'cenik' ? 'price.override' : 'quotes.create'"), 'cenik zahteva price.override (isti prag kot ročni vnos pravil)')
chk(src_has(route, 'PRICE_LIST_IMPORT'), 'uvoz zapiše revizijo PRICE_LIST_IMPORT')
chk(src_has(route, "kind !== 'bom' && kind !== 'quote' && kind !== 'cenik'"), 'vrsta uvoza cenik je registrirana v vratih')
chk(not src_has(core, 'from \'@prisma/client\'') and not src_has(core, '@/lib/db') and not src_has(core, 'next/server'), 'core je čist: brez Prisme, brez next, brez DB')
core_src = open(os.path.join(REPO, core), encoding='utf-8').read()
cene_v_kodi = re.findall(r"price\s*[:=]\s*(\d+(?:[.,]\d+)?)\b(?!_)", core_src)
cena_literali = [c for c in cene_v_kodi if float(c.replace(',', '.')) > 0]
chk(len(cena_literali) == 0, f'v core NI hardkodiranih cen (našel {cena_literali}) — pogodba »cene so podatek« drži')
# R548: uvoz cenika se je fizično preselil iz katalog.tsx v katalog-ceniki.tsx (razbitje srednjih modulov) — sidra posodobljena pošteno.
chk(src_has('src/components/roksal/modules/katalog-ceniki.tsx', '/api/import/cenik'), 'UI kataloga kliče uvoz cenika')
chk(src_has('src/components/roksal/modules/katalog-ceniki.tsx', 'Uvozi cenik'), 'UI ima gumb za uvoz cenika')

# ═══ F) živi API — samo če strežnik teče ═══════════════════════════════════
try:
    with urllib.request.urlopen(BASE + '/api/public/health', timeout=5) as r:
        SERVER_UP = r.status == 200
except Exception:
    SERVER_UP = False

if not SERVER_UP:
    print('── F) živi API: SKIP (strežnik ne teče) — A–E so čisti dokaz')
else:
    print('── F) živi API: RBAC, preveri, uvozi, nadomestitev')

    def callj (method, path, token=None, body=None, timeout=60):
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

    class Multipart:
        def __init__ (self):
            self.boundary = '----R516' + uuid.uuid4().hex
            self.buf = io.BytesIO()
        def add (self, name, data, filename=None, ctype='application/octet-stream'):
            b = self.boundary.encode()
            self.buf.write(b'--' + b + b'\r\n')
            disp = f'form-data; name="{name}"'
            if filename: disp += f'; filename="{filename}"'
            self.buf.write(f'Content-Disposition: {disp}\r\n'.encode())
            self.buf.write(f'Content-Type: {ctype}\r\n\r\n'.encode())
            if isinstance(data, str): data = data.encode('utf-8')
            self.buf.write(data)
            self.buf.write(b'\r\n')
        def bytes (self):
            b = self.boundary.encode()
            self.buf.write(b'--' + b + b'--\r\n')
            return self.buf.getvalue()
        def content_type (self):
            return f'multipart/form-data; boundary={self.boundary}'

    def post_file (path, token, fields, filename, data, ctype='application/octet-stream'):
        mp = Multipart()
        for k, v in fields.items():
            mp.add(k, v)
        mp.add('file', data, filename=filename, ctype=ctype)
        req = urllib.request.Request(BASE + path, data=mp.bytes(), method='POST')
        req.add_header('Content-Type', mp.content_type())
        if token: req.add_header('Authorization', 'Bearer ' + token)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, json.loads(r.read().decode('utf-8', 'replace'))
        except urllib.error.HTTPError as e:
            try: return e.code, json.loads(e.read().decode('utf-8', 'replace'))
            except Exception: return e.code, {}
        except Exception as e:
            return 0, {'error': str(e)}

    TAG = 'R516-TEST'
    admin = login('admin@roksal.si', 'Admin123!')
    monter = login('monter@roksal.si', 'Monter123!')

    # RBAC
    s, d = post_file('/api/import/cenik', None, {'mode': 'preveri', 'name': 'x'}, 't.csv', b'SKU;Cena;Enota;Popust %;Min cena;Veljavno od;Veljavno do;Opomba')
    chk(s == 401, f'cenik brez žetona 401 (dejansko {s})')
    s, d = post_file('/api/import/cenik', monter, {'mode': 'preveri', 'name': 'x'}, 't.csv', b'SKU;Cena;Enota;Popust %;Min cena;Veljavno od;Veljavno do;Opomba')
    chk(s == 403, f'monter (brez price.override) 403 na uvoz cenika (dejansko {s})')

    # vzemi resnična SKUja iz kataloga (inventory ali products)
    s, d = callj('GET', '/api/inventory', admin)
    inv_skus = [i['sku'] for i in d.get('data', [])][:2] if s == 200 else []
    if len(inv_skus) < 2:
        s, d = callj('GET', '/api/products', admin)
        inv_skus = [p['sku'] for p in d.get('data', [])][:2] if s == 200 else []
    chk(len(inv_skus) >= 1, 'katalog dosegljiv za resnične SKUje')

    H = 'SKU;Cena;Enota;Popust %;Min cena;Veljavno od;Veljavno do;Opomba'
    dober_csv = (H + '\r\n' + inv_skus[0] + ';12,50;kos;;;;;\r\n').encode()
    slab_csv = (H + '\r\n' + inv_skus[0] + ';12,50;kos;;;;;\r\nNE-OBSTA-123;9;; ;;;;;\r\n').encode()

    # preveri z neznanim SKUjem → zavrnjeno, NIČ se ne zapiše
    s, d = post_file('/api/import/cenik', admin, {'mode': 'preveri', 'name': TAG}, 'slab.csv', slab_csv, 'text/csv')
    chk(s == 409 and 'NE-OBSTA-123' in d.get('error', ''), 'neznan SKU zavrne preveri s poimenovanjem (fail-closed)')
    s, d = post_file('/api/import/cenik', admin, {'mode': 'uvozi', 'name': TAG}, 'slab.csv', slab_csv, 'text/csv')
    chk(s == 409, 'neznan SKU zavrne tudi uvozi — VSE ALI NIČ')

    # preveri z dobrim → 200 in brez zapisa
    s, d = post_file('/api/import/cenik', admin, {'mode': 'preveri', 'name': TAG}, 'dober.csv', dober_csv, 'text/csv')
    chk(s == 200 and d.get('data', {}).get('diff', {}).get('novo') == 1, 'preveri vrne predogled (1 novo, brez zapisa)')
    s, d = callj('GET', '/api/price-lists', admin)
    chk(not any(l['name'] == TAG for l in d.get('data', [])), 'po PREVERI cenik NI bil ustvarjen (dry-run drži)')

    # manka cilj
    s, d = post_file('/api/import/cenik', admin, {'mode': 'preveri'}, 't.csv', b'SKU;Cena;Enota;Popust %;Min cena;Veljavno od;Veljavno do;Opomba')
    chk(s == 400, 'brez cilja (priceListId/name) 400')

    # uvozi → 201
    s, d = post_file('/api/import/cenik', admin, {'mode': 'uvozi', 'name': TAG}, 'dober.csv', dober_csv, 'text/csv')
    chk(s == 201 and d['data']['novo'] == 1, 'uvoz ustvari cenik s pravilom (201)')
    LIST_ID = d['data']['list']['id']
    s, d = callj('GET', '/api/price-lists', admin)
    lst = next((l for l in d.get('data', []) if l['id'] == LIST_ID), None)
    chk(lst is not None and lst['name'] == TAG and len(lst['rules']) == 1, 'cenik viden v GET /api/price-lists s 1 pravilom')
    chk(lst is not None and float(lst['rules'][0]['price']) == 12.5, 'cena 12,50 zapisana kot pravilo (podatek, ne koda)')

    # ponovni uvoz istega SKUja → NADOMESTITEV (ne dvojnik)
    s, d = post_file('/api/import/cenik', admin, {'mode': 'uvozi', 'priceListId': LIST_ID}, 'dober2.csv', (H + '\r\n' + inv_skus[0] + ';15,00;kos;;;;;\r\n').encode(), 'text/csv')
    chk(s == 201 and d['data']['posodobljeno'] == 1 and d['data']['novo'] == 1, 'ponovni uvoz nadomesti (1 nadomeščeno, novo pravilo zapisano)')
    s, d = callj('GET', '/api/price-lists', admin)
    lst = next((l for l in d.get('data', []) if l['id'] == LIST_ID), None)
    chk(lst is not None and len([r for r in lst['rules'] if r.get('active', True)]) == 1, 'aktiven je SAMO eno pravilo za SKU (nadomestitev, ne seštevanje)')

    # audit
    s, d = callj('GET', '/api/audit?action=PRICE_LIST_IMPORT&limit=10', admin)
    found = any(LIST_ID in (e.get('entityId') or '') for e in d.get('data', []))
    chk(found, 'revizija PRICE_LIST_IMPORT zapisana')

    # idempotentno čiščenje ×2 (r513 vzorec — nepuščamo testnih cenikov v bazi)
    CLEAN_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const ls=await p.priceList.findMany({where:{name:'__TAG__'},select:{id:true}});
  for (const l of ls) {
    await p.priceRule.deleteMany({where:{priceListId:l.id}});
    await p.priceList.delete({where:{id:l.id}});
  }
  await p.auditLog.deleteMany({where:{entityId:{in:ls.map(l=>l.id)}}});
  console.log('CLEAN_DONE');return p.$disconnect();
})()
'''.replace('__TAG__', TAG)
    for i in range(2):
        out, err = bun_ts(CLEAN_JS)
        chk('CLEAN_DONE' in out, f'čiščenje ×{i + 1} se zaključi (idempotentno)')
    s, d = callj('GET', '/api/price-lists', admin)
    chk(not any(l['name'] == TAG for l in d.get('data', [])), 'testni cenik odstranjen iz baze (stanje kot pred testom)')

print()
print(f'════ R516: {PASS} ✓ / {FAIL} ✗ ════')
sys.exit(1 if FAIL > 0 else 0)
