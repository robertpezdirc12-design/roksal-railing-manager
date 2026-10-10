#!/usr/bin/env bash
# R464: CI matrika regresijskih testov (GitHub Actions) — skupine po času izvajanja
set -uo pipefail
GRUPA="${1:?skupina}"
PASS=0; FAILED=0; FAILED_LIST=""
run_py () {
  echo "::group::$1"
  if timeout 420 python3 "tests/$1"; then PASS=$((PASS+1)); else FAILED=$((FAILED+1)); FAILED_LIST="$FAILED_LIST $1"; fi
  echo "::endgroup::"
}
run_sh () {
  echo "::group::$1"
  if timeout 420 bash "tests/$1"; then PASS=$((PASS+1)); else FAILED=$((FAILED+1)); FAILED_LIST="$FAILED_LIST $1"; fi
  echo "::endgroup::"
}
case "$GRUPA" in
  r437-r445) run_sh r437.sh; run_sh r438.sh; run_sh r439.sh; run_sh r440.sh; run_sh r441.sh; run_py r440-smoke.py; run_py r443.py; run_py r445.py ;;
  r446-r452) run_py r446.py; run_py r447.py; run_py r448.py; run_py r449.py; run_py r450.py; run_py r451.py; run_py r452.py ;;
  r454-r458) run_py r454.py; run_py r455.py; run_py r456.py; run_py r457.py; run_py r458.py ;;
  r459-r462) run_py r459.py; run_py r460.py; run_py r461.py; run_py r462.py ;;
  r464)       run_py r464-pricing.py; run_py r464-concurrency.py ;;
  r465-r473)  run_py r465.py; run_py r467.py; run_py r468.py; run_py r469.py; run_py r470.py; run_py r471.py; run_py r473.py ;;
  *) echo "neznana skupina: $GRUPA"; exit 2 ;;
esac
echo "═══ $GRUPA: $PASS ✓ / $FAILED ✗ ═══"
[ -n "$FAILED_LIST" ] && echo "PADLI:$FAILED_LIST"
exit $FAILED
