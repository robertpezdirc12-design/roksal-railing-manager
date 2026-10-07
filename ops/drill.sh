#!/usr/bin/env bash
# ops/drill.sh — RECOVERY DRILL (R441 / issue #3, točka 7).
#
# Simulira POPOLNO IZGUBO sistema in izmeri obnovo izključno iz off-site
# varnostne kopije (GitLab) + šifrirnega gesla (izven repozitorija):
#
#   1. IZGUBA: deluje samo še GitLab dostop (žeton) + geslo — lokalne kopije se
#      NAMERNO ne uporabijo (prazna ROKSAL_BACKUP_DIR mapa).
#   2. PRENOS + DEŠIFRIRANJE + PREVERBA (kontrolne vsote, git fsck, števci baze)
#      + OBNOVA v izolirano mapo (baza + repozitorij).
#   3. VELJAVNOST KODE: bun install + tsc --noEmit iz obnovljenega repozitorija.
#   4. ZAGON APLIKACIJE iz obnovljene kode + baze (vrata 3100, ločeno od
#      produkcijskega dev strežnika na 3000) + /api/health.
#   5. PRIJAVA + POSLOVNI TEST (projekti) proti obnovljenemu sistemu.
#
# Izhod: docs/RECOVERY-DRILL-<časovni-žig>.md poročilo z RTO/RPO + JSON na stdout.
# Uporaba: ops/drill.sh [--skip-install]   (preskoči bun install — za hiter ponovni test)

set -euo pipefail
. "$(dirname "$0")/lib.sh"

SKIP_INSTALL=0
if [ "${1:-}" = "--skip-install" ]; then SKIP_INSTALL=1; fi

DRILL_ROOT="$(mktemp -d /tmp/roksal-drill-XXXXXX)"
DRILL_REPO="$DRILL_ROOT/out/repo"
REPORT_TS="$(date +%Y%m%d-%H%M%S)"
REPORT="$ROOT_DIR/docs/RECOVERY-DRILL-$REPORT_TS.md"
DRILL_PORT="${ROKSAL_DRILL_PORT:-3100}"
ADMIN_EMAIL="${DRILL_ADMIN_EMAIL:-admin@roksal.si}"
ADMIN_PASS="${DRILL_ADMIN_PASSWORD:-Admin123!}"
DRILL_PID=""

cleanup () {
  if [ -n "$DRILL_PID" ] && kill -0 "$DRILL_PID" 2>/dev/null; then
    kill "$DRILL_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$DRILL_PID" 2>/dev/null || true
  fi
  rm -rf "$DRILL_ROOT"
}
trap cleanup EXIT

now_ns () { date +%s%N; }
since_s () { python3 -c "print(round(( $(now_ns) - $1 ) / 1e9, 1))"; }

T_START="$(now_ns)"

# ── faza 1+2: prenos off-site kopije, preverba, obnova v izolacijo ─────────
log "FAZA 1: izguba sistema — prenos + dešifriranje + preverba off-site kopije…"
T="$(now_ns)"
export ROKSAL_BACKUP_DIR="$DRILL_ROOT/ni-lokalnih" # prisili IZKLJUČNO off-site pot
mkdir -p "$ROKSAL_BACKUP_DIR"
RESTORE_JSON="$(bash "$OPS_DIR/restore.sh" --target-dir "$DRILL_ROOT/out" 2>"$DRILL_ROOT/restore.log" | tail -n1)"
PHASE1_S="$(since_s "$T")"
RESTORE_OK="$(printf '%s' "$RESTORE_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['ok'])" 2>/dev/null || echo False)"
[ "$RESTORE_OK" = "True" ] || { cat "$DRILL_ROOT/restore.log" >&2; die "obnova off-site kopije je spodletela"; }
GIT_SHA="$(printf '%s' "$RESTORE_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['gitSha'])")"
[ -f "$DRILL_REPO/package.json" ] || die "obnovljeni repozitorij nima package.json"
log "   kopija prenešena, dešifrirana, preverjena in obnovljena (${PHASE1_S}s)"

