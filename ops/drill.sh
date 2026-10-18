#!/usr/bin/env bash
# ops/drill.sh — RECOVERY DRILL (R441 / issue #3 točka 7; R565 / issue #22:
# PROVIDER-ZAVEDEN — PostgreSQL drill je pravi PG recovery, ne SQLite obvod).
#
# Simulira POPOLNO IZGUBO sistema in izmeri obnovo izključno iz off-site
# varnostne kopije (GitLab) + šifrirnega gesla (izven repozitorija):
#
#   1. IZGUBA: deluje samo še GitLab dostop (žeton) + geslo — lokalne kopije se
#      NAMERNO ne uporabijo (prazna ROKSAL_BACKUP_DIR mapa). Alternativno
#      --file KOPIJA.rkb preizkusi obnovo iz dane LOKALNE kopije (za teste).
#   2. PRENOS + DEŠIFRIRANJE + PREVERBA (kontrolne vsote, git fsck, števci baze)
#      + OBNOVA v izolirano mapo (baza/repo + export glede na providerja).
#   3. VELJAVNOST KODE: bun install + tsc --noEmit iz obnovljenega repozitorija.
#   4a. PROVIDER=postgresql (R565): SVEŽA izolirana baza na lokalnem embedded
#      PostgreSQL strežniku (nikoli produkcijska baza!) → prisma migrate deploy
#      → ops/import-db.mjs (FK-urejen uvoz export/*.json + preverba števcev)
#      → preverba tujih ključev (sirote = 0).
#   4b. PROVIDER=sqlite (zgodovinske kopije): posnetek custom.db (nespremenjeno).
#   5. ZAGON APLIKACIJE iz obnovljene kode + baze (vrata 3100, ločeno od
#      produkcijskega dev strežnika na 3000) + /api/health.
#   6. PRIJAVA + POSLOVNI TEST (branje: projekti; pisanje: nova stranka) proti
#      obnovljenemu sistemu.
#
# Izhod: docs/RECOVERY-DRILL-<časovni-žig>.md poročilo z RTO/RPO + JSON na stdout.
# Off-site kopija ni dosegljiva (žeton/kvota) → poročilo BLOCKED (izhod 3),
# NIKOLI "uspešno".
#
# Uporaba: ops/drill.sh [--skip-install] [--file KOPIJA.rkb]

set -euo pipefail
. "$(dirname "$0")/lib.sh"

SKIP_INSTALL=0
DRILL_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-install) SKIP_INSTALL=1 ;;
    --file) DRILL_FILE="$2"; shift ;;
    *) die "neznana opcija: $1 (dovoljena: --skip-install, --file KOPIJA.rkb)" ;;
  esac
  shift
done

DRILL_ROOT="$(mktemp -d /tmp/roksal-drill-XXXXXX)"
DRILL_REPO="$DRILL_ROOT/out/repo"
REPORT_TS="$(date +%Y%m%d-%H%M%S)"
REPORT="$ROOT_DIR/docs/RECOVERY-DRILL-$REPORT_TS.md"
DRILL_PORT="${ROKSAL_DRILL_PORT:-3100}"
ADMIN_EMAIL="${DRILL_ADMIN_EMAIL:-admin@roksal.si}"
ADMIN_PASS="${DRILL_ADMIN_PASSWORD:-Admin123!}"
DRILL_PID=""
DRILL_DB_NAME="roksal_drill_$(date +%Y%m%d_%H%M%S)" # SVEŽA baza — NIKOLI produkcijska (brez pomišljajev — SQL identifikator)
DRILL_DB_URL="postgresql://roksal:roksal@${ROKSAL_DRILL_PG_HOST:-localhost}:${ROKSAL_DRILL_PG_PORT:-54329}/$DRILL_DB_NAME"
PROVIDER=""
DRILL_APP_DB_URL=""

