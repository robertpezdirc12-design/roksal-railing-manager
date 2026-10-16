#!/usr/bin/env bash
# R464: CI matrika regresijskih testov (GitHub Actions) — skupine po času izvajanja.
#
# R496: ta datoteka je EDINI VIR RESNICE za seznam skupin in njeno vsebino.
# Usage:
#   bash tests/ci-matrix.sh <skupina>   # ena skupina (GitHub Actions matrix)
#   bash tests/ci-matrix.sh --list      # ime ene skupine na vrstico
#   bash tests/ci-matrix.sh --json      # JSON seznam skupin (za .github matrix)
#   bash tests/ci-matrix.sh --all       # vse skupine zaporedoma (lokalni relejni pas)
set -uo pipefail
cd "$(dirname "$0")/.."

# R496: `python3` je na Windows lahko Store alias, ki se ne izvrši → skupno
# odkrivanje + PATH ovojem (tests/pyshim.sh), da tudi .sh suite-i delajo.
source tests/toolshim.sh

# --- edina definicija: vrstni red skupin + njihove datoteke -------------------
GRUPE=(r437-r445 r446-r452 r454-r458 r459-r462 r464 r464-notifications r465-r474 r475-r478 r479 r480 r481 r483 r484 r485 r486 r487 r488 r489 r490 r493 r494 r495 r500 r501 r502 r503 r504 r508 r509 r510 r511 r513 r516 r517 r518 r520 r522 r523 r524 r527 r532 r533 r534 r536 r538)

declare -A CLANI
CLANI[r437-r445]="r437.sh r438.sh r439.sh r440.sh r441.sh r440-smoke.py r443.py r445.py"
CLANI[r446-r452]="r446.py r447.py r448.py r449.py r450.py r451.py r452.py"
CLANI[r454-r458]="r454.py r455.py r456.py r457.py r458.py"
CLANI[r459-r462]="r459.py r460.py r461.py r462.py"
CLANI[r464]="r464-pricing.py r464-concurrency.py"
CLANI[r464-notifications]="r464-notifications.py"
CLANI[r465-r474]="r465.py r467.py r468.py r469.py r470.py r471.py r473.py r474.py"
CLANI[r475-r478]="r475.py r476.py r477.py r478.py"
CLANI[r479]="r479.py"
CLANI[r480]="r480.py"
CLANI[r481]="r481.py"
CLANI[r483]="r483.py"
CLANI[r484]="r484.py"
CLANI[r485]="r485.py"
CLANI[r486]="r486.py"
CLANI[r487]="r487.py"
CLANI[r488]="r488.py"
CLANI[r489]="r489.py"
CLANI[r490]="r490.py"
CLANI[r493]="r493.py"
CLANI[r494]="r494.py"
CLANI[r495]="r495.py"
CLANI[r500]="r500.py"
CLANI[r501]="r501.py"
CLANI[r502]="r502.py"
CLANI[r503]="r503.py"
CLANI[r504]="r504.py"
CLANI[r508]="r508.py"
CLANI[r509]="r509.py"
CLANI[r510]="r510.py"
CLANI[r511]="r511.py"
CLANI[r513]="r513.py"
CLANI[r516]="r516.py"
CLANI[r517]="r517.py"
CLANI[r518]="r518.py"
CLANI[r520]="r520.py"
CLANI[r522]="r522.py"
CLANI[r523]="r523.py"
CLANI[r524]="r524.py"
CLANI[r527]="r527.py"
CLANI[r532]="r532.py"
CLANI[r533]="r533.py"
CLANI[r534]="r534.py"
CLANI[r536]="r536.py"
CLANI[r538]="r538.py"

PASS=0; FAILED=0; SKIPPED=0; FAILED_LIST=""; SKIPPED_LIST=""
STRICT_TOOLS="${STRICT_TOOLS:-0}"

