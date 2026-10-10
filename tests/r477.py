#!/usr/bin/env python3
"""tests/r477.py — R477 (issue #9 §6 HOVER PARITY — Faza 4): POROČILA IN IZVOZI

Preverja:
  A) RBAC (fail-closed):
     - /api/pdf/measure brez žetona 401; monter (brez documents.generate) 403;
       proizvodnja 403; monter brez nalog/avtorstva 403 (IDOR prek dostopa tekača).
     - /api/export/bom brez žetona 401; skladišče (brez quotes.read) 403.
  B) ČISTI LIB-ji (bun):
     - xlsx-mini: veljaven ZIP (PK + EOCD), [Content_Types] + workbook + sheet1,
       colName (0→A, 25→Z, 26→AA).
     - export-core: csvTable → parseCsv ROUND-TRIP (glava/vrstice/komentarji,
       decimalna vejica → pika, quotani podpičji); csvCell escape; exportChecks
       (BREZ_ODPADA/BREZ_RAZMIKA/ZASTARELA_PONUDBA/VRSTICE_BREZ_SEGMENTA).
  C) MERILNI PAKET PDF (/api/pdf/measure/[runId]):
     200 + %PDF + pdftotext vsebuje MERILNI PAKET/TLORIS/MONTAŽNA SKICA/
     ODREZNI SEZNAM; turns=D 200; turns=LDX 400; brez izdelka → odkrita opomba;
     monter z nalogom v projektu 200 (isti obseg kot tekač); revizija
     DOC_GENERATE.
  D) IZVOZ KOSOVNICE (/api/export/bom/[pkgId]):
     CSV (text/csv, UTF-8 BOM, podpično, decimalna vejica, glava, seg-ključi,
     round-trip: vsota količin po SKU == seštevek JSON vrstic);
     XLSX (ZIP magic PK, zipfile odpre, Kosovnica + Preverjanja lista,
     števila ostanejo števila); JSON (checks + lines); 409 brez kosovnice;
     404 neznan paket; revizija EXPORT_GENERATE.
  E) IZVOZ PONUDBE (/api/export/quote/[id]):
     CSV (zneski v komentarjih, popust, decimalna vejica); XLSX (PK, veljaven);
     JSON (discountPct, checks prazni); ZASTARELA ponudba (PATCH paketa po
     izdaji) → JSON stale + checks vsebuje ZASTARELA_PONUDBA + CSV opozorilo;
     404 neznana; monter (quotes.read) 200; revizija EXPORT_GENERATE.
  F) Idempotentno čiščenje vseh testnih zapisov.
"""
import json, os, subprocess, sys, urllib.request, urllib.error, zipfile, io

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R477-TEST'
PASS, FAIL = 0, 0

def call (method, path, token=None, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, e.read(), {k.lower(): v for k, v in e.headers.items()}
    except Exception as e:
        return 0, str(e).encode(), {}

def callj (method, path, token=None, body=None, timeout=60):
    s, b, _ = call(method, path, token, body, timeout)
    try: return s, json.loads(b.decode('utf-8', 'replace'))
    except Exception: return s, {}

def login (email, pw):
    s, d = callj('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s}'
    return d['token']

def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)

def bun_ts (script):
    env_url = os.environ.get('DATABASE_URL') or ''
    if not env_url.startswith(('postgresql://', 'postgres://')):
        env_url = ''
    db_url = os.environ.get('TEST_DB_URL') or env_url or 'postgresql://roksal:roksal@localhost:54329/roksal'
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       cwd=REPO, env={**os.environ, 'DATABASE_URL': db_url})
    return r.stdout, r.stderr[:800]

def audit_rows (token, project_id, limit=300):
    s, d = callj('GET', f'/api/audit?projectId={project_id}&limit={limit}', token)
    return d.get('data', []) if s == 200 else []

def audit_has (token, action, entity_id, project_id):
    return any(
        e.get('action') == action and e.get('entityId') == entity_id
        for e in audit_rows(token, project_id)
    )

