#!/usr/bin/env python3
"""tests/r446.py — R446 SERVIS e2e (issue #7 §10, P2: garancije, reklamacije, servis)

Tok: STRANKA → REKLAMACIJA → PREVERITEV → ODLOČITEV → SERVIS → ZAKLJUČEK.
Preverja: vezave (stranka/projekt/paket/garancija/claim), integriteto prehodov
(409), samodejni billable iz garancije, samodejni premik ODOBRENA → V_SERVISU ob
prvem obisku, sinhkronizacijo claim ↔ case ob zaključku/zavrnitvi, RBAC
(pisarna vs. tehnik/monter, fail-closed), obseg monterja (samo svoji primeri),
iskanje z obsegom in revizijske zapise. Regresija: warranty ruta še deluje.
"""
import json, sys, urllib.request, urllib.error

BASE = 'http://localhost:3000'
PASS, FAIL = 0, 0

def call (method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e:
        return 0, str(e)

def jget (path, token):
    s, b = call('GET', path, token)
    return json.loads(b) if s == 200 else None

def login (email, pw):
    s, b = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s}'
    return json.loads(b)['token']

def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)

admin = login('admin@roksal.si', 'Admin123!')
vodja = login('vodja@roksal.si', 'Vodja123!')
monter = login('monter@roksal.si', 'Monter123!')
sklad = login('skladisce@roksal.si', 'Skladisce123!')
prod = login('proizvodnja@roksal.si', 'Proizvodnja123!')
print('── prijava: admin / vodja / monter / skladišče / proizvodnja ──')
ok('prijava 5 vlog')

users = jget('/api/users', admin)['data']
monter_id = next(u['id'] for u in users if u['email'] == 'monter@roksal.si')
vodja_id = next(u['id'] for u in users if u['email'] == 'vodja@roksal.si')

projects = jget('/api/projects?limit=500', admin)['data']
p004 = next(p for p in projects if p['code'] == 'P-2026-004')   # ZAKLJUCEN, veljavna garancija
p008 = next(p for p in projects if p['code'] == 'P-2026-008')   # ARHIV, potekla garancija
p006 = next(p for p in projects if p['code'] == 'P-2026-006')   # AKTIVNI, brez garancije
p001 = next(p for p in projects if p['code'] == 'P-2026-001')   # TEREN, s paketi

wars = jget('/api/warranty', admin)['data']
w004 = next(w for w in wars if w['projectId'] == p004['id'])
w008 = next(w for w in wars if w['projectId'] == p008['id'])
chk(w004['valid'] is True, 'garancija P-2026-004 velja (testdata)')
chk(w008['valid'] is False, 'garancija P-2026-008 je potekla (testdata)')

pkgs = jget(f"/api/project-packages?projectId={p001['id']}", admin)['data']
pkg001 = pkgs[0] if pkgs else None

# ══ 1. REKLAMACIJE: ustvarjanje + validacije ══════════════════════════════════
print('── reklamacije: ustvarjanje + validacije ──')
s, b = call('POST', '/api/claims', admin, {
    'customerId': p006['customerId'], 'projectId': p006['id'],
    'title': 'R446 e2e — šum ograje na stopnišču', 'desc': 'Testni tok: stranka poroča o šumu.',
    'channel': 'TELEFON', 'reportedBy': 'R446 e2e prijavitelj',
})
claimA = json.loads(b)['data'] if s == 201 else None
chk(s == 201 and claimA and claimA['status'] == 'NOVA', f'ustvarjanje reklamacije ({s}, {claimA["code"] if claimA else "?"})')
chk(claimA and claimA['serviceCase'] is None, 'nova reklamacija še brez servisnega primera')

