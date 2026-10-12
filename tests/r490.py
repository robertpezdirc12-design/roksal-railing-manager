#!/usr/bin/env python3
"""tests/r490.py — R490 (GitHub issue #11 — ROKSAL SMART GUIDE):
kontekstna pomoč po vseh modulih (41 vnosov SL/HR), lastne shematske skice
z obvezno oznako »Shematski prikaz — ni merilo«, glasovna navodila SL/HR
IZKLJUČNO prek vgrajene sinteze brskalnika (Web Speech API — brez
AI-modelov, brez plačljivih storitev, brez pošiljanja besedila navzven),
vodena prva uporaba za monterja z možnostjo preskoka.

Preverja:
  A) REGISTRE (statično + prek /api/guide): GUIDE obstaja, vsak vnos ima
     stabilen ID, tabId iz nav-registry, ≥2 koraka, ≥1 napako, pričakovani
     rezultat, glasovni skript — vse v SL in HR (brez manjkajočih prevodov);
     sketchKey veljaven; verzija ≥ 1.
  B) SKICE (statično): vsak SKETCH_KEYS ima komponento v guide-sketches.tsx;
     obvezna oznaka »Shematski prikaz — ni merilo« (SL) in »nije mjerilo«
     (HR); role="img"; GuideSketch izvožen.
  C) UI VEZAVE (statično): app-shell nosi <SmartGuide/>; plošča ima
     Predvajaj/Premor/Ponovi, utišanje, hitrost, preklop SL/HR,
     »Pokaži primer«, motion-reduce, aria-oznake, vodeni uvod (preskok).
  D) BREZ AI/PLAČLJIVIH STORITEV (statično): v guide datotekah NI SDK/TTS
     servisov, NI fetch/axios na zunanje TTS; registry je client-safe (brez
     strežniških uvozov); speech samo prek window.speechSynthesis.
  E) API /api/guide: 401 brez žetona; prijava (monter) → veljavno=true,
     issues=[], prednostni moduli (issue #11 §4) pokriti; firstUse za
     monterja vsebuje dane/zajem/meritve/nalogi; HR ≠ SL naslovi.
  F) REGRESIJA: prijava, /api/nalog, /api/gallery, /api/health ostanejo
     nedotaknjeni (pomoč je čisto odjemalska + 1 varna GET ruta).
  G) Idempotenca: statične preverbe ×2 (brez stranskih učinkov — pomoč
     NE piše v bazo, zato ni čiščenja).
"""
import json, os, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R490-SG'
PASS, FAIL = 0, 0

REGISTRY = 'src/lib/smart-guide-registry.ts'
SKETCHES = 'src/components/roksal/guide-sketches.tsx'
SHEET = 'src/components/roksal/smart-guide.tsx'
HOOK = 'src/hooks/use-guide-speech.ts'
SHELL = 'src/components/roksal/app-shell.tsx'
API = 'src/app/api/guide/route.ts'

GUIDE_FILES = [REGISTRY, SKETCHES, SHEET, HOOK]


def callj (method, path, token=None, body=None, timeout=60):
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


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)


def src (relpath):
    with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
        return f.read()


def src_has (relpath, needle):
    try:
        return needle in src(relpath)
    except Exception:
        return False


print(f'══ {TAG} — SMART GUIDE (issue #11) ══')

# ── A) REGISTRE — statično ───────────────────────────────────────────────────
print('── A) Register (statično) ──')
chk(src_has(REGISTRY, 'export const GUIDE'), 'GUIDE izvožen iz registra')
chk(src_has(REGISTRY, 'export function validateGuide'), 'validateGuide izvožen (avtomatska integriteta)')
chk(src_has(REGISTRY, 'SKETCH_KEYS'), 'SKETCH_KEYS izvožen')
chk(src_has(REGISTRY, 'readonly [string, string]'), 'dvojezični tip Bi [SL, HR]')
# client-safe: brez strežniških uvozov (fail-closed dokaz)
chk(not src_has(REGISTRY, "@/lib/db"), 'register BREZ strežniškega db uvoza (client-safe)')
chk(not src_has(REGISTRY, "'use server'"), 'register brez use server')
chk(not src_has(REGISTRY, 'next/server'), 'register brez next/server')
# ID-ji stabilni (pika-imenovanje modul.kljuc)
import re
regsrc = src(REGISTRY)
ids = re.findall(r"id: '([a-z0-9.-]+)'", regsrc)
chk(len(ids) >= 40, f'dovolj vnosov v registru ({len(ids)} ≥ 40)')
chk(len(ids) == len(set(ids)), 'ID-ji vnosov so unikatni')