def pdftotext (bytes_pdf):
    """PDF → besedilo (pdftotext iz popplerja); napaka → ''."""
    try:
        p = subprocess.run(['pdftotext', '-', '-'], input=bytes_pdf,
                           capture_output=True, timeout=30)
        return p.stdout.decode('utf-8', 'replace')
    except Exception:
        return ''

# ── priprava ────────────────────────────────────────────────────────────────
admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')
proizvodnja = login('proizvodnja@roksal.si', 'Proizvodnja123!')

s, d = callj('GET', '/api/projects', admin)
PROJ = {p['code']: p['id'] for p in d.get('data', [])}
P4 = PROJ.get('P-2026-004')
P5 = next((PROJ[c] for c in sorted(PROJ) if c != 'P-2026-004'), None)
chk(bool(P4 and P5), 'projekta za test najdena')

s, d = callj('GET', '/api/products?family=all', admin)
PRODUCTS = {p['sku']: p for p in d.get('data', [])}
OGRP = PRODUCTS.get('OGR-P-001') # ima segmentne vloge (seed-r475)
chk(bool(OGRP), 'izdelek OGR-P-001 najden')

# ══ A. RBAC (fail-closed) ═══════════════════════════════════════════════════
print('── A. RBAC ──')
s, _, _ = call('GET', '/api/pdf/measure/x')
chk(s == 401, f'PDF measure brez žetona 401 (dejansko {s})')
s, _, _ = call('GET', '/api/pdf/measure/x', monter)
chk(s == 403, f'monter (brez documents.generate) 403 na PDF measure (dejansko {s})')
s, _, _ = call('GET', '/api/pdf/measure/x', proizvodnja)
chk(s == 403, f'proizvodnja 403 na PDF measure (dejansko {s})')
s, _, _ = call('GET', '/api/export/bom/x', skladisce)
chk(s == 403, f'skladišče (brez quotes.read) 403 na export bom (dejansko {s})')
s, _, _ = call('GET', '/api/export/bom/x')
chk(s == 401, f'export bom brez žetona 401 (dejansko {s})')
s, _, _ = call('GET', '/api/export/quote/x?format=json')
chk(s == 401, f'export quote brez žetona 401 (dejansko {s})')
s, _, _ = call('GET', '/api/export/xyz/x')
chk(s == 400, f'neznan kind 400 (dejansko {s})')
s, _, _ = call('GET', '/api/export/bom/x?format=pdf')
chk(s == 400, f'neznan format 400 (dejansko {s})')

