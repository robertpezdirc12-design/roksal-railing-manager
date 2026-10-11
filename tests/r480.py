#!/usr/bin/env python3
"""tests/r480.py — R480 (issue #9 §10): JAVNI VIZUALIZATOR — VizLink + javni
viz + STRANKIN IZBOR (append-only) + lead-capture

Preverja:
  A) RBAC (fail-closed):
     - vse interne poti brez žetona 401 (viz-link GET/POST/DELETE, viz-choices);
     - monter (brez portal.manage) 403 na ustvarjanje/seznam/preklic povezave;
     - skladišče (brez portal.manage) 403 na ustvarjanje povezave;
     - monter LAHKO bere viz-choices (projects.read + nalog na P4);
     - monter brez nalog (tuji projekt P3) 403 (IDOR).
  B) ČIST LIB viz-core (bun — 0 strežniških uvozov):
     - parseVizRequestType (PONUDBA|OGLED|IZMERA; smeti → null);
     - vizConfigSummary (samo javni del renderParams — config; quad/reference NE);
     - publicVizVisualization (note/renderParams/avtor ODSOTNI; sliki samo ob
       photosAllowed; BREZ cen);
     - choiceSummary (javni povzetek — brez kontakta/leadId);
     - validVizChoiceInput (consentAccepted obvezen; note ≤ 500; kontakti ≤ meje);
     - consentStatus re-izvoz iz pin-core (NE podvojen).
  C) VIZ-LINK življenjski cikel:
     - ustvari 201 (žeton pv-, url /v/<token>, rok 14 dni; days=91 → varno na
       privzeto; days=7 → 7 dni); revizija VIZLINK_CREATE;
     - GET seznam (+ active, viewCount); javni GET 200 šteje ogled (viewCount 2);
     - preklic → javni dostop 404 (idempotentno); revizija VIZLINK_REVOKE;
     - potekel rok (backdate) → 404; smeten/kratki/manjkajoči žeton → 404;
     - tempomat javni GET 429 po 60/min.
  D) JAVNI VIZ varni podskup (/api/public/viz?token=):
     - project {code,title,customerName}; varianti A+B (ARHIV umaknjena);
     - variantLabel prisoten; interni note ODSOTEN; renderParams/quad ODSOTNA;
       cene ODSOTNE (costPrice/salePrice/margin); avtor ODSOTEN; status
       (IZBRANA) ODSOTEN; chosen null (pred izbiro);
     - consent MANJKA → photosBlocked MANJKA_SOGLASJE + sliki null (meta ostane);
       SET → slike VIDNE; potek (backdate) → SOGLASJE_POTEKLO.
  E) JAVNA IZBIRA (/api/public/viz-choice?token=):
     - brez consentAccepted → 400 (tudi false);
     - z → 201 + chosenAt + chosenVia VIZUALIZATOR + revizija VIZ_CHOICE_CREATE
       (brez kontakta v audit detail);
     - javni GET po izbiri nosi chosen (zadnji izbor);
     - append-only: druga izbira = DRUGA vrstica ( zgodovina); NI PATCH/DELETE
       rut (405 na obeh);
     - s kontaktom → LEAD ustvarjen (source VIZUALIZATOR, status NOV) +
       choice.leadId vezan;
     - napačen visualizationId → 404; tuja vizualizacija (P3) → 400; ARHIV → 400;
       note > 500 → 400; requestType smeti → 400; variantLabel neujemanje → 400;
     - tempomat 10/min (ločen ključ od GET) → 429 po 10.
  F) ZGODOVINA ZA PISARNO (/api/projects/[id]/viz-choices):
     - izbire z kontakti + lead povezavo + visualization variantLabel/product;
     - monter (nalog) 200; IDOR tuj projekt 403;
     - LEAD viden v /api/crm (crm.read) z virom VIZUALIZATOR.
  G) Idempotentno čiščenje vseh testnih zapisov (direktno prek Prisma).
"""
import base64, json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R480-TEST'
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

def audit_detail (token, action, entity_id, project_id):
    for e in audit_rows(token, project_id):
        if e.get('action') == action and e.get('entityId') == entity_id:
            try: return json.loads(e.get('detail') or '{}')
            except Exception: return {}
    return None

# ── priprava ────────────────────────────────────────────────────────────────
admin = login('admin@roksal.si', 'Admin123!')
vodja = login('vodja@roksal.si', 'Vodja123!')
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')
proizvodnja = login('proizvodnja@roksal.si', 'Proizvodnja123!')

s, d = callj('GET', '/api/projects', admin)
PROJ = {p['code']: p['id'] for p in d.get('data', [])}
P4 = PROJ.get('P-2026-004')   # ZAKLJUCEN, monter ima nalog N-2026-006
P3 = PROJ.get('P-2026-003')   # monter BREZ naloga (IDOR negativ)
chk(bool(P4 and P3), 'projekta za test najdena (P4 + P3 brez monterjevega naloga)')

PHOTO = lambda tag: 'data:image/jpeg;base64,' + base64.b64encode(tag.encode()).decode()
RENDER_PARAMS = json.dumps({
    'quad': [{'x': 0.1, 'y': 0.8}, {'x': 0.9, 'y': 0.8}, {'x': 0.9, 'y': 0.3}, {'x': 0.1, 'y': 0.3}],
    'reference': {'tip': 'ROCNO', 'cm': 400},
    'config': {'tip': 'POKOCNA', 'lengthCm': 400, 'heightCm': 110, 'posts': 5,
               'handrail': True, 'lamelaMm': 70, 'rezaMm': 20, 'deskaMm': 120,
               'pritrditev': 'TALNA', 'vijaki': True},
})

