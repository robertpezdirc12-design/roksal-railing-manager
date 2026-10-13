#!/usr/bin/env bash
# R496: enokomandni LOKALNI relejni pas — `bash tests/ci-local.sh`
#
# Zakaj: GitHub Actions je porabljen (minute do 2026-11-01), .gitlab-ci.yml pa ne
# zmore regresijskih suite-ov (nima baze s podatki). Ta skripta naredi isto kar
# počnejo CI jobi, lokalno: typecheck + lint + migracije + seed + živa aplikacija
# + celotna matrika iz tests/ci-matrix.sh (edini vir resnice za seznam skupin).
#
# Potrebuje: bun (ali npx), python3, curl, git, bash 4+.
#
# Bazo zagotovi uporabnik, ne skripta — `bun run db:up` je dolgotrajen proces
# (embedded-postgres ostane v ospredju), zato ga zaženi v svojem terminalu:
#   terminal 1: bun run db:up          # lokalni PG na :54329
#   terminal 2: bash tests/ci-local.sh # vse ostalo
#
# Okoljske spremenljivke:
#   BASE_URL   privzeto http://localhost:3000
#   START_DEV  1 (privzeto) skripta sama zažene `ops/dev-serve.sh` in ga ustavi
#   SKIP_DB    1 preskoči migrate+seed (če je baza že pripravljena)
#   KEEP       1 pusti dev strežnik teči tudi po zaključku
set -uo pipefail
cd "$(dirname "$0")/.."

BASE_URL="${BASE_URL:-http://localhost:3000}"
LOGS="${LOGS_DIR:-.ci-local-logs}"
START_DEV="${START_DEV:-1}"
SKIP_DB="${SKIP_DB:-0}"
KEEP="${KEEP:-0}"
DEV_PID=""
Rdece=0

need () {
  command -v "$1" >/dev/null 2>&1 || { echo "✗ manjka pogoj: $1 — namesti ga in ponovi."; exit 127; }
}
need python3; need curl; need git
if command -v bun >/dev/null 2>&1; then RUNNER=bun; elif command -v npx >/dev/null 2>&1; then RUNNER=npx; else
  echo "✗ manjka pogoj: bun (ali npx) — testi tega repozitorija so pisani za bun."; exit 127
fi
[ -d node_modules ] || { echo "✗ node_modules manjka — zaženi 'bun install'."; exit 1; }
if [ "$RUNNER" = bun ]; then PRISMA=(bunx prisma); else PRISMA=(npx prisma); fi

korak () { # korak <ime> <ukaz...>
  echo "── $1"
  if "${@:2}" > "$LOGS/$(echo "$1" | tr ' /' '__').log" 2>&1; then
    echo "   ✓"
  else
    echo "   ✗ ($1) — $LOGS/$(echo "$1" | tr ' /' '__').log"; Rdece=$((Rdece+1))
  fi
}

cleanup () {
  [ "$KEEP" = 1 ] && return 0
  [ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null
  return 0
}
trap cleanup EXIT

mkdir -p "$LOGS"

# ── 1. uskladjenost CI matrike (skupine ne smejo zaiti drug od drugih) ────────
# ci.yml ima matriko ročno izpisano; ta preizkus opozori, kadar se razhajata.
# Izjema: r464-notifications je NAMENO samo lokalno — sam zaganja drugi dev
# strežnik (:3031) in v GitHub jobu doslej ni bil vklopljen.
if [ -f .github/workflows/ci.yml ]; then
  Razlika=$(diff <(grep -oE 'grupa: [^ ]+' .github/workflows/ci.yml | awk '{print $2}' | sort) \
                  <(bash tests/ci-matrix.sh --list | grep -v '^r464-notifications$' | sort))
  if [ -z "$Razlika" ]; then
    echo "── CI matrika usklajena z .github/workflows/ci.yml"
  else
    echo "✗ .github/workflows/ci.yml in tests/ci-matrix.sh se razhajata:"
    echo "$Razlika"
    Rdece=$((Rdece+1))
  fi
fi

# ── 2. varnostna zavora: samo LOKALNA baza (pas migrira in seed-a) ───────────
[ -f env.sh ] && source env.sh
DB="${TEST_DB_URL:-${DATABASE_URL:-}}"
case "$DB" in
  ""|*@localhost*|*@127.0.0.1*|*@\:\:1*) : ;;
  *) echo "✗ povezava ne kaže na lokalno bazo: ${DB%%@*}…";
     echo "  Rejni poganja migracije in seed — produkcija (Neon) ni dovoljena."; exit 1 ;;
esac
if [ -z "$DB" ]; then
  export TEST_DB_URL="postgresql://roksal:roksal@localhost:54329/roksal"
  export DATABASE_URL="$TEST_DB_URL"
  echo "── brez env.sh: uporabljam privzeti lokalni PG ($TEST_DB_URL)"
fi

# ── 3. statična kakovost ─────────────────────────────────────────────────────
korak "typecheck" "$RUNNER" run typecheck
korak "lint" "$RUNNER" run lint

# ── 4. baza ──────────────────────────────────────────────────────────────────
if [ "$SKIP_DB" != 1 ]; then
  korak "prisma generate" "${PRISMA[@]}" generate
  korak "migrate deploy" "${PRISMA[@]}" migrate deploy
  korak "db:seed" "$RUNNER" run db:seed
fi

# ── 5. živa aplikacija ───────────────────────────────────────────────────────
if [ "$START_DEV" = 1 ]; then
  ./ops/dev-serve.sh &
  DEV_PID=$!
fi
for _ in $(seq 1 90); do
  curl -sf "$BASE_URL/api/public/health" >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -sf "$BASE_URL/api/public/health" >/dev/null 2>&1; then
  echo "✗ $BASE_URL/api/public/health ni dosegljiv — testi potrebujejo živo aplikacijo."
  echo "  (Zagon ročno: bun run db:up v svojem terminalu, nato START_DEV=0 bash tests/ci-local.sh)"
  exit 1
fi
echo "── aplikacija pripravljena: $BASE_URL"

# ── 6. celotna regresijska matrika ───────────────────────────────────────────
PADLE=""
for g in $(bash tests/ci-matrix.sh --list); do
  if bash tests/ci-matrix.sh "$g" > "$LOGS/$g.log" 2>&1; then
    printf '  ✓ %-22s %s\n' "$g" "$(grep -E '^═══' "$LOGS/$g.log" | tail -1)"
  else
    Rdece=$((Rdece+1)); PADLE="$PADLE $g"
    printf '  ✗ %-22s (podrobnosti: %s/%s.log)\n' "$g" "$LOGS" "$g"
    tail -20 "$LOGS/$g.log"
  fi
done

echo
if [ "$Rdece" -eq 0 ]; then
  echo "════ RELEJNI PAS: ✓ zeleno (vsi koraki in vse skupine) ════"
else
  echo "════ RELEJNI PAS: ✗ $Rdece rdečih korakov/skupin ════"
  [ -n "$PADLE" ] && echo "PADLE SKUPINE:$PADLE"
  echo "Ne predlagaj deploya, dokler pas ni zelen."
fi
echo "Logi: $LOGS/"
exit "$Rdece"
