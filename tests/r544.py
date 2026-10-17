#!/usr/bin/env python3
"""tests/r544.py — R544: PWA DEEP-LINKING (?m=) + ZGODOVINA (BACK GUMB).

Zakaj: raziskava R544-a je pokazala, da manifest PWA vsebuje 3 bližnjice
(Danes/Nalogi/Meritve), a VSE tri odprejo gol naslov "/" — mobilna bližnjica
"Nalogi" uporabnika ne prinese do Nalogov, ampak na persistan zavihek iz
localStorage. Hkrati aplikacija nima NOBENEGA URL odraza stanja: naslovna
vrstica ostane "/" za vsakim klikom, zgodovina brskalnika se ne polni in
BACK gumb nad preklopi ne naredi ničesar (0 popstate/pushState v src/).

Kaj prinese R544 (51. skupina):
  • src/lib/deep-link.ts — ČIST lib (0 uvozov, testabilen): TAB_PARAM 'm',
    tabFromSearch (URLSearchParams nad nizi), urlForTab (/?m=<id>),
    pushTabState (history.pushState — nova entrate za back),
    clearTabState (replaceState '/' — odstranitev neveljavnega ?m);
  • app-shell.tsx — R544 effect: inicialni sync ob mountu, kjer URL ZMAGA
    nad persistom (?m=nalogi odpre Nalogi tudi po prijavi — LoginScreen ne
    navigira, ?m preživi v naslovu); neveljaven ?m (neznan id ali zavihek
    brez pravice — tabVisible fail-closed) → clearTabState, stanje ostane
    na persistanem zavihku; popstate listener = BACK gumb odvija preklope;
    vsa 6 navigacijskih mest (logo/pickSection, iskanje goToHit, profil,
    desktop zavihek, tabletke) zdaj delajo pushTabState;
  • public/manifest.webmanifest — 3 bližnjice preusmerjene na globoke
    povezave (/?m=danes, /?m=nalogi, /?m=meritve) + NOVA 4. (Projekti,
    /?m=projekti — Chrome na domačem zaslonu prikaže do 4).

Kaj preverja ta suite:
  A) statično: deep-link.ts (čist lib, 0 uvozov; try/catch varovalki na
     stranskih učinkih); app-shell.tsx (import, R544 effect s popstate +
     fail-closed clearTabState, ≥6 pushTabState mest, sectionForTab/tabById
     iz ENEGA vira nav-registry); manifest.webmanifest (4 bližnjice, vsaka
     url /?m=<id>, nobena na goli "/"); varnost: ModuleView vrata
     ("Neznani zavihek" fail-closed) nezamenjana — globoka povezava NE more
     odpreti prepovedanega zavihka (glavna obramba ostaja v modulskih vratih).
  B) živi bun klic deep-link.ts: tabFromSearch ('?m=nalogi'→'nalogi',
     '?m=material-v5'→'material-v5', '?x=1'→null, ''→null, '?m=%20'→null),
     urlForTab ('nalogi'→'/?m=nalogi', 'foto-replace'→'/?m=foto-replace',
     'vodja-ekipa'→'/?m=vodja-ekipa' — vezaji preživijo).
  C) živi HTTP: GET /?m=nalogi → 200 (ista lupina, query se prenaša skozi);
     GET /?m=nalogi&x=1 → 200 (tuji parametri ne motijo); GET
     /?m=neveljaven-xyz → 200 (stran se izriše; klient ?m ignorira —
     fail-closed se zgodi v brskalniku, ne v strežniku); GET
     /manifest.webmanifest → 200 + JSON z 4 bližznicami, vsaka url /?m=.
  D) registracija: ci-matrix.sh (GRUPE + CLANI) in ci.yml matrika.

POGOJI: teče nad strežnikom na BASE_URL (privzeto :3000). Brez DB sprememb —
R544 je čisto klientni sloj (lib + lupina + statični manifest).
"""
import json
import os
import re
import subprocess
import sys
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
PASS, FAIL, SKIP = 0, 0, 0


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)
def skip (msg): global SKIP; SKIP += 1; print(f'  ⏸ {msg}')


def http_get (path):
    """GET na BASE+path → (status, body-bajti). Brez avtentikacije (javne poti)."""
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + path), timeout=30) as r:
            return r.status, r.read()
    except Exception as e:
        return 0, str(e).encode()


def src (relpath):
    with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
        return f.read()


def src_has (relpath, needle):
    try:
        return needle in src(relpath)
    except Exception:
        return False


def bun_e (script, timeout=60):
    env = {k: v for k, v in os.environ.items()
           if k not in ('SEED_CONFIRM', 'SEED_ALLOW_REMOTE', 'NODE_ENV', 'PRISMA_LOG_QUERIES')}
    return subprocess.run(['bun', '-e', script], cwd=REPO, capture_output=True,
                          text=True, timeout=timeout, env=env)


