#!/usr/bin/env python3
"""tests/r484.py — R484 (issue #2 P0 RECOVERY): docs/RECOVERY-STATUS.md —
dokazljiv popis virov + matrika A–E + varna kopija (Faza 0).

NE odvisnosti od peskovniških stanj (CI teče na ČISTEM checkoutu —
backupi in .pgdata tam NE obstajajo): preverja SAMO vsebino repa
(dokument, artefakti, zastarela opomba) + osnovni API sanity against
tekočo instanco (health + fail-closed RBAC za anonimne klice).

Preverja:
  A) obstoj + struktura dokumenta — VSEH 8 obveznih razdelkov issueja #2
     (povzetek preverjanj, viri, matrika A–E, ločitev, spremembe/varna
     kopija z SHA-256, blokade za lastnika, prednostni načrt, testi).
  B) matrika pokritost — vrstice A–E + VSAH 5 statusov (OHRANJENO /
     DELNO / DEMO/PLACEHOLDER / MANJKA / NEPREVERLJIVO).
  C) SHA-256 kontrolne vsote v dokumentu (regex 64 hex) + pot kopije.
  D) poštenost virov resnice: RECOVERY.md ima usmerjevalno opombo o
     zastarelosti; RECOVERY-STATUS.md NE trdi, da je GitLab kanonični
     vir (GitHub je — tranzicija R463).
  E) rešeni produkcijski artefakti obstajajo v repu (assets/ chunki +
     fonti, pages-samples/ 6 strani, chunks.txt) in so NEPRAZNI.
  F) skrivnosti: nov dokument NE vsebuje očitnih žetonov (glpat-/ghp_/sk-).
  G) API sanity: health 200 (public + auth), anonimni dostop do
     poslovnih virov fail-closed 401 (uporabniki, meritve, foto-viz,
     ponudbe).

Idempotentno: ne ustvarja NIČ (samo GET + branje datotek).
"""
import json, os, re, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOC = os.path.join(REPO, 'docs', 'RECOVERY-STATUS.md')
RECOVERY = os.path.join(REPO, 'docs', 'RECOVERY.md')
PASS, FAIL = 0, 0

def callj (method, path, token=None, body=None, timeout=30):
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

def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)

print('R484 — RECOVERY-STATUS.md (issue #2 P0 RECOVERY)')
print('════════════════════════════════════════════════')

# ── A) obstoj + struktura (8 obveznih točk issueja #2) ────────────────────────
print('A) Struktura dokumenta (8 obveznih točk)')
doc = open(DOC, encoding='utf-8').read() if os.path.isfile(DOC) else ''
chk(bool(doc), 'docs/RECOVERY-STATUS.md obstaja in ni prazen')
SECTIONS = [
    ('Povzetek dejansko preverjenega', 'točka 1: povzetek preverjanj'),
    ('Viri in dostopnost', 'točka 2: tabela virov'),
    ('Matrika funkcionalnosti A–E', 'točka 3: matrika A–E'),
    ('Ločitev: izvirnik / rekonstrukcija / artefakt / dokumentacija', 'točka 4: ločitev vrst vsebin'),
    ('Spremembe v tej reviziji (R484) in varna kopija', 'točka 5: spremembe + varna kopija'),
    ('Blokade, ki zahtevajo lastnika', 'točka 6: blokade za lastnika'),
    ('Prednostni načrt nadaljnjih issuejev', 'točka 7: prednostni načrt'),
    ('Testi — dejanski rezultati', 'točka 8: testi z rezultati'),
]
for needle, label in SECTIONS:
    chk(needle in doc, f'{label} (»{needle}«)')

# ── B) matrika pokritost ──────────────────────────────────────────────────────
print('B) Matrika A–E + statusi')
MATRIX_ROWS = [
    ('A', 'Kamera in meritve'),
    ('B', 'Realistična zamenjava na fotografiji'),
    ('C', 'Izračuni in ponudba'),
    ('D', 'Katalogi in gradiva'),
    ('E', 'Poslovni sistem'),
]
for letter, name in MATRIX_ROWS:
    chk(f'**{letter}**' in doc and name in doc, f'vrstica {letter}: {name}')