# tri variante na P4 (A, B OSNUTEK; C ARHIV — umaknjena iz javnega seznama)
# + ena tuja vizualizacija na P3 (IDOR/preklicni 400 test); note = INTERNI (NE sme ven)
SETUP = r'''
const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const proj = await p.project.findFirst({where:{id:'__P4__'}});
  const tuj = await p.project.findFirst({where:{id:'__P3__'}});
  const prod = await p.product.findFirst({where:{active:true}, include:{variants:{take:1}}});
  const prej = (l) => '__PREJ__' + l;
  const potem = (l) => '__POTEM__' + l;
  const mk = (pid, label, status) => p.photoVisualization.create({data:{
    projectId: pid, variantLabel: label, status,
    sourcePhoto: prej(label), productId: prod.id, variantId: prod.variants[0]?.id ?? null,
    engineVersion: '1.0.0', renderParams: JSON.stringify(__RENDER_PARAMS__),
    rendered: potem(label), note: 'INTERNI-NOTE-__TAG__-' + label,
  }});
  const a = await mk(proj.id, 'A', 'OSNUTEK');
  const b = await mk(proj.id, 'B', 'OSNUTEK');
  const c = await mk(proj.id, 'C', 'ARHIV');
  const t = await mk(tuj.id, 'A', 'OSNUTEK');
  console.log('VIZ=' + JSON.stringify({A:a.id, B:b.id, C:c.id, T:t.id}));
  return p.$disconnect();
})()
'''.replace('__P4__', P4).replace('__P3__', P3).replace('__TAG__', TAG) \
     .replace('__RENDER_PARAMS__', RENDER_PARAMS) \
     .replace('__PREJ__', PHOTO('PREJ-')).replace('__POTEM__', PHOTO('POTEM-'))

out, err = bun_ts(SETUP)
line = next((l for l in out.splitlines() if l.startswith('VIZ=')), '')
chk(bool(line), f'3 variante na P4 + 1 tuja na P3 ustvarjene (err {err[:150]})')
VIZ = json.loads(line[4:]) if line else {}
VIZ_A, VIZ_B, VIZ_C, VIZ_T = VIZ.get('A', ''), VIZ.get('B', ''), VIZ.get('C', ''), VIZ.get('T', '')

# ══ A. RBAC (fail-closed) ═══════════════════════════════════════════════════
print('── A. RBAC ──')
for method, path in [
    ('GET', f'/api/projects/{P4}/viz-link'),
    ('POST', f'/api/projects/{P4}/viz-link'),
    ('DELETE', f'/api/projects/{P4}/viz-link?id=xyz'),
    ('GET', f'/api/projects/{P4}/viz-choices'),
]:
    s, _, _ = call(method, path)
    chk(s == 401, f'{method} {path.split("?")[0]} brez žetona 401 (dejansko {s})')

s, _, _ = call('POST', f'/api/projects/{P4}/viz-link', monter, {})
chk(s == 403, f'monter (brez portal.manage) 403 na ustvarjanje povezave (dejansko {s})')
s, _, _ = call('GET', f'/api/projects/{P4}/viz-link', monter)
chk(s == 403, f'monter 403 na seznam povezav (dejansko {s})')
s, _, _ = call('DELETE', f'/api/projects/{P4}/viz-link?id=xyz', monter)
chk(s == 403, f'monter 403 na preklic povezave (dejansko {s})')
s, _, _ = call('POST', f'/api/projects/{P4}/viz-link', skladisce, {})
chk(s == 403, f'skladišče (brez portal.manage) 403 na ustvarjanje povezave (dejansko {s})')

s, d = callj('GET', f'/api/projects/{P4}/viz-choices', monter)
chk(s == 200, f'monter LAHKO bere viz-choices (projects.read + nalog na P4; dejansko {s})')
s, _, _ = call('GET', f'/api/projects/{P3}/viz-choices', monter)
chk(s == 403, f'monter brez nalog na tujem projektu 403 (IDOR; dejansko {s})')
s, d = callj('GET', f'/api/projects/{P4}/viz-choices', proizvodnja)
chk(s == 200, f'proizvodnja bere vse (projects.read + readsAllData; dejansko {s})')
s, _, _ = call('GET', '/api/projects/neobstaja/viz-choices', admin)
chk(s == 404, 'viz-choices na neznani projekt 404')