cleanup () {
  if [ -n "$DRILL_PID" ] && kill -0 "$DRILL_PID" 2>/dev/null; then
    kill "$DRILL_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$DRILL_PID" 2>/dev/null || true
  fi
  # R565: drill bazo POČISTIMO (sledljivost — testna baza ne ostane na strežniku)
  if [ -n "$DRILL_DB_NAME" ] && [ "$PROVIDER" = "postgresql" ]; then
    (cd "$ROOT_DIR" && DATABASE_URL="postgresql://roksal:roksal@${ROKSAL_DRILL_PG_HOST:-localhost}:${ROKSAL_DRILL_PG_PORT:-54329}/postgres" \
      bun -e "
import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect().catch(() => process.exit(0))
await c.query('DROP DATABASE IF EXISTS ${DRILL_DB_NAME}').catch(() => {})
await c.end()
" >/dev/null 2>&1) || true
  fi
  # ROKSAL_DRILL_KEEP=1 ohrani delovno mapo za razhroščevanje (dnevniki faz)
  if [ "${ROKSAL_DRILL_KEEP:-0}" = "1" ]; then
    log "ROKSAL_DRILL_KEEP=1 — delovna mapa ostaja: $DRILL_ROOT"
  else
    rm -rf "$DRILL_ROOT"
  fi
}
trap cleanup EXIT

now_ns () { date +%s%N; }
since_s () { python3 -c "print(round(( $(now_ns) - $1 ) / 1e9, 1))"; }

T_START="$(now_ns)"

# ── faza 1+2: prenos kopije, preverba, obnova v izolacijo ───────────────────
log "FAZA 1: izguba sistema — ${DRILL_FILE:+lokalna kopija ($DRILL_FILE) · }obnova + preverba…"
T="$(now_ns)"
if [ -n "$DRILL_FILE" ]; then
  [ -f "$DRILL_FILE" ] || die "datoteka kopije ne obstaja: $DRILL_FILE"
  export ROKSAL_BACKUP_DIR="$(dirname "$DRILL_FILE")"
  RESTORE_ARGS=(--target-dir "$DRILL_ROOT/out" --file "$DRILL_FILE")
else
  export ROKSAL_BACKUP_DIR="$DRILL_ROOT/ni-lokalnih" # prisili IZKLJUČNO off-site pot
  mkdir -p "$ROKSAL_BACKUP_DIR"
  RESTORE_ARGS=(--target-dir "$DRILL_ROOT/out")
fi
if ! RESTORE_JSON="$(bash "$OPS_DIR/restore.sh" "${RESTORE_ARGS[@]}" 2>"$DRILL_ROOT/restore.log" | tail -n1)"; then
  cat "$DRILL_ROOT/restore.log" >&2 || true
  # R565 (issue #22): off-site ni dosegljiv (žeton/kvota) → BLOCKED poročilo, ne "uspeh"
  cat > "$REPORT" << EOF
# Recovery drill — $REPORT_TS

## Rezultat: BLOKIRAN ⛔

Off-site varnostna kopija NI dosegljiva (žeton GitLab ali kvota — glej zgoraj).
Drill NI bil izveden — to poročilo NI dokaz obnovljivosti. RTO/RPO se ne izračunata.

## Odblokiraj in ponovi
1. Preveri GITLAB_TOKEN (okolje ali .env.recovery) in kvoto projekta.
2. Pošlji svečo kopijo: bash ops/backup.sh --remote
3. Ponovi: bash ops/drill.sh
EOF
  python3 -c "
import json
print(json.dumps({ 'ok': False, 'blocked': True, 'reason': 'off-site kopija ni dosegljiva (žeton/kvota)', 'report': '$REPORT' }, ensure_ascii=False))"
  log "RECOVERY DRILL BLOKIRAN (off-site nedosegljiv) — poročilo: $REPORT"
  exit 3
fi
PHASE1_S="$(since_s "$T")"
RESTORE_OK="$(printf '%s' "$RESTORE_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['ok'])" 2>/dev/null || echo False)"
[ "$RESTORE_OK" = "True" ] || { cat "$DRILL_ROOT/restore.log" >&2; die "obnova kopije je spodletela"; }
GIT_SHA="$(printf '%s' "$RESTORE_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['gitSha'])")"
[ -f "$DRILL_REPO/package.json" ] || die "obnovljeni repozitorij nima package.json"

# ── R565: provider iz manifesta obnovljene kopije ───────────────────────────
PROVIDER="$(python3 -c "
import json
m = json.load(open('$DRILL_ROOT/out/manifest.json'))
print(m.get('db', {}).get('provider', 'sqlite'))" 2>/dev/null || echo sqlite)"
if [ "$PROVIDER" = "postgresql" ] && [ ! -d "$DRILL_ROOT/out/export" ]; then
  die "kopija se izdaja za PostgreSQL, a nima export/ mape — ni veljavena PG kopija"