SHELL = 'src/components/roksal/app-shell.tsx'
DEEPLINK = 'src/lib/deep-link.ts'
MANIFEST = 'public/manifest.webmanifest'

print('═══ R544: PWA deep-linking (?m=) + zgodovina (back) ═══')

# ═══ A) statično: lib + lupina + manifest + varnostna vrata ════════════════
print('── A) statično (deep-link.ts / app-shell.tsx / manifest) ──')

# A1) deep-link.ts obstaja, je ČIST modul (0 uvozov) — bun import dela
chk(src_has(DEEPLINK, "export const TAB_PARAM = 'm'"), 'A1 deep-link: TAB_PARAM = \'m\'')
chk(src_has(DEEPLINK, 'tabFromSearch') and src_has(DEEPLINK, 'URLSearchParams'),
    'A2 deep-link: tabFromSearch prek URLSearchParams (nad nizi — testabilno)')
chk(src_has(DEEPLINK, 'urlForTab') and src_has(DEEPLINK, 'encodeURIComponent'),
    'A3 deep-link: urlForTip z encodeURIComponent (varno za id-je)')
uvozi = [l for l in src(DEEPLINK).splitlines() if l.strip().startswith('import ')]
chk(len(uvozi) == 0, f'A4 deep-link: ČIST lib, 0 uvozov (naštel {len(uvozi)})')
chk(src_has(DEEPLINK, 'window.history.pushState') and src_has(DEEPLINK, 'window.history.replaceState'),
    'A5 deep-link: pushState/replaceState stranska učinka')
chk(src_has(DEEPLINK, 'try {') and src_has(DEEPLINK, '} catch {'),
    'A6 deep-link: try/catch varovalki (SSR/izolirani testi brez window)')

# A2) app-shell.tsx: R544 effect + ≥6 pushTabState mest
shell = src(SHELL)
chk("from '@/lib/deep-link'" in shell, 'A7 lupina: uvoz @/lib/deep-link')
chk('popstate' in shell, 'A8 lupina: popstate listener (BACK gumb)')
chk('syncFromUrl' in shell and 'tabFromSearch' in shell, 'A9 lupina: syncFromUrl + tabFromSearch')
chk('clearTabState' in shell, 'A10 lupina: clearTabState (fail-closed za neveljaven ?m)')
st_push = shell.count('pushTabState(')
chk(st_push >= 5, f'A11 lupina: ≥5 pushTabState mest klikov (naštel {st_push}: goToHit, pickSection, profil, desktop zavihek, tabletke)')
chk('sectionForTab' in shell and 'tabById' in shell,
    'A12 lupina: sectionForTab + tabById — EN VIR nav-registry (id≠ime: logistika/varnost)')
# konkretna mesta (vsako z pushState):
chk("onClick={() => { setSection(sec.id); setTab(t.id); pushTabState(t.id) }}" in shell,
    'A13 lupina: desktop zavihek — setSection+setTab+pushTabState')
chk("onClick={() => { setTab(t.id); pushTabState(t.id) }}" in shell,
    'A14 lupina: tabletke znotraj sekcije — setTab+pushTabState')
chk("pushTabState(hit.tab)" in shell, 'A15 lupina: goToHit (iskanje) — pushTabState')
chk("pushTabState('profil')" in shell, 'A16 lupina: Moj profil — pushTabState')
chk('if (first) { setTab(first.id); pushTabState(first.id) }' in shell,
    'A17 lupina: pickSection — prvi videni zavihek v URL, sicer clearTabState')

# A3) manifest: 4 bližnjice, vse /?m=<id>
try:
    man = json.loads(src(MANIFEST))
    scs = man.get('shortcuts', [])
    chk(len(scs) == 4, f'A18 manifest: 4 bližnjice (naštel {len(scs)})')
    urls = [s.get('url', '') for s in scs]
    chk(all(u.startswith('/?m=') for u in urls),
        f'A19 manifest: vsaka url /?m=<id> ({", ".join(urls)})')
    chk('/?m=danes' in urls and '/?m=nalogi' in urls and '/?m=meritve' in urls and '/?m=projekti' in urls,
        'A20 manifest: danes/nalogi/meritve (prej vsi "/") + nov Projekti')
    chk('/' not in urls, 'A21 manifest: NOBENA bližznica več na goli "/"')
    imena = [s.get('name', '') for s in scs]
    chk('Projekti' in imena, f'A22 manifest: 4. bližznica Projekti (imena: {", ".join(imena)})')
except ValueError:
    bad('A18–A22 manifest: JSON se ne razbere')
    imena, urls = [], []

