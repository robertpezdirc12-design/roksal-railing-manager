#!/usr/bin/env python3
"""tests/r522.py — R522 (issue #7 §4B): DOKUMENTACIJSKE SLIKE DETAJLOV v merilni
seji — ločene od merilnih pogledov (rekonstrukcija), z oznako in pripnitvijo
na segment.

Zakaj ta suite obstaja (resnična vrzel iz R508 ostanka 1):
  merilni pogledi so bili edini kontejner za vse fotografije — max 4,
  namenjeni rekonstrukciji (točke + kalibracija + konsolidacija). Issue #7
  §4B pa zahteva: »Podpri poljubno smiselno število dokumentacijskih
  fotografij, ne samo nekaj vnaprej določenih slik; loči fotografije, ki se
  uporabljajo za rekonstrukcijo, od dokumentacijskih fotografij detajlov« in
  »dodatne fotografije detajla (vijak, nosilec, podlaga, ovira) naj se
  pripnejo k ustreznemu segmentu/elementu«.

  A) čist modul measure-doc: oznake iz issueja, normalizacija, fail-closed
     preverjanja (neznana oznaka = napaka, ne tiho shranjena), zapis v
     params brez uničenja obstoječih ključev, ločena meja MAX_DOK_SLIK.
  B) žičenje: kamera nosi detajle ločeno od pogledov (gumb je na voljo tudi
     pri 4/4 pogledih), potrditev jih pošlje ZA meritvijo z docOf vezavo,
     offline pot nosi oznako (docOf ni mogoč — zapiše docOffline, ne lažne
     veze), osnutek jih prenaša (§6 brez izgube podatkov ob osvežitvi).
  C) API krog (samo ob delujočem strežniku): doc* polja so TOP-LEVEL in jih
     strežnik preveri — napačna oznaka 400, tip OGRAJA z oznako 400,
     neobstoječi docOf 400, brez žetona 401; veljaven krog zapise docOf/
     docTag/docSegmentIdx/docNote v params FOTO zapisa; nazaj kompatibilno
     (stari klici brez doc* delujejo nespremenjeno); revizija nosi dokaz.
  D) dokazni artefakti: E2E pot skozi pravo aplikacijo (ops/r522-ui-*.png).

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


print('═══ R522: dokumentacijske slike detajlov — ločene od merilnih pogledov ═══')

# ═══ A) čist modul measure-doc ═══════════════════════════════════════════════
print('── A) measure-doc: oznake, normalizacija, fail-closed, zapis v params ──')
A = bun_js(r'''
const m = await import('./src/lib/measure-doc')
const prazno = m.preveriDocPolja({})
const veljavno = m.preveriDocPolja({ type: 'FOTO', docOfMeasurementId: ' m1 ', docTag: 'VIJAK', docSegmentIdx: 2, docNote: '  M12 na sidru  ' })
const napakaTag = m.preveriDocPolja({ type: 'FOTO', docTag: 'ZARJA' })
const napakaTip = m.preveriDocPolja({ type: 'OGRAJA', docTag: 'VIJAK' })
const napakaNote = m.preveriDocPolja({ type: 'FOTO', docTag: 'VIJAK', docNote: 'x'.repeat(201) })
const docOfBrezTag = m.preveriDocPolja({ type: 'FOTO', docOfMeasurementId: 'm2' })
const segmentNeg = m.normalizirajDocSegment(-3)
const segmentFloat = m.normalizirajDocSegment(1.7)
const segmentNull = m.normalizirajDocSegment('abc')
const noteTrim = m.normalizirajDocNote('  abc  ')
const merge = JSON.parse(m.zapišiDocVParams(JSON.stringify({ photo: 'x', stage: 'ZAJEM' }), { docTag: 'OVIRA', docSegmentIdx: null, docNote: 'koruza pred vhodom' }))
const pokvarjen = JSON.parse(m.zapišiDocVParams('ni json {{{', { docTag: 'NOSILEC' }))
const offline = JSON.parse(m.zapišiDocVParams(null, { docTag: 'PODLAGA', docOffline: true }))
console.log(JSON.stringify({
  tags: m.DOC_TAGS, maxSlik: m.MAX_DOK_SLIK,
  labels: Object.keys(m.DOC_TAG_LABELS).length,
  praznoDoc: prazno.docOf === null && prazno.docTag === null && prazno.docSegmentIdx === null && prazno.docNote === '',
  veljavno, napakaTag: napakaTag.napaka ?? null, napakaTip: napakaTip.napaka ?? null,
  napakaNote: napakaNote.napaka ?? null, docOfBrezTag: docOfBrezTag.docOf,
  segmentNeg, segmentFloat, segmentNull, noteTrim,
  ohraniPhoto: merge.photo === 'x' && merge.stage === 'ZAJEM' && merge.docTag === 'OVIRA' && merge.docNote === 'koruza pred vhodom' && !('docSegmentIdx' in merge),
  pokvarjen: pokvarjen.docTag === 'NOSILEC',
  offline: offline.docTag === 'PODLAGA' && offline.docOffline === true,
  prostor0: m.prostorZaDokSlike(30), prostor5: m.prostorZaDokSlike(25), prostorNeg: m.prostorZaDokSlike(-2),
}))
''')
chk(A.get('_err') is None, f'modul se naloži brez napak ({str(A.get("_err"))[:80]})')
chk(A.get('tags') == ['VIJAK', 'NOSILEC', 'PODLAGA', 'OVIRA', 'SPLOSNO'], f'oznake so točno issue §4B seznam + SPLOSNO ({A.get("tags")})')
chk(A.get('maxSlik') == 30, 'MAX_DOK_SLIK = 30 (»poljubno smiselno«, ne neskončno)')
chk(A.get('labels') == 5, 'vseh 5 oznak ima človeško berljiv napis')
chk(A.get('praznoDoc') is True, 'brez doc* polj → prazen rezultat (nazaj kompatibilno)')
V = A.get('veljavno') or {}
chk(V.get('docOf') == 'm1' and V.get('docTag') == 'VIJAK' and V.get('docSegmentIdx') == 2 and V.get('docNote') == 'M12 na sidru', 'veljavna polja se normalizirajo (trim, brez napake)')
chk(isinstance(A.get('napakaTag'), str) and 'Neveljavna' in A.get('napakaTag'), f'neznana oznaka → napaka ({A.get("napakaTag")})')
chk('tip FOTO' in str(A.get('napakaTip')), f'tip OGRAJA z doc* → napaka ({A.get("napakaTip")})')
chk('predolga' in str(A.get('napakaNote')), 'opomba > 200 znakov → napaka')
chk(A.get('docOfBrezTag') == 'm2', 'docOf brez taga je dovoljen (samo vezava)')
chk(A.get('segmentNeg') is None and A.get('segmentFloat') == 2 and A.get('segmentNull') is None, 'segment: negativ → null, float → round, smet → null')
chk(A.get('noteTrim') == 'abc', 'opomba se trima')
chk(A.get('ohraniPhoto') is True, 'zapis v params OHRANI obstoječe ključe (photo, stage) in doda doc*')
chk(A.get('pokvarjen') is True, 'pokvarjen JSON params ne povzroči izgeme doc polj')
chk(A.get('offline') is True, 'docOffline se zapiše (offline pot brez docOf)')
chk(A.get('prostor0') == 0 and A.get('prostor5') == 5 and A.get('prostorNeg') == 30, 'prostor: meja, rezerva in negativen vhod (fail-safe)')

# ═══ B) žičenje UI + offline + osnutek ═══════════════════════════════════════
print('── B) žičenje: kamera, confirm, offline, osnutek, sync ──')
KAMERA = 'src/components/roksal/modules/meritve-kamera.tsx'
chk(src_has(KAMERA, 'detajli'), 'kamera ima ločen seznam detajlov (ne pogledov)')
chk(src_has(KAMERA, 'prostorZaDokSlike(detajli.length) <= 0'), 'dodajanje dokumentacijske slike ima LASTNO mejo (ne MAX_VIEWS)')
chk(src_has(KAMERA, 'docOfMeasurementId: meritevId'), 'potrditev pošlje detajle ZA meritvijo z docOf vezavo')
chk(src_has(KAMERA, "JSON.stringify({ photo: d.dataUrl, stage: 'DOKUMENTACIJA' })"), 'detajl se shrani kot FOTO zapis z oznako faze DOKUMENTACIJA')
chk(src_has(KAMERA, 'docTag: d.tag'), 'offline vrsta nosi oznako detajla')
chk(src_has(KAMERA, 'dokSlike: detajli.map'), 'osnutek prenaša dokumentacijske slike (§6 brez izgube)')
chk(src_has(KAMERA, 'setDetajli(restoredDok)'), 'obnova osnutka vrne tudi detajle')
chk(src_has(KAMERA, 'setDetajli([]); setAddingDok(false)'), 'reset počisti detajle (nova seja)')
chk(src_has(KAMERA, "MAX_VIEWS = 4"), 'meja MERILNIH pogledov ostaja 4 (rekonstrukcija — namenoma)')
chk(src_has(KAMERA, 'DOC_TAG_LABELS'), 'UI izpiše človeško berljive oznake (ne surove kode)')
DRAFT = 'src/lib/measure-draft.ts'
chk(src_has(DRAFT, 'dokSlike?: DokSlikaVDraftu[]'), 'MeasureDraftSnapshot ima neobvezno polje dokSlike (stari zapisi veljavni)')
chk(src_has(DRAFT, 'Array.isArray(s.snapshot?.dokSlike)'), 'normalizacija osnutka bere dokSlike pošteno')
OFFL = 'src/lib/offline.ts'
chk(src_has(OFFL, 'docTag?: string | null'), 'QueuePhotoInput nosi docTag/docSegmentIdx/docNote')
chk(src_has(OFFL, "payload.docTag = input.docTag.trim()"), 'queuePhoto prenaša oznako v op')
SYNC = 'src/app/api/sync/route.ts'
chk(src_has(SYNC, 'docOffline: true'), 'opFoto zapiše docOffline: true (offline pot NE laže o vezu)')
chk(src_has(SYNC, 'jeVeljavenDocTag(docTag)'), 'opFoto zavrača neznano oznako (fail-closed transport)')
API = 'src/app/api/measurements/route.ts'
chk(src_has(API, 'preveriDocPolja({'), 'API preveri doc* polja pred zapisom')
chk(src_has(API, 'docOfMeasurementId: body.docOfMeasurementId'), 'API prebere docOf iz TOP-LEVEL (ne iz odjemalskih params)')
chk(src_has(API, 'Izvorna meritev ne obstaja'), 'neobstoječi docOf → jasna napaka (slepa vez je nemogoča)')
DOC = 'src/lib/measure-doc.ts'
chk(not src_has(DOC, "@/lib/db") and not src_has(DOC, "from 'next/"), 'measure-doc je ČIST modul (brez Prisma/next uvozov — testabilen)')

# ═══ C) živi API krog (samo ob delujočem strežniku) ════════════════════════
print('── C) živi API: doc* polja preživijo krog z veljavnimi vrati ──')
try:
    # Timeout 30 s: prvi GET / v dev načinu sproži kompilacijo (~7 s) — 5 s bi
    # lažno preskočilo blok na sicer zdravem strežniku (izkušnja R522).
    with urllib.request.urlopen(BASE + '/', timeout=30) as r:
        pass
except Exception:
    print('  ⏸ strežnik ne teče na BASE_URL — blok C se preskoči (ne zeleno)')
else:
    TOKEN = login('admin@roksal.si', 'Admin123!')
    # minimalen veljaven JPEG 1×1 (enačba ni predmet tega bloka)
    FOTO = ('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof'
            'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAA'
            'AAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAA'
            'AP/aAAgBAwEBPwF//9k=')

    # brez žetona → 401 (RBAC)
    s, d = callj('POST', '/api/measurements', body={'type': 'FOTO', 'params': json.dumps({'photo': FOTO})})
    chk(s == 401, f'brez žetona → 401 (dejansko {s})')

    # nazaj kompatibilno: star klic brez doc* → 201
    s, stara = callj('POST', '/api/measurements', TOKEN, {'type': 'FOTO', 'params': json.dumps({'photo': FOTO, 'opomba': 'r522 stara pot'})})
    chk(s == 201, f'star klic brez doc* deluje nespremenjeno ({s})')

    # neveljavna vrata
    s, d = callj('POST', '/api/measurements', TOKEN, {'type': 'FOTO', 'docTag': 'ZARJA'})
    chk(s == 400, f'neznana oznaka → 400 (dejansko {s})')
    s, d = callj('POST', '/api/measurements', TOKEN, {'type': 'OGRAJA', 'docTag': 'VIJAK', 'params': json.dumps({'points': [{'x': 0, 'y': 0}]})})
    chk(s == 400 and 'tip FOTO' in json.dumps(d, ensure_ascii=False), f'tip OGRAJA z doc* → 400 z razlago (dejansko {s})')
    s, d = callj('POST', '/api/measurements', TOKEN, {'type': 'FOTO', 'docOfMeasurementId': 'neobstojec-id-123'})
    chk(s == 400 and 'Izvorna meritev ne obstaja' in json.dumps(d, ensure_ascii=False), f'neobstoječi docOf → 400 (dejansko {s})')
    s, d = callj('POST', '/api/measurements', TOKEN, {'type': 'FOTO', 'docTag': 'VIJAK', 'docNote': 'y' * 201})
    chk(s == 400, f'predolga opomba → 400 (dejansko {s})')

    # VELJAVEN krog: izvorna meritev → 2 detajla z docOf
    if s in (200, 201, 400) and stara.get('data', {}).get('id'):
        izvor_id = stara['data']['id']
        s, dok1 = callj('POST', '/api/measurements', TOKEN, {
            'type': 'FOTO',
            'params': json.dumps({'photo': FOTO, 'stage': 'DOKUMENTACIJA'}),
            'docOfMeasurementId': izvor_id, 'docTag': 'VIJAK', 'docSegmentIdx': 0, 'docNote': 'M12 na betonskih sidrih',
        })
        chk(s == 201, f'dokumentacijska slika z docOf + oznako + segmentom → 201 (dejansko {s})')
        s, dok2 = callj('POST', '/api/measurements', TOKEN, {
            'type': 'FOTO',
            'params': json.dumps({'photo': FOTO, 'stage': 'DOKUMENTACIJA'}),
            'docOfMeasurementId': izvor_id, 'docTag': 'OVIRA',
        })
        chk(s == 201, f'drug detajl na isto izvorno meritev → 201 (več slik je legitimno, dejansko {s})')

        # preverba zapisov v bazi (strežnik, ne odjemalec)
        if dok1.get('data', {}).get('id') and dok2.get('data', {}).get('id'):
            P = bun_db(f'''
import {{ PrismaClient }} from '@prisma/client'
const db = new PrismaClient()
const p1 = await db.measurement.findUnique({{ where: {{ id: '{dok1['data']['id']}' }}, select: {{ params: true, type: true, status: true }} }})
const p2 = await db.measurement.findUnique({{ where: {{ id: '{dok2['data']['id']}' }}, select: {{ params: true }} }})
const o = JSON.parse(p1.params || '{{}}'), o2 = JSON.parse(p2.params || '{{}}')
console.log(JSON.stringify({{
  tip: p1.type, status: p1.status,
  docOf: o.docOf, docTag: o.docTag, docSegmentIdx: o.docSegmentIdx, docNote: o.docNote, stage: o.stage,
  docOffline: o.docOffline ?? false,
  docOf2: o2.docOf, docTag2: o2.docTag, docSegmentIdx2: o2.docSegmentIdx ?? null, brezNote: !('docNote' in o2),
}}))
await db.$disconnect()
''')
            chk(P.get('tip') == 'FOTO' and P.get('status') == 'ESTIMATED', f'zapis je FOTO z ESTIMATED (dokaz, ne poslovna mera — {P.get("tip")}/{P.get("status")})')
            chk(P.get('docOf') == izvor_id, 'params.docOf se ujema z izvorno meritvijo')
            chk(P.get('docTag') == 'VIJAK' and P.get('docSegmentIdx') == 0 and P.get('docNote') == 'M12 na betonskih sidrih', 'oznaka + segment + opomba preživijo krog')
            chk(P.get('stage') == 'DOKUMENTACIJA', 'faza DOKUMENTACIJA se shrani')
            chk(P.get('docOffline') is False, 'online pot NE zapiše docOffline (lažna oznaka bi zavajala)')
            chk(P.get('docOf2') == izvor_id and P.get('docTag2') == 'OVIRA', 'drugi detajl pravilno vezan (OVIRA)')
            chk(P.get('docSegmentIdx2') is None and P.get('brezNote') is True, 'neodločeni polji se ne zapišejo (ne null smeti)')

            # čiščenje (idempotentno ×2)
            for _ in range(2):
                C2 = bun_db(f'''
import {{ PrismaClient }} from '@prisma/client'
const db = new PrismaClient()
await db.measurement.delete({{ where: {{ id: '{dok1['data']['id']}' }}, }}).catch(() => {{}})
await db.measurement.delete({{ where: {{ id: '{dok2['data']['id']}' }}, }}).catch(() => {{}})
await db.measurement.delete({{ where: {{ id: '{izvor_id}' }}, }}).catch(() => {{}})
const n = await db.measurement.count({{ where: {{ id: {{ in: ['{dok1['data']['id']}', '{dok2['data']['id']}', '{izvor_id}'] }} }} }})
console.log(JSON.stringify({{ n }}))
await db.$disconnect()
''')
            chk(C2.get('n') == 0, 'testni zapisi počiščeni (idempotentno ×2)')

# ═══ D) dokazni artefakti (E2E skozi pravo aplikacijo) ══════════════════════
print('── D) dokazni artefakti E2E (ops/r522-ui-*.png) ──')
artefakti = sorted(a for a in os.listdir(os.path.join(REPO, 'ops')) if a.startswith('r522-ui-') and a.endswith('.png'))
chk(len(artefakti) >= 4, f'E2E dokazi obstajajo ({len(artefakti)} PNG: {", ".join(artefakti[:6])}…)')
neprazni = 0
for a in artefakti:
    try:
        if os.path.getsize(os.path.join(REPO, 'ops', a)) > 20000:
            neprazni += 1
    except OSError:
        pass
chk(neprazni >= 4, f'dokazi niso prazni ({neprazni} > 20 kB)')

print()
print(f'══ REZULTAT: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL > 0 else 0)