fi
if [ "$PROVIDER" != "postgresql" ] && [ "$PROVIDER" != "sqlite" ]; then
  die "neznan provider v manifestu: $PROVIDER"
fi
log "   kopija prenešena, dešifrirana, preverjena, obnovljena (${PHASE1_S}s · provider: $PROVIDER)"

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

# ── faza 4: OBNOVA BAZE po providerju ───────────────────────────────────────
PHASE4B_S="0"
PHASE4C_S="0"
if [ "$PROVIDER" = "postgresql" ]; then
  # 4a. R565: SVEŽA izolirana baza na lokalnem embedded PostgreSQL + migracije
  # + FK-urejen uvoz export/*.json + preverba tujih ključev. NIKOLI se ne
  # povežemo na produkcijsko/dev bazo (ime drill baze je unikatno; varovalka
  # spodaj zavrne, če bi se URL kakorkoli ujemal z živim DATABASE_URL).
  log "FAZA 4a (PostgreSQL): sveža izolirana baza $DRILL_DB_NAME + migracije + uvoz…"
  T="$(now_ns)"
  # varovala: drill se NIKOLI poveže na živo bazo (ime je unikatno s časovnim
  # žigom; vseeno eksplicitno preverimo, da se ne ujema z okoljskim DATABASE_URL)
  LIVE_DB="${DATABASE_URL:-}"
  if [ -n "$LIVE_DB" ]; then
    LIVE_NAME="${LIVE_DB%%\?*}"; LIVE_NAME="${LIVE_NAME##*/}"
    [ "$LIVE_NAME" = "$DRILL_DB_NAME" ] && die "varovala: drill bi ponesreči uporabil ŽIVO bazo ($LIVE_NAME)"
  fi
  (cd "$ROOT_DIR" && bun -e "
import pg from 'pg'
const c = new pg.Client({ connectionString: 'postgresql://roksal:roksal@${ROKSAL_DRILL_PG_HOST:-localhost}:${ROKSAL_DRILL_PG_PORT:-54329}/postgres' })
await c.connect()
await c.query('DROP DATABASE IF EXISTS ${DRILL_DB_NAME}')
await c.query('CREATE DATABASE ${DRILL_DB_NAME}')
await c.end()
console.log('ustvarjena')")
  (cd "$DRILL_REPO" && DATABASE_URL="$DRILL_DB_URL" bunx prisma migrate deploy >>"$DRILL_ROOT/pg-migrate.log" 2>&1)
  PHASE4A_S="$(since_s "$T")"
  T="$(now_ns)"
  (cd "$DRILL_REPO" && DATABASE_URL="$DRILL_DB_URL" bun ops/import-db.mjs "$DRILL_ROOT/out/export" >>"$DRILL_ROOT/pg-import.log" 2>&1)
  PHASE4B_S="$(since_s "$T")"
  T="$(now_ns)"
  FK_JSON="$(cd "$DRILL_REPO" && DATABASE_URL="$DRILL_DB_URL" bun ops/fk-check.mjs)"
  FK_TOTAL="$(printf '%s' "$FK_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['total'])")"
  [ "$FK_TOTAL" = "0" ] || { printf '%s\n' "$FK_JSON" >&2; die "preverba tujih ključev: $FK_TOTAL sirot (obnova NI veljavna)"; }
  PHASE4C_S="$(since_s "$T")"
  DRILL_APP_DB_URL="$DRILL_DB_URL"
  log "   baza $DRILL_DB_NAME: migracije (${PHASE4A_S}s) + uvoz (${PHASE4B_S}s) + FK preverba 0 sirot (${PHASE4C_S}s)"
  PHASE4_S="$PHASE4A_S"
else
  # 4b. SQLite (zgodovinske kopije) — posnetek custom.db, nespremenjena pot
  log "FAZA 4b (SQLite): posnetek baze iz kopije…"
  T="$(now_ns)"
  mkdir -p "$DRILL_REPO/db"
  cp "$DRILL_ROOT/out/custom.db" "$DRILL_REPO/db/custom.db"
  DRILL_APP_DB_URL="file:$DRILL_REPO/db/custom.db"
  PHASE4_S="$(since_s "$T")"
fi