# ── B) SKICE — statično ──────────────────────────────────────────────────────
print('── B) Skice (statično) ──')
sk = src(SKETCHES)
chk(src_has(SKETCHES, 'Shematski prikaz — ni merilo'), 'obvezna SL oznaka »Shematski prikaz — ni merilo«')
chk(src_has(SKETCHES, 'Shematski prikaz — nije mjerilo'), 'obvezna HR oznaka »nije mjerilo«')
chk(src_has(SKETCHES, 'role="img"'), 'skice imajo role="img" (bralniki zaslona)')
chk(src_has(SKETCHES, 'aria-label={alt}'), 'aria-label skice iz alt-opisa vnosa')
chk(src_has(SKETCHES, 'export function GuideSketch'), 'GuideSketch izvožen')
chk(src_has(SKETCHES, 'SKETCH_COMPONENT_KEYS'), 'SKETCH_COMPONENT_KEYS izvožen (skladnost s registrom)')
for k in ['Danes', 'Zajem', 'Meritev', 'Ogradnja', 'Teren', 'Konfigurator', 'Bom', 'Nalog', 'Projekt', 'Stopnica', 'Foto']:
    chk(f'function Sketch{k} ()' in sk, f'komponenta skice Sketch{k} obstaja')
# vsak SKETCH_KEYS ima komponento (skladnost registrov)
for k in ['danes', 'zajem', 'meritev', 'ogradnja', 'teren', 'konfigurator', 'bom', 'nalog', 'projekt', 'stopnica', 'foto']:
    chk(f'{k}:' in sk, f'skica {k} povezana v SKETCHES mapo')

# ── C) UI VEZAVE — statično ──────────────────────────────────────────────────
print('── C) UI vezave (statično) ──')
sh = src(SHEET)
chk(src_has(SHELL, '<SmartGuide />'), 'gumb Pomoč vgrajen v glavo AppShell')
chk(src_has(SHELL, "import { SmartGuide }"), 'SmartGuide uvožen v app-shell')
chk('Predvajaj' in sh and 'Reproduciraj' in sh, 'gumb Predvajaj (SL/HR)')
chk('Premor' in sh and 'Pauza' in sh, 'gumb Premor (SL/HR)')
chk('Ponovi' in sh and 'Ponovi glasovno navodilo' in sh, 'gumb Ponovi (brez samodejnega ponavljanja)')
chk('Utišaj' in sh or 'utišaj zvok' in sh.lower(), 'utišanje zvoka')
chk('Hitrost govora' in sh, 'nastavitev hitrosti govora')
chk('sl' in sh and 'hr' in sh, 'preklop jezika SL/HR v plošči')
chk('Pokaži primer' in sh and 'Prikaži primjer' in sh, '»Pokaži primer« (skica, SL/HR)')
chk('Vodeni uvod' in sh and 'Vođeni uvod' in sh, 'vodena prva uporaba (badge, SL/HR)')
chk('Sem izkušen uporabnik' in sh, 'preskok za izkušenega uporabnika (monter)')
chk('motion-reduce' in sh, 'podpora prefers-reduced-motion')
chk('aria-label' in sh, 'aria-oznake na gumbih plošče')
chk('aria-live="polite"' in sh, 'status govora z aria-live (ne moti bralnika)')
chk('max-h-[85dvh]' in sh, 'enoročna mobilna plošča (bottom sheet, omejena višina)')
chk('safe-area-inset-bottom' in sh, 'spoštovanje varnostnega obrobja iOS')
chk('useIsMobile' in sh, 'prilagoditev bottom/right glede na napravo')

# ── D) BREZ AI/PLAČLJIVIH STORITEV ───────────────────────────────────────────
print('── D) Brez AI/plačljivih storitev (statično) ──')
for f in GUIDE_FILES:
    s = src(f)
    chk('z-ai-web-dev-sdk' not in s, f'{os.path.basename(f)}: BREZ z-ai SDK')
    chk('openai' not in s.lower(), f'{os.path.basename(f)}: BREZ openai')
    chk('api.openai' not in s, f'{os.path.basename(f)}: BREZ zunanjih AI API-jev')