s, _ = call('POST', '/api/claims', admin, {'customerId': p006['customerId'], 'projectId': p006['id'], 'title': '', 'desc': 'x'})
chk(s == 400, f'prazen naslov zavrnjen ({s})')
s, _ = call('POST', '/api/claims', admin, {'customerId': p006['customerId'], 'projectId': p006['id'], 'title': 'x', 'desc': ''})
chk(s == 400, f'prazen opis zavrnjen ({s})')
s, _ = call('POST', '/api/claims', admin, {'customerId': 'ne-obstaja', 'projectId': p006['id'], 'title': 'x', 'desc': 'x'})
chk(s == 404, f'tuja stranka zavrnjena ({s})')
s, _ = call('POST', '/api/claims', admin, {'customerId': p006['customerId'], 'projectId': 'ne-obstaja', 'title': 'x', 'desc': 'x'})
chk(s == 404, f'tuj projekt zavrnjen ({s})')
s, _ = call('POST', '/api/claims', admin, {
    'customerId': p006['customerId'], 'projectId': p006['id'],
    'warrantyId': w004['id'], 'title': 'x', 'desc': 'x',
})
chk(s == 409, f'garancija tujega projekta zavrnjena ({s})')
if pkg001:
    s, _ = call('POST', '/api/claims', admin, {
        'customerId': p006['customerId'], 'projectId': p006['id'],
        'packageId': pkg001['id'], 'title': 'x', 'desc': 'x',
    })
    chk(s == 409, f'paket tujega projekta zavrnjen ({s})')
s, _ = call('POST', '/api/claims', admin, {
    'customerId': p006['customerId'], 'projectId': p006['id'],
    'title': 'x', 'desc': 'x', 'channel': 'GOLOB',
})
chk(s == 400, f'neveljaven kanal zavrnjen ({s})')
s, _ = call('POST', '/api/claims', admin, {
    'customerId': p004['customerId'], 'projectId': p006['id'], 'title': 'x', 'desc': 'x',
})
chk(s == 409, f'stranka ne pripada projektu → 409 ({s})')

s, b = call('GET', f"/api/claims/{claimA['id']}", admin)
chk(s == 200 and json.loads(b)['data']['code'] == claimA['code'], 'podrobnost reklamacije')
s, _ = call('GET', '/api/claims/ne-obstaja', admin)
chk(s == 404, f'neznana reklamacija 404 ({s})')

# ══ 2. SERVISNI PRIMER IZ REKLAMACIJE + tok do zaključka ═════════════════════
print('── servisni primer: odpiranje iz reklamacije + celoten tok ──')
s, b = call('POST', '/api/service-cases', admin, {
    'claimId': claimA['id'], 'projectId': p006['id'],
    'title': 'R446 e2e — preveritev šuma', 'desc': 'Preveriti pritrditev ograje.',
})
caseA = json.loads(b)['data'] if s == 201 else None
chk(s == 201 and caseA and caseA['status'] == 'PREVERITEV', f'odpiranje primera iz reklamacije ({s}, {caseA["code"] if caseA else "?"})')

claimA_now = jget(f"/api/claims/{claimA['id']}", admin)['data']
chk(claimA_now['status'] == 'V_OBRAVNAVI', f'reklamacija samodejno V_OBRAVNAVI ({claimA_now["status"]})')
chk(claimA_now['serviceCase'] and claimA_now['serviceCase']['id'] == caseA['id'], 'zveza claim → case vidna na claimu')

s, _ = call('POST', '/api/service-cases', admin, {'claimId': claimA['id'], 'projectId': p006['id'], 'title': 'x', 'desc': 'x'})
chk(s == 409, f'drugi primer iz iste reklamacije zavrnjen — 1:1 ({s})')

# claim iz drugega projekta → 409
s, b = call('POST', '/api/claims', admin, {
    'customerId': p004['customerId'], 'projectId': p004['id'],
    'title': 'R446 e2e — claim za 409', 'desc': 'Ta claim ostane NOVA.',
})
claimF = json.loads(b)['data'] if s == 201 else None
s, _ = call('POST', '/api/service-cases', admin, {'claimId': claimF['id'], 'projectId': p006['id'], 'title': 'x', 'desc': 'x'})
chk(s == 409, f'claim tujega projekta zavrnjen ({s})')