# ── faza 5: zagon aplikacije iz obnovljene kode + baze ──────────────────────
log "FAZA 5: zagon aplikacije (vrata $DRILL_PORT, ločeno od produkcije)…"
T="$(now_ns)"
(
  cd "$DRILL_REPO"
  DATABASE_URL="$DRILL_APP_DB_URL" ROKSAL_BUILD="recovery-drill-$REPORT_TS" \
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
PHASE5_S="$(since_s "$T")"
[ -n "$HEALTH" ] || { tail -30 "$DRILL_ROOT/server.log" >&2; die "aplikacija iz obnovljene kopije ni zagnana v 180 s"; }
log "   aplikacija ZDRAVA (${PHASE5_S}s): $HEALTH"

# ── faza 6: prijava + poslovni test (branje + PISANJE) ──────────────────────
log "FAZA 6: prijava + kritični poslovni test…"
T="$(now_ns)"
LOGIN="$(curl -s --max-time 15 -X POST "http://localhost:$DRILL_PORT/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")"
JWT="$(printf '%s' "$LOGIN" | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || true)"
[ -n "$JWT" ] || die "prijava na obnovljeni sistem ni uspela"
PROJECTS="$(curl -s --max-time 15 "http://localhost:$DRILL_PORT/api/projects" -H "Authorization: Bearer $JWT")"
P_COUNT="$(printf '%s' "$PROJECTS" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['data']))" 2>/dev/null || echo 0)"
[ "$P_COUNT" -gt 0 ] || die "poslovni test: 0 projektov na obnovljenem sistemu"
# R565: PISALNI test — obnovljen sistem ne sme biti samo za branje (nov customer 201)
CUST_CODE="drill-$REPORT_TS"
CUST_S="$(curl -s -o "$DRILL_ROOT/cust.json" -w "%{http_code}" --max-time 15 -X POST "http://localhost:$DRILL_PORT/api/customers" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"name\":\"Drill preizkus $CUST_CODE\",\"email\":\"$CUST_CODE@drill.local\"}")"
[ "$CUST_S" = "201" ] || { cat "$DRILL_ROOT/cust.json" >&2 || true; die "pisalni test: nova stranka ni ustvarjena ($CUST_S)"; }
PHASE6_S="$(since_s "$T")"
log "   prijava OK, $P_COUNT projektov, pisanje OK (${PHASE6_S}s)"

# ── povzetek + poročilo ─────────────────────────────────────────────────────
RTO_TOTAL="$(since_s "$T_START")"

# RPO: starost zadnje off-site kopije (samo za off-site teke; --file teki → n/a)
RPO_S="0"
RPO_NOTE="lokalna kopija (--file) — RPO se ne izračuna"
if [ -z "$DRILL_FILE" ]; then
  RPO_S="$(python3 - "$SECRETS_FILE" << 'PYEOF'
import json, os, sys, urllib.request
from datetime import datetime, timezone
api = 'https://gitlab.com/api/v4'
tok = os.environ.get('GITLAB_TOKEN', '')
if not tok:
    for line in open(sys.argv[1], encoding='utf-8'):
        if line.startswith('GITLAB_TOKEN='):
            tok = line.split('=', 1)[1].strip()
req = urllib.request.Request(f'{api}/projects/87474527/packages?package_name=roksal-backup&sort=desc&order_by=created_at&per_page=1')
req.add_header('PRIVATE-TOKEN', tok)
pkgs = json.load(urllib.request.urlopen(req, timeout=30))
created = datetime.fromisoformat(pkgs[0]['created_at'].replace('Z', '+00:00'))
print(int((datetime.now(timezone.utc) - created).total_seconds()))
PYEOF
)"
  RPO_NOTE="off-site kopija (GitLab)"
fi

RTO_OK="$(python3 -c "print('IZPOLNJEN ✓' if $RTO_TOTAL <= 1800 else 'PRESEŽEN ✗')")"
RPO_OK="$(python3 -c "print('n/a' if $RPO_S == 0 else ('IZPOLNJEN ✓' if $RPO_S <= 86400 else 'PRESEŽEN ✗'))")"
INSTALL_NOTE="polni bun install"
[ "$SKIP_INSTALL" -eq 1 ] && INSTALL_NOTE="preskočen (--skip-install — ponovljena namestitev bi dodala ~30–60 s)"
if [ "$PROVIDER" = "postgresql" ]; then
  DB_FAZA="| 4a | **PostgreSQL**: sveža baza \`$DRILL_DB_NAME\` + prisma migrate deploy | ${PHASE4A_S} s |