# ══ B. ČIST LIB viz-core (bun) ══════════════════════════════════════════════
print('── B. viz-core (čist lib) ──')
CORE = r'''
const {
  parseVizRequestType, vizConfigSummary, publicVizVisualization, choiceSummary,
  validVizChoiceInput, consentStatus, VIZ_LINK_MAX_DAYS, VIZ_LINK_DEFAULT_DAYS,
  VIZ_TOKEN_PREFIX, VIZ_REQUEST_TYPES, VIZ_CHOICE_NOTE_MAX,
} = require('./src/lib/viz-core.ts');
(async () => {
  console.log('RT=' + JSON.stringify([
    parseVizRequestType('PONUDBA'), parseVizRequestType('OGLED'), parseVizRequestType('IZMERA'),
    parseVizRequestType('XYZ'), parseVizRequestType(null), parseVizRequestType(''),
  ]));
  const rp = JSON.stringify({
    quad: [{x:0.1,y:0.8},{x:0.9,y:0.8},{x:0.9,y:0.3},{x:0.1,y:0.3}],
    reference: {tip:'ROCNO', cm:400},
    config: {tip:'POKOCNA', lengthCm:400, heightCm:110, posts:5, handrail:true, lamelaMm:70, rezaMm:20, deskaMm:120, pritrditev:'TALNA', vijaki:true},
  });
  const cs = vizConfigSummary(rp);
  console.log('CS=' + JSON.stringify(cs));
  console.log('CS_KEYS=' + Object.keys(cs).sort().join(','));
  console.log('CSBAD=' + JSON.stringify([vizConfigSummary('smeti'), vizConfigSummary(null), vizConfigSummary('null'), vizConfigSummary('{"config":1}')]));
  const vizRow = {
    id: 'viz1', variantLabel: 'A', renderParams: rp,
    sourcePhoto: 'data:image/jpeg;base64,PREJ', rendered: 'data:image/jpeg;base64,POTEM',
    updatedAt: new Date('2026-10-11T08:00:00Z'),
    product: {sku: 'TER-WPC-001', name: 'WPC terasa'},
    variant: {sku: 'TER-GRA', name: 'Grafit', ral: 'RAL 7016'},
  };
  const pub = publicVizVisualization(vizRow, true);
  const blk = publicVizVisualization(vizRow, false);
  console.log('PUB=' + JSON.stringify(pub));
  console.log('PUB_KEYS=' + Object.keys(pub).sort().join(','));
  console.log('BLK=' + JSON.stringify([blk.sourcePhoto, blk.rendered, blk.variantLabel, blk.configSummary?.tip]));
  const ch = choiceSummary({
    id: 'ch1', variantLabel: 'B', chosenAt: new Date('2026-10-11T09:00:00Z'),
    chosenVia: 'VIZUALIZATOR', requestType: 'PONUDBA', note: 'naša izbira',
    consentAcceptedAt: new Date('2026-10-11T09:00:00Z'), createdAt: new Date('2026-10-11T09:00:01Z'),
  });
  console.log('CH=' + JSON.stringify(ch));
  console.log('CH_KEYS=' + Object.keys(ch).sort().join(','));
  console.log('VI1=' + JSON.stringify([
    validVizChoiceInput({visualizationId:'cmvizid12345678901234', variantLabel:'A', requestType:'PONUDBA', consentAccepted:true}).ok,
    validVizChoiceInput({visualizationId:'cmvizid12345678901234', variantLabel:'A', requestType:'PONUDBA', consentAccepted:false}).ok,
    validVizChoiceInput({visualizationId:'cmvizid12345678901234', variantLabel:'A', requestType:'PONUDBA'}).ok,
    validVizChoiceInput({visualizationId:'xyz', variantLabel:'A', requestType:'PONUDBA', consentAccepted:true}).ok,
    validVizChoiceInput({visualizationId:'cmvizid12345678901234', variantLabel:'X', requestType:'PONUDBA', consentAccepted:true}).ok,
    validVizChoiceInput({visualizationId:'cmvizid12345678901234', variantLabel:'A', requestType:'XYZ', consentAccepted:true}).ok,
    validVizChoiceInput({visualizationId:'cmvizid12345678901234', variantLabel:'A', requestType:'PONUDBA', consentAccepted:true, note:'x'.repeat(501)}).ok,
    validVizChoiceInput({visualizationId:'cmvizid12345678901234', variantLabel:'A', requestType:'PONUDBA', consentAccepted:true, contactName:'y'.repeat(201)}).ok,
  ]));
  const okIn = validVizChoiceInput({
    visualizationId:'cmvizid12345678901234', variantLabel:'B', requestType:'IZMERA',
    consentAccepted:true, note:'  opomba  ', contactName:' Ana ', contactPhone:'040 123 456',
  });
  console.log('VI2=' + JSON.stringify(okIn.ok ? [okIn.value.requestType, okIn.value.note, okIn.value.contactName, okIn.value.contactPhone, okIn.value.contactEmail] : ['FAIL']));
  console.log('CONST=' + JSON.stringify([VIZ_TOKEN_PREFIX, VIZ_LINK_MAX_DAYS, VIZ_LINK_DEFAULT_DAYS, VIZ_CHOICE_NOTE_MAX, VIZ_REQUEST_TYPES.join('|')]));
  console.log('CS2=' + consentStatus({photoConsentAt:new Date(), photoConsentExpiresAt:null}));
})()
'''
out, err = bun_ts(CORE)
chk('RT=["PONUDBA","OGLED","IZMERA",null,null,null]' in out, f'parseVizRequestType: 3 vrste veljavne, smeti null (dejansko {out.splitlines()[0] if out else err})')
cs_line = next((l for l in out.splitlines() if l.startswith('CS=')), '')
cs = json.loads(cs_line[3:]) if cs_line else {}
chk(cs.get('tip') == 'POKOCNA' and cs.get('lengthCm') == 400 and cs.get('heightCm') == 110 and cs.get('posts') == 5 and cs.get('pritrditev') == 'TALNA' and cs.get('lamelaMm') == 70,
    f'vizConfigSummary izlušči JAVNI config (dimenzije; dejansko {cs})')
csk = next((l for l in out.splitlines() if l.startswith('CS_KEYS=')), '')
chk(csk == 'CS_KEYS=deskaMm,handrail,heightCm,lamelaMm,lengthCm,posts,pritrditev,rezaMm,tip',
    f'vizConfigSummary SAMO javna polja — BREZ quad/reference (dejansko {csk})')
