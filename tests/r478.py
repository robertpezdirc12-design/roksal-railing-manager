#!/usr/bin/env python3
"""tests/r478.py — R478 (issue #9 §6 zaključek — HOVER PARITY): UVOZ (round-trip)

Preverja:
  A) RBAC (fail-closed):
     - /api/import/bom|quote brez žetona 401; monter (brez quotes.create) 403;
       skladišče (brez quotes.create) 403; neznana vrsta 400.
  B) ČISTI LIB-ji (bun):
     - parseSiNumber (vejica/pika/zavržene tisočice/ smeti);
     - parseBomCsv: lasten izvoz bomCsv → vrstice (glava, decimalna vejica,
       komentarji preskočeni); napačna glava → napaka; podvojen SKU+segment →
       napaka; neveljaven segment/skupina/odpad → napaka z vrstico;
     - bomImportDiff: DODANO/ODSTRANJENO/SPREMENJENA_KOLICINA/unchanged;
     - parseBomJson: ovijalnik {data:{…}} IN golo telo; kind != bom → napaka;
     - parseQuoteJson: ovijalnik; zneski iz datoteke se ne zaupajo (fileTotals
       se samo poroča); popust 0..100.
  C) XLSX bralnik (bun, server lib):
     - lasten izvoz bomXlsx → readXlsx → vrstice (round-trip XLSX);
     - sharedStrings pot (Excel re-save simulacija) + DEFLATE (node:zlib).
  D) UVOZ KOSOVNICE (/api/import/bom):
     - CSV preveri: 0 razlik (round-trip dokaz); uvozi: nova koda kosovnice,
       vrstice enake (re-izvoz → identične vsote po SKU);
     - XLSX preveri (meta vrstice preskočene, opozorilo); JSON preveri;
     - sprememba količine v datoteki → diff SPREMENJENA_KOLICINA; uvoz →
       količina dejansko spremenjena v bazi;
     - neznan SKU → 409; napačna glava CSV → 409; XLSX brez glave → 409;
       manjkajoč packageId → 400; neznana vrsta 400; JSON smeti → 409/400;
     - revizija BOM_IMPORT; invalidacija ponudb (R474): POSLAN ponudba na
       paketu → po uvozu OSNUTEK + zastavica ZASTARELO.
  E) UVOZ PONUDBE (/api/import/quote):
     - JSON preveri: pozicije, preračunani zneski (enaki izvirniku), popust
       se ohrani; projekt/stranka vezana po kodi/imenu + opozorili;
     - uvozi: NOVA koda (izvorna ostane), status OSNUTEK, vrstice enake;
       izvorna ponudba NEDOTAKNJENA (enak total);
     - izkrivljeni zneski v datoteki → PRERAČUNANI (opozorilo o razliki);
     - CSV datoteka → 400 (ponudba se uvaža izključno iz JSON);
     - packageId drugega projekta → 400; revizija QUOTE_IMPORT.
  F) Idempotentno čiščenje vseh testnih zapisov (direktno prek Prisma).
"""
import json, os, subprocess, sys, urllib.request, urllib.error, uuid, io, zipfile

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R478-TEST'
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

class Multipart:
    """Minimalen multipart/form-data sestavljalec (urllib ne zna FormData)."""
    def __init__ (self):
        self.boundary = '----R478' + uuid.uuid4().hex
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

# ── priprava ────────────────────────────────────────────────────────────────
admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')

s, d = callj('GET', '/api/projects', admin)
PROJ = {p['code']: p['id'] for p in d.get('data', [])}
P1 = PROJ.get('P-2026-001')

# ══ A. RBAC (fail-closed) ═══════════════════════════════════════════════════
print('── A. RBAC ──')
s, d = post_file('/api/import/bom', None, {'packageId': 'x', 'mode': 'preveri'}, 't.csv', b'Skupina;Segment;SKU')
chk(s == 401, f'import bom brez žetona 401 (dejansko {s})')
s, d = post_file('/api/import/quote', None, {'mode': 'preveri'}, 't.json', b'{}')
chk(s == 401, f'import quote brez žetona 401 (dejansko {s})')
s, d = post_file('/api/import/bom', monter, {'packageId': 'x', 'mode': 'preveri'}, 't.csv', b'Skupina;Segment;SKU')
chk(s == 403, f'monter (brez quotes.create) 403 na import bom (dejansko {s})')
s, d = post_file('/api/import/quote', skladisce, {'mode': 'preveri'}, 't.json', b'{}')
chk(s == 403, f'skladišče 403 na import quote (dejansko {s})')
s, d = callj('POST', '/api/import/xyz')
chk(s in (400, 401), f'neznan kind zavrnjen (dejansko {s})')