# ── faza 3: veljavnost kode (odvisnosti + tipi) ────────────────────────────
log "FAZA 3: veljavnost obnovljene kode…"
T="$(now_ns)"
if [ "$SKIP_INSTALL" -eq 1 ]; then
  log "   --skip-install: uporabljam obstoječi node_modules (hitri način)"
  cp -r "$ROOT_DIR/node_modules" "$DRILL_REPO/node_modules"
else
  (cd "$DRILL_REPO" && bun install --frozen-lockfile >>"$DRILL_ROOT/install.log" 2>&1)
fi
PHASE3A_S="$(since_s "$T")"
T="$(now_ns)"
(cd "$DRILL_REPO" && bunx tsc --noEmit -p tsconfig.ci.json >>"$DRILL_ROOT/tsc.log" 2>&1)
PHASE3B_S="$(since_s "$T")"
log "   odvisnosti (${PHASE3A_S}s) + tipovna preveritev OK (${PHASE3B_S}s)"

# ── faza 4: zagon aplikacije iz obnovljene kode + baze ─────────────────────
log "FAZA 4: zagon aplikacije (vrata $DRILL_PORT, ločeno od produkcije)…"
T="$(now_ns)"
mkdir -p "$DRILL_REPO/db"
cp "$DRILL_ROOT/out/custom.db" "$DRILL_REPO/db/custom.db"
(
  cd "$DRILL_REPO"
  DATABASE_URL="file:$DRILL_REPO/db/custom.db" ROKSAL_BUILD="recovery-drill-$REPORT_TS" \
    exec bunx next dev -p "$DRILL_PORT"
) >"$DRILL_ROOT/server.log" 2>&1 &
DRILL_PID=$!
HEALTH=""
for _ in $(seq 1 90); do # do 180 s
  HEALTH="$(curl -s --max-time 4 "http://localhost:$DRILL_PORT/api/health" 2>/dev/null || true)"
  if printf '%s' "$HEALTH" | python3 -c "import json,sys; sys.exit(0 if json.load(sys.stdin).get('status') == 'ok' else 1)" 2>/dev/null; then
    break
  fi
  HEALTH=""
  if ! kill -0 "$DRILL_PID" 2>/dev/null; then break; fi
  sleep 2
done
PHASE4_S="$(since_s "$T")"
[ -n "$HEALTH" ] || { tail -30 "$DRILL_ROOT/server.log" >&2; die "aplikacija iz obnovljene kopije ni zagnana v 180 s"; }
log "   aplikacija ZDRAVA (${PHASE4_S}s): $HEALTH"

# ── faza 5: prijava + poslovni test ────────────────────────────────────────
log "FAZA 5: prijava + kritični poslovni test…"
T="$(now_ns)"
LOGIN="$(curl -s --max-time 15 -X POST "http://localhost:$DRILL_PORT/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")"
JWT="$(printf '%s' "$LOGIN" | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || true)"
[ -n "$JWT" ] || die "prijava na obnovljeni sistem ni uspela"
PROJECTS="$(curl -s --max-time 15 "http://localhost:$DRILL_PORT/api/projects" -H "Authorization: Bearer $JWT")"
P_COUNT="$(printf '%s' "$PROJECTS" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['data']))" 2>/dev/null || echo 0)"
[ "$P_COUNT" -gt 0 ] || die "poslovni test: 0 projektov na obnovljenem sistemu"
PHASE5_S="$(since_s "$T")"
log "   prijava OK, $P_COUNT projektov dostopnih (${PHASE5_S}s)"

# ── povzetek + poročilo ─────────────────────────────────────────────────────
RTO_TOTAL="$(since_s "$T_START")"

# RPO: starost zadnje off-site kopije
RPO_S="$(python3 - "$SECRETS_FILE" << 'PYEOF'
import json, os, sys, urllib.request
from datetime import datetime, timezone
api = 'https://gitlab.com/api/v4'
tok = os.environ.get('GITLAB_TOKEN', '')
if not tok:
    for line in open(sys.argv[1], encoding='utf-8'):
        if line.startswith('GITLAB_TOKEN='):
            tok = line.split('=', 1)[1].strip()
