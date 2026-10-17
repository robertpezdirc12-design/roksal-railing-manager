#!/usr/bin/env python3
"""tests/r449.py — R449 (GitLab issue #8): VERZIONIRANJE KATALOGA IN INŽENIRSKIH PRAVIL

Preverja: verzija se zapiše ob vsaki spremembi profila/pravila (kdo/kdaj/staro→novo),
nove rute (GET /api/catalog/versions + /[id], GET /api/engineering-rules/[id]/versions
+ /api/engineering-rules/versions/[id]), RBAC (brez žetona 401; monter brez
catalog.write na mutaciji 403 ampak read OK; skladišče IMA catalog.write;
proizvodnja IMA production.manage) in revizijski dnevnik (CATALOG_VERSION /
RULE_VERSION). Regresija: catalog/engineering-rules rute delujejo naprej.
Po vzoru tests/r446.py."""
import json, os, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASS, FAIL = 0, 0
TAG = 'R449T'  # marker testnih entitet

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
admin_name = next(u['name'] for u in users if u['email'] == 'admin@roksal.si')

# ══ 1. KATALOG: verzija ob nastanku profila ═══════════════════════════════════
print('── katalog: verzija ob nastanku profila ──')
sku = f'{TAG}-PROF'
s, b = call('POST', '/api/catalog', admin, {
    'sku': sku, 'name': f'{TAG} testni profil', 'material': 'INOX', 'type': 'OGRAJA', 'pricePerM': 100,
})
prof = json.loads(b)['data'] if s == 201 else None
chk(s == 201 and prof, f'nov profil prek POST /api/catalog ({s})')

s, b = call('GET', f'/api/catalog/versions?profileId={prof["id"]}', admin)
vers = json.loads(b)['data'] if s == 200 else []
chk(s == 200 and len(vers) == 1, f'nastanek profila zapiše TOČNO 1 verzijo ({len(vers)})')
v1 = vers[0] if vers else None
chk(v1 and v1['user'] and v1['user']['name'] == admin_name, 'verzija nosi kdo (user.name)')
chk(v1 and v1['profile'] and v1['profile']['sku'] == sku, 'verzija nosi osnovne podatke profila (sku)')
snap1 = (v1.get('data') or {}) if v1 else {}  # R542: data je jsonb objekt
chk(snap1.get('before') is None, 'ob nastanku je before = null')
chk(snap1.get('after', {}).get('pricePerM') == 100 and snap1.get('profile', {}).get('sku') == sku,
    'snapshot vsebuje after + celoten profile posnetek')

# ══ 2. KATALOG: verzija ob spremembi (staro→novo) ═════════════════════════════
print('── katalog: verzija ob spremembi profila ──')
s, b = call('PATCH', f'/api/catalog/{prof["id"]}', admin, {'pricePerM': 125.5, 'name': f'{TAG} preimenovan profil'})
chk(s == 200, f'PATCH profila uspešen ({s})')

s, b = call('GET', f'/api/catalog/versions?profileId={prof["id"]}', admin)
vers = json.loads(b)['data'] if s == 200 else []
chk(len(vers) == 2, f'sprememba doda 2. verzijo ({len(vers)})')
chk(all(vers[i]['createdAt'] >= vers[i+1]['createdAt'] for i in range(len(vers)-1)),
    'seznam je padajoče po createdAt (najnovejša prva)')
v2 = vers[0] if vers else None
snap2 = (v2.get('data') or {}) if v2 else {}  # R542: data je jsonb objekt
chk(snap2.get('before', {}).get('pricePerM') == 100 and snap2.get('after', {}).get('pricePerM') == 125.5,
    'staro→novo preverljivo (pricePerM 100 → 125.5)')
chk(snap2.get('before', {}).get('name') == f'{TAG} testni profil'
    and snap2.get('after', {}).get('name') == f'{TAG} preimenovan profil', 'staro→novo tudi za ime')
chk(snap2.get('profile', {}).get('pricePerM') == 125.5, 'snapshot vsebuje celoten NOVI profil')

# podrobnost verzije
s, b = call('GET', f'/api/catalog/versions/{v2["id"]}', admin)
det = json.loads(b)['data'] if s == 200 else None
chk(s == 200 and det and (det['data'] or {}).get('after', {}).get('pricePerM') == 125.5,  # R542: jsonb objekt
    'GET /api/catalog/versions/[id] — podrobnost s snapshotom')
chk(det and det['user'] and det['profile'] and det['profile']['sku'] == sku, 'podrobnost nosi user + profile')
s, _ = call('GET', '/api/catalog/versions/ne-obstaja', admin)
chk(s == 404, f'neznana verzija kataloga 404 ({s})')

# seznam brez filtra + limit
s, b = call('GET', '/api/catalog/versions?limit=200', admin)
allv = json.loads(b)['data'] if s == 200 else []
chk(s == 200 and len(allv) >= 2 and all('user' in v and 'profile' in v for v in allv),
    f'seznam vseh verzij z user+profile ({len(allv)} zadetkov)')