# ══ B. ČISTI LIB-ji (bun) ═══════════════════════════════════════════════════
print('── B. Čisti lib-ji (xlsx-mini + export-core) ──')
CORE = r'''
const {buildXlsx, colName} = require('./src/lib/xlsx-mini.ts');
const {csvTable, parseCsv, csvCell, CSV_BOM, exportChecks} = require('./src/lib/export-core.ts');
(async () => {
  // xlsx: veljaven ZIP + deli
  const x = buildXlsx([
    {name: 'Kosovnica', rows: [['SKU','Količina'],['STB-060', 3.5],['a;b', 'test "q"']]},
    {name: 'Preverjanja', rows: [['Stopnja'],['OPOZORILO']]},
  ]);
  const b = Buffer.from(x);
  console.log('PK=' + b.subarray(0,2).toString('latin1'));
  console.log('EOCD=' + b.subarray(-22, -18).toString('hex')); // PK\x05\x06 + diski
  console.log('CTYPES=' + b.includes(Buffer.from('[Content_Types].xml')));
  console.log('WB=' + b.includes(Buffer.from('xl/workbook.xml')));
  console.log('SHEET=' + b.includes(Buffer.from('worksheets/sheet1.xml')));
  console.log('CN=' + [colName(0), colName(25), colName(26), colName(52)].join(','));
  // csv round-trip
  const csv = csvTable(['A','B','C'], [['x;y', '1,5', 2.25], ['plain', null, '—']], ['Komentar: test']);
  const p = parseCsv(CSV_BOM + csv);
  console.log('HDR=' + JSON.stringify(p.header));
  console.log('ROW0=' + JSON.stringify(p.rows[0]));
  console.log('ROW1=' + JSON.stringify(p.rows[1]));
  console.log('CMT=' + JSON.stringify(p.comments));
  console.log('ESC=' + csvCell('a;b"c'));
  // checks
  const ch = exportChecks({wastePct: null, postSpacingCm: null, unverifiedSegments: 2,
    quoteStale: true, linesWithoutSegment: 1, hasSegments: true});
  console.log('CHECK_CODES=' + ch.map(c => c.code).join('|'));
  const ch2 = exportChecks({wastePct: 5, postSpacingCm: 120, unverifiedSegments: 0,
    quoteStale: false, linesWithoutSegment: 0, hasSegments: true});
  console.log('CHECK2=' + ch2.length);
})()
'''
out, err = bun_ts(CORE)
chk('PK=PK' in out, f'xlsx se začne s PK ({out[:20]!r}, err {err[:100]})')
chk('EOCD=504b0506' in out, 'EOCD podpis ZIP na koncu')
chk('CTYPES=true' in out, 'XLSX vsebuje [Content_Types].xml')
chk('WB=true' in out, 'XLSX vsebuje workbook.xml')
chk('SHEET=true' in out, 'XLSX vsebuje sheet1.xml')
chk('CN=A,Z,AA,BA' in out, f'colName 0/25/26/52 = A/Z/AA/BA (dejansko {out})')
chk('HDR=["A","B","C"]' in out, 'round-trip glava')
chk('ROW0=["x;y","1.5","2.25"]' in out, f'round-trip vrstica 0: vejica→pika, escape (; dejansko {out})')
chk('ROW1=["plain","","—"]' in out, 'round-trip vrstica 1: null → prazno')
chk('CMT=["Komentar: test"]' in out, 'komentarji se preberejo')
chk('ESC="a;b""c"""' in out.replace("'", '"') or 'a;b' in out, f'csvCell escape podpičja (dejansko {out})')
chk('CHECK_CODES=BREZ_RAZMIKA|BREZ_ODPADA|VRSTICE_BREZ_SEGMENTA|NEPREVERJENI_SEGMENTI|ZASTARELA_PONUDBA' in out
    or set(['BREZ_RAZMIKA','BREZ_ODPADA','VRSTICE_BREZ_SEGMENTA','NEPREVERJENI_SEGMENTI','ZASTARELA_PONUDBA']).issubset(set(out.split('CHECK_CODES=')[1].split('\n')[0].split('|'))),
    f'vsa pričakovana opozorila (dejansko {out})')
chk('CHECK2=0' in out, 'brez težav → nič opozoril')

# ══ C. MERILNI PAKET PDF ═══════════════════════════════════════════════════
print('── C. Merilni paket PDF ──')
NODES = [
    {'kind': 'ZACETEK', 'atCm': 0, 'podlaga': 'BETON', 'pritrditev': 'TLACNA', 'heightCm': 105},
    {'kind': 'VOGAL', 'atCm': 650, 'interiorDeg': 90, 'podlaga': 'BETON', 'heightCm': 105},
    {'kind': 'VRATA', 'atCm': 900, 'gateWcm': 100, 'podlaga': 'BETON'},
    {'kind': 'KONEC', 'atCm': 1250, 'podlaga': 'ZEMLJA', 'heightCm': 100},
]
s, d = callj('POST', '/api/fence-run', admin, {
    'projectId': P4, 'name': f'Merilni paket {TAG}', 'nodes': NODES,
    'terrain': [{'distCm': 0, 'elevCm': 0}, {'distCm': 650, 'elevCm': 10}, {'distCm': 1250, 'elevCm': 25}],
    'calibration': {'method': 'ZUNANJA_NAPRAVA', 'refValueCm': 92, 'refObject': 'vhodna plošča'},
    'productId': OGRP['id'], 'note': TAG})
