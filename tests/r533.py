#!/usr/bin/env python3
"""tests/r533.py — R533 (issue #20): ENOTEN VIR KODE — dokazljiva sinhronizacija
na ravni commit SHA + strojni odkrivalnik razhajanja (drift).

Zakaj: issue #20 ugotavlja, da je bila oznaka »zrcalo sinhrono« NAPAČNA —
GitLab main je stal na R527, GitHub pa na R532-dodatek; zelen pipeline za
stari SHA ni bil dokaz za najnovejšo kodo. Od tedaj naprej se sinhronizacija
dokazuje s PRIMERJAVO SHA (ops/sync-check.sh), ne z uspehom push ukaza.

Kaj preverja ta suite (42. skupina):
  A) ops/sync-check.sh sintaksa + izpis brez žetonov (varnost: noben glpat-/ghp_
     v izpisu);
  B) OK primer: dve lokalni (file://) zrcali na istem SHA kot delovni repo →
     izhod 0, stanje OK, vsi SHA v izpisu;
  C) DRIFT primer (DoD »namenski test odkrije namerno zastarelo zrcalo«):
     eno zrcalo EN commit za delovnim repom → izhod 1, DRIFT, izpis vsebuje
     obe vrednosti (zastarelo + pričakovano);
  D) FAILED primer: nedosegljiv oddaljen repozitorij (napačna pot) → izhod 2;
  E) oznaka izdaje: zrcalo z manjkajočo oznako v{version} → DRIFT (izdaja se
     ne sme razglasiti, dokler oznaka ni na obeh sistemih);
  F) živi primer (samo ob dosegljivih oddaljenih repozitorijih): pravi
     origin + gitlab na istem SHA kot lokalni main → OK (pošteno: če
     ls-remote ni dosegljiv, se blok preskoči — ne zeleno, ne rdeče).

Brez AI, brez novih odvisnosti, brez omrežja (razen git na localhostu;
blok F zahteva omrežje in je pokrit z ločenim preskokom).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
PASS, FAIL = 0, 0


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)


def run (cmd, cwd=REPO, env=None):
    return subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, env=env)


def src_has (relpath, needle):
    try:
        with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
            return needle in f.read()
    except Exception:
        return False


print('═══ R533: enoten vir kode — sinhronizacija po SHA (issue #20) ═══')

# ═══ A) skripta obstaja, sintaksa, izpis brez žetonov ═════════════════════════
print('── A) ops/sync-check.sh — obstaja, sintaksa, varnost izpisa ──')
chk(os.path.isfile(os.path.join(REPO, 'ops/sync-check.sh')), 'ops/sync-check.sh obstaja')
r = run(['bash', '-n', 'ops/sync-check.sh'])
chk(r.returncode == 0, f'bash -n brez sintaktičnih napak (RC {r.returncode})')
src = open(os.path.join(REPO, 'ops/sync-check.sh'), encoding='utf-8').read()
chk('NIKOLI' in src or 'ne izpisuje' in src or 'URL' in src,
    'skripta dokumentira varnost izpisa (brez URL-jev/žetonov)')
chk('ls-remote' in src and 'rev-parse' in src, 'primerjava po SHA (rev-parse + ls-remote)')
chk('DRIFT' in src and 'FAILED' in src and 'OK' in src, 'stanja OK/DRIFT/FAILED izpisana')

# ═══ B) OK primer — oba zrcali na istem SHA ══════════════════════════════════
print('── B) OK: dve zrcali na istem SHA kot delovni repo ──')
tmp = tempfile.mkdtemp(prefix='r533-')
try:
    # delovni repozitorij: main + 2 komita (brez omrežja)
    work = os.path.join(tmp, 'work')
    run(['git', 'init', '-b', 'main', work])
    run(['git', '-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'a'], cwd=work)
    # verzija paketa, da skripta preverja tudi oznako
    with open(os.path.join(work, 'package.json'), 'w', encoding='utf-8') as f:
        f.write('{"name": "t", "version": "9.9.9"}\n')
    run(['git', 'add', 'package.json'], cwd=work)
    run(['git', '-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-m', 'b'], cwd=work)
    run(['git', 'tag', 'v9.9.9'], cwd=work)
    # dve goli zrcali
    for ime in ('zg', 'zd'):
        run(['git', 'clone', '--mirror', work, os.path.join(tmp, ime)])
    run(['git', 'remote', 'add', 'zg', os.path.join(tmp, 'zg')], cwd=work)
    run(['git', 'remote', 'add', 'zd', os.path.join(tmp, 'zd')], cwd=work)
    # skripta pričakuje pot REPO/ops/sync-check.sh — pognana iz tmp delovnega
    # repota z REPO skripto (cd v tmp/work)
    env = {**os.environ, 'SYNC_REMOTES': 'zg zd', 'SYNC_RETRIES': '1', 'SYNC_ROOT': work}
    r = run(['bash', os.path.join(REPO, 'ops/sync-check.sh')], cwd=work, env=env)
    chk(r.returncode == 0, f'izhod 0 (dejansko {r.returncode})')
    chk('── sinhronizacija: OK' in r.stdout, f'stanje OK (izpis: {r.stdout.strip().splitlines()[-1] if r.stdout else "?"})')
    chk(r.stdout.count('OK: main') == 2, f'oba repota poročata OK main ({r.stdout.count("OK: main")})')
    chk(r.stdout.count('OK: v9.9.9') == 2, 'oba repota poročata OK oznako izdaje')
    chk('glpat-' not in r.stdout and 'ghp_' not in r.stdout, 'izpis brez žetonov')

    # ═══ C) DRIFT — namerno zastarelo zrcalo (DoD) ════════════════════════════
    print('── C) DRIFT: eno zrcalo EN commit za delovnim repom ──')
    # nov commit v delovnem repotu; potisni SAMO na zd → zg ostane zastarel
    run(['git', '-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'c'], cwd=work)
    run(['git', 'push', 'zd', 'main'], cwd=work, env=env)
    r = run(['bash', os.path.join(REPO, 'ops/sync-check.sh')], cwd=work, env=env)
    chk(r.returncode == 1, f'izhod 1 ob razhajanju (dejansko {r.returncode})')
    chk('── sinhronizacija: DRIFT' in r.stdout, 'stanje DRIFT izpisano')
    chk('DRIFT: main @ zg' in r.stdout and 'OK: main @ zd' in r.stdout,
        'točno ZASTARELO zrcalo je poimenovano (zg DRIFT, zd OK)')
    chk('push ali reset' in r.stdout, 'izpis pove naslednji korak (push ali reset)')
    # oba SHA sta v izpisu — operater vidi razliko
    stale = run(['git', '-C', os.path.join(tmp, 'zg'), 'rev-parse', 'main']).stdout.strip()
    local = run(['git', '-C', work, 'rev-parse', 'main']).stdout.strip()
    chk(stale[:12] in r.stdout and local[:12] in r.stdout, 'izpis vsebuje OBA SHA (zastarelo + lokalno)')
    # oznaka v9.9.9 obstaja lokalno in na OBEH zrcalih iz klona → ni DRIFT oznake
    chk('v9.9.9 manjka' not in r.stdout, 'oznaka na obeh zrcalih (iz klona) — ni lažnega DRIFT')

    # ═══ E) manjkajoča oznaka izdaje na zrcalu ═══════════════════════════════
    print('── E) DRIFT: manjkajoča oznaka izdaje na enemu zrcalu ──')
    # uskladi zg main, nato IZBRIŠI oznako v9.9.9 iz zg → manjkajoča izdajna oznaka
    run(['git', 'push', 'zg', 'main'], cwd=work, env=env)
    run(['git', '--git-dir', os.path.join(tmp, 'zg'), 'tag', '-d', 'v9.9.9'])
    r = run(['bash', os.path.join(REPO, 'ops/sync-check.sh')], cwd=work, env=env)
    chk(r.returncode == 1, f'manjkajoča oznaka = DRIFT izhod 1 (dejansko {r.returncode})')
    chk('v9.9.9 manjka @ zg' in r.stdout, 'manjkajoča oznaka izdaje je DRIFT z imenom repota')
    chk('OK: v9.9.9 @ zd' in r.stdout, 'drugo zrcalo še vedno OK (nedotaknjeno)')

    # ═══ D) FAILED — nedosegljiv repozitorij ═════════════════════════════════
    print('── D) FAILED: nedosegljiv oddaljen repozitorij ──')
    env_d = {**os.environ, 'SYNC_REMOTES': 'ne-obstaja', 'SYNC_RETRIES': '1', 'SYNC_ROOT': work}
    r = run(['bash', os.path.join(REPO, 'ops/sync-check.sh')], cwd=work, env=env_d)
    chk(r.returncode == 2, f'izhod 2 ob nedosegljivem repotu (dejansko {r.returncode})')
    chk('FAILED: ne-obstaja ni dosegljiv' in r.stdout, 'izpis poimenuje nedosegljiv repozitorij')
finally:
    shutil.rmtree(tmp, ignore_errors=True)

# ═══ F) živi primer — samo ob dosegljivih oddaljenih repozitorijih ═══════════
print('── F) živi primer: pravi origin + gitlab (pošteno: preskok če nedosegljiva) ──')
try:
    r = run(['bash', 'ops/sync-check.sh'], env={**os.environ, 'SYNC_RETRIES': '2'}, cwd=REPO)
    if r.returncode == 2:
        print('  ⏸ oddaljeni repozitorij trenutno ni dosegljiv (prehodna blokada) — preskok, ne zeleno')
    else:
        chk(r.returncode == 0, f'pravi origin+gitlab na istem SHA kot lokalni main (RC {r.returncode})')
        chk('── sinhronizacija: OK' in r.stdout, 'živo stanje OK')
except Exception as e:
    print(f'  ⏸ živi blok preskočen: {e}')

# ═══ G) dokumentacija kanoničnega vira (issue #20 točka 1) ══════════════════
print('── G) vir: kanonični repo dokumentiran, zrcalo pošteno ──')
chk(src_has('README.md', 'GitHub je kanonični vir'),
    'README: GitHub je kanonični vir (izrecno)')
chk(src_has('README.md', 'ops/sync-check.sh'),
    'README: sinhronizacija po SHA z ops/sync-check.sh dokumentirana')
chk(src_has('ops/sync-check.sh', 'issue #20'), 'skripta se sklicuje na issue #20')
chk(src_has('.gitlab-ci.yml', 'verify') or os.path.isfile(os.path.join(REPO, '.gitlab-ci.yml')),
    '.gitlab-ci.yml obstaja (verify job — drugotna vrata)')

print()
print(f'══ REZULTAT: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL > 0 else 0)