chk('CSBAD=[null,null,null,null]' in out, 'vizConfigSummary fail-closed na smeteh')
pub_raw = next((l for l in out.splitlines() if l.startswith('PUB=')), '')
pub = json.loads(pub_raw[4:]) if pub_raw else {}
chk(pub.get('sourcePhoto') == 'data:image/jpeg;base64,PREJ' and pub.get('rendered') == 'data:image/jpeg;base64,POTEM',
    'publicVizVisualization ob photosAllowed izda PREJ + POTEM')
chk(pub.get('product', {}).get('sku') == 'TER-WPC-001' and pub.get('variant', {}).get('ral') == 'RAL 7016', 'javna varianta nosi izdelek + varianto/RAL')
chk('BLK=[null,null,"A","POKOCNA"]' in out, 'publicVizVisualization brez soglasja: sliki null, meta OSTANE')
pk = next((l for l in out.splitlines() if l.startswith('PUB_KEYS=')), '')
chk(pk == 'PUB_KEYS=configSummary,id,product,rendered,sourcePhoto,updatedAt,variant,variantLabel',
    f'publicVizVisualization nosi SAMO varna polja — BREZ note/renderParams/avtorja/statusa (dejansko {pk})')
ch_raw = next((l for l in out.splitlines() if l.startswith('CH=')), '')
ch = json.loads(ch_raw[3:]) if ch_raw else {}
chk(ch.get('requestTypeLabel') == 'Zahtevam ponudbo' and ch.get('variantLabel') == 'B' and bool(ch.get('chosenAt')),
    f'choiceSummary javni povzetek izbora (dejansko {ch})')
hk = next((l for l in out.splitlines() if l.startswith('CH_KEYS=')), '')
chk(hk == 'CH_KEYS=chosenAt,chosenVia,consentAcceptedAt,createdAt,id,note,requestType,requestTypeLabel,variantLabel',
    f'choiceSummary BREZ kontakta/leadId (dejansko {hk})')
vi1 = next((l for l in out.splitlines() if l.startswith('VI1=')), '')
chk(vi1 == 'VI1=[true,false,false,false,false,false,false,false]', f'validVizChoiceInput: consentAccepted obvezen + fail-closed (dejansko {vi1})')
vi2 = next((l for l in out.splitlines() if l.startswith('VI2=')), '')
chk(vi2 == 'VI2=["IZMERA","opomba","Ana","040 123 456",null]', f'validVizChoiceInput očisti/trim-a vhod (dejansko {vi2})')
const_line = next((l for l in out.splitlines() if l.startswith('CONST=')), '')
chk('CONST=["pv-",90,14,500,"PONUDBA|OGLED|IZMERA"]' in out, f'konstante viz-core (dejansko {const_line})')
chk('CS2=VELJAVNO' in out, 'consentStatus re-izvožen iz pin-core (NE podvojen)')

# ══ C. VIZ-LINK življenjski cikel ═══════════════════════════════════════════
print('── C. viz-link življenjski cikel ──')
s, L1 = callj('POST', f'/api/projects/{P4}/viz-link', admin, {'note': TAG})
chk(s == 201, f'povezava ustvarjena 201 (dejansko {s}, {L1.get("error", "")})')
T1 = L1.get('data', {}).get('token', '')
LID1 = L1.get('data', {}).get('id', '')
chk(T1.startswith('pv-'), f'žeton ima predpono pv- ({T1[:6]}…)')
chk(L1.get('data', {}).get('url') == f'/v/{T1}', 'url kaže na javno stran vizualizatorja /v/<token>')
import datetime as _dt
exp = _dt.datetime.fromisoformat(L1.get('data', {}).get('expiresAt', '').replace('Z', '+00:00'))
days = (exp - _dt.datetime.now(_dt.timezone.utc)).total_seconds() / 86400
chk(13.9 <= days <= 14.1, f'privzeti rok 14 dni (dejansko {days:.2f})')
chk(L1.get('data', {}).get('note') == TAG, 'interna opomba povezave se vrne')
chk(audit_has(admin, 'VIZLINK_CREATE', LID1, P4), 'revizija VIZLINK_CREATE')
s, L91 = callj('POST', f'/api/projects/{P4}/viz-link', admin, {'days': 91, 'note': TAG})
chk(s == 201, 'days=91 (> max 90) ne podere — varno na privzeto (vzorec portal/review)')
exp91 = _dt.datetime.fromisoformat(L91.get('data', {}).get('expiresAt', '').replace('Z', '+00:00'))
days91 = (exp91 - _dt.datetime.now(_dt.timezone.utc)).total_seconds() / 86400
chk(13.9 <= days91 <= 14.1, f'days=91 → privzeti 14 dni (dejansko {days91:.2f})')
s, L7 = callj('POST', f'/api/projects/{P4}/viz-link', admin, {'days': 7, 'note': TAG})
exp7 = _dt.datetime.fromisoformat(L7.get('data', {}).get('expiresAt', '').replace('Z', '+00:00'))
days7 = (exp7 - _dt.datetime.now(_dt.timezone.utc)).total_seconds() / 86400
chk(6.9 <= days7 <= 7.1, f'rok 7 dni (dejansko {days7:.2f})')
s, _, _ = call('POST', f'/api/projects/{P4}/viz-link', vodja, {'note': TAG + '-vodja'})
chk(s == 201, 'vodja (portal.manage) lahko ustvari povezavo')
s, _, _ = call('POST', '/api/projects/neobstaja/viz-link', admin, {'note': TAG})
chk(s == 404, 'viz-link na neznan projekt 404')

