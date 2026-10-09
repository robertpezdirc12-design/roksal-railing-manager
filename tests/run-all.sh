#!/usr/bin/env bash
# R464: celoten regresijski suite (CI + lokalno) — PostgreSQL
set -uo pipefail
cd "$(dirname "$0")/.."
PASS=0; FAILED=0; FAILED_LIST=""
run_py () {
  echo "══════════ $1 ══════════"
  if timeout 420 python3 "tests/$1" > "/tmp/reg-$1.log" 2>&1; then
    tail -2 "/tmp/reg-$1.log" | head -1
    PASS=$((PASS+1))
  else
    tail -5 "/tmp/reg-$1.log"
    FAILED=$((FAILED+1)); FAILED_LIST="$FAILED_LIST $1"
  fi
}
run_sh () {
  echo "══════════ $1 ══════════"
  if timeout 420 bash "tests/$1" > "/tmp/reg-$1.log" 2>&1; then
    tail -2 "/tmp/reg-$1.log" | head -1
    PASS=$((PASS+1))
  else
    tail -5 "/tmp/reg-$1.log"
    FAILED=$((FAILED+1)); FAILED_LIST="$FAILED_LIST $1"
  fi
}
run_sh r437.sh; run_sh r438.sh; run_sh r439.sh; run_sh r440.sh; run_sh r441.sh
run_py r440-smoke.py; run_py r443.py; run_py r445.py; run_py r446.py; run_py r447.py
run_py r448.py; run_py r449.py; run_py r450.py; run_py r451.py; run_py r452.py
run_py r454.py; run_py r455.py; run_py r456.py; run_py r457.py; run_py r458.py
run_py r459.py; run_py r460.py; run_py r461.py; run_py r462.py
run_py r464-pricing.py
run_py r464-concurrency.py
echo "══════════ r464-notifications (samostojen strežnik :3031) ══════════"
if BASE_URL=http://localhost:3031 TEST_DB_URL="$TEST_DB_URL" timeout 420 python3 tests/r464-notifications.py > /tmp/reg-r464-notifications.log 2>&1; then
  tail -2 /tmp/reg-r464-notifications.log | head -1; PASS=$((PASS+1))
else
  tail -5 /tmp/reg-r464-notifications.log; FAILED=$((FAILED+1)); FAILED_LIST="$FAILED_LIST r464-notifications.py"
fi
echo
echo "════════ SKUPAJ: $PASS ZELENIH / $FAILED RDEČIH ════════"
[ -n "$FAILED_LIST" ] && echo "PADLI:$FAILED_LIST"
exit $FAILED