# garancija tujega projekta na primeru → 409
s, _ = call('POST', '/api/service-cases', admin, {'projectId': p006['id'], 'warrantyId': w004['id'], 'title': 'x', 'desc': 'x'})
chk(s == 409, f'garancija tujega projekta na primeru zavrnjena ({s})')
s, _ = call('POST', '/api/service-cases', admin, {'projectId': 'ne-obstaja', 'title': 'x', 'desc': 'x'})
chk(s == 404, f'tuj projekt na primeru zavrnjen ({s})')
s, _ = call('POST', '/api/service-cases', admin, {'projectId': p006['id'], 'title': '', 'desc': 'x'})
chk(s == 400, f'prazen naslov primera zavrnjen ({s})')

# ── prehodi statusov ──
s, _ = call('PATCH', f"/api/service-cases/{caseA['id']}", admin, {'status': 'ODOBRENA'})
chk(s == 400, f'odobritev brez odločitve zavrnjena ({s})')
s, _ = call('PATCH', f"/api/service-cases/{caseA['id']}", admin, {'status': 'ODOBRENA', 'decision': 'UTEMELJENA', 'decisionNote': 'krat'})
chk(s == 400, f'odobritev s kratko utemeljitvijo zavrnjena ({s})')
s, _ = call('PATCH', f"/api/service-cases/{caseA['id']}", admin, {'status': 'ZAKLJUCEN'})
chk(s == 409, f'PREVERITEV → ZAKLJUCEN ni dovoljen ({s})')
s, b = call('PATCH', f"/api/service-cases/{caseA['id']}", admin, {
    'status': 'ODOBRENA', 'decision': 'UTEMELJENA', 'decisionNote': 'Utrditev pritrditve pokrita z garancijo ni — zaračunamo.',
})
caseA = json.loads(b)['data'] if s == 200 else caseA
chk(s == 200 and caseA['decision'] == 'UTEMELJENA' and caseA['decidedBy'], f'odobritev z odločitvijo ({s})')
chk(caseA['billable'] is True, f'brez garancije → samodejno zaračunano (billable={caseA["billable"]})')
chk(caseA['decidedAt'] is not None, 'decidedAt zapisan')

# ── obisk monterja ZASE (nalog.write) + samodejni premik v V_SERVISU ──
s, b = call('POST', f"/api/service-cases/{caseA['id']}/visits", monter, {'note': 'R446 e2e obisk — profil pritrjen.', 'hours': 2})
chk(s == 201, f'monter zapiše obisk zase ({s})')
caseA = jget(f"/api/service-cases/{caseA['id']}", admin)['data']
chk(caseA['status'] == 'V_SERVISU', f'ob prvem obisku ODOBRENA → V_SERVISU ({caseA["status"]})')
chk(len(caseA['visits']) == 1 and caseA['visits'][0]['user']['id'] == monter_id, 'obisk vsebuje tehnika')

s, _ = call('POST', f"/api/service-cases/{caseA['id']}/visits", monter, {'note': 'x', 'userId': vodja_id})
chk(s == 403, f'monter ne more zapisati obiska za drugega ({s})')
s, _ = call('POST', f"/api/service-cases/{caseA['id']}/visits", monter, {'note': ''})
chk(s == 400, f'obisk brez opisa zavrnjen ({s})')
s, _ = call('POST', f"/api/service-cases/{caseA['id']}/visits", monter, {'note': 'x', 'hours': 0})
chk(s == 400, f'0 ur zavrnjenih ({s})')
s, _ = call('POST', f"/api/service-cases/{caseA['id']}/visits", monter, {'note': 'x', 'hours': 25})
chk(s == 400, f'25 ur zavrnjenih ({s})')
s, _ = call('POST', '/api/service-cases/ne-obstaja/visits', monter, {'note': 'x'})
chk(s == 404, f'obisk na neznanem primeru 404 ({s})')

