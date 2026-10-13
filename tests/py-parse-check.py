#!/usr/bin/env python3
"""tests/py-parse-check.py — R497: ali se vsak Python suite na TEM interpreterju
sploh razčleni.

Zakaj: suite-i so pisani na razvojni mizi s Python 3.12+, kjer je v f-stringu
dovoljen gnezden ISTI narekovaj (`f'{x.get('a')}'`). Na 3.11 in starejšem je to
SyntaxError, pas pa to pokaže šele kot neprepoznljivo rdečo skupino — ne kot
razlog, da interpreter ne ustreza kodu testov.

Izhod: 0 če se vse razčleni, sicer 1 in seznam `datoteka:vrstica: sporočilo`.
"""
import ast
import pathlib
import sys

# Windows: stdout je lahko cp1250 in ✓/✗ vrže UnicodeEncodeError — checker mora
# biti berljiv tudi, ko ga pokličeš naravnost, ne samo prek tests/toolshim.sh.
for tok in (sys.stdout, sys.stderr):
    try: tok.reconfigure(encoding='utf-8', errors='replace')
    except Exception: pass

datoteke = sorted(pathlib.Path(__file__).resolve().parent.glob('*.py'))
napake = []
for f in datoteke:
    try:
        ast.parse(f.read_text(encoding='utf-8'), filename=str(f))
    except SyntaxError as e:
        napake.append(f'{f.name}:{e.lineno}: {e.msg}')

if napake:
    print('✗ Python suite-i, ki se NE razčlenijo na '
          f'{sys.version_info.major}.{sys.version_info.minor}:')
    for n in napake:
        print('  ' + n)
    print('  Razlog je najpogosteje 3.12+ sintaksa (isti narekovaj v f-stringu) '
          'ali kak drug 3.12+ zapis.')
    sys.exit(1)
print(f'✓ vseh {len(datoteke)} Python suite-ov se razčleni na '
      f'{sys.version_info.major}.{sys.version_info.minor}')
