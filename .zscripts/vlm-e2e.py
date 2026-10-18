#!/usr/bin/env python3
""" .zscripts/vlm-e2e.py — R562: ŽIVO preverjanje GLM-4.6V prek strežnika (end-to-end).

Lastnikov ukaz: »(GLM-4.6V prek strežnika) je zastonj, deluje — preveri, če ne,
skripte naredi.« Skript gre ČEZ živi dev strežnik (localhost:3000) kot monter
in preveri VSE tri foto-VLM rute z REALNIMA fotografijama iz kataloga (ne 1×1 px
past iz r559 — VLM zavrača <24 px slike):

  1) POST /api/ar/analyze      { photo }  → 200 + scene/placement/obstacles/references
  2) POST /api/ar/inspect      { photo }  → 200 + jeOgraja/materiali/tla/vogali/mere/prizor/objekti/varnost
  3) POST /api/ar/analyze-multi{ photos×2}→ 200 + dims/warnings

Zagon: python3 .zscripts/vlm-e2e.py [BASE_URL]
Izhod: poročilo + /tmp/r562-vlm-e2e.json (dokaz za worklog).
"""
import base64, json, os, sys, time, urllib.request, urllib.error

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG1 = os.path.join(REPO, 'public/assets/roksal/src/r495-deske-za-ograje-wpc-precna-balkonska-ograja_378.jpg')
IMG2 = os.path.join(REPO, 'public/assets/roksal/src/r495-woodcore-rustic-oak-zel-detajl.jpg')

PASS, FAIL = 0, 0


def ok (msg):
    global PASS; PASS += 1; print(f'  ✓ {msg}')


def bad (msg):
    global FAIL; FAIL += 1; print(f'  ✗ {msg}')


def data_url (path):
    with open(path, 'rb') as f:
        return 'data:image/jpeg;base64,' + base64.b64encode(f.read()).decode()


def call (method, path, token=None, body=None, timeout=120):
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


report = {'base': BASE, 'routes': {}, 'createdAt': time.strftime('%Y-%m-%dT%H:%M:%S')}
print(f'════ GLM-4.6V ŽIVO prek strežnika — e2e (R562) ════')

# prijava (monter — measurements.write)
s, d = call('POST', '/api/auth/login', body={'email': 'monter@roksal.si', 'password': 'Monter123!'})
assert s == 200, f'prijava monter: {s} {d}'
tok = d['token']
ok(f'prijava monter@roksal.si (žeton {len(tok)} znakov)')

P1, P2 = data_url(IMG1), data_url(IMG2)
print(f'  sliki: WPC ograja {len(P1)//1024} kB · les detajl {len(P2)//1024} kB')

# 1) /api/ar/analyze
print('── 1) POST /api/ar/analyze (svetovalec za postavitev)')
t0 = time.time()
s, d = call('POST', '/api/ar/analyze', tok, {'photo': P1, 'hint': 'terasna ograja WPC'})
ms = round((time.time() - t0) * 1000)
report['routes']['analyze'] = {'status': s, 'ms': ms, 'body': d if s == 200 else str(d)[:300]}
if s == 200:
    a = d.get('data', {})
    ok(f'200 v {ms} ms — scene: {a.get("scene", "")[:70]}')
    ok(f'placement: {len(a.get("placement", []))} predlogi; obstacles: {len(a.get("obstacles", []))}; references: {len(a.get("references", []))}')
elif s == 422:
    bad(f'422 v {ms} ms — VLM ni prepoznal (neveljavna slika?)')
else:
    bad(f'{s} v {ms} ms: {json.dumps(d)[:160]}')

# 2) /api/ar/inspect (najbolj popolna shema R559/R560/R561)
print('── 2) POST /api/ar/inspect (odprta inventura)')
t0 = time.time()
s, d = call('POST', '/api/ar/inspect', tok, {'photo': P1})
ms = round((time.time() - t0) * 1000)
report['routes']['inspect'] = {'status': s, 'ms': ms, 'summary': {}, 'body': d if s == 200 else str(d)[:300]}
if s == 200:
    a = d.get('data', {})
    mat = a.get('materiali', []); tla = a.get('tla', {}); mere = a.get('mere', [])
    prizor = a.get('prizor', {}); obj = a.get('objekti', []); var = a.get('varnost', [])
    rep = report['routes']['inspect']['summary']
    rep.update(jeOgraja=a.get('jeOgraja'), materiali=len(mat), mere=len(mere), objekti=len(obj), varnost=len(var))
    ok(f'200 v {ms} ms — jeOgraja: {a.get("jeOgraja")}')
    ok(f'materiali: {len(mat)} ({", ".join(m.get("vrsta", "?") for m in mat[:4])}…)')
    ok(f'tla: {tla.get("vrsta", "?")} · ploščica ≈{tla.get("ploscicaDolzinaCm")}×{tla.get("ploscicaSirinaCm")} cm')
    ok(f'vogali: {len(a.get("vogali", []))} · mere: {len(mere)} · objekti: {len(obj)} · varnost: {len(var)}')
    ok(f'prizor: {prizor.get("tip", "?")} · svetloba: {str(prizor.get("svetloba", "?"))[:40]}')
else:
    bad(f'{s} v {ms} ms: {json.dumps(d)[:200]}')

# 3) /api/ar/analyze-multi (prečka)
print('── 3) POST /api/ar/analyze-multi (prečka 2 fotografiji)')
t0 = time.time()
s, d = call('POST', '/api/ar/analyze-multi', tok, {'photos': [P1, P2]})
ms = round((time.time() - t0) * 1000)
report['routes']['analyze-multi'] = {'status': s, 'ms': ms, 'body': d if s == 200 else str(d)[:300]}
if s == 200:
    a = d.get('data', {})
    dims = a.get('dims', []); warns = a.get('warnings', [])
    ok(f'200 v {ms} ms — dims: {len(dims)}; warnings: {len(warns)}')
    if dims: ok(f'prva dimenzija: {json.dumps(dims[0])[:120]}')
else:
    bad(f'{s} v {ms} ms: {json.dumps(d)[:200]}')

with open('/tmp/r562-vlm-e2e.json', 'w') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print(f'════ konec: {PASS} ✓ / {FAIL} ✗ — dokaz: /tmp/r562-vlm-e2e.json ════')
sys.exit(1 if FAIL else 0)