# obisk na primeru v PREVERITEV (seed SRV-2026-003) → 409
seed_cases = jget('/api/service-cases', admin)['data']
preveritev_case = next((c for c in seed_cases if c['status'] == 'PREVERITEV' and not c['claimId']), None)
if preveritev_case:
    s, _ = call('POST', f"/api/service-cases/{preveritev_case['id']}/visits", monter, {'note': 'x'})
    chk(s == 409, f'obisk na PREVERITEV zavrnjen ({s})')
else:
    print('  (ni primera v PREVERITEV — preskočeno)')

# ── zaključek ──
s, _ = call('PATCH', f"/api/service-cases/{caseA['id']}", admin, {'status': 'ODOBRENA'})
chk(s == 409, f'V_SERVISU → ODOBRENA ni dovoljen ({s})')
s, _ = call('PATCH', f"/api/service-cases/{caseA['id']}", admin, {'status': 'ZAKLJUCEN'})
chk(s == 400, f'zaključek brez resolutionNote zavrnjen ({s})')
s, b = call('PATCH', f"/api/service-cases/{caseA['id']}", admin, {'status': 'ZAKLJUCEN', 'resolutionNote': 'Pritrditev zamenjana, šuma ni več.'})
chk(s == 200 and json.loads(b)['data']['status'] == 'ZAKLJUCEN', f'zaključek primera ({s})')
claimA_end = jget(f"/api/claims/{claimA['id']}", admin)['data']
chk(claimA_end['status'] == 'ZAKLJUCENA', f'claim samodejno ZAKLJUCENA ob zaključku primera ({claimA_end["status"]})')
s, _ = call('PATCH', f"/api/service-cases/{caseA['id']}", admin, {'status': 'V_SERVISU'})
chk(s == 409, f'ZAKLJUCEN je končno stanje ({s})')
s, _ = call('PATCH', f"/api/claims/{claimA['id']}", admin, {'status': 'V_OBRAVNAVI'})
chk(s == 409, f'ZAKLJUCENA claim je končno stanje ({s})')

# ══ 3. BILLABLE iz garancije (veljavna / potekla / prepis) ═══════════════════
print('── billable iz garancije ──')
s, b = call('POST', '/api/claims', admin, {
    'customerId': p004['customerId'], 'projectId': p004['id'], 'warrantyId': w004['id'],
    'title': 'R446 e2e — claim na garanciji', 'desc': 'Veljavna garancija naj pokrije servis.',
})
claimB = json.loads(b)['data'] if s == 201 else None
s, b = call('POST', '/api/service-cases', admin, {
    'claimId': claimB['id'], 'projectId': p004['id'], 'warrantyId': w004['id'],
    'title': 'R446 e2e — servis po garanciji', 'desc': 'Test pokritosti garancije.',
})
caseB = json.loads(b)['data'] if s == 201 else None
s, b = call('PATCH', f"/api/service-cases/{caseB['id']}", admin, {
    'status': 'ODOBRENA', 'decision': 'UTEMELJENA', 'decisionNote': 'Garancija velja — servis pokrit.',
})
caseB = json.loads(b)['data'] if s == 200 else caseB
chk(s == 200 and caseB['billable'] is False, f'veljavna garancija → NI zaračunano (billable={caseB["billable"]})')

# pisarna zapiše obisk ZA VODJO (userId) → primer V_SERVISU
s, b = call('POST', f"/api/service-cases/{caseB['id']}/visits", admin, {'note': 'R446 e2e — vodja prevzel primer.', 'userId': vodja_id, 'hours': 1})
chk(s == 201 and json.loads(b)['data']['user']['id'] == vodja_id, f'pisarna zapiše obisk za drugega ({s})')
s, b = call('POST', f"/api/service-cases/{caseB['id']}/visits", admin, {'note': 'x', 'userId': 'ne-obstaja'})
chk(s == 404, f'neznan tehnik 404 ({s})')
s, b = call('PATCH', f"/api/service-cases/{caseB['id']}", admin, {'status': 'ZAKLJUCEN', 'resolutionNote': 'Zamenjana matica po garanciji.'})
chk(s == 200, f'zaključek primera na garanciji ({s})')