for status in ['OHRANJENO', 'DELNO', 'DEMO/PLACEHOLDER', 'MANJKA', 'NEPREVERLJIVO']:
    chk(status in doc, f'status {status} je v matriki/legendi definiran')

# ── C) SHA-256 vrednosti varne kopije ─────────────────────────────────────────
print('C) Kontrolne vsote varne kopije v dokumentu')
shas = re.findall(r'\b[0-9a-f]{64}\b', doc)
chk(len(shas) >= 2, f'dokument vsebuje ≥2 SHA-256 vrednosti (najdenih: {len(shas)})')
chk('/home/z/roksal-backups/' in doc, 'pot varne kopije (izven repa) je navedena')

# ── D) vir resnice (poštenost) ────────────────────────────────────────────────
print('D) Vir resnice / zastarela trditev')
rec = open(RECOVERY, encoding='utf-8').read() if os.path.isfile(RECOVERY) else ''
chk('Zastarelo glede vira resnice — glej docs/RECOVERY-STATUS.md (R484)' in rec,
    'RECOVERY.md ima usmerjevalno opombo o zastarelosti (ena vrstica, brez prepisa vsebine)')
chk('GitLab je kanonični vir' not in doc,
    'RECOVERY-STATUS.md NE trdi »GitLab je kanonični vir« (GitLab je blokiran)')
chk('GitHub' in doc and 'kanonični vir' in doc,
    'RECOVERY-STATUS.md navaja GitHub kot kanonični vir (tranzicija R463)')

# ── E) rešeni produkcijski artefakti v repu ───────────────────────────────────
print('E) Artefakti izvirnika (assets/, pages-samples/)')
chunks_dir = os.path.join(REPO, 'assets', '_next', 'static', 'chunks')
chunks = os.listdir(chunks_dir) if os.path.isdir(chunks_dir) else []
chk(len(chunks) >= 15, f'assets/_next/static/chunks/ obstaja in je neprazen ({len(chunks)} datotek)')
assets_all = [os.path.join(dp, f) for dp, _, fs in os.walk(os.path.join(REPO, 'assets')) for f in fs]
chk(len(assets_all) >= 20, f'assets/ skupaj ≥20 datotek (chunki + fonti: {len(assets_all)})')
ps_dir = os.path.join(REPO, 'pages-samples')
ps_html = [f for f in os.listdir(ps_dir) if f.endswith('.html')] if os.path.isdir(ps_dir) else []
chk(len(ps_html) == 6, f'pages-samples/ vsebuje 6 vzorčnih strani izvirnika ({len(ps_html)})')
chk(os.path.isfile(os.path.join(REPO, 'chunks.txt')), 'chunks.txt (seznam rešenih chunkov) obstaja')

# ── F) skrivnosti ─────────────────────────────────────────────────────────────
print('F) Sken brez žetonov v novem dokumentu')
for pattern, label in [('glpat-', 'GitLab PAT'), ('ghp_', 'GitHub PAT'), ('sk-', 'API ključ')]:
    hits = re.findall(re.escape(pattern) + r'[A-Za-z0-9_\-]{8,}', doc)
    chk(not hits, f'brez očitnih žetonov ({label}): 0 zadetkov')

# ── G) API sanity (tekoča instanca) ───────────────────────────────────────────
print('G) API sanity + fail-closed RBAC')
s, d = callj('GET', '/api/public/health')
chk(s == 200 and d.get('ok') is True and d.get('db') == 'ok', f'GET /api/public/health → 200 ok (db ok)')
s, d = callj('GET', '/api/health')
chk(s == 200 and d.get('status') == 'ok', f'GET /api/health → 200 ok')
for method, path, label in [
    ('GET', '/api/users', 'uporabniki'),
    ('GET', '/api/measurements', 'meritve'),
    ('POST', '/api/photo-visualization', 'foto-vizualizacije'),
    ('GET', '/api/quotes', 'ponudbe'),
]:
    s, _ = callj(method, path)
    chk(s == 401, f'anonimni {method} {path} → 401 (fail-closed: {label})')

print('════════════════════════════════════════════════')
print(f'REZULTAT: {PASS} ✓ / {FAIL} ✗ (skupaj {PASS + FAIL})')
sys.exit(1 if FAIL else 0)