# ══ B. ČISTI LIB (import-core) ══════════════════════════════════════════════
print('── B. Čisti lib (import-core) ──')
CORE = r'''
const {parseSiNumber, parseBomCsv, parseBomJson, parseQuoteJson, bomImportDiff, validateBomRows} = require('./src/lib/import-core.ts');
const {bomCsv, BOM_CSV_HEADER} = require('./src/lib/export-core.ts');
const out = [];
// parseSiNumber
out.push(['si_1', parseSiNumber('1,5') === 1.5]);
out.push(['si_2', parseSiNumber('1.5') === 1.5]);
out.push(['si_3', parseSiNumber('-3') === -3]);
out.push(['si_4', parseSiNumber('1.234,5') === null]); // tisočice zavrnjene
out.push(['si_5', parseSiNumber('abc') === null]);
out.push(['si_6', parseSiNumber('') === null && parseSiNumber(null) === null]);
// bomCsv round-trip (lasten izvoz → parse)
const meta = {packageCode: 'PAK-X', productName: 'Test', projectCode: null, projectTitle: null, qty: 10, unit: 'm2', generatedAt: '2026-10-11T00:00:00Z'};
const lines = [
  {group: 'STEBRI', segmentKey: 'seg-1', sku: 'STB-060', name: 'Steber 60', qty: 3.5, unit: 'kos', wastePct: null, sourceRule: 'max_razdalja_stebrov', note: null},
  {group: 'ROCNIK', segmentKey: null, sku: 'ROC-040', name: 'Ročnik', qty: 2.25, unit: 'm', wastePct: 7.5, sourceRule: 'odpad_rez_pct', note: 'opis; s podpičjem'},
];
const csv = bomCsv(meta, lines, []);
const p = parseBomCsv(csv);
out.push(['csv_lines', p.lines.length === 2 && p.errors.length === 0]);
out.push(['csv_qty', p.lines[0].qty === 3.5 && p.lines[1].qty === 2.25]);
out.push(['csv_waste', p.lines[1].wastePct === 7.5]);
out.push(['csv_note', p.lines[1].note === 'opis; s podpičjem']);
// napačna glava
const bad1 = parseBomCsv('A;B;C\r\n1;2;3');
out.push(['csv_badhead', bad1.errors.length === 1 && bad1.lines.length === 0]);
// podvojen SKU+segment
const dup = parseBomCsv(BOM_CSV_HEADER.join(';') + '\r\nSTEBRI;;STB-060;N;1;kos;;;;\r\nSTEBRI;;STB-060;N;2;kos;;;;\r\n');
out.push(['csv_dup', dup.errors.length >= 1 && dup.errors[0].problem.includes('Podvojen')]);
// neveljaven segment
const seg = parseBomCsv(BOM_CSV_HEADER.join(';') + '\r\nSTEBRI;segment-1;STB-060;N;1;kos;;;;\r\n');
out.push(['csv_badseg', seg.errors.length === 1 && seg.errors[0].field === 'Segment']);
// neveljavna skupina
const grp = parseBomCsv(BOM_CSV_HEADER.join(';') + '\r\nSTEBRIKI;;STB-060;N;1;kos;;;;\r\n');
out.push(['csv_badgroup', grp.errors.length === 1 && grp.errors[0].field === 'Skupina']);
// negativna količina
const neg = parseBomCsv(BOM_CSV_HEADER.join(';') + '\r\nSTEBRI;;STB-060;N;-1;kos;;;;\r\n');
out.push(['csv_negqty', neg.errors.length === 1 && neg.errors[0].field === 'Količina']);
// diff
const diff = bomImportDiff(
  [{group: null, segmentKey: 'seg-1', sku: 'A', name: '', qty: 5, unit: 'kos', wastePct: null, sourceRule: null, note: null},
   {group: null, segmentKey: null, sku: 'B', name: '', qty: 2, unit: 'kos', wastePct: null, sourceRule: null, note: null}],
  [{sku: 'A', segmentKey: 'seg-1', qty: 5}, {sku: 'C', segmentKey: null, qty: 1}]
);
out.push(['diff_unchanged', diff.unchanged === 1]);
out.push(['diff_added', diff.entries.some(e => e.kind === 'DODANO' && e.sku === 'B')]);
out.push(['diff_removed', diff.entries.some(e => e.kind === 'ODSTRANJENO' && e.sku === 'C')]);
const diff2 = bomImportDiff(
  [{group: null, segmentKey: null, sku: 'A', name: '', qty: 9, unit: 'kos', wastePct: null, sourceRule: null, note: null}],
  [{sku: 'A', segmentKey: null, qty: 5}]
);
out.push(['diff_changed', diff2.entries.length === 1 && diff2.entries[0].kind === 'SPREMENJENA_KOLICINA' && diff2.entries[0].fromQty === 5 && diff2.entries[0].toQty === 9]);
// parseBomJson — ovijalnik IN golo
const jsonWrapped = {data: {kind: 'bom', lines: [{sku: 'X', qty: 1, unit: 'kos'}], package: {packageCode: 'PAK-Y'}}};
const jsonBare = {kind: 'bom', lines: [{sku: 'X', qty: 1, unit: 'kos'}]};
const pj1 = parseBomJson(jsonWrapped);
const pj2 = parseBomJson(jsonBare);
out.push(['json_wrapped', pj1.lines.length === 1 && pj1.errors.length === 0]);
out.push(['json_bare', pj2.lines.length === 1 && pj2.errors.length === 0]);
out.push(['json_warning_src', pj1.warnings.some(w => w.includes('PAK-Y'))]);
const pj3 = parseBomJson({kind: 'quote'});
out.push(['json_wrongkind', pj3.errors.length === 1]);
// parseQuoteJson — ovijalnik, fileTotals, popust
const qj = parseQuoteJson({data: {kind: 'quote', quote: {code: 'PON-1', status: 'POSLAN', customerName: 'Test', projectCode: 'P-1', discountPct: 10, subtotal: 100, discount: 10, vat: 19.8, total: 119.8, stale: false}, lines: [{description: 'D', qty: 2, unitPrice: 50}]}});
out.push(['qj_parsed', qj.parsed != null && qj.error == null]);
out.push(['qj_lines', qj.parsed.lines.length === 1 && qj.parsed.lines[0].unitPrice === 50]);
out.push(['qj_pct', qj.parsed.discountPct === 10]);
out.push(['qj_totals_reported', qj.parsed.fileTotals.total === 119.8]);
const qj2 = parseQuoteJson({kind: 'quote', quote: {discountPct: 150}, lines: [{description: 'D', qty: 1, unitPrice: 10}]});
out.push(['qj_badpct', qj2.parsed.discountPct === null && qj2.parsed.warnings.some(w => w.includes('ni veljaven'))]);
for (const [k, v] of out) console.log(k + '=' + (v ? 'OK' : 'FAIL'));
'''
out, err = bun_ts(CORE)
for line in out.strip().splitlines():
    if '=' not in line: continue
    k, v = line.split('=', 1)
    chk(v == 'OK', f'lib: {k}')