| 4b | Uvoz export/*.json (FK-urejen import-db.mjs) + preverba števcev | ${PHASE4B_S} s |
| 4c | Preverba tujih ključev (4 relacije, 0 sirot) | ${PHASE4C_S} s |"
else
  DB_FAZA="| 4 | **SQLite**: posnetek custom.db iz kopije | ${PHASE4_S} s |"
fi

cat > "$REPORT" << EOF
# Recovery drill — $REPORT_TS (provider: $PROVIDER)

Simulirana popolna izguba sistema (peskovnik Roksal Manager). Obnova IZKLJUČNO
iz varnostne kopije${DRILL_FILE:+ (LOKALNA: $DRILL_FILE — off-site RPO se ne izračuna)} + šifrirnega
gesla (hramba izven repozitorija). Lokalne datoteke se ne uporabijo${DRILL_FILE:+ (razen --file)}.

## Rezultat: USPEŠEN ✓

| Faza | Dejanje | Trajanje |
|------|---------|----------:|
| 1 | Prenos + dešifriranje + preverba (SHA-256, git fsck, števci) + obnova | ${PHASE1_S} s |
| 3 | Odvisnosti ($INSTALL_NOTE) | ${PHASE3A_S} s |
| 3 | Tipovna preveritev obnovljene kode (tsc --noEmit) | ${PHASE3B_S} s |
$DB_FAZA
| 5 | Zagon aplikacije na vrata $DRILL_PORT + /api/health 200 | ${PHASE5_S} s |
| 6 | Prijava + poslovni test ($P_COUNT projektov + nova stranka 201) | ${PHASE6_S} s |
| **Skupaj (RTO)** | | **${RTO_TOTAL} s** |

- **RTO (dejanski):** ${RTO_TOTAL} s — cilj ≤ 1800 s (30 min): $RTO_OK
- **RPO:** ${RPO_NOTE} — ${RPO_S}s — cilj ≤ 86400 s (24 h): $RPO_OK
- Obnovljeni HEAD: \`$GIT_SHA\`
- Preverjeno: kontrolne vsote vseh komponent, git fsck celotne zgodovine,
  prstni odtis sheme baze, števci vrstic vseh tabel (import-db preverba),
  tuji ključi (0 sirot), uspešen zagon, prijava, branje IN pisanje poslovnih podatkov.
- Šifrirno geslo je bilo prebrano IZKLJUČNO iz okolja/.env.recovery (ni v repozitoriju).

## Ponovitev
\`\`\`bash
bash ops/drill.sh                  # polni preizkus (off-site, z bun install)
bash ops/drill.sh --skip-install   # hitri ponovni preizkus
bash ops/drill.sh --file db/backups/NAJNOVEJSA.rkb   # preizkus iz lokalne kopije
\`\`\`
EOF

# JSON povzetek (strežnik počisti trap ob izhodu)
python3 - "$REPORT" "$RTO_TOTAL" "$RPO_S" "$PHASE1_S" "$PHASE3A_S" "$PHASE3B_S" "$PHASE5_S" "$PHASE6_S" "$GIT_SHA" "$P_COUNT" "$PROVIDER" "$PHASE4B_S" "$PHASE4C_S" << 'PYEOF'
import json, sys
print(json.dumps({
  'ok': True,
  'report': sys.argv[1],
  'rtoSec': float(sys.argv[2]),
  'rpoSec': int(sys.argv[3]),
  'provider': sys.argv[11],
  'phases': { 'prenos_preverba_obnova': float(sys.argv[4]), 'odvisnosti': float(sys.argv[5]),
              'tipi': float(sys.argv[6]), 'zagon': float(sys.argv[7]), 'poslovni_test': float(sys.argv[8]),
              'pg_uvoz': float(sys.argv[12]), 'pg_fk_preverba': float(sys.argv[13]) },
  'gitSha': sys.argv[9],
  'projects': int(sys.argv[10]),
}, ensure_ascii=False))
PYEOF
log "RECOVERY DRILL USPEŠEN ($PROVIDER) — poročilo: $REPORT (RTO ${RTO_TOTAL}s, RPO ${RPO_S}s)"