meta = json.loads(b).get('meta', {})
chk(meta.get('total', 0) >= 2 and meta.get('limit') == 200, 'meta {total, limit} v odgovoru')

# ══ 3. PRAVILA: zgodovina vrednosti ob upsertu (nastanek + posodobitev) ═══════
print('── pravila: zgodovina vrednosti ──')
key = f'{TAG.lower()}_pravilo'
s, b = call('POST', '/api/engineering-rules', prod, {
    'key': key, 'label': f'{TAG} testno pravilo', 'value': 45, 'unit': 'cm',
})
rule = json.loads(b)['data'] if s == 201 else None
chk(s == 201 and rule, f'novo pravilo prek POST /api/engineering-rules — proizvodnja ({s})')

s, b = call('GET', f'/api/engineering-rules/{rule["id"]}/versions', admin)
rvers = json.loads(b)['data'] if s == 200 else []
chk(len(rvers) == 1, f'nastanek pravila zapiše 1 RuleVersion ({len(rvers)})')
rv1 = rvers[0] if rvers else None
chk(rv1 and rv1['oldValue'] is None and rv1['newValue']['value'] == 45,  # R542: jsonb objekti
    'ob nastanku je oldValue = null, newValue = 45')
chk(rv1 and rv1['user'] and rv1['user']['name'], 'RuleVersion nosi kdo (user.name)')

s, b = call('POST', '/api/engineering-rules', prod, {
    'key': key, 'label': f'{TAG} testno pravilo', 'value': 55, 'unit': 'cm',
})
chk(s == 201, f'upsert pravila z novo vrednostjo ({s})')
s, b = call('GET', f'/api/engineering-rules/{rule["id"]}/versions', admin)
rvers = json.loads(b)['data'] if s == 200 else []
chk(len(rvers) == 2, f'posodobitev doda 2. RuleVersion ({len(rvers)})')
rv2 = rvers[-1] if rvers else None
chk(rv2 and rv2['oldValue']['value'] == 45 and rv2['newValue']['value'] == 55,
    'staro→novo vrednosti (45 → 55)')
chk(all(rvers[i]['createdAt'] <= rvers[i+1]['createdAt'] for i in range(len(rvers)-1)),
    'seznam je naraščajoče po createdAt')

# PATCH posodobitev
s, b = call('PATCH', f'/api/engineering-rules/{rule["id"]}', prod, {'value': 60})
chk(s == 200, f'PATCH pravila uspešen ({s})')
s, b = call('GET', f'/api/engineering-rules/{rule["id"]}/versions', admin)
rvers = json.loads(b)['data'] if s == 200 else []
chk(len(rvers) == 3 and rvers[-1]['oldValue']['value'] == 55
    and rvers[-1]['newValue']['value'] == 60, 'PATCH doda RuleVersion s staro→novo')

# podrobnost verzije pravila
s, b = call('GET', f'/api/engineering-rules/versions/{rvers[-1]["id"]}', admin)
rdet = json.loads(b)['data'] if s == 200 else None
chk(s == 200 and rdet and rdet['newValue']['value'] == 60, 'GET /api/engineering-rules/versions/[id] — podrobnost')
chk(rdet and rdet['rule'] and rdet['rule']['key'] == key and rdet['user'], 'podrobnost nosi rule + user')
s, _ = call('GET', '/api/engineering-rules/versions/ne-obstaja', admin)
chk(s == 404, f'neznana verzija pravila 404 ({s})')

# deaktivacija = sprememba (active) → RuleVersion
s, b = call('DELETE', f'/api/engineering-rules/{rule["id"]}', prod)
chk(s == 200, f'deaktivacija pravila uspešna ({s})')
s, b = call('GET', f'/api/engineering-rules/{rule["id"]}/versions', admin)
rvers = json.loads(b)['data'] if s == 200 else []
chk(len(rvers) == 4 and rvers[-1]['oldValue']['active'] is True
    and rvers[-1]['newValue']['active'] is False, 'deaktivacija zapiše RuleVersion (active true → false)')

# ══ 4. RBAC ═══════════════════════════════════════════════════════════════════
print('── RBAC ──')
for path in ['/api/catalog/versions', f'/api/catalog/versions/{v2["id"]}',
             f'/api/engineering-rules/{rule["id"]}/versions', f'/api/engineering-rules/versions/{rvers[-1]["id"]}']:
    s, _ = call('GET', path)
    chk(s == 401, f'brez žetona 401: {path.split("/api/")[1]} ({s})')

s, _ = call('POST', '/api/catalog', monter, {'sku': f'{TAG}-M', 'name': 'x', 'pricePerM': 1})
chk(s == 403, f'monter BREZ catalog.write na mutaciji 403 ({s})')
s, _ = call('PATCH', f'/api/catalog/{prof["id"]}', monter, {'pricePerM': 1})
chk(s == 403, f'monter BREZ catalog.write na PATCH 403 ({s})')
s, b = call('GET', '/api/catalog/versions', monter)
chk(s == 200, f'monter IMA catalog.read → seznam verzij 200 ({s})')
s, b = call('GET', f'/api/catalog/versions/{v1["id"]}', monter)
chk(s == 200, f'monter bere podrobnost verzije 200 ({s})')

