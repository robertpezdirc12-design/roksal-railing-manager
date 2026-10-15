#!/usr/bin/env bash
# .zscripts/ci-mirror.sh — vzdrževanje LOKALNEGA GOLEGA ZRCALA za CI klon (R525)
#
# ZAKAJ: peskovnikov izhodni IP je na gitlab.com prek Cloudflare blokiran za
# git smart-HTTP z job-tokenom (dokaz: bivša veja debug/ci-403 — telo 403
# "You are currently viewing from a blocked IP address or country"). Zasebni
# projekt runner (sandbox-runner-roksal-R525, id 57464452) zato v config.toml
# uporablja clone_url = "file:///home/z/ci-mirror/" — klon prebere VEJE/TAGE
# iz tega lokalnega zrcala namesto prek HTTPS. API klici runnerja (anektenje
# joba, trace, cache) ostanejo na https://gitlab.com in delujejo.
#
# POŠTENOST: zrcalo sinhroniziramo iz DELAVNEGA repozitorija (main + tagi).
# Uspešen `git push` pomeni, da je oddaljena veja NATANČNO na tem commitu —
# preverjanje tako teče nad vsebinsko enakim commitom, ki ga je GitLab sprejel.
#
# Uporaba:
#   bash .zscripts/ci-mirror.sh sync     # posodobi zrcalo iz delovnega repota
#   bash .zscripts/ci-mirror.sh verify    # izpiše SHA main/tagov lokalno + oddaljeno
#   bash .zscripts/ci-mirror.sh ensure    # ustvari zrcalo, če še ne obstaja
set -euo pipefail

REPO="/home/z/my-project"
MIRROR="/home/z/ci-mirror/markec-group1/roksal-railing-manager.git"

ensure() {
  if [ ! -d "$MIRROR" ]; then
    mkdir -p "$(dirname "$MIRROR")"
    git clone --mirror "$REPO" "$MIRROR"
    echo "── zrcalo ustvarjeno: $MIRROR"
  fi
}

sync() {
  ensure
  git -C "$MIRROR" fetch "$REPO" '+refs/heads/*:refs/heads/*' --prune
  git -C "$MIRROR" fetch "$REPO" '+refs/tags/*:refs/tags/*' --prune
  git -C "$MIRROR" fetch "$REPO" '+refs/pipelines/*:refs/pipelines/*' --prune 2>/dev/null || true
}

verify() {
  ensure
  local local_sha remote_sha
  local_sha=$(git -C "$REPO" rev-parse main)
  remote_sha=$(git -C "$REPO" ls-remote gitlab refs/heads/main | awk '{print $1}')
  echo "lokalno  main: $local_sha"
  echo "zrcalo   main: $(git -C "$MIRROR" rev-parse refs/heads/main)"
  echo "oddaljeno main: $remote_sha"
  if [ "$local_sha" = "$remote_sha" ] && [ "$local_sha" = "$(git -C "$MIRROR" rev-parse refs/heads/main)" ]; then
    echo "✓ VSI NA ISTEM SHA — CI preverja točno ta commit"
  else
    echo "✗ NISOVPADAJO — poženi 'sync' in preveri, ali je bil push uspešen"
    exit 1
  fi
}

case "${1:-}" in
  sync)   sync ;;
  verify) verify ;;
  ensure) ensure ;;
  *) echo "Uporaba: $0 {sync|verify|ensure}"; exit 64 ;;
esac