s, d = callj('GET', f'/api/projects/{P4}/viz-link', admin)
lrow = next((l for l in d.get('data', []) if l.get('id') == LID1), {})
chk(lrow.get('viewCount') == 0 and lrow.get('active') is True and lrow.get('url') == f'/v/{T1}',
    'seznam povezav z veljavnostjo (viewCount 0 pred ogledom)')
chk(all(k in lrow for k in ('id', 'token', 'expiresAt', 'revokedAt', 'viewCount', 'note', 'createdAt')),
    'seznam nosi zahtevana polja (id/token/expiresAt/revokedAt/viewCount/note/createdAt)')

# javni GET šteje ogled
s, _, _ = call('GET', f'/api/public/viz?token={T1}')
chk(s == 200, f'anonimni javni GET 200 (dejansko {s})')
s, _, _ = call('GET', f'/api/public/viz?token={T1}')
s, d = callj('GET', f'/api/projects/{P4}/viz-link', admin)
lrow = next((l for l in d.get('data', []) if l.get('id') == LID1), {})
chk(lrow.get('viewCount') == 2, f'viewCount šteje oglede (dejansko {lrow.get("viewCount")})')
chk(lrow.get('lastViewAt') is not None, 'lastViewAt zabeležen')

# preklic → 404 + idempotenca
s, d = callj('DELETE', f'/api/projects/{P4}/viz-link?id={LID1}', admin)
chk(s == 200 and d.get('data', {}).get('revoked') is True, f'preklic povezave (dejansko {s})')
chk(audit_has(admin, 'VIZLINK_REVOKE', LID1, P4), 'revizija VIZLINK_REVOKE')
s, _, _ = call('GET', f'/api/public/viz?token={T1}')
chk(s == 404, f'preklicana povezava → javni dostop 404 (dejansko {s})')
s, d = callj('DELETE', f'/api/projects/{P4}/viz-link?id={LID1}', admin)
chk(s == 200, 'preklic je idempotenten')
s, _, _ = call('DELETE', f'/api/projects/{P4}/viz-link?id=neobstaja', admin)
chk(s == 404, 'preklic neznane povezave 404')
s, _, _ = call('DELETE', f'/api/projects/{P3}/viz-link?id={LID1}', admin)
chk(s == 404, 'preklic prek tujega projekta 404 (povezava ne pripada P3)')

# potekel rok povezave (backdate) → 404
expire_link = r'''
const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  await p.vizLink.updateMany({where:{note:{contains:'__TAG__'}, revokedAt:null}, data:{expiresAt:new Date(Date.now()-3600000)}});
  console.log('EXPIRED');return p.$disconnect();
})()
'''.replace('__TAG__', TAG)
out, err = bun_ts(expire_link)
chk('EXPIRED' in out, 'rok testnih povezav podtaknjen v preteklost')
T7 = L7.get('data', {}).get('token', '')
s, _, _ = call('GET', f'/api/public/viz?token={T7}')
chk(s == 404, f'potekla povezava → 404 (dejansko {s})')

# smeten/kratki/manjkajoči žeton
s, _, _ = call('GET', '/api/public/viz?token=kratk')
chk(s == 404, f'prekratki žeton 404 (dejansko {s})')
s, _, _ = call('GET', '/api/public/viz')
chk(s == 404, 'brez žetona 404 (javna pot ne razkrije ničesar)')
s, _, _ = call('GET', '/api/public/viz?token=' + 'x' * 100)
chk(s == 404, 'predolgi žeton 404')

# tempomat 60/min → 429 (svež žeton)
s, L9 = callj('POST', f'/api/projects/{P4}/viz-link', admin, {'note': TAG + '-temp'})
T9 = L9.get('data', {}).get('token', '')
saw429 = False
for _ in range(70):
    s, _, _ = call('GET', f'/api/public/viz?token={T9}')
    if s == 429:
        saw429 = True
        break
chk(saw429, 'tempomat 60/min na žeton → 429 po prekoračitvi')

# ══ D. JAVNI VIZ varni podskup ══════════════════════════════════════════════
print('── D. Javni viz varni podskup ──')
s, L2 = callj('POST', f'/api/projects/{P4}/viz-link', admin, {'note': TAG + '-d'})
T2 = L2.get('data', {}).get('token', '')
chk(s == 201 and T2.startswith('pv-'), 'sveža povezava za varni podskup')
s, body2, _ = call('GET', f'/api/public/viz?token={T2}')
chk(s == 200, f'anonimni GET javnega vizualizatorja 200 (dejansko {s})')
J = json.loads(body2.decode('utf-8', 'replace')).get('data', {})
chk(J.get('project', {}).get('code') == 'P-2026-004' and J.get('project', {}).get('title') and J.get('project', {}).get('customerName') == 'Janez Kovač',
    f'project SAMO code/title + customerName (dejansko {J.get("project")})')