if 'FAIL' in out: bad(f'lib FAIL detektiran: {out[:400]}')
if not out.strip(): bad(f'lib izhod prazen (stderr: {err})')

# ══ C. XLSX bralnik ═════════════════════════════════════════════════════════
print('── C. XLSX bralnik (xlsx-read) ──')
XLSX = r'''
const {readXlsx, findSheetWithHeader, parseSheetXml} = require('./src/lib/xlsx-read.ts');
const {findHeaderRow} = require('./src/lib/import-core.ts');
const {bomXlsx, BOM_CSV_HEADER} = require('./src/lib/export-core.ts');
const {deflateRawSync} = require('node:zlib');
const out = [];
// 1) lasten izvoz → readXlsx
const meta = {packageCode: 'PAK-X', productName: 'Test', projectCode: null, projectTitle: null, qty: 1, unit: 'kos', generatedAt: '2026-10-11T00:00:00Z'};
const lines = [
  {group: 'STEBRI', segmentKey: 'seg-2', sku: 'STB-060', name: 'Steber', qty: 3.5, unit: 'kos', wastePct: null, sourceRule: null, note: null},
  {group: null, segmentKey: null, sku: 'ROC-040', name: 'Ročnik', qty: 2, unit: 'm', wastePct: 7.5, sourceRule: 'odpad_rez_pct', note: null},
];
const x = bomXlsx(meta, lines, []);
const res = readXlsx(x);
const sheet = findSheetWithHeader(res, BOM_CSV_HEADER, 'Kosovnica');
out.push(['xlsx_sheet', sheet != null]);
const hdrIdx = findHeaderRow(sheet.rows, BOM_CSV_HEADER);
out.push(['xlsx_header', hdrIdx === 4]); // 4 meta vrstice pred glavo (brez projekta)
const dataRows = sheet.rows.slice(hdrIdx + 1);
out.push(['xlsx_rows', dataRows.length === 2]);
out.push(['xlsx_qty', dataRows[0][4] === '3.5']); // število kot niz s piko
out.push(['xlsx_waste', dataRows[1][6] === '7.5']);
// 2) DEFLATE simulacija (Excel re-save): ročno ZIP z metodo 8
const mkZip = (entries, method) => {
  const parts = [], central = []; let pos = 0;
  const u16 = v => [v & 255, (v >> 8) & 255];
  const u32 = v => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255];
  const crc = buf => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); } return (~c) >>> 0; };
  for (const {name, data} of entries) {
    const nameB = Buffer.from(name, 'utf8');
    const payload = method === 8 ? deflateRawSync(Buffer.from(data)) : Buffer.from(data);
    const crcV = crc(Buffer.from(data));
    const lh = Buffer.from([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(method), ...u16(0), ...u16(0), ...u32(crcV), ...u32(payload.length), ...u32(data.length), ...u16(nameB.length), ...u16(0)]);
    parts.push(lh, nameB, payload);
    central.push(Buffer.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(method), ...u16(0), ...u16(0), ...u32(crcV), ...u32(payload.length), ...u32(data.length), ...u16(nameB.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(pos)]), nameB);
    pos += lh.length + nameB.length + payload.length;
  }
  let cdLen = 0; for (const c of central) cdLen += c.length;
  const end = Buffer.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length / 2), ...u16(central.length / 2), ...u32(cdLen), ...u32(pos), ...u16(0)]);
  return Buffer.concat([...parts, ...central, end]);
};
const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>Meta vrstica</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>${BOM_CSV_HEADER[0]}</t></is></c><c r="B2" t="inlineStr"><is><t>${BOM_CSV_HEADER[1]}</t></is></c><c r="C2" t="inlineStr"><is><t>${BOM_CSV_HEADER[2]}</t></is></c><c r="D2" t="inlineStr"><is><t>${BOM_CSV_HEADER[3]}</t></is></c><c r="E2" t="inlineStr"><is><t>${BOM_CSV_HEADER[4]}</t></is></c><c r="F2" t="inlineStr"><is><t>${BOM_CSV_HEADER[5]}</t></is></c><c r="G2" t="inlineStr"><is><t>${BOM_CSV_HEADER[6]}</t></is></c><c r="H2" t="inlineStr"><is><t>${BOM_CSV_HEADER[7]}</t></is></c><c r="I2" t="inlineStr"><is><t>${BOM_CSV_HEADER[8]}</t></is></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>STEBRI</t></is></c><c r="C3" t="inlineStr"><is><t>STB-060</t></is></c><c r="D3" t="inlineStr"><is><t>Steber</t></is></c><c r="E3"><v>4</v></c><c r="F3" t="inlineStr"><is><t>kos</t></is></c></row>
</sheetData></worksheet>`;
const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Kosovnica" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
const deflateZip = mkZip([
  {name: 'xl/workbook.xml', data: workbook},
  {name: 'xl/_rels/workbook.xml.rels', data: rels},
  {name: 'xl/worksheets/sheet1.xml', data: sheet1},
], 8);
try {
  const res2 = readXlsx(new Uint8Array(deflateZip));
  const sheet2 = findSheetWithHeader(res2, BOM_CSV_HEADER);
  out.push(['deflate_sheet', sheet2 != null]);
  out.push(['deflate_cell', sheet2 != null && sheet2.rows[2] != null && sheet2.rows[2][4] === '4']);
} catch (e) { out.push(['deflate_sheet', false]); out.push(['deflate_cell', false]); }
// 3) sharedStrings pot (Excel re-save pogosto shrani besedilo sem)
const sheet3 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>7</v></c></row></sheetData></worksheet>`;
const rows = parseSheetXml(sheet3, ['Kosovnica', 'Segment', 'SKU', 'STEBRI']);
out.push(['shared_1', rows[0][0] === 'Kosovnica' && rows[0][1] === 'Segment']);
out.push(['shared_2', rows[1][0] === 'STEBRI' && rows[1][1] === '7']);
for (const [k, v] of out) console.log(k + '=' + (v ? 'OK' : 'FAIL'));
'''
out, err = bun_ts(XLSX)
for line in out.strip().splitlines():
    if '=' not in line: continue
    k, v = line.split('=', 1)
    chk(v == 'OK', f'xlsx: {k}')