s, b = call('POST', '/api/claims', admin, {
    'customerId': p008['customerId'], 'projectId': p008['id'], 'warrantyId': w008['id'],
    'title': 'R446 e2e — claim s poteklo garancijo', 'desc': 'Garancija je potekla.',
})
claimC = json.loads(b)['data'] if s == 201 else None
s, b = call('POST', '/api/service-cases', admin, {
    'claimId': claimC['id'], 'projectId': p008['id'], 'warrantyId': w008['id'],
    'title': 'R446 e2e — obnova po potekli garanciji', 'desc': 'Zaračunana obnova.',
})
caseC = json.loads(b)['data'] if s == 201 else None
s, b = call('PATCH', f"/api/service-cases/{caseC['id']}", admin, {
    'status': 'ODOBRENA', 'decision': 'DELNO_UTEMELJENA', 'decisionNote': 'Garancija je potekla — obnova se zaračuna.',
})
caseC = json.loads(b)['data'] if s == 200 else caseC
chk(s == 200 and caseC['billable'] is True, f'potekla garancija → zaračunano (billable={caseC["billable"]})')
s, b = call('PATCH', f"/api/service-cases/{caseC['id']}", admin, {'status': 'ZAKLJUCEN', 'resolutionNote': 'Obnova izvedena po ceniku.'})
chk(s == 200, f'zaključek zaračunanega primera ({s})')

# prepis billable ob odobritvi + neprehodni PATCH brez statusa + ODOBRENA → ZAKLJUCEN
s, b = call('POST', '/api/service-cases', admin, {'projectId': p006['id'], 'title': 'R446 e2e — prepis zaračunanosti', 'desc': 'Test prepisa billable.'})
caseE = json.loads(b)['data'] if s == 201 else None
s, b = call('PATCH', f"/api/service-cases/{caseE['id']}", admin, {
    'status': 'ODOBRENA', 'decision': 'UTEMELJENA', 'decisionNote': 'Utemeljeno, a stranki ne zaračunamo (kulturni dogovor).', 'billable': False,
})
caseE = json.loads(b)['data'] if s == 200 else caseE
chk(s == 200 and caseE['billable'] is False, f'uporabnik prepiše billable ob odobritvi (billable={caseE["billable"]})')
s, b = call('PATCH', f"/api/service-cases/{caseE['id']}", admin, {'billable': True})
chk(s == 200 and json.loads(b)['data']['billable'] is True, f'neprehodni PATCH billable deluje ({s})')
s, _ = call('PATCH', f"/api/service-cases/{caseE['id']}", admin, {})
chk(s == 400, f'prazen PATCH zavrnjen ({s})')
s, b = call('PATCH', f"/api/service-cases/{caseE['id']}", admin, {'status': 'ZAKLJUCEN', 'resolutionNote': 'Odobrena in takoj zaključena (brez obiska).'})
chk(s == 200, f'ODOBRENA → ZAKLJUCEN bližnjica deluje ({s})')