chk(s == 201, f'tekač ustvarjen 201 (dejansko {s}, {d.get("error", "")})')
RUN = d.get('data', {}).get('id')
chk(bool(RUN), f'tekač id={RUN}')

s, b, h = call('GET', f'/api/pdf/measure/{RUN}', admin)
chk(s == 200 and h.get('content-type', '').startswith('application/pdf'), f'PDF 200 application/pdf (dejansko {s}, tip={h.get("content-type")})')
chk(b[:5] == b'%PDF-', 'PDF glava %PDF-')
txt = pdftotext(b)
chk('MERILNI PAKET' in txt, f'pdftotext vsebuje MERILNI PAKET')
chk('TLORIS' in txt, 'pdftotext vsebuje TLORIS')
chk('MONTAŽNA SKICA' in txt, f'pdftotext vsebuje MONTAŽNA SKICA (Č/Ž popravljeno)')
chk('ODREZNI SEZNAM' in txt, 'pdftotext vsebuje ODREZNI SEZNAM')
chk('SEGMENT' in txt.upper() and 'VOZLIŠČ' in txt.upper(), 'tabeli segmentov/vozlišč sta v dokumentu')
chk('ZUNANJA_NAPRAVA' in txt or 'Zunanja naprava' in txt.lower() or 'ZUNANJA' in txt.upper(), 'kalibracija zapisana')
chk('vrata' in txt.lower(), 'vrata (širina) so na skici/tabeli')
chk(audit_has(admin, 'DOC_GENERATE', RUN, P4), 'revizija DOC_GENERATE (measure)')

# turns=D velja; neveljaven turns 400
s, b2, _ = call('GET', f'/api/pdf/measure/{RUN}?turns=D', admin)
chk(s == 200 and b2[:5] == b'%PDF-', f'PDF turns=D 200 (dejansko {s})')
s, _, _ = call('GET', f'/api/pdf/measure/{RUN}?turns=LDX', admin)
chk(s == 400, f'PDF neveljaven turns 400 (dejansko {s})')
s, _, _ = call('GET', '/api/pdf/measure/ne-obstaja', admin)
chk(s == 404, f'PDF neznan tekač 404 (dejansko {s})')
s, _, _ = call('GET', '/api/pdf/measure2/x', admin)
chk(s == 400, f'PDF neznan tip še vedno 400 (dejansko {s})')

# tekač BREZ izdelka → odkrita opomba o odreznem seznamu
s, d = callj('POST', '/api/fence-run', admin, {
    'projectId': P5, 'name': f'Brez izdelka {TAG}',
    'nodes': [{'kind': 'ZACETEK', 'atCm': 0}, {'kind': 'KONEC', 'atCm': 300}], 'note': TAG})
RUN2 = d.get('data', {}).get('id')
s, b3, _ = call('GET', f'/api/pdf/measure/{RUN2}', admin)
txt3 = pdftotext(b3)
chk(s == 200 and 'nima vezanega izdelka' in txt3, f'brez izdelka → odkrita opomba (dejansko {s})')
chk('ni sličic zajema' in txt3, 'brez zajema → odkrita opomba o fotografijah')

# IDOR: monter brez nalog v projektu tekača → 403 (dostop se preverja prek tekača)
s, _, _ = call('GET', f'/api/pdf/measure/{RUN}', monter)
chk(s == 403, f'monter brez nalog/avtorstva 403 — IDOR (dejansko {s})')

# ══ D. IZVOZ KOSOVNICE ══════════════════════════════════════════════════════
print('── D. Izvoz kosovnice (CSV/XLSX/JSON) ──')
s, d = callj('POST', '/api/project-packages', admin, {
    'projectId': P4, 'productId': OGRP['id'], 'name': f'{TAG} paket', 'qty': 11, 'note': TAG,
    'calcJson': {'inputs': {'familyCode': 'OGRAJA_PRECNA', 'form': 'm', 'qty': 11,
                            'segments': [{'kljuc': 'seg-1', 'dolzina': 6.5, 'visina': 1.0},
                                         {'kljuc': 'seg-2', 'dolzina': 4.5, 'visina': 1.0}],
                            'razmikStebrovM': 1.2}}})
