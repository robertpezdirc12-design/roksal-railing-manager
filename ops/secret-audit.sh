#!/usr/bin/env bash
# ops/secret-audit.sh — pregled repozitorija za skrivnosti (issue #3, točka 5).
#
# Preverja SAMO sledeno (git) vsebino: delovno kopijo in celotno zgodovino.
# Datoteke .env*, db/ in logi morajo biti prezrti (higiena .gitignore).
#
# Izhod:  0 = čisto
#         1 = najdena skrivnost (usodno)
#         2 = napačna higiena repozitorija
#
# Namensko NE iščemo splošnih gesel po vzorcu (preveč lažnih zadetkov) —
# demo prijave iz prisma/seed*.cjs so dokumentirane v docs/SECRETS.md.

set -euo pipefail
. "$(dirname "$0")/lib.sh"

HISTORY_SCAN="${1:---history}" # --history (privzeto) ali --tree-only

# Vzorci trdih skrivnosti — žetoni in zasebni ključi. Vsak zadetek je usoden.
# V dokumentaciji pišemo okrajšave (glpat-…), nikoli 20+ znakov dolgih nizov.
PATTERNS=(
  'glpat-[A-Za-z0-9_-]{20,}'
  'gh[pousr]_[A-Za-z0-9]{36,}'
  'github_pat_[A-Za-z0-9_]{22,}'
  'AKIA[0-9A-Z]{16}'
  'xox[baprs]-[A-Za-z0-9-]{10,}'
  'sk-proj-[A-Za-z0-9_-]{20,}'
  'sk-ant-[A-Za-z0-9_-]{20,}'
  'AIza[0-9A-Za-z_-]{35}'
  '-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----'
)

FAILED=0

echo "== 1/4 Higiena .gitignore (občutljive datoteke morajo biti prezrte) =="
for f in .env .env.recovery db/custom.db dev.log; do
  if git -C "$ROOT_DIR" check-ignore -q "$f" 2>/dev/null; then
    echo "  OK  $f (prezrto)"
  else
    echo "  ✗   $f NI prezrto — preveri .gitignore!"
    FAILED=2
  fi
done

echo "== 2/4 Sledena vsebina ne vsebuje občutljivih imen datotek =="
BAD_NAMES="$(git -C "$ROOT_DIR" ls-files | grep -E '(^|/)\.env|\.pem$|\.key$|(^|/)id_rsa|^.*\.db$' || true)"
if [ -n "$BAD_NAMES" ]; then
  echo "$BAD_NAMES" | sed 's/^/  ✗   /'
  FAILED=1
else
  echo "  OK  med sledenimi datotekami ni .env/.pem/.key/.db"
fi

echo "== 3/4 Vzorci skrivnosti v delovni kopiji (sledene datoteke) =="
TREE_HITS=0
for p in "${PATTERNS[@]}"; do
  while IFS= read -r hit; do
    [ -z "$hit" ] && continue
    echo "  ✗   ${hit%%:*}: $(mask "${hit#*:}")"
    TREE_HITS=$((TREE_HITS + 1))
  done < <(git -C "$ROOT_DIR" grep -nE -e "$p" -- . 2>/dev/null || true)
done
[ "$TREE_HITS" -eq 0 ] && echo "  OK  0 zadetkov v delovni kopiji"
[ "$TREE_HITS" -gt 0 ] && FAILED=1

echo "== 4/4 Vzorci skrivnosti v celotni git zgodovini =="
if [ "$HISTORY_SCAN" = "--tree-only" ]; then
  echo "  --  preskočeno (--tree-only)"
else
  HIST_TMP="$(mktemp)"
  trap 'rm -f "$HIST_TMP"' EXIT
  git -C "$ROOT_DIR" log --all -p --no-color --format= >"$HIST_TMP" 2>/dev/null || true
  HIST_HITS=0
  for p in "${PATTERNS[@]}"; do
    while IFS= read -r hit; do
      [ -z "$hit" ] && continue
      echo "  ✗   zgodovina: $(mask "$hit")"
      HIST_HITS=$((HIST_HITS + 1))
    done < <(grep -nE -e "$p" "$HIST_TMP" || true)
  done
  [ "$HIST_HITS" -eq 0 ] && echo "  OK  0 zadetkov v zgodovini ($(git -C "$ROOT_DIR" rev-list --all --count 2>/dev/null || echo '?') commitov)"
  [ "$HIST_HITS" -gt 0 ] && FAILED=1
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "SKRIVNOSTNI PREGLED: ČISTO ✓"
  exit 0
elif [ "$FAILED" -eq 2 ]; then
  echo "SKRIVNOSTNI PREGLED: NAPAČNA HIGIENA .gitignore ✗"
  exit 2
else
  echo "SKRIVNOSTNI PREGLED: NAJDENA SKRIVNOST ✗ — rotiraj žeton in očisti zgodovino!"
  exit 1
fi
