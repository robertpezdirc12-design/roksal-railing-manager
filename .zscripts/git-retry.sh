#!/usr/bin/env bash
# .zscripts/git-retry.sh — git omrežni ukaz z retry ob znani Cloudflare 403 blokadi.
# (delovno odkritje R448/R453: gitlab.com za git HTTP včasih vrne 403 kljub
#  veljavnemu žetonu — bot hevristika, ~60% uspešnost na posamezen poskus)
#
# Uporaba: git-retry.sh <ukazi...>   npr.  git-retry.sh push origin r453-testi
set -uo pipefail

MAX="${GIT_RETRY_MAX:-8}"
DELAY="${GIT_RETRY_DELAY:-3}"

for i in $(seq 1 "$MAX"); do
  if git "$@"; then
    exit 0
  fi
  code=$?
  echo "[git-retry] poskus $i/$i neuspešen (exit $code) — čakam ${DELAY}s …" >&2
  sleep "$DELAY"
done

echo "[git-retry] VSE $MAX poskusov neuspešnih: git $*" >&2
exit 1