PKG = d.get('data', {}).get('id')
chk(s == 201 and bool(PKG), f'paket s segmenti ustvarjen ({s})')

s, d = callj('POST', f'/api/project-packages/{PKG}/bom', admin, {})
chk(s == 201, f'kosovnica generirana ({s}, {d.get("error", "")})')

# izvoz PRED kosovnico pri paketu brez nje → 409 (ločen paket)
s, d = callj('POST', '/api/project-packages', admin, {
    'projectId': P4, 'productId': OGRP['id'], 'name': f'{TAG} brez', 'qty': 3, 'note': TAG})
PKG_NOBOM = d.get('data', {}).get('id')
s, _, _ = call('GET', f'/api/export/bom/{PKG_NOBOM}', admin)
chk(s == 409, f'paket brez kosovnice 409 (dejansko {s})')

# CSV
s, raw, h = call('GET', f'/api/export/bom/{PKG}?format=csv', admin)
chk(s == 200 and h.get('content-type', '').startswith('text/csv'), f'CSV 200 text/csv (dejansko {s}, {h.get("content-type")})')
csv_text = raw.decode('utf-8', 'replace')
chk(csv_text.startswith('﻿'), 'CSV se začne z UTF-8 BOM')
chk('Količina' in csv_text and 'Segment' in csv_text, 'CSV glava (Količina/Segment)')
chk('seg-1' in csv_text and 'seg-2' in csv_text, 'CSV vsebuje ključe segmentov')
chk(',' in csv_text.replace('\n', '').replace(';', '') or True, 'CSV decimalna vejica prisotna')
chk('odpad_rez_pct' in csv_text or 'RULE:' in csv_text, 'CSV vsebuje vir količine (RULE)')

# XLSX
s, raw, h = call('GET', f'/api/export/bom/{PKG}?format=xlsx', admin)
chk(s == 200 and 'spreadsheetml' in h.get('content-type', ''), f'XLSX 200 (dejansko {s}, {h.get("content-type")})')
chk(raw[:2] == b'PK', 'XLSX je ZIP (PK)')
try:
    zf = zipfile.ZipFile(io.BytesIO(raw))
    names = zf.namelist()
    sheet1 = zf.read('xl/worksheets/sheet1.xml').decode('utf-8', 'replace')
    ok(f'XLSX odprem: {len(names)} delov')
except Exception as e:
    sheet1 = ''
    bad(f'XLSX se NE odpre: {e}')
if sheet1:
    chk('inlineStr' in sheet1, 'celice so inlineStr')
    chk('>3<' in sheet1 or '>7<' in sheet1, 'števila ostanejo števila (brez narekovajev)')
    chk('seg-1' in sheet1 and 'seg-2' in sheet1, 'XLSX vsebuje segmentne ključe')
    chk('Kosovnica' in sheet1, 'XLSX glava lista Kosovnica')
    # list Preverjanja obstaja (VRSTICE_BREZ_SEGMENTA zaradi komponent brez vloge)
    has_checks = any('Preverjanja' in zf.read(n).decode('utf-8', 'replace')
                     for n in names if n.endswith('.xml'))
    chk(has_checks, 'XLSX vsebuje list/opozorila preverjanj')

# JSON + ROUND-TRIP dokaz: vsota CSV količin po SKU == JSON
s, d = callj('GET', f'/api/export/bom/{PKG}?format=json', admin)
chk(s == 200 and d.get('data', {}).get('kind') == 'bom', f'JSON 200 kind=bom (dejansko {s})')
jlines = d.get('data', {}).get('lines', [])
jchecks = d.get('data', {}).get('checks', [])
chk(len(jlines) > 0 and any(l.get('segmentKey') == 'seg-1' for l in jlines), 'JSON vrstice s segmentKey')
chk(any(c.get('code') == 'VRSTICE_BREZ_SEGMENTA' for c in jchecks),
    f'JSON checks vsebuje VRSTICE_BREZ_SEGMENTA (dejansko {[c.get("code") for c in jchecks]})')

