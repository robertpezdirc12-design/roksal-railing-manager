#!/usr/bin/env python3
"""build-e2e-matrix.py — R440 (GitLab issue #4)

Statična analiza vseh API rut → docs/E2E-MATRIX.json (strojno berljiv register).

Za vsak endpoint (route datoteka + HTTP metoda) izlušči:
- pot (Next.js dinamični segmenti → :param),
- zahtevano pravico (requirePermission) ali PUBLIC,
- dovoljene vloge (iz ROLE_PERMISSIONS),
- pričakovani status ALLOW / DENY.

Vir resnice: src/app/api/**/route.ts + src/lib/permissions-core.ts
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / 'src' / 'app' / 'api'
PERMS_FILE = ROOT / 'src' / 'lib' / 'permissions-core.ts'

# ── 1. vloge → pravice iz permissions-core.ts ────────────────────────────────
src = PERMS_FILE.read_text(encoding='utf-8')

m = re.search(r"export const ROLE_PERMISSIONS: Record<Role, Permission\[\]> = \{(.*?)\n\}", src, re.S)
if not m:
    sys.exit('Ni mogoče razčleniti ROLE_PERMISSIONS')
body = m.group(1)

role_perms = {}
for rm in re.finditer(r"(ADMIN|VODJA|MONTER|SKLADISCE|PROIZVODNJA):\s*\[(.*?)\]", body, re.S):
    role, inner = rm.group(1), rm.group(2)
    perms = re.findall(r"'([a-z]+\.[a-zA-Z]+)'", inner)
    role_perms[role] = perms

# ADMIN = ALL, VODJA = ALL − security.read
all_perms = re.findall(r"'([a-z]+\.[a-zA-Z]+)'", re.search(r"export const PERMISSIONS = \[(.*?)\] as const", src, re.S).group(1))
role_perms['ADMIN'] = all_perms
role_perms['VODJA'] = [p for p in all_perms if p != 'security.read']

# ── 2. regex za razčlenjevaje route datotek ──────────────────────────────────
RE_HANDLER = re.compile(r"export async function (GET|POST|PATCH|PUT|DELETE)\s*\(")
RE_PERM = re.compile(r"requirePermission\(\s*req,\s*'([a-z]+\.[a-zA-Z]+)'")
RE_PERM_ALL = re.compile(r"'([a-z]+\.[a-zA-Z]+)'")
RE_SESSION = re.compile(r"getSessionUser\(" )
# begin/end bloka funkcije: do naslednjega export ali konca datoteke
RE_NEXT_EXPORT = re.compile(r"\nexport ")

def handler_block(handler: str, code: str) -> str | None:
    hm = re.search(r"export async function " + handler + r"\s*\(", code)
    if not hm:
        return None
    start = hm.start()
    nxt = RE_NEXT_EXPORT.search(code, start + 10)
    return code[start:nxt.start()] if nxt else code[start:]

def path_of(rel: Path) -> str:
    parts = list(rel.parts)
    if parts:
        parts[-1] = parts[-1].replace('route.ts', '')
    out = '/api'
    for p in parts:
        if not p:
            continue
        if p.startswith('[') and p.endswith(']'):
            inner = p[1:-1].replace('...', '')
            out += f'/:{inner}'
        else:
            out += '/' + p
    return out

def perms_for(handler: str, code: str) -> list[str]:
    """Vse pravice znotraj bloka handlerja (podpira ternary pogojne pravice)."""
    block = handler_block(handler, code)
    if block is None:
        return []
    if 'requirePermission(' not in block:
        return []
    # vzemi del za requirePermission klicem (ne cela datoteka — samo blok)
    return list(dict.fromkeys(RE_PERM_ALL.findall(block[block.find('requirePermission('):])))

def uses_session(handler: str, code: str) -> bool:
    block = handler_block(handler, code)
    return bool(block) and bool(RE_SESSION.search(block))

ALL_ROLES = ['ADMIN', 'VODJA', 'MONTER', 'SKLADISCE', 'PROIZVODNJA']

endpoints = []
for f in sorted(API.rglob('route.ts')):
    code = f.read_text(encoding='utf-8')
    rel = f.relative_to(API)
    path = path_of(rel)
    handlers = RE_HANDLER.findall(code)
    for h in handlers:
        perms = perms_for(h, code)
        # cisti permission stringi (samo tisti iz kataloga)
        perms = [p for p in perms if p in all_perms]
        if perms:
            roles = [r for r in ALL_ROLES if any(p in role_perms[r] for p in perms)]
            kind = 'AUTH'
            perm_str = ' + '.join(perms)
            allow, deny = (200, 403)
        elif uses_session(h, code):
            # prijavljeni uporabnik (seja) brez specificne pravice na vhodu
            roles = ALL_ROLES
            kind = 'SESSION'
            perm_str = 'prijavljen (seja)'
            allow, deny = (200, 401)
        else:
            roles = []
            kind = 'PUBLIC'
            perm_str = None
            allow, deny = (200, 401)
        endpoints.append({
            'method': h,
            'path': path,
            'file': str(rel),
            'permission': perm_str,
            'kind': kind,
            'roles': roles,
            'allow': allow,
            'deny': deny,
        })

# ── 3. dejansko pričakovani statusi za specifične metode (201 ob ustvarjanju) ─
CREATE_201 = {
    ('POST', '/api/customers'), ('POST', '/api/crm'), ('POST', '/api/nalog'),
    ('POST', '/api/quotes'), ('POST', '/api/invoices'), ('POST', '/api/payments'),
    ('POST', '/api/projects'), ('POST', '/api/production'), ('POST', '/api/measurements'),
    ('POST', '/api/equipment'), ('POST', '/api/qc'), ('POST', '/api/warranty'),
    ('POST', '/api/catalog'), ('POST', '/api/suppliers'), ('POST', '/api/surveys'),
    ('POST', '/api/engineering-rules'), ('POST', '/api/material-orders'),
    ('POST', '/api/material-prices'), ('POST', '/api/inventory/lots'),
    ('POST', '/api/railing-layout'), ('POST', '/api/punch'), ('POST', '/api/deal-lock'),
    ('POST', '/api/nalog/:id/termin'), ('POST', '/api/nalog/:id/transition'),
    ('POST', '/api/measure/photo'), ('POST', '/api/measurement/confirm'),
    ('POST', '/api/portal'), ('POST', '/api/documents'), ('POST', '/api/gallery'),
    ('POST', '/api/evidence'),
    ('POST', '/api/audit'), ('POST', '/api/users'),
    ('POST', '/api/measurements/:id/share'), ('POST', '/api/crm/:id/pretvorba'),
}
for e in endpoints:
    if (e['method'], e['path']) in CREATE_201:
        e['allow'] = 201
    if e['method'] == 'DELETE':
        e['allow'] = 200

# ── 4. ROUTE-MAP preslikava (dokumentirana pot → dejanski endpoint) ─────────
route_map_doc = ROOT / 'docs' / 'ROUTE-MAP.md'
doc_lines = []
if route_map_doc.exists():
    for line in route_map_doc.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line.startswith('- `') or line.startswith('| `/'):
            doc_lines.append(line)

matrix = {
    'generatedAt': '2026-10-07',
    'phase': 'R440',
    'issue': 4,
    'source': 'staticka analiza src/app/api/**/route.ts + src/lib/permissions-core.ts',
    'roles': ['ADMIN', 'VODJA', 'MONTER', 'SKLADISCE', 'PROIZVODNJA'],
    'rolePermissions': role_perms,
    'routeMapDocumentedLines': len(doc_lines),
    'endpoints': endpoints,
    'summary': {
        'routeFiles': len({e['file'] for e in endpoints}),
        'endpoints': len(endpoints),
        'publicEndpoints': len([e for e in endpoints if e['kind'] == 'PUBLIC']),
        'sessionEndpoints': len([e for e in endpoints if e['kind'] == 'SESSION']),
        'authEndpoints': len([e for e in endpoints if e['kind'] == 'AUTH']),
    },
}

out = ROOT / 'docs' / 'E2E-MATRIX.json'
out.write_text(json.dumps(matrix, ensure_ascii=False, indent=2), encoding='utf-8')
print(f"✓ {out.relative_to(ROOT)} — {len(endpoints)} endpointov v {matrix['summary']['routeFiles']} datotekah")
print(f"  javnih: {matrix['summary']['publicEndpoints']}, zaščitenih: {matrix['summary']['authEndpoints']}")
# hitra kontrola: endpointi brez pravice, ki niso v /public
suspects = [e for e in endpoints if e['kind'] == 'PUBLIC' and '/public' not in e['path']]
names = [e['method'] + ' ' + e['path'] for e in suspects]
print('  ⚠ brez pravice (ni /public): ' + str(names))