variants = J.get('variants', [])
chk(sorted(v.get('variantLabel') for v in variants) == ['A', 'B'], f'varianti A+B na javnem seznamu; ARHIV umaknjena (dejansko {[v.get("variantLabel") for v in variants]})')
chk(all(v.get('product') and v.get('configSummary') for v in variants), 'vsaka varianta nosi izdelek + configSummary')
chk(J.get('chosen') is None, 'chosen null pred prvo izbiro')
chk(J.get('link', {}).get('expiresAt'), 'javni odgovor nosi rok povezave')
# varni podskup — ODSOTNOST internih podatkov (raw telo)
chk(b'INTERNI-NOTE' not in body2, 'INTERNI note pisarne ODSOTEN v javnem odgovoru')
chk(b'renderParams' not in body2 and b'quad' not in body2 and b'reference' not in body2, 'renderParams (quad/reference) ODSOTEN — samo javni configSummary')
chk(b'costPrice' not in body2 and b'salePrice' not in body2 and b'price' not in body2 and b'margin' not in body2, 'cene ODSOTNE (costPrice/salePrice/margin)')
chk(b'author' not in body2 and b'authorId' not in body2, 'avtor ODSOTEN v javnem odgovoru')
chk(b'IZBRANA' not in body2 and b'OSNUTEK' not in body2 and b'ARHIV' not in body2, 'interna statusa (OSNUTEK/IZBRANA/ARHIV) ODSOTNA')
chk(b'engineVersion' not in body2 and b'versions' not in body2, 'engineVersion/verzije ODSOTNI')
chk(b'@roksal.si' not in body2, 'brez e-pošte uporabnikov v javnem odgovoru')
# consent MANJKA → sliki null + photosBlocked
chk(J.get('consent') == 'MANJKA' and J.get('photosBlocked') == 'MANJKA_SOGLASJE',
    f'brez soglasja → photosBlocked MANJKA_SOGLASJE (dejansko {J.get("photosBlocked")})')
chk(all(v.get('sourcePhoto') is None and v.get('rendered') is None for v in variants),
    'brez soglasja: PREJ/POTEM sliki null (meta variante OSTANE)')
# soglasje SET → slike vidne
s, d = callj('POST', f'/api/projects/{P4}/consent', admin, {'action': 'SET', 'validDays': 30})
chk(s == 200 and d.get('data', {}).get('consent') == 'VELJAVNO', f'soglasje SET (pisarna; dejansko {s})')
s, body3, _ = call('GET', f'/api/public/viz?token={T2}')
J3 = json.loads(body3.decode('utf-8', 'replace')).get('data', {})
v3 = J3.get('variants', [])
chk(all(v.get('sourcePhoto', '').startswith('data:image/jpeg;base64,') and v.get('rendered', '').startswith('data:image/jpeg;base64,') for v in v3),
    f'z veljavnim soglasjem: PREJ + POTEM sliki VIDNI (dejansko {[bool(v.get("sourcePhoto")) for v in v3]})')
chk(J3.get('photosBlocked') is None and J3.get('consent') == 'VELJAVNO', 'z soglasjem photosBlocked null')
# potek soglasja (backdate) → spet blokirano
backdate = r'''
const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  await p.project.update({where:{id:'__P4__'},data:{photoConsentExpiresAt:new Date(Date.now()-86400000)}});
  console.log('BACKDATED');return p.$disconnect();
})()
'''.replace('__P4__', P4)
out, err = bun_ts(backdate)
chk('BACKDATED' in out, 'rok soglasja podtaknjen v preteklost')
s, body4, _ = call('GET', f'/api/public/viz?token={T2}')
J4 = json.loads(body4.decode('utf-8', 'replace')).get('data', {})
chk(J4.get('photosBlocked') == 'SOGLASJE_POTEKLO' and all(v.get('sourcePhoto') is None for v in J4.get('variants', [])),
    f'poteklo soglasje → slike spet zamaknjene (SOGLASJE_POTEKLO; dejansko {J4.get("photosBlocked")})')

# ══ E. JAVNA IZBIRA ═════════════════════════════════════════════════════════
print('── E. Javna izbira ──')
BASE_CHOICE = {'visualizationId': VIZ_A, 'variantLabel': 'A', 'requestType': 'PONUDBA', 'consentAccepted': True}
s, d = callj('POST', f'/api/public/viz-choice?token={T2}', None, {**BASE_CHOICE, 'consentAccepted': None})
chk(s == 400, f'izbira brez consentAccepted → 400 (dejansko {s})')
s, d = callj('POST', f'/api/public/viz-choice?token={T2}', None, {**BASE_CHOICE, 'consentAccepted': False})
chk(s == 400, 'izbira s consentAccepted=false → 400')

s, C1 = callj('POST', f'/api/public/viz-choice?token={T2}', None, {**BASE_CHOICE, 'note': f'Izbrali bi {TAG}'})
chk(s == 201, f'prva izbira 201 (dejansko {s}, {C1.get("error", "")})')
D1 = C1.get('data', {})
CID1 = D1.get('id', '')
chk(D1.get('variantLabel') == 'A' and D1.get('chosenVia') == 'VIZUALIZATOR' and D1.get('requestType') == 'PONUDBA', 'izbira nosi varianto + via + vrsto zahteve')
chk(bool(D1.get('chosenAt')) and bool(D1.get('consentAcceptedAt')), 'izbira nosi chosenAt + consentAcceptedAt')
chk(D1.get('requestTypeLabel') == 'Zahtevam ponudbo', 'izbira nosi slovensko oznako zahteve')
chk('contactName' not in D1 and 'leadId' not in D1, 'javni odgovor izbire BREZ kontakta/leadId')
chk(audit_has(admin, 'VIZ_CHOICE_CREATE', CID1, P4), 'revizija VIZ_CHOICE_CREATE')
adet = audit_detail(admin, 'VIZ_CHOICE_CREATE', CID1, P4) or {}
chk(adet.get('variantLabel') == 'A' and adet.get('requestType') == 'PONUDBA' and 'contactName' not in adet and 'contactEmail' not in adet,
    f'revizija nosi vrsto zahteve + varianto, BREZ kontakta (dejansko {adet})')

