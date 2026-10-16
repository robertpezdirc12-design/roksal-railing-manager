#!/usr/bin/env bash
# ops/sync-check.sh — R533 (issue #20): dokazljiva sinhronizacija na ravni commit SHA.
#
# ZAKAJ: »zrcalo sinhrono« se dokazuje s primerjavo SHA, ne z uspehom push ukaza.
# Push lahko uspe na enem sistemu, drugi pa ostane zastarel (dogajalo se je:
# R528 — GitLab je ostal 6 commitov za GitHubom, ker je žeton ugasnil).
#
# Preverja: lokalni main, origin (GitHub) main, gitlab main in oznako izdaje
# (v{version} iz package.json) na OBEH oddaljenih repozitorijih. Izhod:
#   OK       — vsi na istem SHA
#   DRIFT    — vsaj en odjem na drugem SHA (izpis razlik)
#   FAILED   — oddaljeni repozitorij ni dosegljiv (po vseh poskusih)
# Izhodna koda: 0 = OK, 1 = DRIFT, 2 = FAILED.
#
# Varnost: izpisejo se SAMO imena oddaljenih repozitorijev in SHA — NIKOLI
# URL-ji (vsebujejo žetone) ali poverilnice.
#
# Okolje:
#   SYNC_REMOTES  privzeto "origin gitlab" — kateri repoti se preverjajo
#                 (testi r533 podijo svoja imena z lokalnimi potmi)
#   SYNC_RETRIES  privzeto 3 — poskusi na prehodne blokade (Cloudflare 403,
#                 znano z R519+)
set -uo pipefail
# SYNC_ROOT: kje je delovni repo (privzeto koren tega repota; testi r533
# podajo svoj začasni repo, da lahko brez omrežja dokazujejo OK/DRIFT/FAILED)
cd "${SYNC_ROOT:-$(dirname "$0")/..}"

SYNC_REMOTES="${SYNC_REMOTES:-origin gitlab}"
SYNC_RETRIES="${SYNC_RETRIES:-3}"

# SHA lokalnega main (delovni repozitorij)
LOKALNO="$(git rev-parse main 2>/dev/null || true)"
[ -n "$LOKALNO" ] || { echo "FAILED: lokalna veja main ne obstaja"; exit 2; }

# Oznaka izdaje iz verzije paketa (v{major.minor.patch})
VERZIJA="$(python3 -c "import json;print(json.load(open('package.json'))['version'])" 2>/dev/null || true)"
OZNAKA=""; [ -n "$VERZIJA" ] && OZNAKA="v${VERZIJA}"

# ls_remote IME REF — SHA z oddaljenega repota (z retriji na prehodne blokade)
ls_remote () {
  local remote="$1" ref="$2" i out
  for i in $(seq 1 "$SYNC_RETRIES"); do
    out="$(git ls-remote "$remote" "$ref" 2>/dev/null | head -1 | cut -f1)"
    if [ -n "$out" ]; then printf '%s' "$out"; return 0; fi
    sleep 3
  done
  return 1
}

STATUS=OK       # 0
ZAKLJUCEK=0
poroci () { # poroci OK|DRIFT|FAILED besedilo
  echo "$1: $2"
  if [ "$1" = DRIFT ] && [ "$STATUS" != FAILED ]; then STATUS=DRIFT; ZAKLJUCEK=1; fi
  if [ "$1" = FAILED ]; then STATUS=FAILED; ZAKLJUCEK=2; fi
}

for R in $SYNC_REMOTES; do
  # main
  if ODJ="$(ls_remote "$R" refs/heads/main)"; then
    if [ "$ODJ" = "$LOKALNO" ]; then
      poroci OK "main @ $R = ${ODJ:0:12} (lokalno)"
    else
      poroci DRIFT "main @ $R = ${ODJ:0:12} ≠ lokalno ${LOKALNO:0:12} — push ali reset"
    fi
  else
    poroci FAILED "$R ni dosegljiv (ls-remote po $SYNC_RETRIES poskusih)"
  fi
  # oznaka izdaje (če obstaja verzija in LOKALNA oznaka) — primerjava
  # lokalna oznaka ↔ oddaljena oznaka (NE proti main: oznaka sme kazati
  # na starejši izdajni commit)
  if [ -n "$OZNAKA" ]; then
    LOKALNA_OZ="$(git rev-parse -q --verify "refs/tags/$OZNAKA" 2>/dev/null || true)"
    if [ -z "$LOKALNA_OZ" ]; then
      echo "OPOMBA: oznaka $OZNAKA (verzija paketa $VERZIJA) lokalno še ne obstaja — izpust, ne DRIFT"
    elif ODJ="$(ls_remote "$R" "refs/tags/$OZNAKA")"; then
      if [ "$ODJ" = "$LOKALNA_OZ" ]; then
        poroci OK "$OZNAKA @ $R = ${ODJ:0:12}"
      else
        poroci DRIFT "$OZNAKA @ $R = ${ODJ:0:12} ≠ lokalna ${LOKALNA_OZ:0:12} — ponovno označi ali potisni"
      fi
    else
      poroci DRIFT "oznaka $OZNAKA manjka @ $R (lokalno ${LOKALNA_OZ:0:12}) — izdaja NI popolna"
    fi
  fi
done

echo "── sinhronizacija: $STATUS"
exit "$ZAKLJUCEK"