# A4) varnost: modulska vrata nezamenjana (glavna obramba fail-closed ostaja)
chk(src_has('src/components/roksal/module-view.tsx', 'Neznani zavihek'),
    'A23 varnost: ModuleView "Neznani zavihek" fail-closed nezamenjan')
chk(src_has(SHELL, 'tabVisible(useAppStore.getState().user?.perms, tab)'),
    'A24 varnost: effect preverja tabVisible (zavihek brez pravice → clearTabState)')

# ═══ B) živi bun klic: tabFromSearch + urlForTab ══════════════════════════
print('── B) živi bun klic deep-link.ts ──')

r = bun_e("""
const m = await import('./src/lib/deep-link.ts')
console.log(JSON.stringify({
  a: m.tabFromSearch('?m=nalogi'),
  b: m.tabFromSearch('?m=material-v5&x=1'),
  c: m.tabFromSearch('?x=1'),
  d: m.tabFromSearch(''),
  e: m.tabFromSearch('?m=%20'),
  f: m.urlForTab('nalogi'),
  g: m.urlForTab('foto-replace'),
  h: m.urlForTab('vodja-ekipa'),
  i: m.TAB_PARAM
}))
""")
try:
    d = json.loads(r.stdout.strip().splitlines()[-1])
    chk(d.get('a') == 'nalogi', 'B1 tabFromSearch(\'?m=nalogi\') → nalogi')
    chk(d.get('b') == 'material-v5', 'B2 tabFromSearch(\'?m=material-v5&x=1\') → material-v5 (vezaj + tuji param)')
    chk(d.get('c') is None, 'B3 tabFromSearch brez ?m → null')
    chk(d.get('d') is None, 'B4 tabFromSearch(\'\') → null')
    chk(d.get('e') is None, 'B5 tabFromSearch(\'?m=%20\') → null (samo presledki)')
    chk(d.get('f') == '/?m=nalogi', 'B6 urlForTab(nalogi) → /?m=nalogi')
    chk(d.get('g') == '/?m=foto-replace', 'B7 urlForTab(foto-replace) → /?m=foto-replace (vezaj preživi)')
    chk(d.get('h') == '/?m=vodja-ekipa', 'B8 urlForTab(vodja-ekipa) → /?m=vodja-ekipa')
    chk(d.get('i') == 'm', 'B9 TAB_PARAM = \'m\'')
except Exception:
    bad(f'B1–B9 bun klic razpadel: rc={r.returncode} {r.stderr[:200]}')

# ═══ C) živi HTTP: query se prenaša, manifest streže ?m= ══════════════════
print('── C) živi HTTP ──')

st, body = http_get('/?m=nalogi')
chk(st == 200, f'C1 GET /?m=nalogi → {st} (lupina se izriše, query prenaša)')
st2, _ = http_get('/?m=nalogi&x=1')
chk(st2 == 200, f'C2 GET /?m=nalogi&x=1 → {st2} (tuji parametri ne motijo)')
st3, _ = http_get('/?m=neveljaven-xyz-123')
chk(st3 == 200, f'C3 GET /?m=neveljaven-xyz → {st3} (fail-closed se zgodi v klientu, stran se izriše)')
st4, mbody = http_get('/manifest.webmanifest')
chk(st4 == 200, f'C4 GET /manifest.webmanifest → {st4}')
if st4 == 200:
    try:
        man = json.loads(mbody.decode('utf-8'))
        scs = man.get('shortcuts', [])
        urls = [s.get('url', '') for s in scs]
        chk(len(scs) == 4 and all(u.startswith('/?m=') for u in urls),
            f'C5 manifest strežen prek HTTP: 4 bližznice z /?m= ({", ".join(urls)})')
    except ValueError:
        bad('C5 manifest: JSON se ne razbere')
else:
    skip('C5 manifest: pot ni dosegljiva')

# ═══ D) registracija ══════════════════════════════════════════════════════
print('── D) registracija ──')

m = src('tests/ci-matrix.sh')
chk(re.search(r'(?<![\w-])r544(?![\w-])', m.split('CLANI=')[0] if 'CLANI=' in m else m) is not None,
    'D1 ci-matrix.sh GRUPE vsebuje r544 (pozicijsko neodvisno)')
chk('CLANI[r544]' in m or 'r544.py' in m, 'D2 ci-matrix.sh CLANI[r544]')
y = src('.github/workflows/ci.yml')
chk(re.search(r'(?<![\w-])r544(?![\w-])', y) is not None, 'D3 ci.yml matrika vsebuje r544 (pozicijsko neodvisno)')

# ═══ povzetek ════════════════════════════════════════════════════════════
print(f'═══ R544: {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸ ═══')
sys.exit(0 if FAIL == 0 else 1)