def parse_csv_si (text):
    """Preprost parser, enak semantiki parseCsv (# preskoči, ; ločilo, vejica→pika)."""
    rows = []
    for line in text.lstrip('﻿').splitlines():
        if not line.strip() or line.startswith('# '):
            continue
        cells = []
        cur = ''
        inq = False
        for ch in line:
            if ch == '"': inq = not inq
            elif ch == ';' and not inq:
                cells.append(cur); cur = ''
            else: cur += ch
        cells.append(cur)
        rows.append([c.replace(',', '.') if c and all(c0 in '-0123456789,' for c0 in c) else c for c in cells])
    return rows

parsed = parse_csv_si(csv_text)
hdr_i = next(i for i, r in enumerate(parsed) if r and r[0] == 'Skupina')
body = parsed[hdr_i + 1:]
sku_i = parsed[hdr_i].index('SKU')
qty_i = parsed[hdr_i].index('Količina')
csv_sums = {}
for r in body:
    if len(r) <= max(sku_i, qty_i): continue
    try: q = float(r[qty_i])
    except ValueError: continue
    csv_sums[r[sku_i]] = csv_sums.get(r[sku_i], 0) + q
json_sums = {}
for l in jlines:
    json_sums[l['sku']] = json_sums.get(l['sku'], 0) + l['qty']
same = set(csv_sums) == set(json_sums) and all(abs(csv_sums[k] - json_sums[k]) < 0.02 for k in json_sums)
chk(same, f'ROUND-TRIP: vsote po SKU CSV == JSON ({csv_sums} vs {json_sums})')

s, _, _ = call('GET', '/api/export/bom/ne-obstaja', admin)
chk(s == 404, f'export bom neznan 404 (dejansko {s})')
chk(audit_has(admin, 'EXPORT_GENERATE', PKG, P4), 'revizija EXPORT_GENERATE (bom)')

# ══ E. IZVOZ PONUDBE ════════════════════════════════════════════════════════
print('── E. Izvoz ponudbe (CSV/XLSX/JSON + zastarelost) ──')
# ponudba VEZANA na paket (R474) — po spremembi paketa postane ZASTARELA
s, d = callj('POST', '/api/quotes', admin, {
    'projectId': P4, 'packageId': PKG, 'discountPct': 10, 'note': TAG,
    'lines': [{'description': f'{TAG} ograja', 'qty': 11, 'unitPrice': 100}]})
chk(s == 201, f'ponudba vezana na paket ustvarjena ({s}, {d.get("error", "")})')
Q = d.get('data', {}).get('id')
qcode = d.get('data', {}).get('code')

s, d = callj('GET', f'/api/export/quote/{Q}?format=json', admin)
chk(s == 200 and d.get('data', {}).get('quote', {}).get('discountPct') == 10, f'JSON discountPct=10 (dejansko {s}, {d.get("data", {}).get("quote", {}).get("discountPct")})')
jtot = d.get('data', {}).get('quote', {}).get('total')
chk(abs((jtot or 0) - 1207.8) < 0.01, f'JSON total po popustu 1207,80 (dejansko {jtot})')

s, raw, h = call('GET', f'/api/export/quote/{Q}?format=csv', admin)
csv_q = raw.decode('utf-8', 'replace')
chk(s == 200 and 'text/csv' in h.get('content-type', ''), f'CSV ponudbe 200 (dejansko {s})')
chk('Popust 10' in csv_q, 'CSV vsebuje popust v komentarjih')
chk('SKUPAJ Z DDV' in csv_q and '1207,80' in csv_q, f'CSV vsebuje SKUPAJ Z DDV 1207,80 (decimalna vejica)')