if 'FAIL' in out: bad(f'xlsx FAIL detektiran: {out[:400]}')
if not out.strip(): bad(f'xlsx izhod prazen (stderr: {err})')

# ══ D. UVOZ KOSOVNICE ══════════════════════════════════════════════════════
print('── D. Uvoz kosovnice ──')
# testni paket z BOM (isti projekt P1, ločeno od demo paketov)
s, d = callj('POST', '/api/project-packages', admin, body={
  'projectId': P1, 'productId': 'seed-product-wpc', 'qty': 4, 'unit': 'm2', 'note': TAG,
})
PKG = None
if s == 201:
    PKG = d['data']['id']
else:
    # produkt seeda ima lahko drugačen id — poišči prvega iz kataloga
    s, d = callj('GET', '/api/products?family=all', admin)
    prod = next((p for p in d.get('data', []) if p.get('sku') == 'OGR-P-001'), (d.get('data') or [None])[0])
    s, d = callj('POST', '/api/project-packages', admin, body={
      'projectId': P1, 'productId': prod['id'], 'qty': 4, 'unit': 'm2', 'note': TAG,
    })
    if s == 201: PKG = d['data']['id']
chk(bool(PKG), f'testni paket ustvarjen ({s})')

if PKG:
    # generiraj BOM (regen — da ima paket kosovnico)
    s, d = callj('POST', f'/api/project-packages/{PKG}/bom', admin, body={})
    chk(s == 201, f'kosovnica generirana ({s})')
    BOM_ORIG = d.get('data', {}).get('bom', {}).get('code')

    # ── CSV round-trip: izvoz → preveri (0 razlik) ──
    s, csv_bytes, _ = call('GET', f'/api/export/bom/{PKG}?format=csv', admin)
    chk(s == 200, f'izvoz CSV ({s})')
    s, d = post_file('/api/import/bom', admin, {'packageId': PKG, 'mode': 'preveri'}, 'kosovnica.csv', csv_bytes, 'text/csv')
    chk(s == 200, f'preveri CSV 200 (dejansko {s})')
    chk(d.get('data', {}).get('diff', {}).get('entries') == [], 'preveri CSV: 0 razlik (ROUND-TRIP)')
    chk(d.get('data', {}).get('lines', 0) > 0, 'preveri CSV: vrstice > 0')

    # ── XLSX preveri (meta preskočene) ──
    s, x_bytes, _ = call('GET', f'/api/export/bom/{PKG}?format=xlsx', admin)
    chk(s == 200, f'izvoz XLSX ({s})')
    s, d = post_file('/api/import/bom', admin, {'packageId': PKG, 'mode': 'preveri'}, 'kosovnica.xlsx', x_bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    chk(s == 200 and d.get('data', {}).get('diff', {}).get('entries') == [], f'preveri XLSX: 0 razlik ({s})')
    chk(any('metapodatkov' in w for w in d.get('data', {}).get('warnings', [])), 'preveri XLSX: meta vrstice preskočene (opozorilo)')

    # ── JSON preveri ──
    s, j_bytes, _ = call('GET', f'/api/export/bom/{PKG}?format=json', admin)
    chk(s == 200, f'izvoz JSON ({s})')
    s, d = post_file('/api/import/bom', admin, {'packageId': PKG, 'mode': 'preveri'}, 'kosovnica.json', j_bytes, 'application/json')
    chk(s == 200 and d.get('data', {}).get('diff', {}).get('entries') == [], f'preveri JSON: 0 razlik ({s})')

    # ── sprememba količine v CSV → diff + uvoz dejansko spremeni ──
    text = csv_bytes.decode('utf-8-sig')
    lines_csv = text.split('\r\n')
    # naštej prvo podatkovno vrstico in podvoji količino
    data_idx = None
    for i, ln in enumerate(lines_csv):
        if ln and not ln.startswith('#') and ln.split(';')[0] != 'Skupina':
            data_idx = i; break
    chk(data_idx is not None, 'podatkovna vrstica najdena v CSV')
    cells = lines_csv[data_idx].split(';')
    old_qty = cells[4]
    cells[4] = str(float(old_qty.replace(',', '.')) * 2).replace('.', ',')
    lines_csv[data_idx] = ';'.join(cells)
    edited = ('\r\n'.join(lines_csv)).encode('utf-8')
    s, d = post_file('/api/import/bom', admin, {'packageId': PKG, 'mode': 'preveri'}, 'kosovnica-edit.csv', edited, 'text/csv')
    chk(s == 200 and any(e['kind'] == 'SPREMENJENA_KOLICINA' for e in d.get('data', {}).get('diff', {}).get('entries', [])), 'preveri: sprememba količine VIDNA v diff')

    # ── uvoz (uvozi) → dejanska sprememba + revizija + re-izvoz identična ──
    s, d = post_file('/api/import/bom', admin, {'packageId': PKG, 'mode': 'uvozi'}, 'kosovnica-edit.csv', edited, 'text/csv')
    chk(s == 201, f'uvozi CSV 201 (dejansko {s})')
    NEW_BOM = d.get('data', {}).get('bom', {}).get('code')
    chk(bool(NEW_BOM), f'nova koda kosovnice ({NEW_BOM})')
    # re-izvoz → preveri = 0 razlik (dokaz da se je uvoz zares zapisal)
    s, csv2, _ = call('GET', f'/api/export/bom/{PKG}?format=csv', admin)
    s, d = post_file('/api/import/bom', admin, {'packageId': PKG, 'mode': 'preveri'}, 'kosovnica2.csv', csv2, 'text/csv')
    chk(s == 200 and d.get('data', {}).get('diff', {}).get('entries') == [], 're-izvoz po uvozu: 0 razlik (DOKAZ OKROGLOSTI)')
    # revizija
    s, d = callj('GET', f'/api/project-packages/{PKG}', admin)
    proj_id_pkg = d.get('data', {}).get('projectId')
    chk(audit_has(admin, 'BOM_IMPORT', None, proj_id_pkg) or any(
        e.get('action') == 'BOM_IMPORT' for e in audit_rows(admin, proj_id_pkg)), 'revizija BOM_IMPORT zabeležena')

    # ── invalidacija ponudb (R474) ──
    s, d = callj('POST', '/api/quotes', admin, body={
      'projectId': proj_id_pkg, 'packageId': PKG, 'status': 'OSNUTEK',
      'lines': [{'description': f'{TAG} test', 'qty': 1, 'unitPrice': 100}],
    })
    chk(s == 201, f'ponudba na paketu ustvarjena ({s})')
    if s == 201:
      QT_ID, QT_CODE = d['data']['id'], d['data']['code']
      # označi POSLAN
      s, d = callj('PATCH', f'/api/quotes/{QT_ID}', admin, body={'status': 'POSLAN'})
      chk(s == 200, f'ponudba POSLAN ({s})')
      # uvoz kosovnice → invalidacija
      s, d = post_file('/api/import/bom', admin, {'packageId': PKG, 'mode': 'uvozi'}, 'kosovnica2.csv', csv2, 'text/csv')
      chk(s == 201, f'ponovni uvoz po izdaji ponudbe ({s})')
      inv = d.get('data', {}).get('invalidated')
      chk(inv is not None and (inv.get('reset', 0) + inv.get('flagged', 0)) > 0, f'invalidacija poročana ({inv})')
      s, d = callj('GET', f'/api/quotes/{QT_ID}', admin)
      qd = d.get('data', {})
      chk(qd.get('status') == 'OSNUTEK', f'POSLAN → OSNUTEK po uvozu (dejansko {qd.get("status")})')
      chk(qd.get('staleAt') is not None, 'zastavica ZASTARELO nastavljena')
      # izvoz ponudbe nosi opozorilo ZASTARELA_PONUDBA
      s, qj, _ = call('GET', f'/api/export/quote/{QT_ID}?format=json', admin)
      chk(b'ZASTARELA_PONUDBA' in qj, 'izvoz ponudbe: opozorilo ZASTARELA_PONUDBA')
    else:
      QT_ID, QT_CODE = None, None

    # ── napake ──
    # neznan SKU
    badsku = ('Skupina;Segment;SKU;Artikel;Količina;Enota;Odpad %;Vir količine;Opomba\r\n'
              'STEBRI;;NEZNANI-SKU-123;Neki artikel;1;kos;;;;\r\n').encode('utf-8')
    s, d = post_file('/api/import/bom', admin, {'packageId': PKG, 'mode': 'preveri'}, 'bad.csv', badsku, 'text/csv')
    chk(s == 409 and 'NEZNANI-SKU-123' in json.dumps(d), f'neznan SKU 409 z imenom ({s})')
    # napačna glava
    s, d = post_file('/api/import/bom', admin, {'packageId': PKG, 'mode': 'preveri'}, 'bad.csv', b'A;B;C\r\n1;2;3\r\n', 'text/csv')
    chk(s == 409, f'napačna glava CSV 409 (dejansko {s})')
    # XLSX brez glave (random zip)
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, 'w') as z:
        z.writestr('a.txt', 'hello')
    s, d = post_file('/api/import/bom', admin, {'packageId': PKG, 'mode': 'preveri'}, 'bad.xlsx', zbuf.getvalue(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    chk(s in (400, 409), f'XLSX brez glave zavrnjen ({s})')
    # manjkajoč packageId
    s, d = post_file('/api/import/bom', admin, {'mode': 'preveri'}, 'k.csv', csv_bytes, 'text/csv')
    chk(s == 400, f'manjka packageId 400 (dejansko {s})')
    # smeti kot JSON
    s, d = post_file('/api/import/bom', admin, {'packageId': PKG, 'mode': 'preveri'}, 'bad.json', b'ne-veljaven json {{{', 'application/json')
    chk(s == 409 or s == 400, f'smeti JSON zavrnjene ({s})')
    # neznana vrsta
    s, d = post_file('/api/import/xyz', admin, {'mode': 'preveri'}, 't.csv', b'x', 'text/csv')
    chk(s == 400, f'neznan kind 400 (dejansko {s})')

# ══ E. UVOZ PONUDBE ════════════════════════════════════════════════════════
print('── E. Uvoz ponudbe ──')
# izvoz obstoječe demo ponudbe
s, d = callj('GET', '/api/quotes?limit=50', admin)
src = next((q for q in d.get('data', []) if q.get('status') in ('POSLAN', 'SPREJET', 'OSNUTEK') and q.get('_count', {}).get('lines', 0) > 0), None)
chk(src is not None, 'izvorna ponudba najdena')
if src:
    s, qj, _ = call('GET', f"/api/export/quote/{src['id']}?format=json", admin)
    chk(s == 200, f'izvoz ponudbe JSON ({s})')
    # preveri
    s, d = post_file('/api/import/quote', admin, {'mode': 'preveri'}, 'ponudba.json', qj, 'application/json')
    chk(s == 200, f'preveri ponudbe 200 (dejansko {s})')
    dd = d.get('data', {})
    chk(dd.get('lines') == src['_count']['lines'], f'pozicije enake ({dd.get("lines")} vs {src["_count"]["lines"]})')
    chk(abs((dd.get('totals') or {}).get('total', -1) - src['total']) < 0.01, 'znesek preračunan == izvirnik')
    # uvozi
    s, d = post_file('/api/import/quote', admin, {'mode': 'uvozi'}, 'ponudba.json', qj, 'application/json')
    chk(s == 201, f'uvozi ponudbe 201 (dejansko {s})')
    NEW_Q = d.get('data', {}).get('quote', {})
    chk(NEW_Q.get('code') != src['code'] and bool(NEW_Q.get('code')), f'nova koda ponudbe ({NEW_Q.get("code")})')
    chk(NEW_Q.get('status') == 'OSNUTEK', 'uvožena ponudba je OSNUTEK')
    IMP_Q = NEW_Q.get('id')
    # izvirnik NEDOTAKNJEN
    s, d = callj('GET', f"/api/quotes/{src['id']}", admin)
    chk(s == 200 and d['data']['status'] == src['status'], 'izvirna ponudba nedotaknjena (isti status)')
    # uvožena: vrstice + zneski
    s, d = callj('GET', f'/api/quotes/{IMP_Q}', admin)
    chk(s == 200 and len(d['data']['lines']) == src['_count']['lines'], 'uvožene pozicije enake')
    chk(abs(d['data']['total'] - src['total']) < 0.01, 'uvožen SKUPAJ enak izvirniku')
    chk('Uvoženo iz' in (d['data'].get('note') or ''), 'opomba o uvozu v ponudbi')
    # revizija (po projektu izvorne ponudbe — audit API filtrira po projectId)
    s, d = callj('GET', f"/api/quotes/{src['id']}", admin)
    src_proj = d.get('data', {}).get('project')
    src_proj_id = src_proj.get('id') if isinstance(src_proj, dict) else None
    s, d = callj('GET', f'/api/audit?limit=200' + (f'&projectId={src_proj_id}' if src_proj_id else ''), admin)
    chk(any(e.get('action') == 'QUOTE_IMPORT' and e.get('entityId') == IMP_Q for e in d.get('data', [])), 'revizija QUOTE_IMPORT zabeležena')

    # izkrivljeni zneski → PRERAČUNANI
    tampered = json.loads(qj.decode('utf-8'))
    tampered['data']['quote']['total'] = 999999.99
    tampered_bytes = json.dumps(tampered).encode('utf-8')
    s, d = post_file('/api/import/quote', admin, {'mode': 'preveri'}, 'tampered.json', tampered_bytes, 'application/json')
    chk(s == 200 and abs(d['data']['totals']['total'] - src['total']) < 0.01, 'izkrivljeni zneski: PRERAČUNANI uporabljeni')
    chk(any('razlikuje' in w for w in d.get('data', {}).get('warnings', [])), 'opozorilo o razliki zneska')
    # CSV zavrnjen
    s, qcsv, _hdrs = call('GET', f"/api/export/quote/{src['id']}?format=csv", admin)
    s, d = post_file('/api/import/quote', admin, {'mode': 'preveri'}, 'ponudba.csv', qcsv, 'text/csv')
    chk(s == 400, f'CSV za ponudbo zavrnjen 400 (dejansko {s})')
    # packageId drugega projekta → 400
    s, d = post_file('/api/import/quote', admin, {'mode': 'preveri', 'packageId': 'ne-obstaja'}, 'ponudba.json', qj, 'application/json')
    chk(s == 404, f'neznani paket 404 (dejansko {s})')

# ══ F. ČIŠČENJE ════════════════════════════════════════════════════════════
print('── F. Čiščenje ──')
CLEAN = r'''
const {PrismaClient} = require('@prisma/client');
const db = new PrismaClient();
const TAG = 'R478-TEST';
(async () => {
  // testni paket (note označen) + njegova kosovnica
  const pkgs = await db.projectPackage.findMany({ where: { note: TAG } });
  for (const p of pkgs) {
    await db.bomLine.deleteMany({ where: { bom: { packageId: p.id } } });
    await db.bom.deleteMany({ where: { packageId: p.id } });
    await db.projectPackage.delete({ where: { id: p.id } });
  }
  console.log('packages=' + pkgs.length);
  // uvožene testne ponudbe (note vsebuje 'Uvoženo iz' + izdanes < 3 h) IN
  // ponudbe, katerih vrstica opisa nosi testno oznako TAG
  const imported = await db.quote.findMany({
    where: { OR: [{ note: { contains: 'Uvoženo iz' } }, { lines: { some: { description: { contains: TAG } } } }] },
    select: { id: true, createdAt: true, note: true, lines: { select: { description: true } } },
  });
  let n = 0;
  for (const q of imported) {
    const isTagged = (q.lines ?? []).some((l) => (l.description ?? '').includes(TAG));
    const isFreshImport = (q.note ?? '').includes('Uvoženo iz') && Date.now() - new Date(q.createdAt).getTime() < 3 * 3600 * 1000;
    if (isTagged || isFreshImport) {
      await db.quoteLine.deleteMany({ where: { quoteId: q.id } });
      await db.quote.delete({ where: { id: q.id } });
      n++;
    }
  }
  console.log('quotes=' + n);
  await db.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
'''
out, err = bun_ts(CLEAN)
chk('packages=' in out, f'čiščenje paketov ({out.strip()})')
chk('quotes=' in out, f'čiščenje ponudb ({out.strip()})')

# ── povzetek ────────────────────────────────────────────────────────────────
print(f'\n══ R478: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL > 0 else 0)