s, _ = call('POST', '/api/engineering-rules', monter, {'key': f'{TAG.lower()}_m', 'label': 'x', 'value': 1})
chk(s == 403, f'monter BREZ production.manage na mutaciji pravila 403 ({s})')
s, b = call('GET', f'/api/engineering-rules/{rule["id"]}/versions', monter)
chk(s == 200, f'monter bere zgodovino pravila (projects.read) 200 ({s})')

# skladišče IMA catalog.write
s, b = call('POST', '/api/catalog', sklad, {'sku': f'{TAG}-SKL', 'name': f'{TAG} skladišče profil', 'pricePerM': 10})
prof_skl = json.loads(b)['data'] if s == 201 else None
chk(s == 201, f'skladišče IMA catalog.write → nov profil 201 ({s})')
s, b = call('GET', f'/api/catalog/versions?profileId={prof_skl["id"]}', sklad)
chk(s == 200 and len(json.loads(b)['data']) == 1, 'verzija skladiščevega profila vidna (tudi sejalcu)')

# proizvodnja IMA production.manage, nima catalog.write
s, _ = call('POST', '/api/catalog', prod, {'sku': f'{TAG}-P', 'name': 'x', 'pricePerM': 1})
chk(s == 403, f'proizvodnja BREZ catalog.write 403 ({s})')
s, b = call('GET', '/api/catalog/versions', prod)
chk(s == 200, f'proizvodnja IMA catalog.read → verzije 200 ({s})')

# vodja: vse pravice
s, b = call('GET', '/api/catalog/versions', vodja)
chk(s == 200, f'vodja bere verzije kataloga 200 ({s})')

# ══ 5. REVIZIJSKI DNEVNIK (AuditLog) ══════════════════════════════════════════
print('── revizijski dnevnik ──')
s, b = call('GET', '/api/audit?action=CATALOG_VERSION&limit=50', admin)
entries = json.loads(b)['data'] if s == 200 else []
chk(s == 200 and any(e['entity'] == 'catalogVersion' for e in entries),
    f'AuditLog vsebuje CATALOG_VERSION zapise ({len(entries)})')
chk(any((e['detail'] or {}).get('sku') == sku for e in entries),  # R542: detail objekt
    'CATALOG_VERSION detail nosi sku profila')
s, b = call('GET', '/api/audit?action=RULE_VERSION&limit=50', admin)
entries = json.loads(b)['data'] if s == 200 else []
chk(s == 200 and any(e['entity'] == 'ruleVersion' for e in entries),
    f'AuditLog vsebuje RULE_VERSION zapise ({len(entries)})')

# ══ 6. REGRESIJA ═════════════════════════════════════════════════════════════
print('── regresija ──')
for path in ['/api/catalog', '/api/engineering-rules', '/api/engineering-rules?all=1',
             f'/api/engineering-rules/{rule["id"]}', '/api/measurements?limit=5']:
    s, _ = call('GET', path, admin)
    chk(s == 200, f'GET {path} 200 ({s})')
s, b = call('GET', '/api/catalog', admin)
chk(any(p['sku'] == sku for p in json.loads(b)['data']), 'nov profil viden v /api/catalog')
s, b = call('GET', '/api/engineering-rules?all=1', admin)
chk(any(r['key'] == key for r in json.loads(b)['data']), 'deaktivirano pravilo vidno z ?all=1')

# ══ 7. ČIŠČENJE testnih entitet ═══════════════════════════════════════════════
CLEAN = '''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  await p.catalogVersion.deleteMany({where:{profile:{sku:{startsWith:'__TAG__'}}}});
  await p.profile.deleteMany({where:{sku:{startsWith:'__TAG__'}}});
  await p.ruleVersion.deleteMany({where:{rule:{key:{startsWith:'__TAG__'.toLowerCase()}}}});
  await p.engineeringRule.deleteMany({where:{key:{startsWith:'__TAG__'.toLowerCase()}}});
  // R542: detail je jsonb — podniz po serializiranem jsonb (ista semantika contains)
  await p.$executeRawUnsafe('DELETE FROM "AuditLog" WHERE "detail"::text LIKE $1 OR "detail"::text LIKE $2', '%__TAG__%', '%__TAG_LOWO__%');
  console.log('CLEAN_DONE');
  return p.$disconnect();
})()
'''.replace('__TAG__', TAG).replace('__TAG_LOWO__', TAG.lower())
import subprocess
r = subprocess.run(['bun', '-e', CLEAN], capture_output=True, text=True,
                   env={**__import__('os').environ, 'DATABASE_URL': os.environ.get('TEST_DB_URL') or 'postgresql://roksal:roksal@localhost:54329/roksal'})
print('čiščenje:', 'OK' if 'CLEAN_DONE' in r.stdout else ('NAPAKA: ' + r.stderr[:200]))

print(f'═══ R449: {PASS} ✓ / {FAIL} ✗ ═══')
sys.exit(1 if FAIL else 0)