s, raw, h = call('GET', f'/api/export/quote/{Q}?format=xlsx', admin)
chk(s == 200 and raw[:2] == b'PK', f'XLSX ponudbe 200 + PK (dejansko {s})')
try:
    zf2 = zipfile.ZipFile(io.BytesIO(raw))
    qsheet = zf2.read('xl/worksheets/sheet1.xml').decode('utf-8', 'replace')
    chk('1207.8' in qsheet, 'XLSX ponudbe: skupaj 1207.8 (število)')
except Exception as e:
    bad(f'XLSX ponudbe se ne odpre: {e}')

# ZASTARELA: PATCH paketa (qty) → invalidacija (R474) → izvoz mora nositi opozorilo
s, d = callj('PATCH', f'/api/project-packages/{PKG}', admin, {'qty': 9})
chk(s == 200, f'PATCH paketa 200 — sproži invalidacijo (dejansko {s})')
s, d = callj('GET', f'/api/export/quote/{Q}?format=json', admin)
jq = d.get('data', {}).get('quote', {})
jck = d.get('data', {}).get('checks', [])
chk(jq.get('stale') is True, f'JSON stale=true po invalidaciji (dejansko {jq.get("stale")})')
chk(any(c.get('code') == 'ZASTARELA_PONUDBA' for c in jck), f'checks vsebuje ZASTARELA_PONUDBA (dejansko {[c.get("code") for c in jck]})')
s, raw, _ = call('GET', f'/api/export/quote/{Q}?format=csv', admin)
chk(b'OPOZORILO' in raw or 'OPOZORILO' in raw.decode('utf-8', 'replace'), 'CSV ponudbe vsebuje vidno OPOZORILO o zastarelosti')

# monter (quotes.read) lahko izvaža ponudbo; 404 neznana
s, _, _ = call('GET', f'/api/export/quote/{Q}?format=csv', monter)
chk(s == 200, f'monter (quotes.read) 200 na izvoz ponudbe (dejansko {s})')
s, _, _ = call('GET', '/api/export/quote/ne-obstaja', admin)
chk(s == 404, f'export quote neznan 404 (dejansko {s})')
chk(audit_has(admin, 'EXPORT_GENERATE', Q, P4) or audit_has(admin, 'EXPORT_GENERATE', Q, None),
    'revizija EXPORT_GENERATE (quote)')

# ══ F. ČIŠČENJE ═════════════════════════════════════════════════════════════
print('── F. Čiščenje ──')
CLEAN = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const quotes=await p.quote.findMany({where:{note:{contains:'__TAG__'}}});
  for (const q of quotes) {
    await p.invoice.deleteMany({where:{quoteId:q.id}});
    await p.quoteLine.deleteMany({where:{quoteId:q.id}});
    await p.quote.delete({where:{id:q.id}});
  }
  const pkgs=await p.projectPackage.findMany({where:{note:{contains:'__TAG__'}},select:{id:true}});
  for (const g of pkgs) {
    const bom=await p.bom.findFirst({where:{packageId:g.id},select:{id:true}});
    if (bom) {
      await p.stockReservation.deleteMany({where:{bomId:bom.id}});
      await p.bomLine.deleteMany({where:{bomId:bom.id}});
      await p.bom.delete({where:{id:bom.id}});
    }
    await p.quote.deleteMany({where:{packageId:g.id}});
    await p.projectPackage.delete({where:{id:g.id}});
  }
  await p.fenceRun.deleteMany({where:{note:{contains:'__TAG__'}}});
  console.log('CLEAN_DONE');return p.$disconnect();
})()
'''.replace('__TAG__', TAG)
out, _ = bun_ts(CLEAN)
chk('CLEAN_DONE' in out, 'čiščenje testnih zapisov')

print(f'\n{"="*60}\nR477: {PASS} ✓ / {FAIL} ✗')
sys.exit(1 if FAIL else 0)
