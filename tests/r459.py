#!/usr/bin/env python3
"""tests/r459.py — R459 REALISTIC PHOTO REPLACEMENT (issue #14)

Preverja:
  A) RBAC (fail-closed): brez žetona 401 na vseh rutah; skladišče/proizvodnja
     (brez measurements.write) 403 na POST/PATCH, 200 na seznamu; monter vse.
  B) Ustvarjanje variant A/B/C: avtomatska oznaka, četrta → 409, eksplicitna
     napačna oznaka → 400, duplikat → 409.
  C) Validacije: napačen prefix fotografije, prevelika slika, quad < 4 točk,
     quad izven 0..1, referenca izven obsega, neznan izdelek, varianta tujega
     izdelka, meritev tujega projekta, napačna konfiguracija.
  D) Obseg (§13 IDOR): monter2 brez dostopa do projekta → 403 na POST/GET
     detail/PATCH/export/PDF; monter z nalogom na projektu (ne avtor) → 200.
  E) Verzije (§12): sprememba renderParams → NOVA verzija (v1 ostane), status
     IZBRANA pomeni vse ostale, revizije PHOTO_VIZ_*.
  F) Izvoz: format png/primerjava → 200 + revizija PHOTO_VIZ_EXPORT; napačen
     format → 400.
  G) PDF: /api/pdf/photoviz/[id] → 200 application/pdf z DCTDecode slikama;
     neznan id → 404; tujec → 403; napačen tip → 400.
  H) Seznam/detail: filter projectId/status, sourcePhoto + versions + opozorila.
  I) Regresija: measurements/products/projects še delujejo; quote PDF 404.
  J) Idempotentno čiščenje vseh testnih zapisov.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R459-TEST'
PASS, FAIL = 0, 0

def call (method, path, token=None, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode('utf-8', 'replace'), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace'), {k.lower(): v for k, v in e.headers.items()}
    except Exception as e:
        return 0, str(e), {}

def callj (method, path, token=None, body=None):
    s, b, _ = call(method, path, token, body)
    return s, (json.loads(b) if s and b[:1] in '{[' else None)

def jget (path, token):
    s, d = callj('GET', path, token)
    return d if s == 200 else None

def login (email, pw):
    s, d = callj('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s}'
    return d['token']

def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)

def bun (script):
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       env={**os.environ, 'DATABASE_URL': os.environ.get('TEST_DB_URL') or 'postgresql://roksal:roksal@localhost:54329/roksal'})
    return 'CLEAN_DONE' in r.stdout, r.stderr[:400]

# veljaven minimalen JPEG (1×1, DCTDecode)
PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='
RENDERED = PHOTO  # za teste je dovolj enaka sličica

QUAD = [
    {'x': 0.10, 'y': 0.80}, {'x': 0.90, 'y': 0.80},
    {'x': 0.88, 'y': 0.35}, {'x': 0.12, 'y': 0.35},
]
CONFIG = {
    'tip': 'POKOCNA', 'lengthCm': 420, 'heightCm': 110, 'posts': 5,
    'handrail': True, 'lamelaMm': 70, 'rezaMm': 20, 'deskaMm': 120,
    'pritrditev': 'TALNA', 'vijaki': True,
}
def rparams (length=420, quad=None):
    return {'quad': quad or QUAD, 'reference': {'tip': 'ROCNO', 'cm': 420, 'opis': 'testna ograja'}, 'config': {**CONFIG, 'lengthCm': length}}

CLEAN = f'''
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
(async()=>{{
  const vs=await p.photoVisualization.findMany({{where:{{note:{{contains:'{TAG}'}}}},select:{{id:true,projectId:true}}}});
  const pids=[...new Set(vs.map(v=>v.projectId))];
  for(const v of vs){{await p.photoVisualization.delete({{where:{{id:v.id}}}});}}
  const wos=await p.workOrder.findMany({{where:{{title:{{contains:'{TAG}'}}}},select:{{id:true}}}});
  for(const w of wos){{await p.workOrder.delete({{where:{{id:w.id}}}});}}
  const ps=await p.project.findMany({{where:{{title:{{contains:'{TAG}'}}}},select:{{id:true}}}});
  for(const x of ps){{await p.project.delete({{where:{{id:x.id}}}});}}
  await p.measurement.deleteMany({{where:{{note:'{TAG}'}}}});
  await p.user.deleteMany({{where:{{email:'monter2-r459@roksal.si'}}}});
  await p.auditLog.deleteMany({{where:{{detail:{{contains:'{TAG}'}}}}}});
  console.log('CLEAN_DONE');return p.$disconnect();
}})()
'''

# ══ 0. prijava + priprava + čiščenje ════════════════════════════════════════
admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')
proizvodnja = login('proizvodnja@roksal.si', 'Proizvodnja123!')
print('── prijava: admin / monter / skladišče / proizvodnja ──')
ok('prijava 4 vlog')

done, err = bun(CLEAN)
chk(done, f'čiščenje ostankov pred testom {"" if done else " — " + err}')

# testni projekt + izdelka + varianta + meritev (za tuji projekt test)
s, d = callj('POST', '/api/projects', admin, {'title': f'Testni projekt {TAG}', 'status': 'NACRT'})
chk(s == 201, f'testni projekt ustvarjen (dejansko {s})')
PROJ = d['data']['id']
# drugi projekt z meritvijo (za validacijo tujih meritev)
s, d = callj('GET', '/api/projects', admin)
tuji = next((p for p in d['data'] if p['id'] != PROJ), None)
s, d = callj('POST', '/api/measurements', admin, {
    'projectId': tuji['id'], 'type': 'OGRAJA', 'lengthCm': 300, 'heightCm': 100,
    'location': f'{TAG} tuja', 'note': TAG,
})
chk(s == 201, 'tuja meritev ustvarjena za validacijo')
TUJA_M = d['data']['id']

# izdelki
s, d = callj('GET', '/api/products?family=OGRAJA_POKOCNA', admin)
prods = d['data']
PROD = next(p for p in prods if p['sku'] == 'OGR-K-002')
VAR = next(v for v in PROD['variants'] if v['sku'] == 'OGR-K-002-ANT')
s, d = callj('GET', '/api/products?family=OGRAJA_PRECNA', admin)
PROD2 = next(p for p in d['data'] if p['sku'] == 'OGR-P-001')
VAR2 = next(v for v in PROD2['variants'] if 'ANT' in v['sku'])
chk(True, f'izdelka: {PROD["sku"]} / {PROD2["sku"]}')

# monter2 (brez dostopa do testnega projekta)
M2 = f'''
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
(async()=>{{
  const crypto=require('crypto');
  const salt=crypto.randomUUID().replace(/-/g,'');
  const hash=crypto.scryptSync('Monter123!',salt,64).toString('hex');
  const u=await p.user.upsert({{where:{{email:'monter2-r459@roksal.si'}},update:{{}},create:{{
    email:'monter2-r459@roksal.si',name:'Monter2 R459',role:'MONTER',
    passwordHash:salt+':'+hash,active:true}}}});
  console.log('M2='+u.id);return p.$disconnect();
}})()
'''
r = subprocess.run(['bun', '-e', M2], capture_output=True, text=True,
                   env={**os.environ, 'DATABASE_URL': os.environ.get('TEST_DB_URL') or 'postgresql://roksal:roksal@localhost:54329/roksal'})
MONTER2_ID = [l for l in r.stdout.splitlines() if l.startswith('M2=')]
chk(bool(MONTER2_ID), 'monter2 uporabnik pripravljen')
MONTER2_ID = MONTER2_ID[0][3:] if MONTER2_ID else ''
monter2 = login('monter2-r459@roksal.si', 'Monter123!')

# ══ A. RBAC ════════════════════════════════════════════════════════════════
print('── A. RBAC (fail-closed) ──')
s, _ = callj('GET', '/api/photo-visualization')
chk(s == 401, f'seznam brez žetona 401 (dejansko {s})')
s, _ = callj('POST', '/api/photo-visualization', body={'projectId': 'x'})
chk(s == 401, f'ustvarjanje brez žetona 401 (dejansko {s})')
s, _ = callj('GET', '/api/photo-visualization/x')
chk(s == 401, f'detail brez žetona 401 (dejansko {s})')
s, _ = callj('POST', '/api/photo-visualization/x/export', body={'format': 'png'})
chk(s == 401, f'izvoz brez žetona 401 (dejansko {s})')
s, _, _ = call('GET', '/api/pdf/photoviz/x')
chk(s == 401, f'PDF brez žetona 401 (dejansko {s})')
s, _ = callj('POST', '/api/photo-visualization', skladisce, {'projectId': PROJ})
chk(s == 403, f'skladišče (brez measurements.write) POST 403 (dejansko {s})')
s, _ = callj('POST', '/api/photo-visualization', proizvodnja, {'projectId': PROJ})
chk(s == 403, f'proizvodnja POST 403 (dejansko {s})')
s, d = callj('GET', '/api/photo-visualization', skladisce)
chk(s == 200, f'skladišče seznam 200 (projects.read) (dejansko {s})')

# ══ B. Ustvarjanje variant ═════════════════════════════════════════════════
print('── B. ustvarjanje + variante A/B/C ──')
def create (token, **over):
    body = {
        'projectId': PROJ, 'sourcePhoto': PHOTO, 'rendered': RENDERED,
        'productId': PROD['id'], 'variantId': VAR['id'],
        'renderParams': rparams(), 'note': TAG,
        'measurementId': None,
    }
    body.update(over)
    return callj('POST', '/api/photo-visualization', token, body)

s, d = create(admin)
chk(s == 201, f'varianta A ustvarjena (dejansko {s}: {json.dumps(d)[:160] if d else ""})')
VIZ_A = d['data']['id']
chk(d['data']['variantLabel'] == 'A', 'prva varianta dobi oznako A')
chk(d['data']['version'] == 1, 'verzija 1 ob nastanku')
s, d = create(admin)
chk(s == 201 and d['data']['variantLabel'] == 'B', f'druga samodejno B (dejansko {s})')
VIZ_B = d['data']['id']
s, d = create(admin)
chk(s == 201 and d['data']['variantLabel'] == 'C', f'tretja samodejno C (dejansko {s})')
VIZ_C = d['data']['id']
s, d = create(admin)
chk(s == 409, f'četrta varianta zavrnjena — A/B/C zasedene (dejansko {s})')
s, d = create(admin, variantLabel='D')
chk(s == 400, f'oznaka D zavrnjena (dejansko {s})')
s, d = create(admin, variantLabel='A')
chk(s == 409, f'duplikat oznake A zavrnjen (dejansko {s})')

# ══ C. Validacije ══════════════════════════════════════════════════════════
print('── C. validacije vhoda ──')
s, d = create(admin, variantLabel=None)  # ne glede na labelo — napaka prej
chk(s == 409, 'kontrola: A/B/C zasedene tudi brez oznake')
s, d = create(admin, sourcePhoto='data:image/png;base64,iVBORw0KGgo=')
chk(s == 400, f'PNG prefix zavrnjen — zahtevan JPEG (dejansko {s})')
s, d = create(admin, sourcePhoto='data:image/jpeg;base64,' + 'A' * 4_600_000)
chk(s == 400, f'prevelika slika zavrnjena (dejansko {s})')
s, d = create(admin, renderParams=rparams(quad=QUAD[:3]))
chk(s == 400, f'quad s 3 točkami zavrnjen (dejansko {s})')
s, d = create(admin, renderParams=rparams(quad=[{'x': 1.5, 'y': 0.5}, {'x': 0.9, 'y': 0.8}, {'x': 0.88, 'y': 0.35}, {'x': 0.12, 'y': 0.35}]))
chk(s == 400, f'točka izven 0..1 zavrnjena (dejansko {s})')
badref = rparams(); badref['reference'] = {'tip': 'ROCNO', 'cm': 5}
s, d = create(admin, renderParams=badref)
chk(s == 400, f'referenca 5 cm zavrnjena (dejansko {s})')
s, d = create(admin, productId='ne-obstaja')
chk(s == 404, f'neznan izdelek 404 (dejansko {s})')
s, d = create(admin, productId=PROD['id'], variantId=VAR2['id'])
chk(s == 400, f'varianta tujega izdelka zavrnjena (dejansko {s})')
s, d = create(admin, measurementId=TUJA_M)
chk(s == 400, f'meritev tujega projekta zavrnjena (dejansko {s})')
badcfg = rparams(); badcfg['config'] = {**CONFIG, 'lengthCm': 5}
s, d = create(admin, renderParams=badcfg)
chk(s == 400, f'lengthCm 5 zavrnjena (dejansko {s})')
s, d = callj('POST', '/api/photo-visualization', admin, {'projectId': 'ne-obstaja', 'sourcePhoto': PHOTO, 'productId': PROD['id'], 'renderParams': rparams()})
chk(s == 404, f'neznan projekt 404 (dejansko {s})')

# ══ D. Obseg (§13 IDOR) ═══════════════════════════════════════════════════
print('── D. obseg dostopa (IDOR) ──')
s, d = callj('POST', '/api/photo-visualization', monter2, {'projectId': PROJ, 'sourcePhoto': PHOTO, 'productId': PROD['id'], 'renderParams': rparams(), 'note': TAG})
chk(s == 403, f'monter2 brez naloga na projektu: POST 403 (dejansko {s})')
s, d = callj('GET', f'/api/photo-visualization/{VIZ_A}', monter2)
chk(s == 403, f'monter2 detail 403 (dejansko {s})')
s, d = callj('PATCH', f'/api/photo-visualization/{VIZ_A}', monter2, {'note': 'hacker'})
chk(s == 403, f'monter2 PATCH 403 (dejansko {s})')
s, d = callj('POST', f'/api/photo-visualization/{VIZ_A}/export', monter2, {'format': 'png'})
chk(s == 403, f'monter2 export 403 (dejansko {s})')
s, _, _ = call('GET', f'/api/pdf/photoviz/{VIZ_A}', monter2)
chk(s == 403, f'monter2 PDF 403 (dejansko {s})')
s, d = callj('GET', '/api/photo-visualization?projectId=' + PROJ, monter2)
chk(s == 200 and len(d['data']) == 0, f'monter2 seznam projekta prazen (dejansko {s}, n={len(d["data"]) if d else "?"})')

# monter z nalogom na projektu (ni avtor) → dostop OK
s, d = callj('GET', '/api/users', admin)
monter_id = next(u['id'] for u in d['data'] if u['email'] == 'monter@roksal.si')
s, d = callj('POST', '/api/nalog', admin, {'title': f'Testni nalog {TAG}', 'projectId': PROJ, 'assigneeId': monter_id})
chk(s == 201, f'nalog dodeljen monterju (dejansko {s})')
s, d = callj('GET', f'/api/photo-visualization/{VIZ_A}', monter)
chk(s == 200 and d['data']['sourcePhoto'].startswith('data:image/jpeg'), f'monter z nalogom vidi detail + fotografijo (dejansko {s})')
s, d = callj('GET', '/api/photo-visualization?projectId=' + PROJ, monter)
chk(s == 200 and len(d['data']) == 3, f'monter z nalogom vidi 3 variante projekta (dejansko {s}, n={len(d["data"]) if d else "?"})')

# ══ E. Verzije + statusi + revizije ════════════════════════════════════════
print('── E. verzije (§12) + statusi (§7) ──')
s, d = callj('PATCH', f'/api/photo-visualization/{VIZ_A}', admin, {
    'renderParams': rparams(length=500), 'rendered': RENDERED, 'note': TAG + ' posodobljena',
})
chk(s == 200 and d['data'].get('verzija') == 2, f'sprememba renderParams → verzija 2 (dejansko {s}, {d})')
s, d = callj('GET', f'/api/photo-visualization/{VIZ_A}', admin)
vers = sorted(d['data']['versions'], key=lambda v: v['version'])
chk(len(vers) == 2 and vers[0]['version'] == 1 and vers[1]['version'] == 2, f'dve verziji, v1 ostane (n={len(vers)})')
chk(all('data' not in v for v in vers), 'seznam verzij NE vrača bloba posnetka')
chk(d['data']['opozorila'] is not None, 'detail vrača opozorila kakovosti')
# statusi: B izbrana → A izbrana → B nazaj na OSNUTEK
s, d = callj('PATCH', f'/api/photo-visualization/{VIZ_B}', admin, {'status': 'IZBRANA'})
chk(s == 200, f'B izbrana (dejansko {s})')
s, d = callj('PATCH', f'/api/photo-visualization/{VIZ_A}', admin, {'status': 'IZBRANA'})
chk(s == 200, f'A izbrana (dejansko {s})')
s, d = callj('GET', '/api/photo-visualization?projectId=' + PROJ + '&status=IZBRANA', admin)
chk(len(d['data']) == 1 and d['data'][0]['id'] == VIZ_A, f'točno ena IZBRANA = A (n={len(d["data"])})')
s, d = callj('GET', '/api/photo-visualization?projectId=' + PROJ, admin)
byid = {r['id']: r for r in d['data']}
chk(byid[VIZ_B]['status'] == 'OSNUTEK', 'B pomenjena nazaj na OSNUTEK')
s, d = callj('PATCH', f'/api/photo-visualization/{VIZ_C}', admin, {'status': 'ARHIV'})
chk(s == 200, f'C arhivirana (dejansko {s})')
s, d = callj('PATCH', f'/api/photo-visualization/{VIZ_A}', admin, {'status': 'NEVELJAVEN'})
chk(s == 400, f'neveljaven status 400 (dejansko {s})')
s, d = callj('PATCH', f'/api/photo-visualization/{VIZ_A}', admin, {})
chk(s == 400, f'prazna sprememba 400 (dejansko {s})')

# revizije prek Prisma
REV = f'''
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
(async()=>{{
  const logs=await p.auditLog.findMany({{where:{{entity:'photoVisualization',entityId:{{in:['{VIZ_A}','{VIZ_B}','{VIZ_C}']}}}},select:{{action:true}}}});
  const acts=[...new Set(logs.map(l=>l.action))].sort();
  console.log('ACTS='+acts.join(','));
  const v1=await p.photoVisualizationVersion.findFirst({{where:{{visualizationId:'{VIZ_A}',version:1}}}});
  console.log('V1HAS420='+(v1&&v1.data.includes('"lengthCm":420')));
  return p.$disconnect();
}})()
'''
r = subprocess.run(['bun', '-e', REV], capture_output=True, text=True,
                   env={**os.environ, 'DATABASE_URL': os.environ.get('TEST_DB_URL') or 'postgresql://roksal:roksal@localhost:54329/roksal'})
out = r.stdout
chk('PHOTO_VIZ_CREATE' in out and 'PHOTO_VIZ_UPDATE' in out and 'PHOTO_VIZ_SELECT' in out, f'revizije PHOTO_VIZ_CREATE/UPDATE/SELECT zapisane ({out.strip()[:120]})')
chk('V1HAS420=true' in out, 'v1 posnetek vsebuje staro dolžino 420 (brez tihega prepisa)')

# ══ F. Izvoz ═══════════════════════════════════════════════════════════════
print('── F. izvoz ──')
s, d = callj('POST', f'/api/photo-visualization/{VIZ_A}/export', admin, {'format': 'png', 'rendered': RENDERED})
chk(s == 200 and d['data']['ok'], f'izvoz png 200 (dejansko {s})')
s, d = callj('POST', f'/api/photo-visualization/{VIZ_A}/export', admin, {'format': 'primerjava'})
chk(s == 200, f'izvoz primerjava 200 (dejansko {s})')
s, d = callj('POST', f'/api/photo-visualization/{VIZ_A}/export', admin, {'format': 'gif'})
chk(s == 400, f'napačen format 400 (dejansko {s})')
s, d = callj('POST', f'/api/photo-visualization/{VIZ_A}/export', admin, {'format': 'png', 'rendered': 'data:image/png;base64,xxx'})
chk(s == 400, f'napačen rendered prefix 400 (dejansko {s})')

# ══ G. PDF ═════════════════════════════════════════════════════════════════
print('── G. PDF dokument ──')
s, b, h = call('GET', f'/api/pdf/photoviz/{VIZ_A}', admin)
chk(s == 200 and h.get('content-type', '').startswith('application/pdf'), f'PDF 200 application/pdf (dejansko {s}, tip={h.get("content-type")})')
chk(b.startswith('%PDF'), 'PDF glava %PDF')
chk('/DCTDecode' in b, 'PDF vsebuje JPEG sliki (DCTDecode XObject)')
chk('VIZUALIZACIJA ZA PREDSTAVITEV' in b.replace('\\316\\215', 'Č'), 'PDF vsebuje žig §15')
chk('PREJ' in b and 'POTEM' in b, 'PDF vsebuje PREJ/POTEM oznaki')
s, b, _ = call('GET', '/api/pdf/photoviz/ne-obstaja', admin)
chk(s == 404, f'PDF neznan id 404 (dejansko {s})')
s, b, _ = call('GET', '/api/pdf/xyz/x', admin)
chk(s == 400, f'PDF neznan tip 400 (dejansko {s})')
# PDF brez rendered → besedilni fallback (varianta C brez izvoza)
s, b, _ = call('GET', f'/api/pdf/photoviz/{VIZ_C}', admin)
chk(s == 200 and '%PDF' in b, 'PDF brez POTEM sličice še vedno velja (fallback besedilo)')

# ══ H. Seznam/detail oblike ════════════════════════════════════════════════
print('── H. seznam/detail ──')
s, d = callj('GET', '/api/photo-visualization', admin)
chk(s == 200 and any(r['id'] == VIZ_A for r in d['data']), 'globalni seznam vsebuje testne vizualizacije')
row = next(r for r in d['data'] if r['id'] == VIZ_A)
chk('sourcePhoto' not in row, 'seznam NE vrača bloba fotografije (privatnost/velikost)')
chk(row['product']['sku'] == 'OGR-K-002', 'seznam nosi produkt s SKU')
chk(row['variant']['ral'] == 'RAL 7016', 'seznam nosi RAL variante')
chk(row['_count']['versions'] == 2, 'števec verzij = 2')
s, d = callj('GET', f'/api/photo-visualization/{VIZ_A}', admin)
chk(d['data']['measurementVersion'] is None or isinstance(d['data']['measurementVersion'], int), 'measurementVersion prisoten')
chk(d['data']['engineVersion'] == '1.0.0', 'engineVersion zapisan')

# ══ I. Regresija ═══════════════════════════════════════════════════════════
print('── I. regresija ──')
s, _ = callj('GET', '/api/measurements', admin); chk(s == 200, f'measurements 200 (dejansko {s})')
s, _ = callj('GET', '/api/products?family=all', admin); chk(s == 200, f'products 200 (dejansko {s})')
s, _ = callj('GET', '/api/projects', admin); chk(s == 200, f'projects 200 (dejansko {s})')
s, _ = callj('GET', '/api/photo-visualization?projectId=' + tuji['id'], admin); chk(s == 200, f'seznam po projektu 200 (dejansko {s})')
s, _, _ = call('GET', '/api/pdf/quote/ne-obstaja', admin); chk(s == 404, f'quote PDF 404 ostaja (dejansko {s})')

# ══ J. Čiščenje ════════════════════════════════════════════════════════════
print('── J. čiščenje ──')
done, err = bun(CLEAN)
chk(done, f'čiščenje po testu {"" if done else " — " + err}')
r = subprocess.run(['bun', '-e', f'''
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
(async()=>{{
  const n=await p.photoVisualization.count();
  const m=await p.measurement.count({{where:{{note:'{TAG}'}}}});
  const u=await p.user.count({{where:{{email:'monter2-r459@roksal.si'}}}});
  const pr=await p.project.count({{where:{{title:{{contains:'{TAG}'}}}}}});
  console.log('N='+n+' M='+m+' U='+u+' P='+pr);return p.$disconnect();
}})()
'''], capture_output=True, text=True, env={**os.environ, 'DATABASE_URL': os.environ.get('TEST_DB_URL') or 'postgresql://roksal:roksal@localhost:54329/roksal'})
out = r.stdout.strip()
chk('N=0' in out and 'M=0' in out and 'U=0' in out and 'P=0' in out, f'ni ostankov ({out})')

print()
print(f'══ R459: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL else 0)