manjkajoce_orodje () { # manjkajoce_orodje <datoteka> → prazno če vse lahko
  local t
  for t in $(orodja_za "$1"); do
    orodje_ok "$t" || printf '%s ' "$t"
  done
}

# Suite, ki rabi zunanje orodje, ki ga na tej mizi NI, ne sme pasti rdeče — to
# bi bil LAZEN podatek (196 "jq: command not found" padcev v R497 je bil prav
# takšen). Označijo se kot preskočeni in jih povzetek glasno našteje, da pas ne
# trdi, da je dokazal celotno matriko. STRICT_TOOLS=1 (CI) jih steje kot napako.
try_run () { # try_run <datoteka> <izvedbeni ukaz...>
  local f="$1"; shift
  local manjkajo; manjkajo="$(manjkajoce_orodje "$f")"
  if [ -n "$manjkajo" ]; then
    if [ "$STRICT_TOOLS" = 1 ]; then
      echo "✗ $f: manjkajo zahtevana orodja ($manjkajo) — STRICT_TOOLS=1"
      FAILED=$((FAILED+1)); FAILED_LIST="$FAILED_LIST $f"
    else
      echo "⊘ $f: PRESKOČENO (manjka: $manjkajo)"
      SKIPPED=$((SKIPPED+1)); SKIPPED_LIST="$SKIPPED_LIST $f"
    fi
    return 0
  fi
  if "$@"; then PASS=$((PASS+1)); else FAILED=$((FAILED+1)); FAILED_LIST="$FAILED_LIST $f"; fi
}

run_py () {
  echo "::group::$1"
  try_run "$1" timeout "${TIMEOUT_PY:-420}" python3 "tests/$1"
  echo "::endgroup::"
}

run_sh () {
  echo "::group::$1"
  try_run "$1" timeout "${TIMEOUT_SH:-420}" bash "tests/$1"
  echo "::endgroup::"
}

# r464-notifications sam zaganja dev strežnik (BASE_URL :3031) — potrebuje svoje okolje
# in daljšo mejo kot ostali suite-i.
run_notifications () {
  echo "::group::$1"
  try_run "$1" env BASE_URL="${NOTIFY_BASE_URL:-http://localhost:3031}" \
    timeout "${TIMEOUT_NOTIFY:-600}" python3 "tests/$1"
  echo "::endgroup::"
}

run_group () {
  local g="$1"
  if [[ -z "${CLANI[$g]:-}" ]]; then echo "neznana skupina: $g (razpoložljive: ${GRUPE[*]})"; exit 2; fi
  for f in ${CLANI[$g]}; do
    case "$f" in
      r464-notifications.py) run_notifications "$f" ;;
      *.py) run_py "$f" ;;
      *) run_sh "$f" ;;
    esac
  done
}

MODE="${1:?uporaba: ci-matrix.sh <skupina>|--list|--json|--all}"
case "$MODE" in
  --list) printf '%s\n' "${GRUPE[@]}"; exit 0 ;;
  --json)
    out=""
    for g in "${GRUPE[@]}"; do out+="\"$g\","; done
    printf '[%s]\n' "${out%,}"
    exit 0 ;;
esac

if [[ "$MODE" == "--all" ]]; then
  for g in "${GRUPE[@]}"; do
    echo "══════════ $g ══════════"
    run_group "$g"
  done
else
  run_group "$MODE"
fi

echo "═══ ${MODE}: $PASS ✓ / $FAILED ✗$( [ "$SKIPPED" -gt 0 ] && printf ' / %s preskočenih' "$SKIPPED" )"
[ -n "$FAILED_LIST" ] && echo "PADLI:$FAILED_LIST"
[ -n "$SKIPPED_LIST" ] && { echo "PRESKOČENO (manjkajo orodja):$SKIPPED_LIST"; echo "  Povzetek NI dokaz celotne matrike — namest manjkajoče orodje ali STRICT_TOOLS=1."; }
exit $FAILED
