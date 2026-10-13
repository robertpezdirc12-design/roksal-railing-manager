#!/usr/bin/env bash
# R496: enokomandni LOKALNI relejni pas — `bash tests/ci-local.sh`
#
# Zakaj: GitHub Actions je porabljen (minute do 2026-11-01), .gitlab-ci.yml pa ne
# zmore regresijskih suite-ov (nima baze s podatki). Ta skripta naredi isto kar
# počnejo CI jobi, lokalno: typecheck + lint + migracije + seed + živa aplikacija
# + celotna matrika iz tests/ci-matrix.sh (edini vir resnice za seznam skupin).
#
# Potrebuje: bun (ali npm kot izvajalec skriptov), Python 3, curl, git, bash 4+.
#
# Bazo zagotovi uporabnik, ne skripta — `db:up` je dolgotrajen proces
# (embedded-postgres ostane v ospredju), zato ga zaženi v svojem terminalu:
#   terminal 1: bun run db:up              # lokalni PG na :54329 (ali: node scripts/dev-db.mjs up)
#   terminal 2: bash tests/ci-local.sh     # vse ostalo
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
Koraki=0
Skupine=0

need () {
  command -v "$1" >/dev/null 2>&1 || { echo "✗ manjka pogoj: $1 — namesti ga in ponovi."; exit 127; }
}
# Orodja: `python3` je lahko Windows Store alias, `bun` je lahko odsoten — oba
# sta posnemana z PATH ovi (tests/toolshim.sh: python3→dejanski Python,
# bun→node). Namestitev odvisnosti NIMA nadomestka: hostilec je bun.lock.
source tests/toolshim.sh
need curl; need git
if [ "$JS_RUNNER" = bun ]; then RUNNER=(bun run)
elif command -v npm >/dev/null 2>&1; then RUNNER=(npm run); echo "── brez bun: uporabljam 'npm run' (isti skripti, ista matrika)"
else
  echo "✗ manjka pogoj: bun (ali npm) — testi tega repozitorija so pisani za bun."; exit 127
fi
[ -d node_modules ] || { echo "✗ node_modules manjka — zaženi 'bun install'."; exit 1; }
if command -v bunx >/dev/null 2>&1; then PRISMA=(bunx prisma); else PRISMA=(npx prisma); fi

korak () { # korak <ime> <ukaz...>
  Koraki=$((Koraki+1))
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
# R497: izjema za r464-notifications je bila odstranjena — skupina je zdaj tudi
# v workflowu, zato mora biti na obeh straneh ista množica; sicer je bil pas rdeč
# zaradi lastnega popravka (test je predpostavljal stanje pred njim).
if [ -f .github/workflows/ci.yml ]; then
  Razlika=$(diff <(grep -oE 'grupa: [^ ]+' .github/workflows/ci.yml | awk '{print $2}' | sort) \
                  <(bash tests/ci-matrix.sh --list | sort))
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
  DB="postgresql://roksal:roksal@localhost:54329/roksal"
  echo "── brez env.sh: uporabljam privzeti lokalni PG ($DB)"
fi
# R497: TEST_DB_URL je ZAKLAD za teste (tests/dbenv.py), DATABASE_URL pa mora biti
# izvožen VEDNO — Prisma CLI, seed in dev strežnik (ops/dev-serve.sh brez env.sh)
# brajo samo DATABASE_URL. Brez tega je pas padel na P1012 in je vsaka prijava
# vrnila 500 (aplikacija ni imela povezave do baze) — 23 rdečih skupin iz enega
# samega razloga, ne iz napak v kodi.
export TEST_DB_URL="$DB"
export DATABASE_URL="$DB"

# R497: produkcijska meja 30 prijav/min/IP bi zadavila kar samo matriko (22
# skupin se zaporedoma prijavlja z 127.0.0.1 — izmerjeno: zadnja polovica je
# padala na 429). Pas ne preverja zavor, ampak aplikacijo, zato jo odpre.
export AUTH_RATE_MAX="${AUTH_RATE_MAX:-100000}"
echo "── AUTH_RATE_MAX=$AUTH_RATE_MAX (lokalno; v produkciji je privzeto 30/min/IP)"

# ── 3. statična kakovost ─────────────────────────────────────────────────────
# R498: avtorja commitov morata biti GitHub račun, ki ga Vercel prepozna. Sicer se
# production deploy tiho zadrži (BLOCKED) — zelena koda potem NI enaka živi kodi.
korak "avtorji commitov (Vercel)" bash tests/deploy-author-check.sh
# R497: teste najprej razčleni — na interpreterju, ki ne pozna 3.12+ f-string
# sintakse, bi bil vsak takšen suite v pasu neprepoznljivo rdeč.
korak "razčlenitev Python suite-ov" "$PY" tests/py-parse-check.py
korak "typecheck" "${RUNNER[@]}" typecheck
korak "lint" "${RUNNER[@]}" lint

# ── 4. baza ──────────────────────────────────────────────────────────────────
if [ "$SKIP_DB" != 1 ]; then
  korak "prisma generate" "${PRISMA[@]}" generate
  korak "migrate deploy" "${PRISMA[@]}" migrate deploy
  korak "db:seed" "${RUNNER[@]}" db:seed
fi

# ── 5. živa aplikacija ───────────────────────────────────────────────────────
cekaj_health () { # cekaj_health <url> <sekund> → 0 če aplikacija sprejme health
  local url="$1" mejo="${2:-90}" _
  for _ in $(seq 1 "$mejo"); do
    curl -sf "$url/api/public/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

zazeni_dev () {
  # R497: NODE_OPTIONS (testni `@/` resolver) NAMENO NE sme v dev strežnik —
  # aplikacija mora teči v enakem runtime-u kot v produkciji; hook je samo za
  # testne suite-i, ki neposredno berejo src/lib/*.ts.
  NODE_OPTIONS= ./ops/dev-serve.sh &
  DEV_PID=$!
}

dev_poslusalec () { # PID poslušalca na vratih (Linux `ss`, Windows/mac `netstat`)
  if command -v ss >/dev/null 2>&1; then
    ss -tlnp "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ano 2>/dev/null | awk -v p=":$1" \
      '$1 ~ /^TCP/ && index($2, p) && ($4 ~ /LISTEN/ || $3 ~ /^(0\.0\.0\.0:0|\[::]:0)$/) { print $NF; exit }'
  fi
}

ustavi_drevo () { # ustavi proces IN njegove otroke
  case "$(uname -s 2>/dev/null)" in
    MING*|MSYS*|CYGWIN*) taskkill //PID "$1" //T //F >/dev/null 2>&1 ;;
    *) kill -TERM "$1" 2>/dev/null; sleep 1; kill -KILL "$1" 2>/dev/null ;;
  esac
}