# javni GET po izbiri → chosen
s, body5, _ = call('GET', f'/api/public/viz?token={T2}')
J5 = json.loads(body5.decode('utf-8', 'replace')).get('data', {})
chk(J5.get('chosen', {}).get('variantLabel') == 'A' and J5.get('chosen', {}).get('id') == CID1, 'javni viz po izbiri nosi chosen (zadnji izbor)')

# append-only: druga izbira = DRUGA vrstica
s, C2 = callj('POST', f'/api/public/viz-choice?token={T2}', None,
              {'visualizationId': VIZ_B, 'variantLabel': 'B', 'requestType': 'OGLED', 'note': f'Popravek {TAG}', 'consentAccepted': True})
chk(s == 201, f'druga izbira 201 (append-only; dejansko {s})')
CID2 = C2.get('data', {}).get('id', '')
chk(CID2 != CID1, 'druga izbira = nova vrstica (drugi id)')
s, body6, _ = call('GET', f'/api/public/viz?token={T2}')
J6 = json.loads(body6.decode('utf-8', 'replace')).get('data', {})
chk(J6.get('chosen', {}).get('variantLabel') == 'B', 'chosen = ZADNJI izbor (B)')
# NI PATCH/DELETE rut na izborih (append-only dokaz)
s, _, _ = call('PATCH', f'/api/projects/{P4}/viz-choices', admin, {'id': CID1, 'note': 'prepis'})
chk(s == 405, f'NI PATCH rute na izborih (append-only; dejansko {s})')
s, _, _ = call('DELETE', f'/api/projects/{P4}/viz-choices', admin)
chk(s == 405, 'NI DELETE rute na izborih (append-only)')

# tretja izbira S KONTAKTOM → LEAD
s, C3 = callj('POST', f'/api/public/viz-choice?token={T2}', None,
              {'visualizationId': VIZ_A, 'variantLabel': 'A', 'requestType': 'IZMERA', 'note': f'Kontakt {TAG}',
               'contactName': 'Ana Testna', 'contactPhone': '040 123 456', 'contactEmail': 'ana@testna.si',
               'consentAccepted': True})
chk(s == 201, f'izbira s kontaktom 201 (dejansko {s}, {C3.get("error", "")})')
CID3 = C3.get('data', {}).get('id', '')
LEAD_EMAIL = 'ana@testna.si'

# neveljavni vnosi (sveža povezava — ločen tempomat bucket)
s, L4 = callj('POST', f'/api/projects/{P4}/viz-link', admin, {'note': TAG + '-neg'})
T4 = L4.get('data', {}).get('token', '')
s, _, _ = call('POST', f'/api/public/viz-choice?token={T4}', None,
               {'visualizationId': 'cneobstaja1234567890123', 'variantLabel': 'A', 'requestType': 'PONUDBA', 'consentAccepted': True})
chk(s == 404, f'napačen visualizationId → 404 (dejansko {s})')
s, _, _ = call('POST', f'/api/public/viz-choice?token={T4}', None,
               {'visualizationId': VIZ_T, 'variantLabel': 'A', 'requestType': 'PONUDBA', 'consentAccepted': True})
chk(s == 400, f'tuja vizualizacija (P3) → 400 (dejansko {s})')
s, _, _ = call('POST', f'/api/public/viz-choice?token={T4}', None,
               {'visualizationId': VIZ_C, 'variantLabel': 'C', 'requestType': 'PONUDBA', 'consentAccepted': True})
chk(s == 400, f'ARHIV varianta → 400 (umaknjena; dejansko {s})')
s, _, _ = call('POST', f'/api/public/viz-choice?token={T4}', None,
               {**BASE_CHOICE, 'note': 'x' * 501})
chk(s == 400, f'note > 500 → 400 (dejansko {s})')
s, _, _ = call('POST', f'/api/public/viz-choice?token={T4}', None,
               {**BASE_CHOICE, 'requestType': 'XYZ'})
chk(s == 400, 'requestType smeti → 400')
s, _, _ = call('POST', f'/api/public/viz-choice?token={T4}', None,
               {'visualizationId': VIZ_A, 'variantLabel': 'B', 'requestType': 'PONUDBA', 'consentAccepted': True})
chk(s == 400, 'variantLabel se ne ujema z vizualizacijo → 400')
s, _, _ = call('POST', f'/api/public/viz-choice?token=neobstaja-zi-1234', None, BASE_CHOICE)
chk(s == 404, 'izbira z napačnim žetonom 404')

# tempomat 10/min (ločen ključ od GET) → 429
s, L3 = callj('POST', f'/api/projects/{P4}/viz-link', admin, {'note': TAG + '-rate'})
T3 = L3.get('data', {}).get('token', '')
oks, saw429p = 0, False
for _ in range(15):
    s, _, _ = call('POST', f'/api/public/viz-choice?token={T3}', None, {**BASE_CHOICE, 'note': TAG})
    if s == 429:
        saw429p = True
        break
    if s == 201:
        oks += 1