req = urllib.request.Request(f'{api}/projects/87314539/packages?package_name=roksal-backup&sort=desc&order_by=created_at&per_page=1')
req.add_header('PRIVATE-TOKEN', tok)
pkgs = json.load(urllib.request.urlopen(req, timeout=30))
created = datetime.fromisoformat(pkgs[0]['created_at'].replace('Z', '+00:00'))
print(int((datetime.now(timezone.utc) - created).total_seconds()))
PYEOF
)"

RTO_OK="$(python3 -c "print('IZPOLNJEN ✓' if $RTO_TOTAL <= 1800 else 'PRESEŽEN ✗')")"
RPO_OK="$(python3 -c "print('IZPOLNJEN ✓' if $RPO_S <= 86400 else 'PRESEŽEN ✗')")"
INSTALL_NOTE="polni bun install"
[ "$SKIP_INSTALL" -eq 1 ] && INSTALL_NOTE="preskočen (--skip-install — ponovljena namestitev bi dodala ~30–60 s)"

cat > "$REPORT" << EOF
# Recovery drill — $REPORT_TS

Simulirana popolna izguba sistema (peskovnica Roksal Manager). Obnova IZKLJUČNO
iz off-site varnostne kopije (GitLab, generic package registry) + šifrirnega
gesla (hramba izven repozitorija). Lokalne datoteke se ne uporabijo.

## Rezultat: USPEŠEN ✓

| Faza | Dejanje | Trajanje |
|------|---------|----------:|
| 1 | Prenos + dešifriranje + preverba (SHA-256, git fsck, števci) + obnova | ${PHASE1_S} s |
| 3 | Odvisnosti ($INSTALL_NOTE) | ${PHASE3A_S} s |
| 3 | Tipovna preveritev obnovljene kode (tsc --noEmit) | ${PHASE3B_S} s |
| 4 | Zagon aplikacije na vrata $DRILL_PORT + /api/health 200 | ${PHASE4_S} s |
| 5 | Prijava + poslovni test ($P_COUNT projektov) | ${PHASE5_S} s |
| **Skupaj (RTO)** | | **${RTO_TOTAL} s** |

- **RTO (dejanski):** ${RTO_TOTAL} s — cilj ≤ 1800 s (30 min): $RTO_OK
- **RPO (dejanski):** ${RPO_S} s od ustvaritve zadnje off-site kopije — cilj ≤ 86400 s (24 h): $RPO_OK
- Obnovljeni HEAD: \`$GIT_SHA\`
- Preverjeno: kontrolne vsote vseh treh komponent (bundle/baza/export), git fsck
  celotne zgodovine, prstni odtis sheme baze, števci vrstic vseh tabel, uspešen
  zagon, prijava, branje poslovnih podatkov.
- Šifrirno geslo je bilo prebrano IZKLJUČNO iz okolja/.env.recovery (ni v repozitoriju).

## Ponovitev
\`\`\`bash
bash ops/drill.sh                  # polni preizkus (z bun install)
bash ops/drill.sh --skip-install   # hitri ponovni preizkus
\`\`\`
EOF

# JSON povzetek (strežnik počisti trap ob izhodu)
python3 - "$REPORT" "$RTO_TOTAL" "$RPO_S" "$PHASE1_S" "$PHASE3A_S" "$PHASE3B_S" "$PHASE4_S" "$PHASE5_S" "$GIT_SHA" "$P_COUNT" << 'PYEOF'
import json, sys
print(json.dumps({
  'ok': True,
  'report': sys.argv[1],
  'rtoSec': float(sys.argv[2]),
  'rpoSec': int(sys.argv[3]),
  'phases': { 'prenos_preverba_obnova': float(sys.argv[4]), 'odvisnosti': float(sys.argv[5]),
              'tipi': float(sys.argv[6]), 'zagon': float(sys.argv[7]), 'poslovni_test': float(sys.argv[8]) },
  'gitSha': sys.argv[9],
  'projects': int(sys.argv[10]),
}, ensure_ascii=False))
PYEOF
log "RECOVERY DRILL USPEŠEN — poročilo: $REPORT (RTO ${RTO_TOTAL}s, RPO ${RPO_S}s)"