ustavi_poslusaleca () { # ustavi drevo poslušalca na URL-ju, dokler vtičnica ne sprosti
  local url="$1" vrata="${1##*:}" pid _
  for _ in $(seq 1 25); do
    curl -sf "$url/api/public/health" >/dev/null 2>&1 || return 0
    pid="$(dev_poslusalec "$vrata")"
    [ -n "$pid" ] && ustavi_drevo "$pid"
    sleep 1
  done
}

ustavi_dev () {
  [ -n "${DEV_PID:-}" ] || return 0
  kill "$DEV_PID" >/dev/null 2>&1
  # `kill` zadane samo ovoj: dev-serve → next → node je drevo, ki na Windows
  # preživi, health pa še naprej odgovarja in bi naslednji zagon trčil na
  # .next/dev/lock. Zato do prostih vtičnic počistimo za poslušalcem na vratih.
  ustavi_poslusaleca "$BASE_URL"
  DEV_PID=""
}

if [ "$START_DEV" = 1 ]; then zazeni_dev; fi
if ! cekaj_health "$BASE_URL" 90; then
  echo "✗ $BASE_URL/api/public/health ni dosegljiv — testi potrebujejo živo aplikacijo."
  echo "  (Zagon ročno: bun run db:up v svojem terminalu, nato START_DEV=0 bash tests/ci-local.sh)"
  exit 1
fi
echo "── aplikacija pripravljena: $BASE_URL"

# ── 6. celotna regresijska matrika ───────────────────────────────────────────
PADLE=""
for g in $(bash tests/ci-matrix.sh --list); do
  Skupine=$((Skupine+1))
  # R497: Next 16 dovoli EN sam dev strežnik na projektno mapo (blokada
  # .next/dev/lock). Skupina r464-notifications si sama zažene dev strežnik na
  # vrata 3031 (faze A–D potrebujejo različen process.env), zato mora biti
  # strežnik pasu na 3000 med njo ustavljen — sicer test čaka 4 × 240 s na
  # health, ki nikoli ne pride, ker je drugi strežnik že lastnik mape.
  if [ "$g" = r464-notifications ]; then
    ustavljen=0
    if [ -n "$DEV_PID" ]; then
      echo "  ⏸ r464-notifications: dev strežnik na $BASE_URL začasno ustavljen (Next dev blokada)"
      ustavi_dev; ustavljen=1
    else
      echo "  ⚠ r464-notifications: skupina si zažene svoj dev strežnik na :3031 — če v tej mapi"
      echo "    že teče drugi `next dev` (npr. tvoj :3000), Next 16 to zavrne in skupina pade."
    fi
    if bash tests/ci-matrix.sh "$g" > "$LOGS/$g.log" 2>&1; then
      printf '  ✓ %-22s %s\n' "$g" "$(grep -E '^═══' "$LOGS/$g.log" | tail -1)"
    else
      Rdece=$((Rdece+1)); PADLE="$PADLE $g"
      printf '  ✗ %-22s (podrobnosti: %s/%s.log)\n' "$g" "$LOGS" "$g"
      tail -20 "$LOGS/$g.log"
    fi
    # Suite NAMENO pusti svoj strežnik na :3031 teči ("za naknadne teste"), ta pa
    # drži blokado mape — brez čiščenja Next novega na :3000 ne spusti in
    # propadejo VSE nadaljnje skupine. Ustavimo ga na portu, ki ga pozna samo ta
    # skupina (nikoli na kakšnem drugem).
    ustavi_poslusaleca "${NOTIFY_BASE_URL:-http://localhost:3031}"
    if [ "$ustavljen" = 1 ]; then
      zazeni_dev
      if ! cekaj_health "$BASE_URL" 120; then
        echo "✗ po r464-notifications aplikacija ni več dosegljiva na $BASE_URL — ostale skupine testi ne morejo izvesti."
        Rdece=$((Rdece+1))
      fi
    fi
    continue
  fi
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
  echo "════ RELEJNI PAS: ✓ zeleno ($Koraki statičnih korakov, $Skupine skupin) ════"
else
  echo "════ RELEJNI PAS: ✗ $Rdece rdečih od $Koraki korakov in $Skupine skupin ════"
  [ -n "$PADLE" ] && echo "PADLE SKUPINE:$PADLE"
  echo "Ne predlagaj deploya, dokler pas ni zelen."
fi
echo "Logi: $LOGS/"
exit "$Rdece"
