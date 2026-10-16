#!/usr/bin/env python3
"""tests/r527.py — R527 (issue #14 §5): izrecna oznaka generičnih demo izdelkov.

Zakaj ta suite (odprta točka issue #14 §5: »gradiva (ali izrecna oznaka
»generični izdelek, ni ROKSALOV original«) za OGR-K-001/002, OGR-P-001/002,
TER-WPC-001/002, TER-ALU-001, FAS-L-001, FAS-K-002«):

  Oskrba uradnih gradiv za generične demo izdelke je lastnikova stran (težava
  #6); poročilo docs/FOTOZAMENJAVA-POROCILO-14.md §5 dovoljuje kot ALTERNATIVO
  izrecno oznako. R527 jo nosi — to je ta suite:

  A) pravilo identitete (src/lib/katalog-original.ts): ROK- predpona točno
     razvrsti vseh 9 generičnih in vseh 8 ROKSALOVIH originalov
     fotomontažnih družin + robni primeri (prazno, delna predpona, mala črka).
  B) živi katalog (baza): pravilo je TOČEN klasifikator — generični imajo
     0 preverjenih gradiv, vsi ROK- originali ≥ 1 (kar pomeni: oznaka ne more
     zgrešiti niti v eno smer).
  C) žičenje UI: oznaka v izbiri izdelka (»— generični«), opozorilo ob izbiri
     (OZNAKA_GENERIKA po besedilu poročila), vrstica v rezultatu POTEM,
     oznaka v seznamu shranjenih variant in v javnem pregledu povezav.
  D) živi API (samo ob delujočem strežniku): /api/products?family=all vrne
     točno 9 generičnih v fotomontažnih družinah (isti seznam kot poročilo).

Iskrene meje (issue #14 ostaja odprt po oskrbovalni strani):
  - oznaka je ALTERNATIVA, ne nadomestilo: ko lastnik pridobije uradna gradiva
    za te izdelke, oznaka ostane točna le toliko, da SKU dobi predpono ROK-
    (dogma kataloga, zapisana v knjižnici);
  - pravilo je DOGMA predpone, ne lastnost baze — nov ROKSALOV izdelek brez
    predpone bi bil napačno označen; test B to odkrije (asset brez ROK- SKU).

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

# Seznam iz poročila docs/FOTOZAMENJAVA-POROCILO-14.md §5 (točno 9):
GENERIKI = ['OGR-K-001', 'OGR-K-002', 'OGR-P-001', 'OGR-P-002',
            'TER-WPC-001', 'TER-WPC-002', 'TER-ALU-001',
            'FAS-L-001', 'FAS-K-002']
# Vsi ROKSALOVI originali v 4 fotomontažnih družinah (točno 8):
ORIGINALI = ['ROK-OG-ROMB-67', 'ROK-OG-POLNA-128', 'ROK-OG-DESKA-150',
             'ROK-OGP-POLNA-100', 'ROK-OGP-POLNA-57',
             'ROK-TER-KLASIK', 'ROK-TER-RUSTIC', 'ROK-FAS-KUBO']
FOTO_DRUZINE = ['OGRAJA_PRECNA', 'OGRAJA_POKOCNA', 'FASADA', 'TERASA']


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
        # R537: veliki moduli so razbiti v podmapo (modul.tsx + modul/*) —
        # statični pregled velja za celo funkcionalnost, ne samo datoteko.
        p = os.path.join(REPO, relpath)
        with open(p, encoding='utf-8') as f:
            besedilo = f.read()
        podmapa = p.rsplit('.', 1)[0]
        if os.path.isdir(podmapa):
            for ime in sorted(os.listdir(podmapa)):
                if ime.endswith(('.ts', '.tsx')):
                    with open(os.path.join(podmapa, ime), encoding='utf-8') as f:
                        besedilo += '\n' + f.read()
        return needle in besedilo
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


print('═══ R527: izrecna oznaka generičnih demo izdelkov (issue #14 §5, alternativa b) ═══')

# ═══ A) pravilo identitete — čista funkcija ═══════════════════════════════════
print('── A) katalog-original: ROK- predpona kot klasifikator ──')
A = bun_js(r'''
const lib = await import('./src/lib/katalog-original')
const generiki = ['OGR-K-001', 'OGR-K-002', 'OGR-P-001', 'OGR-P-002',
  'TER-WPC-001', 'TER-WPC-002', 'TER-ALU-001', 'FAS-L-001', 'FAS-K-002']
const originali = ['ROK-OG-ROMB-67', 'ROK-OG-POLNA-128', 'ROK-OG-DESKA-150',
  'ROK-OGP-POLNA-100', 'ROK-OGP-POLNA-57', 'ROK-TER-KLASIK', 'ROK-TER-RUSTIC',
  'ROK-FAS-KUBO']
console.log(JSON.stringify({
  generikiVsi: generiki.every((s) => lib.jeGenericniIzdelek(s)),
  generikiNobenOriginal: generiki.every((s) => !lib.jeOriginalIzdelek(s)),
  originaliVsi: originali.every((s) => lib.jeOriginalIzdelek(s)),
  originaliNobenGenerik: originali.every((s) => !lib.jeGenericniIzdelek(s)),
  robni: {
    prazno: lib.jeGenericniIzdelek(''),
    samaPredpona: lib.jeOriginalIzdelek('ROK-'),
    brezPredpone: lib.jeOriginalIzdelek('ROK'),
    malaCrka: lib.jeOriginalIzdelek('rok-og-x'),
  },
  oznaka: lib.OZNAKA_GENERIKA,
}))
''')
chk(A.get('generikiVsi') is True and A.get('generikiNobenOriginal') is True,
    f'vseh 9 generičnih prepoznanih (generikiVsi={A.get("generikiVsi")})')
chk(A.get('originaliVsi') is True and A.get('originaliNobenGenerik') is True,
    f'vseh 8 originalov prepoznanih (originaliVsi={A.get("originaliVsi")})')
rob = A.get('robni', {})
chk(rob.get('prazno') is True and rob.get('samaPredpona') is True
    and rob.get('brezPredpone') is False and rob.get('malaCrka') is False,
    f'robni primeri: prazno→generik, ROK-→original, ROK→generik, rok-→generik ({rob})')
chk(A.get('oznaka') == 'Generični izdelek, ni ROKSALOV original',
    f'oznaka po besedilu poročila §5: {A.get("oznaka")!r}')

# ═══ B) živi katalog — pravilo je TOČEN klasifikator ══════════════════════════
print('── B) živi katalog: oznaka sovpada s prisotnostjo gradiv ──')
B = bun_db(r'''
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const druzine = ['OGRAJA_PRECNA', 'OGRAJA_POKOCNA', 'FASADA', 'TERASA']
const izdelki = await db.product.findMany({
  where: { family: { code: { in: druzine } }, active: true },
  select: { sku: true, _count: { select: { assets: true } } },
})
const zGradivi = izdelki.filter((p) => p._count.assets > 0).map((p) => p.sku).sort()
const brez = izdelki.filter((p) => p._count.assets === 0).map((p) => p.sku).sort()
console.log(JSON.stringify({
  skupaj: izdelki.length,
  zGradivi, brez,
  zGradiviVsiROK: zGradivi.every((s) => s.startsWith('ROK-')),
  brezNobenROK: !brez.some((s) => s.startsWith('ROK-')),
}))
await db.$disconnect()
''')
chk(B.get('skupaj') == 17, f'17 izdelkov v 4 fotomontažnih družinah (dejansko {B.get("skupaj")})')
chk(B.get('zGradiviVsiROK') is True and B.get('brezNobenROK') is True,
    'predponsko pravilo ≡ prisotnost gradiv: vsi z gradivi so ROK-, vsi brez gradiv niso')
chk(sorted(B.get('brez', [])) == sorted(GENERIKI),
    f'brez gradiv so TOČNO generiki iz poročila ({len(B.get("brez", []))} : {B.get("brez")})')
chk(all(s in (B.get('zGradivi') or []) for s in ORIGINALI),
    f'vseh 8 originalov ima gradiva ({len(B.get("zGradivi", []))} z gradivi)')

# ═══ C) žičenje UI — oznaka vseh petih mest ═══════════════════════════════════
print('── C) žičenje: izbira, opozorilo, rezultat, shranjene, javni pregled ──')
chk(src_has('src/lib/katalog-original.ts', "sku.startsWith('ROK-')"),
    'katalog-original.ts nosi predponsko pravilo')
chk(src_has('src/lib/katalog-original.ts', 'Generični izdelek, ni ROKSALOV original'),
    'katalog-original.ts nosi OZNAKA_GENERIKA po besedilu poročila')
chk(src_has('src/components/roksal/modules/foto-replace.tsx',
            "jeGenericniIzdelek(p.sku) ? ' — generični' : ''"),
    'izbira izdelka: dopolnilo »— generični« ob vsakem generičnem')
chk(src_has('src/components/roksal/modules/foto-replace.tsx', 'genericni-izdelek-opozorilo'),
    'korak IZDELEK: opozorilo (data-testid) ob izbiri generičnega')
chk(src_has('src/components/roksal/modules/foto-replace.tsx',
            "{OZNAKA_GENERIKA + ' — izris je barvni približek.'}"),
    'izbira gradiva (korak Označi): vrstica oznake ob generičnem izdelku')
chk(src_has('src/components/roksal/modules/foto-replace.tsx', 'genericni-izdelek-potem'),
    'rezultat POTEM: oznaka ob samem izrisu (data-testid)')
chk(src_has('src/components/roksal/modules/foto-replace.tsx',
            "{OZNAKA_GENERIKA + '.'}"),
    'rezultat POTEM: izrecni napis oznake nad razlago')
chk(src_has('src/components/roksal/modules/foto-replace.tsx',
            "jeGenericniIzdelek(r.product.sku) ? ' (generični)' : ''"),
    'seznam shranjenih vizualizacij: oznaka ob generičnem izdelku')
chk(src_has('src/components/roksal/modules/foto-replace-links.tsx',
            'jeGenericniIzdelek(c.visualization.product.sku)'),
    'javni pregled povezav: oznaka vidi tudi stranka')
chk(src_has('src/components/roksal/modules/foto-replace.tsx',
            'Izdelki z dopolnilom »— generični« so demo izdelki brez preverjenih gradiv'),
    'razlaga pod izbiro: pove, kaj dopolnilo pomeni')

# ═══ D) živi API (samo ob delujočem strežniku) ═══════════════════════════════
print('── D) živi API: katalog, ki ga vidi fotomontaža ──')
try:
    with urllib.request.urlopen(BASE + '/', timeout=5) as r:
        pass
except Exception:
    print('  ⏸ strežnik ne teče na BASE_URL — blok D se preskoči (ne zeleno)')
else:
    TOKEN = login('admin@roksal.si', 'Admin123!')
    s, prods = callj('GET', '/api/products?family=all', TOKEN)
    foto = [p for p in prods.get('data', []) if p.get('family', {}).get('code') in FOTO_DRUZINE]
    gen = sorted(p['sku'] for p in foto if not p['sku'].startswith('ROK-'))
    rok = sorted(p['sku'] for p in foto if p['sku'].startswith('ROK-'))
    chk(len(foto) == 17, f'API vrne 17 izdelkov fotomontažnih družin (dejansko {len(foto)})')
    chk(gen == sorted(GENERIKI), f'generični po API = seznam poročila ({gen})')
    chk(rok == sorted(ORIGINALI), f'originali po API = seznam poročila ({rok})')

print()
print(f'══ REZULTAT: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL > 0 else 0)