# ══ 4. ZAVRNITEV primera povleče claim v ZAVRNJENA ═══════════════════════════
print('── zavrnitev ──')
s, b = call('POST', '/api/claims', admin, {
    'customerId': p008['customerId'], 'projectId': p008['id'],
    'title': 'R446 e2e — neutemeljena reklamacija', 'desc': 'Za zavrnitev.',
})
claimD = json.loads(b)['data'] if s == 201 else None
# napačen prehod claima: NOVA → ZAKLJUCENA
s, _ = call('PATCH', f"/api/claims/{claimD['id']}", admin, {'status': 'ZAKLJUCENA'})
chk(s == 409, f'claim NOVA → ZAKLJUCENA zavrnjen ({s})')
s, b = call('PATCH', f"/api/claims/{claimD['id']}", admin, {'status': 'V_OBRAVNAVI'})
chk(s == 200 and json.loads(b)['data']['status'] == 'V_OBRAVNAVI', f'claim NOVA → V_OBRAVNAVI ({s})')
s, b = call('POST', '/api/service-cases', admin, {
    'claimId': claimD['id'], 'projectId': p008['id'],
    'title': 'R446 e2e — primer za zavrnitev', 'desc': 'Preveritev pokaže neutemeljenost.',
})
caseD = json.loads(b)['data'] if s == 201 else None
s, _ = call('PATCH', f"/api/service-cases/{caseD['id']}", admin, {'status': 'ZAVRNJENA', 'decision': 'NEUTEMELJENA'})
chk(s == 400, f'zavrnitev brez utemeljitve zavrnjena ({s})')
s, b = call('PATCH', f"/api/service-cases/{caseD['id']}", admin, {
    'status': 'ZAVRNJENA', 'decision': 'NEUTEMELJENA', 'decisionNote': 'Poškodba ni iz montaže — mehanska obremenitev.',
})
chk(s == 200 and json.loads(b)['data']['status'] == 'ZAVRNJENA', f'zavrnitev primera ({s})')
claimD_end = jget(f"/api/claims/{claimD['id']}", admin)['data']
chk(claimD_end['status'] == 'ZAVRNJENA', f'claim samodejno ZAVRNJENA ({claimD_end["status"]})')
s, _ = call('PATCH', f"/api/claims/{claimD['id']}", admin, {'status': 'V_OBRAVNAVI'})
chk(s == 409, f'ZAVRNJENA claim je končno stanje ({s})')

# ══ 5. RBAC: monter / skladišče / proizvodnja / brez žetona ══════════════════
print('── RBAC (fail-closed) ──')
s, _ = call('GET', '/api/claims', monter)
chk(s == 403, f'MONTER ne vidi reklamacij ({s})')
s, _ = call('POST', '/api/claims', monter, {'customerId': p006['customerId'], 'projectId': p006['id'], 'title': 'x', 'desc': 'x'})
chk(s == 403, f'MONTER ne more ustvarjati reklamacij ({s})')
s, _ = call('PATCH', f"/api/claims/{claimF['id']}", monter, {'status': 'V_OBRAVNAVI'})
chk(s == 403, f'MONTER ne more urejati reklamacij ({s})')
s, _ = call('POST', '/api/service-cases', monter, {'projectId': p006['id'], 'title': 'x', 'desc': 'x'})
chk(s == 403, f'MONTER ne more odpreti servisnega primera ({s})')
s, _ = call('PATCH', f"/api/service-cases/{caseC['id']}", monter, {'status': 'V_SERVISU'})
chk(s == 403, f'MONTER ne more voditi toka primera ({s})')

s, b = call('GET', '/api/claims', sklad)
chk(s == 200, f'SKLADIŠČE vidi reklamacije — readsAllData ({s})')
s, _ = call('POST', '/api/claims', sklad, {'customerId': p006['customerId'], 'projectId': p006['id'], 'title': 'x', 'desc': 'x'})
chk(s == 403, f'SKLADIŠČE brez pisarniških mutacij — projects.write ({s})')
s, b = call('GET', '/api/claims', prod)
chk(s == 200, f'PROIZVODNJA vidi reklamacije — readsAllData ({s})')
s, _ = call('POST', '/api/claims', prod, {'customerId': p006['customerId'], 'projectId': p006['id'], 'title': 'x', 'desc': 'x'})
chk(s == 403, f'PROIZVODNJA brez pisarniških mutacij ({s})')
s, _ = call('GET', '/api/claims')
chk(s == 401, f'brez žetona claims 401 ({s})')
s, _ = call('GET', '/api/service-cases')
chk(s == 401, f'brez žetona service-cases 401 ({s})')