chk(saw429p, 'tempomat 10/min na izbiro → 429 po prekoračitvi')
chk(oks == 10, f'točno 10 uspešnih izbir pred tempomatom (dejansko {oks})')
# GET tempomat NI prizadet od POST bucket-a (ločen ključ)
s, _, _ = call('GET', f'/api/public/viz?token={T3}')
chk(s == 200, 'GET tempomat ločen od POST (ključ viz: ločen od viz-choice:)')

# ══ F. ZGODOVINA ZA PISARNO ════════════════════════════════════════════════
print('── F. Zgodovina za pisarno ──')
s, d = callj('GET', f'/api/projects/{P4}/viz-choices', admin)
rows = d.get('data', [])
chk(s == 200 and len(rows) >= 13, f'zgodovina izborov P4 (vsaj 3 izbire + 10 tempomat; dejansko {len(rows)})')
chk(rows[0].get('chosenAt') >= rows[-1].get('chosenAt'), 'zgodovina urejena chosenAt desc')
r3 = next((r for r in rows if r.get('id') == CID3), None)
chk(r3 is not None and r3.get('contactName') == 'Ana Testna' and r3.get('contactPhone') == '040 123 456' and r3.get('contactEmail') == LEAD_EMAIL,
    f'zgodovina vidi KONTAKT stranke (dejansko {r3 and {k: r3.get(k) for k in ("contactName", "contactEmail")}})')
chk(r3 is not None and r3.get('lead') is not None and r3.get('lead', {}).get('source') == 'VIZUALIZATOR' and r3.get('lead', {}).get('status') == 'NOV',
    f'izbor vezan na LEAD (source VIZUALIZATOR, status NOV; dejansko {r3 and r3.get("lead")})')
r1 = next((r for r in rows if r.get('id') == CID1), None)
chk(r1 is not None and r1.get('lead') is None and r1.get('contactName') is None, 'izbira brez kontakta NIMA voda')
chk(r1 is not None and r1.get('visualization', {}).get('variantLabel') == 'A' and r1.get('visualization', {}).get('product', {}).get('sku'),
    'zgodovina vidi visualization variantLabel + product')
chk(r1 is not None and r1.get('link') is not None and r1.get('link', {}).get('id'), 'zgodovina vidi povezavo (atribucija)')
chk(all(r.get('consentAcceptedAt') for r in rows), 'vsak izbor nosi consentAcceptedAt')
s, d = callj('GET', f'/api/projects/{P4}/viz-choices', monter)
chk(s == 200, 'monter (nalog na P4) bere zgodovino izborov')
s, _, _ = call('GET', f'/api/projects/{P3}/viz-choices', monter)
chk(s == 403, 'monter brez nalog 403 na tujo zgodovino (IDOR)')
s, d = callj('GET', '/api/crm', admin)
lead_found = next((l for l in d.get('data', {}).get('leads', []) if l.get('email') == LEAD_EMAIL), None)
chk(lead_found is not None and lead_found.get('source') == 'VIZUALIZATOR' and lead_found.get('status') == 'NOV',
    f'LEAD viden v /api/crm z virom VIZUALIZATOR (dejansko {lead_found and {k: lead_found.get(k) for k in ("source", "status")}})')
chk(lead_found is not None and 'Izbor variante A' in (lead_found.get('note') or ''), 'vod note nosi povzetek izbora')

# ══ G. IDEMPOTENTNO ČIŠČENJE ════════════════════════════════════════════════
print('── G. Idempotentno čiščenje ──')
CLEAN = r'''
const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  await p.notificationEvent.deleteMany({where:{type:'VIZ_CHOICE'}});
  await p.visualizationChoice.deleteMany({where:{note:{contains:'__TAG__'}}});
  await p.vizLink.deleteMany({where:{note:{contains:'__TAG__'}}});
  await p.lead.deleteMany({where:{source:'VIZUALIZATOR'}});
  await p.photoVisualization.deleteMany({where:{note:{contains:'__TAG__'}}});
  await p.project.updateMany({where:{id:'__P4__'},data:{photoConsentAt:null,photoConsentById:null,photoConsentExpiresAt:null}});
  const links=await p.vizLink.count({where:{note:{contains:'__TAG__'}}});
  const choices=await p.visualizationChoice.count({where:{note:{contains:'__TAG__'}}});
  const vizs=await p.photoVisualization.count({where:{note:{contains:'__TAG__'}}});
  const leads=await p.lead.count({where:{source:'VIZUALIZATOR'}});
  const cons=await p.project.count({where:{id:'__P4__',photoConsentAt:{not:null}}});
  const evs=await p.notificationEvent.count({where:{type:'VIZ_CHOICE'}});
  console.log('AFTER='+JSON.stringify([links,choices,vizs,leads,cons,evs]));
  return p.$disconnect();
})()
'''.replace('__TAG__', TAG).replace('__P4__', P4)
out, err = bun_ts(CLEAN)
chk('AFTER=[0,0,0,0,0,0]' in out, f'čiščenje testnih zapisov (dejansko {out.strip()}, err {err[:150]})')
out, _ = bun_ts(CLEAN.replace('AFTER=', 'AFTER2='))
chk('AFTER2=[0,0,0,0,0,0]' in out, 'čiščenje je IDEMPOTENTNO (2. zagon = nič zadetkov)')

print(f'\n{"="*60}\nR480: {PASS} ✓ / {FAIL} ✗')
sys.exit(1 if FAIL else 0)