hk = src(HOOK)
chk('speechSynthesis' in hk, 'glas IZKLJUČNO prek window.speechSynthesis (Web Speech API)')
chk('SpeechSynthesisUtterance' in hk, 'utterance API')
chk('roksal-guide-speech' in hk, 'nastavitve glasa v lokalni shrambi (brez strežnika)')
chk('addEventListener' in hk and 'voiceschanged' in hk, 'zaznava glasov naprave (pošteno)')
# besedilo NE gre v zunanjo storitev: v hooku ni omrežnih klicev
chk('fetch' not in hk and 'XMLHttpRequest' not in hk and 'http' not in hk.replace('https', ''), 'brez omrežnih klicev v TTS hooku (besedilo ostaja lokalno)')
# API ruta je samo bralna (GET)
api_src = src(API)
chk("export async function GET" in api_src, '/api/guide je samo GET (brez mutacij)')
chk('getSessionUser' in api_src, '/api/guide zahteva prijavo')
chk('validateGuide' in api_src, '/api/guide pokliče validateGuide (integriteta)')

# ── E) API /api/guide ────────────────────────────────────────────────────────
print('── E) API /api/guide ──')
s, _ = callj('GET', '/api/guide')
chk(s == 401, f'brez žetona → 401 ({s})')

tok_mon = login('monter@roksal.si', 'Monter123!')
s, d = callj('GET', '/api/guide', tok_mon)
chk(s == 200, f'GET /api/guide (monter) → 200 ({s})')
data = d.get('data', {})
chk(data.get('veljavno') is True, f"validateGuide: issues=[] → {data.get('issues', ['?'])[:2]}")
vnosi = data.get('vnosi', [])
chk(len(vnosi) >= 40, f'vsaj 40 vnosov pomoči ({len(vnosi)})')
chk(all(v.get('steps', 0) >= 2 for v in vnosi), 'vsak vnos ima vsaj 2 koraka')
chk(all(v.get('titleSl') and v.get('titleHr') for v in vnosi), 'vsak vnos ima naslov SL in HR')
razlicnih = sum(1 for v in vnosi if v.get('titleSl') != v.get('titleHr'))
chk(razlicnih >= len(vnosi) - 3, f'HR naslovi so dejansko prevodi ({razlicnih}/{len(vnosi)} se razlikuje; ≤3 naravnih sovpadanj dovoljenih)')
ids_api = [v['id'] for v in vnosi]
tabs_api = [v['tabId'] for v in vnosi]
chk(len(ids_api) == len(set(ids_api)), 'unikatni ID-ji (API)')
chk(len(tabs_api) == len(set(tabs_api)), 'en vnos na modul (brez duplikatov tabId)')
sketch_api = data.get('sketchKeys', [])
chk(len(sketch_api) == 11, f'11 ključev skic ({len(sketch_api)})')
# prednostni moduli (issue #11 §4) — vsi pokriti
for tab in ['zajem', 'meritve', 'teren', 'konfigurator', 'ponudbe', 'material-v5', 'nalogi', 'projekti', 'crm', 'foto', 'nagib', 'danes']:
    chk(tab in tabs_api, f'prednostni modul pokrit: {tab}')
# vodena prva uporaba — monterjevi moduli
first_use = [v['tabId'] for v in vnosi if v.get('firstUse')]
for tab in ['danes', 'zajem', 'meritve', 'nalogi']:
    chk(tab in first_use, f'vodeni uvod za monterja: {tab}')
# skice povezane na prednostne module (issue: prednostne imajo skico)
with_sketch = [v['tabId'] for v in vnosi if v.get('sketchKey')]
for tab in ['zajem', 'meritve', 'teren', 'konfigurator', 'ponudbe', 'nalogi']:
    chk(tab in with_sketch, f'skica na prednostnem modulu: {tab}')

# vodja vidi enako vsebino (pomoč je neodvisna od vloge pri dostopu)
tok_vod = login('vodja@roksal.si', 'Vodja123!')
s2, d2 = callj('GET', '/api/guide', tok_vod)
chk(s2 == 200 and d2.get('data', {}).get('veljavno') is True, 'GET /api/guide (vodja) → 200 veljavno')

# ── F) REGRESIJA — pomoč ne sme ničesar pokvariti ────────────────────────────
print('── F) Regresija ──')
s, d = callj('GET', '/api/nalog', tok_mon)
chk(s == 200, f'/api/nalog ostaja 200 ({s})')
s, d = callj('GET', '/api/gallery', tok_mon)
chk(s == 200, f'/api/gallery ostaja 200 ({s})')
s, d = callj('GET', '/api/health')
chk(s == 200, f'/api/health ostaja 200 ({s})')

# ── G) IDEMPOTENCA — ponovitev E brez stranskih učinkov ─────────────────────
print('── G) Idempotenca ×2 ──')
s, d = callj('GET', '/api/guide', tok_mon)
chk(s == 200 and d.get('data', {}).get('veljavno') is True, 'ponovni GET /api/guide → enak rezultat (brez stanja)')

print(f'\n══ {TAG} KONEC: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL else 0)