# ══ 6. OBSEG: monter vidi SAMO svoje primerе ═════════════════════════════════
print('── obseg monterja ──')
all_cases = jget('/api/service-cases', admin)['data']
mine = jget('/api/service-cases', monter)['data']
expected_ids = set(c['id'] for c in all_cases if any(v['userId'] == monter_id for v in c['visits']))
got_ids = set(c['id'] for c in mine)
chk(got_ids == expected_ids, f'monter vidi TOČNO svoje primerе ({len(got_ids)} od {len(all_cases)})')
chk(caseA['id'] in got_ids, 'primer z monterjevim obiskom je v obsegu')
chk(caseB['id'] not in got_ids and caseC['id'] not in got_ids, 'primera brez njegovega obiska nista v obsegu')

s, _ = call('GET', f"/api/service-cases/{caseA['id']}", monter)
chk(s == 200, f'podrobnost lastnega primera za monterja ({s})')
s, _ = call('GET', f"/api/service-cases/{caseC['id']}", monter)
chk(s == 403, f'tuj primer za monterja 403 ({s})')
s, b = call('GET', f"/api/service-cases/{caseA['id']}/visits", monter)
chk(s == 200 and len(json.loads(b)['data']) >= 1, f'obiski lastnega primera za monterja ({s})')
s, _ = call('GET', f"/api/service-cases/{caseC['id']}/visits", monter)
chk(s == 403, f'obiski tujega primera za monterja 403 ({s})')

# filtri
s, b = call('GET', '/api/claims?status=ZAKLJUCENA', admin)
chk(s == 200 and all(c['status'] == 'ZAKLJUCENA' for c in json.loads(b)['data']), 'filter statusa claims')
s, b = call('GET', f"/api/service-cases?projectId={p006['id']}", admin)
chk(s == 200 and all(c['projectId'] == p006['id'] for c in json.loads(b)['data']), 'filter projekta service-cases')

# ══ 7. ISKANJE z obsegom ════════════════════════════════════════════════════
print('── iskanje (R446 skupina Reklamacije / Servis) ──')
s, b = call('GET', '/api/search?q=SRV-', admin)
groups = {g['kind']: g for g in json.loads(b)['data']['groups']} if s == 200 else {}
chk('servis' in groups, 'admin: skupina Reklamacije / Servis v iskanju')
if 'servis' in groups:
    # R448 §11 IA: servis je po preoblikovanju navigacije lastna sekcija (prej 'pisarna')
    chk(any(h['tab'] == 'servis' and h['section'] == 'servis' for h in groups['servis']['hits']),
        'zadetki navigirajo na zavihek servis')
s, b = call('GET', f"/api/search?q={claimA['code']}", admin)
groups = {g['kind']: g for g in json.loads(b)['data']['groups']} if s == 200 else {}
chk('servis' in groups and any(claimA['code'] in h['label'] for h in groups['servis']['hits']),
    f'iskanje po kodi claima {claimA["code"]}')
s, b = call('GET', '/api/search?q=SRV-', monter)
groups = {g['kind']: g for g in json.loads(b)['data']['groups']} if s == 200 else {}
chk('servis' not in groups, 'monter: BREZ skupine Reklamacije / Servis (fail-closed)')

# ══ 8. REVIZIJA ═════════════════════════════════════════════════════════════
print('── revizijski dnevnik ──')
# vse R446 mutacije pišejo projectId → per-projekt pregled (R428 semantika)
audit_pool = []
for pid in (p004['id'], p006['id'], p008['id']):
    entries = jget(f'/api/audit?projectId={pid}&limit=500', admin)
    if entries: audit_pool.extend(entries['data'])
actions_seen = set(e['action'] for e in audit_pool)
for action in ['CLAIM_CREATE', 'CLAIM_UPDATE', 'SERVICE_CASE_CREATE', 'SERVICE_CASE_DECISION', 'SERVICE_CASE_STATUS', 'SERVICE_CASE_UPDATE', 'SERVICE_VISIT_CREATE']:
    chk(action in actions_seen, f'revizija {action} zapisana')

