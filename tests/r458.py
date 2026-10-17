#!/usr/bin/env python3
"""tests/r458.py — R458 SCRIPT-FIRST FIELD WORKFLOW (issue #13)

Preverja:
  A) RBAC (fail-closed): brez žetona 401; skladišče (brez nalog.*) 403;
     proizvodnja (nalog.read, readsAllData) 200; monter 200.
  B) Definicije (§14): 5 vgrajenih playbookov (OGRAJA/KERAMIKA/STREHA/FASADA/
     MONTAZA), vsi ACTIVE v1 s koraki; filter ?key.
  C) Deterministični tok OGRAJA (§1/§2/§3/§6/§10): zagon idempotenten, ZACNI,
     ZAKLJUCI z dokazili, NEVELJAVNA dokazila → 400 + napake, izjema LE z
     razlogom, pogojne veje (§5: je-stopnisce DA/NE, je-kot NE), validacijska
     pravila (referenca ≥ 20, stopnice ≥ 2, stebri ≥ 2), zaključek + handoff
     KONFIGURATOR (§11), akcija po zaključku 409, PONOVNO odpere zagon (§16).
  D) Obseg (fail-closed): tuj monter 403 na tuji zagon; lastnik 200; admin 200.
  E) Revizija (audit): PLAYBOOK_RUN_START, STEP_COMPLETE, STEP_EXCEPTION,
     STEP_RETRY, RUN_COMPLETE, HANDOFF.
  F) Admin upravljanje (§15): monter 403 na POST/PATCH; admin nova verzija
     FASADA → v2 ACTIVE, v1 RETIRED; nov zagon dobi v2 (§14 snapshot);
     napačen status 400.
  G) Sync offline (§13): op 'playbook-step' izvede ISTO logiko (ZACNI +
     ZAKLJUCI prek /api/sync), napačna akcija/manjkajoči stepId → ERROR.
  H) Regresija: /api/nalog, /api/projects, /api/playbook/runs?workOrderId.
  I) Idempotentno čiščenje vseh testnih zapisov.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R458-TEST'
PASS, FAIL = 0, 0

def call (method, path, token=None, body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode('utf-8', 'replace'), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace'), dict(e.headers)
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
    out = r.stdout.strip()
    return out, r.stderr[:300]

def act (token, run_id, step_id, akcija, evidence=None, razlog=None):
    body = {'stepId': step_id, 'akcija': akcija}
    if evidence is not None: body['evidence'] = evidence
    if razlog is not None: body['razlog'] = razlog
    return callj('POST', f'/api/playbook/runs/{run_id}/action', token, body)

# ─── priprava: testni nalog (assignee = monter) + drugi monter ───────────────
PREP = f'''
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
(async()=>{{
  // počisti ostanke prejšnjih poskusov
  const stari=await p.workOrder.findMany({{where:{{title:{{contains:'{TAG}'}}}},select:{{id:true}}}});
  for(const w of stari){{
    const runs=await p.playbookRun.findMany({{where:{{workOrderId:w.id}},select:{{id:true}}}});
    for(const r of runs){{await p.playbookStepRun.deleteMany({{where:{{runId:r.id}}}});await p.playbookRun.delete({{where:{{id:r.id}}}});}}
    await p.workOrderEvent.deleteMany({{where:{{workOrderId:w.id}}}});
    await p.workOrder.delete({{where:{{id:w.id}}}});
  }}
  // R542: context je jsonb — podniz po serializiranem jsonb (ista semantika contains)
  await p.$executeRawUnsafe('DELETE FROM "PlaybookRun" WHERE "context"::text LIKE $1', '%{TAG}%');
  await p.user.deleteMany({{where:{{email:'monter2-{TAG.lower()}@roksal.si'}}}});
  const monter=await p.user.findUnique({{where:{{email:'monter@roksal.si'}}}});
  const crypto=require('crypto');
  const salt=crypto.randomBytes(16).toString('hex');
  const hash=crypto.scryptSync('Monter123!',salt,64).toString('hex');
  const m2=await p.user.create({{data:{{email:'monter2-{TAG.lower()}@roksal.si',passwordHash:salt+':'+hash,name:'Monter Dva (test)',role:'MONTER'}}}});
  const projekt=await p.project.findFirst({{select:{{id:true}}}});
  const wo=await p.workOrder.create({{data:{{code:'N-TEST-458',title:'{TAG} — vodeni postopek',status:'NAPROGRAMIRAN',assigneeId:monter.id,projectId:projekt?.id??null}}}});
  console.log(JSON.stringify({{woId:wo.id,monterId:monter.id,m2Id:m2.id}}));
  return p.$disconnect();
}})()
'''
print('── priprava: testni nalog + drugi monter ──')
out, err = bun(PREP)
chk(out.startswith('{'), f'priprava baze {"" if out.startswith("{") else " — " + err}')
PREP_DATA = json.loads(out) if out.startswith('{') else {}
WO_ID = PREP_DATA.get('woId', '')
MONTER_ID = PREP_DATA.get('monterId', '')

admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')
proizvodnja = login('proizvodnja@roksal.si', 'Proizvodnja123!')
monter2 = login(f'monter2-{TAG.lower()}@roksal.si', 'Monter123!')
ok('prijava 5 vlog (admin/monter/skladišče/proizvodnja/monter2)')

# ══ A. RBAC ══════════════════════════════════════════════════════════════════
print('── A. RBAC (fail-closed) ──')
s, _ = callj('GET', '/api/playbook/defs')
chk(s == 401, 'brez žetona → 401 na /api/playbook/defs')
s, _ = callj('GET', '/api/playbook/runs')
chk(s == 401, 'brez žetona → 401 na /api/playbook/runs')
s, _ = callj('GET', '/api/playbook/defs', skladisce)
chk(s == 403, 'skladišče (brez nalog.*) → 403 na defs')
s, _ = callj('GET', '/api/playbook/runs', skladisce)
chk(s == 403, 'skladišče → 403 na runs')
s, _ = callj('GET', '/api/playbook/defs', proizvodnja)
chk(s == 200, 'proizvodnja (nalog.read) → 200 na defs')
s, _ = callj('GET', '/api/playbook/defs', monter)
chk(s == 200, 'monter → 200 na defs')

# ══ B. Definicije (§14) ══════════════════════════════════════════════════════
print('── B. Definicije (5 vgrajenih, v1 ACTIVE) ──')
defs = jget('/api/playbook/defs', monter)
data = (defs or {}).get('data', [])
keys = sorted(d['key'] for d in data)
chk(keys == ['FASADA', 'KERAMIKA', 'MONTAZA', 'OGRAJA', 'STREHA'], f'5 playbookov: {keys}')
chk(all(d['version'] == 1 and d['status'] == 'ACTIVE' for d in data), 'vsi v1 ACTIVE')
chk(all(d['korakov'] > 0 for d in data), 'vsi imajo korake')
ograja = next((d for d in data if d['key'] == 'OGRAJA'), None)
chk(ograja and ograja['korakov'] >= 15, f"OGRAJA ima {ograja['korakov'] if ograja else 0} korakov (≥ 15)")
ed = jget('/api/playbook/defs?key=OGRAJA', monter)
chk(len((ed or {}).get('data', [])) == 1, 'filter ?key=OGRAJA → 1 definicija')

# ══ C. Deterministični tok OGRAJA ═══════════════════════════════════════════
print('── C. OGRAJA: zagon → koraki → zaključek + handoff ──')
s, d = callj('POST', '/api/playbook/runs', monter, {'workOrderId': WO_ID, 'key': 'OGRAJA'})
chk(s == 201 and d['data']['nov'] is True, 'zagon OGRAJA → 201 nov')
RUN_ID = d['data']['runId']
s, d = callj('POST', '/api/playbook/runs', monter, {'workOrderId': WO_ID, 'key': 'OGRAJA'})
chk(s == 200 and d['data']['nov'] is False and d['data']['runId'] == RUN_ID,
    'idempotenca: ponovni POST → isti runId, nov=false')

st = jget(f'/api/playbook/runs/{RUN_ID}', monter)['data']
chk(st['run']['status'] == 'V_TEKU', 'zagon V_TEKU')
chk(st['naslednji'] == 'prihod', f"prvi naslednji korak = prihod ({st['naslednji']})")
chk(st['napredek']['koncanih'] == 0 and st['napredek']['skupaj'] >= 15, 'napredek 0/N')
chk(st['run']['playbookVersion'] == 1, 'zagon vezan na verzijo v1 (§14 snapshot)')

# ZACNI + ZAKLJUCI prihod (LOKACIJA)
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'prihod', 'akcija': 'ZACNI'})
chk(s == 200 and d['data']['koraki'][0]['status'] == 'IN_PROGRESS', 'ZACNI prihod → IN_PROGRESS')
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'prihod', 'akcija': 'ZAKLJUCI', 'evidence': {'lokacija': {'naslov': 'Testna 1, Ljubljana'}}})
chk(s == 200 and d['data']['naslednji'] == 'pregled', 'ZAKLJUCI prihod (lokacija) → naslednji pregled')
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'pregled', 'akcija': 'ZAKLJUCI', 'evidence': {'besedilo': 'Terasa, ravna, brez ovir.'}})
chk(s == 200 and d['data']['naslednji'] == 'foto-objekt', 'ZAKLJUCI pregled → naslednji foto-objekt')

# §10: FOTO brez dokazila → 400
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'foto-objekt', 'akcija': 'ZAKLJUCI', 'evidence': {}})
chk(s == 400 and 'fotografij' in json.dumps(d).lower(), 'FOTO brez dokazila → 400 z napako')
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'foto-objekt', 'akcija': 'ZAKLJUCI', 'evidence': {'fotoId': 'foto-test-1'}})
chk(s == 200 and d['data']['naslednji'] == 'foto-kakovost', 'FOTO z id → naslednji foto-kakovost')

# CHECKLIST delna → 400
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'foto-kakovost', 'akcija': 'ZAKLJUCI',
              'evidence': {'tocke': [{'id': 'Ostrost v redu', 'odkljukano': True}]}})
chk(s == 400, 'CHECKLIST delna (1/3) → 400')
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'foto-kakovost', 'akcija': 'ZAKLJUCI',
              'evidence': {'tocke': [{'id': t, 'odkljukano': True} for t in
                                     ['Ostrost v redu', 'Svetlost v redu', 'Celi objekt v kadru']]}})
chk(s == 200 and d['data']['naslednji'] == 'foto-levi', 'CHECKLIST polna → naslednji foto-levi')

# §6: izjema BREZ/kratek razlog → 400
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'foto-levi', 'akcija': 'NI_PRIMERNO', 'razlog': 'xx'})
chk(s == 400 and 'razlog' in json.dumps(d).lower(), 'izjema s kratkim razlogom → 400')
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'foto-levi', 'akcija': 'NI_PRIMERNO',
              'razlog': 'Levi konec ob steni — dostop fizično nemogoč.'})
chk(s == 200 and d['data']['napredek']['izjem'] == 1, 'izjema z razlogom → 200, izjem=1')
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'foto-desni', 'akcija': 'ZAKLJUCI', 'evidence': {'fotoId': 'foto-test-2'}})
chk(s == 200 and d['data']['naslednji'] == 'referenca', 'foto-desni → naslednji referenca')

# validacija: referencaCm < 20 → 400
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'referenca', 'akcija': 'ZAKLJUCI',
              'evidence': {'besedilo': 'Merilni trak 50 cm', 'vrednosti': {'referencaCm': 10}}})
chk(s == 400 and '20' in json.dumps(d), 'referencaCm=10 → 400 (MIN 20)')
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'referenca', 'akcija': 'ZAKLJUCI',
              'evidence': {'besedilo': 'Merilni trak 50 cm', 'vrednosti': {'referencaCm': 50}}})
chk(s == 200 and d['data']['naslednji'] == 'je-stopnisce', 'referenca 50 → naslednji je-stopnisce')

# §5: pogojna veja DA
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'je-stopnisce', 'akcija': 'ZAKLJUCI', 'evidence': {'odgovor': True}})
chk(s == 200 and d['data']['naslednji'] == 'stopnisce', 'je-stopnisce DA → naslednji stopnisce (korak je V verigi)')
chk(d['data']['context']['odgovori'].get('je-stopnisce') is True, 'odgovor zapisan v kontekst (§5)')
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'stopnisce', 'akcija': 'ZAKLJUCI',
              'evidence': {'vrednosti': {'steviloStopnic': 1}}})
chk(s == 400, 'steviloStopnic=1 → 400 (MIN 2)')
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'stopnisce', 'akcija': 'ZAKLJUCI',
              'evidence': {'vrednosti': {'steviloStopnic': 14, 'vzponCm': 17, 'ceznostCm': 29}}})
chk(s == 200 and d['data']['naslednji'] == 'segmenti', 'stopnisce 14 → naslednji segmenti')

s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'segmenti', 'akcija': 'ZAKLJUCI', 'evidence': {'vrednosti': {'segmentov': 5, 'dolzinaCm': 700}}})
chk(s == 200 and d['data']['naslednji'] == 'visine', 'segmenti → naslednji visine')
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'visine', 'akcija': 'ZAKLJUCI', 'evidence': {'vrednosti': {'visinaCm': 110}}})
chk(s == 200 and d['data']['naslednji'] == 'je-kot', 'visine 110 → naslednji je-kot')

# §5: pogojna veja NE — koti IZPADAJO iz verige
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'je-kot', 'akcija': 'ZAKLJUCI', 'evidence': {'odgovor': False}})
chk(s == 200 and d['data']['naslednji'] == 'stebri', 'je-kot NE → naslednji stebri (koti IZVEN verige)')
chk(d['data']['napredek']['skupaj'] >= 15, 'veriga ostaja smiselna po krajšanju')

s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'stebri', 'akcija': 'ZAKLJUCI', 'evidence': {'vrednosti': {'stebrov': 8}}})
chk(s == 200 and d['data']['naslednji'] == 'pritrditev-odlocba', 'stebri 8 → naslednji pritrditev-odlocba')
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'pritrditev-odlocba', 'akcija': 'ZAKLJUCI', 'evidence': {'odgovor': 'CELNA'}})
chk(s == 200 and d['data']['naslednji'] == 'pritrditev', 'pritrditev CELNA → naslednji pritrditev')
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'pritrditev', 'akcija': 'ZAKLJUCI', 'evidence': {'vrednosti': {'odmikCm': 12}}})
chk(s == 200 and d['data']['naslednji'] == 'preverjanje', 'pritrditev → naslednji preverjanje')
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'preverjanje', 'akcija': 'ZAKLJUCI',
              'evidence': {'tocke': [{'id': t, 'odkljukano': True} for t in
                                     ['Vsi segmenti izmerjeni', 'Višine usklajene',
                                      'Pritrditev izmerjena', 'Referenca zabeležena']]}})
chk(s == 200 and d['data']['naslednji'] == 'potrditev', 'preverjanje → naslednji potrditev')

# §11: zaključek + handoff KONFIGURATOR
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'potrditev', 'akcija': 'ZAKLJUCI', 'evidence': {'measurementId': 'mer-test-1'}})
chk(s == 200 and d['data']['run']['status'] == 'ZAKLJUCEN', 'potrditev → zagon ZAKLJUCEN')
chk(d['data']['run']['completedAt'] is not None, 'completedAt zapisan')
chk(any(h['do'] == 'KONFIGURATOR' for h in d['data']['handoff']), 'handoff → KONFIGURATOR (§11)')
chk(d['data']['naslednji'] is None and d['data']['napredek']['odstotek'] == 100,
    'naslednji=null, napredek 100 %')

# akcija po zaključku → 409
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'prihod', 'akcija': 'ZACNI'})
chk(s == 409, 'akcija po zaključku → 409')

# §16: PONOVNO odpere zaključen zagon
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'preverjanje', 'akcija': 'PONOVNO'})
chk(s == 200 and d['data']['run']['status'] == 'V_TEKU' and d['data']['naslednji'] == 'preverjanje',
    'PONOVNO preverjanje → zagon spet V_TEKU (§16 recovery)')
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'preverjanje', 'akcija': 'ZAKLJUCI',
              'evidence': {'tocke': [{'id': t, 'odkljukano': True} for t in
                                     ['Vsi segmenti izmerjeni', 'Višine usklajene',
                                      'Pritrditev izmerjena', 'Referenca zabeležena']]}})
chk(s == 200 and d['data']['run']['status'] == 'ZAKLJUCEN',
    'ponovni ZAKLJUCI preverjanja → zagon se spet zaključi (vsi koraki končni)')
s, d = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter,
             {'stepId': 'potrditev', 'akcija': 'ZAKLJUCI', 'evidence': {'measurementId': 'mer-test-1'}})
chk(s == 409, 'akcija po ponovnem zaključku → 409')
stf = jget(f'/api/playbook/runs/{RUN_ID}', monter)['data']
chk(stf['run']['status'] == 'ZAKLJUCEN' and stf['naslednji'] is None,
    'GET potrjuje: zagon ZAKLJUCEN, naslednji=null')

# ══ D. Obseg (fail-closed) ══════════════════════════════════════════════════
print('── D. Obseg (fail-closed) ──')
s, _ = callj('GET', f'/api/playbook/runs/{RUN_ID}', monter2)
chk(s == 403, 'tuj monter → 403 na zagon')
s, _ = callj('POST', f'/api/playbook/runs/{RUN_ID}/action', monter2,
             {'stepId': 'prihod', 'akcija': 'ZACNI'})
chk(s == 403, 'tuj monter → 403 na akcijo')
s, _ = callj('GET', f'/api/playbook/runs/{RUN_ID}', monter)
chk(s == 200, 'lastnik → 200')
s, _ = callj('GET', f'/api/playbook/runs/{RUN_ID}', admin)
chk(s == 200, 'admin → 200 (readsAllData)')

# ══ E. Revizija (audit) ═════════════════════════════════════════════════════
print('── E. Revizija ──')
AUDIT_Q = f'''
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
(async()=>{{
  const acts=await p.auditLog.findMany({{where:{{entityId:'{RUN_ID}'}},select:{{action:true}}}});
  const a=[...new Set(acts.map(x=>x.action))];
  console.log(JSON.stringify(a));
  return p.$disconnect();
}})()
'''
out, err = bun(AUDIT_Q)
try: dejane = json.loads(out)
except Exception: dejane = []
for pricakana in ['PLAYBOOK_RUN_START', 'PLAYBOOK_STEP_COMPLETE', 'PLAYBOOK_STEP_EXCEPTION',
                  'PLAYBOOK_STEP_RETRY', 'PLAYBOOK_RUN_COMPLETE', 'PLAYBOOK_HANDOFF']:
    chk(pricakana in dejane, f'revizija {pricakana} zapisana')

# ══ F. Admin upravljanje (§15) ══════════════════════════════════════════════
print('── F. Admin upravljanje (§15 verzije) ──')
NOVA_DEF = {
    'key': 'FASADA', 'naziv': 'Fasada — testna v2', 'opis': 'Testna nova verzija',
    'scenarij': 'test', 'version': 1,
    'steps': [
        {'id': 'objekt', 'naziv': 'Pregled', 'navodilo': 'x', 'kje': 'x', 'rezultat': 'x',
         'kategorija': 'PRIHOD', 'offline': True,
         'evidence': [{'vrsta': 'LOKACIJA', 'obvezno': True, 'opis': 'lokacija'}]},
        {'id': 'stranice', 'naziv': 'Stranice', 'navodilo': 'x', 'kje': 'x', 'rezultat': 'x',
         'kategorija': 'MERITEV', 'offline': True,
         'evidence': [{'vrsta': 'MERITEV', 'obvezno': True, 'opis': 'stranice'}]},
        {'id': 'potrditev', 'naziv': 'Potrditev', 'navodilo': 'x', 'kje': 'x', 'rezultat': 'x',
         'kategorija': 'AKCIJA', 'offline': True,
         'evidence': [{'vrsta': 'MERITEV', 'obvezno': True, 'opis': 'meritev'}],
         'handoff': {'do': 'KONFIGURATOR', 'opis': 'test'}},
    ],
}
s, _ = callj('POST', '/api/playbook/defs', monter, {'key': 'FASADA', 'def': NOVA_DEF})
chk(s == 403, 'monter → 403 na POST defs (samo ADMIN/VODJA)')
s, _ = callj('POST', '/api/playbook/defs', admin, {'key': 'FASADA', 'def': NOVA_DEF})
chk(s == 201, f'admin nova verzija FASADA → 201 ({s})')
s, _ = callj('PATCH', '/api/playbook/defs', admin, {'id': 'krivo', 'status': 'CEVRSTNO'})
chk(s == 400, 'PATCH z napačnim statusom → 400')
s, _ = callj('PATCH', '/api/playbook/defs', monter, {'id': 'krivo', 'status': 'ACTIVE'})
chk(s == 403, 'monter → 403 na PATCH defs')
fd = jget('/api/playbook/defs?vse=1&key=FASADA', admin)['data']
chk(len(fd) == 2, f'FASADA ima 2 verziji ({len(fd)})')
chk(any(v['version'] == 2 and v['status'] == 'ACTIVE' for v in fd), 'v2 ACTIVE')
chk(any(v['version'] == 1 and v['status'] == 'RETIRED' for v in fd), 'v1 RETIRED')

# nov zagon dobi v2 (§14 — nove zagone poveže najnovejša ACTIVE)
s, d = callj('POST', '/api/playbook/runs', monter, {'workOrderId': WO_ID, 'key': 'FASADA'})
chk(s == 201, 'zagon FASADA (v2) → 201')
RUN2 = d['data']['runId']
st2 = jget(f'/api/playbook/runs/{RUN2}', monter)['data']
chk(st2['run']['playbookVersion'] == 2 and st2['napredek']['skupaj'] == 3,
    'nov zagon vezan na v2 s 3 koraki')

# ══ G. Sync offline (§13) ═══════════════════════════════════════════════════
print('── G. Sync offline (playbook-step) ──')
s, d = callj('POST', '/api/sync', monter, {
    'deviceId': f'{TAG}-dev1',
    'ops': [{'opId': f'{TAG}-op1', 'kind': 'playbook-step', 'clientTs': 1,
             'payload': {'runId': RUN2, 'stepId': 'objekt', 'akcija': 'ZACNI'}}],
})
chk(s == 200 and d['data']['results'][0]['status'] == 'OK', 'sync ZACNI objekt → OK')
s, d = callj('POST', '/api/sync', monter, {
    'deviceId': f'{TAG}-dev1',
    'ops': [{'opId': f'{TAG}-op2', 'kind': 'playbook-step', 'clientTs': 2,
             'payload': {'runId': RUN2, 'stepId': 'objekt', 'akcija': 'ZAKLJUCI',
                         'evidence': {'lokacija': {'naslov': 'Sync 1'}}}}],
})
chk(s == 200 and d['data']['results'][0]['status'] == 'OK', 'sync ZAKLJUCI objekt → OK')
st2 = jget(f'/api/playbook/runs/{RUN2}', monter)['data']
chk(st2['naslednji'] == 'stranice' and st2['koraki'][0]['status'] == 'COMPLETED',
    'stanje po sync napredovalo (ista logika kot REST)')
s, d = callj('POST', '/api/sync', monter, {
    'deviceId': f'{TAG}-dev1',
    'ops': [{'opId': f'{TAG}-op3', 'kind': 'playbook-step', 'clientTs': 3,
             'payload': {'runId': RUN2, 'stepId': 'stranice', 'akcija': 'NAPACNO'}}],
})
chk(s == 200 and d['data']['results'][0]['status'] == 'ERROR', 'sync napačna akcija → ERROR')
s, d = callj('POST', '/api/sync', monter, {
    'deviceId': f'{TAG}-dev1',
    'ops': [{'opId': f'{TAG}-op4', 'kind': 'playbook-step', 'clientTs': 4,
             'payload': {'runId': RUN2, 'akcija': 'ZACNI'}}],
})
chk(s == 200 and d['data']['results'][0]['status'] == 'ERROR', 'sync brez stepId → ERROR')

# ══ H. Regresija ════════════════════════════════════════════════════════════
print('── H. Regresija ──')
s, _ = callj('GET', '/api/nalog?scope=open', monter)
chk(s == 200, '/api/nalog?scope=open → 200')
s, _ = callj('GET', '/api/projects', admin)
chk(s == 200, '/api/projects → 200')
runs_wo = jget(f'/api/playbook/runs?workOrderId={WO_ID}', monter)
sez = (runs_wo or {}).get('data', [])
chk(len(sez) == 2 and all(r['napredek'] for r in sez),
    f'runs?workOrderId → {len(sez)} zagona z napredkom (Danes strip)')
moji = jget('/api/playbook/runs', monter)['data']
chk(any(r['id'] == RUN_ID for r in moji), 'GET runs (brez filtra) vsebuje zagon')

# ══ I. Čiščenje ═════════════════════════════════════════════════════════════
print('── I. Čiščenje ──')
CLEAN = f'''
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
(async()=>{{
  for(const rid of ['{RUN_ID}','{RUN2}']){{
    if(!rid) continue;
    await p.playbookStepRun.deleteMany({{where:{{runId:rid}}}});
    await p.playbookRun.deleteMany({{where:{{id:rid}}}});
  }}
  await p.playbookDef.deleteMany({{where:{{key:'FASADA',version:2}}}});
  await p.playbookDef.updateMany({{where:{{key:'FASADA',version:1}},data:{{status:'ACTIVE'}}}});
  await p.auditLog.deleteMany({{where:{{entityId:{{in:['{RUN_ID}','{RUN2}']}}}}}});
  // R542: detail je jsonb — podniz po serializiranem jsonb (ista semantika contains)
  await p.$executeRawUnsafe('DELETE FROM "AuditLog" WHERE "detail"::text LIKE $1', '%{TAG}%');
  await p.syncOp.deleteMany({{where:{{id:{{contains:'{TAG}'}}}}}});
  const stari=await p.workOrder.findMany({{where:{{title:{{contains:'{TAG}'}}}},select:{{id:true}}}});
  for(const w of stari){{
    await p.workOrderEvent.deleteMany({{where:{{workOrderId:w.id}}}});
    await p.workOrder.delete({{where:{{id:w.id}}}});
  }}
  await p.user.deleteMany({{where:{{email:'monter2-{TAG.lower()}@roksal.si'}}}});
  console.log('CLEAN_DONE');
  return p.$disconnect();
}})()
'''
out, err = bun(CLEAN)
chk('CLEAN_DONE' in out, f'čiščenje testnih zapisov {"" if "CLEAN_DONE" in out else " — " + err}')
defs_final = jget('/api/playbook/defs', admin)['data']
chk(all(d['version'] == 1 and d['status'] == 'ACTIVE' for d in defs_final) and len(defs_final) == 5,
    'stanje definicij povrjeno (5 × v1 ACTIVE)')

# ══ povzetek ═════════════════════════════════════════════════════════════════
print(f'\n══ R458: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL else 0)