def detail_of (e):
    d = e.get('detail')
    if isinstance(d, str):
        try: return json.loads(d)
        except Exception: return {}
    return d if isinstance(d, dict) else {}

chk(any(detail_of(e).get('code') == caseA['code'] and e['action'] == 'SERVICE_VISIT_CREATE' for e in audit_pool),
    f'SERVICE_VISIT_CREATE za {caseA["code"]}')
chk(any(detail_of(e).get('code') == caseB['code'] and detail_of(e).get('claim') == claimB['code'] and e['action'] == 'SERVICE_CASE_CREATE' for e in audit_pool),
    f'SERVICE_CASE_CREATE vezan na claim {claimB["code"]}')
chk(any(e.get('projectId') == p004['id'] and e['action'] == 'SERVICE_CASE_CREATE' for e in audit_pool), 'revizija primera ima projectId')

# ══ 9. regresija: warranty in osnovne rute ostajajo zdrave ═══════════════════
print('── regresija ──')
s, b = call('GET', '/api/warranty', admin)
chk(s == 200 and len(json.loads(b)['data']) >= 2, f'warranty seznam še deluje ({s})')
s, b = call('POST', '/api/warranty', admin, {'warrantyId': w004['id'], 'visitNote': 'R446 e2e — regresijski obisk garancije.'})
chk(s == 201, f'warranty obisk še deluje ({s})')
s, _ = call('POST', '/api/warranty', admin, {'projectId': p004['id']})
chk(s == 409, f'dvojna garancija projekta še zavrnjena ({s})')
s, _ = call('POST', '/api/warranty', admin, {'projectId': p006['id'], 'note': 'x'})
chk(s == 409, f'garancija na nezaključenem projektu še zavrnjena ({s})')
for path, tok, expect in [
    ('/api/projects', admin, 200), ('/api/nalog', admin, 200), ('/api/deliveries', admin, 200),
    ('/api/stock', admin, 200), (f"/api/warranty?projectId={p004['id']}", admin, 200),
]:
    s, _ = call('GET', path, tok)
    chk(s == expect, f'{path} → {s}')

# ══ 10. ČIŠČENJE: testni entitete (naslov z 'R446 e2e') odstranimo iz baze ════
# (API nima DELETE rut; finalna stanja so končna — edina možnost je neposreden
#  izbris SQLite. Revizijski dnevnik ostane nemutabilen, kot je treba.)
print('── čiščenje testnih podatkov ──')
try:
    import sqlite3
    con = sqlite3.connect('db/custom.db')
    cur = con.cursor()
    cur.execute("SELECT id FROM ServiceCase WHERE title LIKE 'R446 e2e%'")
    case_ids = [r[0] for r in cur.fetchall()]
    cur.execute("SELECT id FROM Claim WHERE title LIKE 'R446 e2e%'")
    claim_ids = [r[0] for r in cur.fetchall()]
    n_visits = 0
    for cid in case_ids:
        cur.execute('DELETE FROM ServiceVisit WHERE caseId = ?', (cid,))
        n_visits += cur.rowcount
    q = ','.join('?' * len(case_ids)) if case_ids else None
    if q: cur.execute(f'DELETE FROM ServiceCase WHERE id IN ({q})', case_ids)
    qc = ','.join('?' * len(claim_ids)) if claim_ids else None
    if qc: cur.execute(f'DELETE FROM Claim WHERE id IN ({qc})', claim_ids)
    cur.execute("DELETE FROM WarrantyVisit WHERE note LIKE 'R446 e2e%'")
    n_war_visits = cur.rowcount
    con.commit(); con.close()
    ok(f'počiščeno: {len(claim_ids)} reklamacij, {len(case_ids)} primerov, {n_visits} obiskov, {n_war_visits} regresijskih obiskov garancije')
except Exception as e:
    bad(f'čiščenje ni uspelo: {e}')

# ══ povzetek ════════════════════════════════════════════════════════════════
print(f'\n══ R446 e2e: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL else 0)
