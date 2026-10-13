#!/usr/bin/env bash
# tests/deploy-author-check.sh — R498: avtorji commitov morajo biti GitHub račun,
# ki ga Vercel prepozna.
#
# Zakaj je to del relejnih vrat in ne samo "lepota":
# Vercel ustavi production deploy (readyState BLOCKED) z obrazložitvijo
#   "The deployment was blocked because Vercel couldn't find a Git account for the
#    commit author."
# Koda je takrat na GitHubu združena in relejna vrata so zeleni, a produkcija TIHO
# zaostaja — razlike ne opazi nihče, dokler kdo ne odpre /api/public/health.
#
# Izmerjeni dokaz (13. 10. 2026): 9 zaporednih production deployev (R493 …
# R495-dodatek) BLOCKED, ker so bili commiti avtorizirani kot
# "Z User <z@container>" oziroma "Z.ai Code <zai@roksal.local>". Produkcija je
# zato ostala na main-fe11901 (R492). Isti kodi v preview okolju, a z avtorjem
# robertpezdirc12-design@users.noreply.github.com, sta READY — gre torej
# izključno za identiteto avtorja, ne za vsebino.
#
# Uporaba: tests/deploy-author-check.sh [<rev-range>]
#   privzeto origin/main..HEAD; če distančna veja ni dosegljiva (svež/plitek
#   klon), se preverí samo vrh — tistega Vercel gradi. Argument je lahko tudi
#   oblika `git rev-list` (npr. `bash tests/deploy-author-check.sh -n 1 HEAD`).
# Izhod:  0 = vsi avtorji so dovoljeni
#         1 = najden avtor, ki bi zadržal production deploy
#         2 = pogojev za preverjanje ni (ni git podatkov) — NIKOLI ne štej zeleno
# Nadomestni seznam (presledki ločeni): ROKSAL_ALLOWED_AUTHOR_EMAILS

set -euo pipefail

DovoljeniDefault="robert.pezdirc12@gmail.com robertpezdirc12-design@users.noreply.github.com"
read -r -a DOVOLJENI <<< "${ROKSAL_ALLOWED_AUTHOR_EMAILS:-$DovoljeniDefault}"

if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "NI GIT — preverjanja avtorjev ni bilo mogoče izvesti (ne štej kot zelen)." >&2
  exit 2
fi

Obseg="$*"
if [ -z "$Obseg" ]; then
  if git rev-parse --verify -q origin/main > /dev/null 2>&1; then
    Obseg="origin/main..HEAD"
  else
    # Ni distančne veje (svež/plitek klon): Vercel gradi VRH, zgodovinskih commitov
    # ne moremo več popravljati — brez tega bi bila vrata večno rdeča zaradi
    # stanja, ki ga noben agent ne more več spremeniti.
    Obseg="-n 1 HEAD"
    echo "opomba: origin/main ni dosegljiv — preverjen je samo vrh (ga Vercel gradi)" >&2
  fi
fi

# `git rev-list` razume obe obliki: "A..B" in zastavice ("-n 1 HEAD").
if ! Commiti=$(git rev-list $Obseg 2>/dev/null); then
  echo "range '$Obseg' ni razumljen (plitek checkout?) — preverjen vrh" >&2
  Commiti=$(git rev-list -n 1 HEAD)
fi

# Prazen range = vrat ne bi pregledala ničesar; vrh je vseeno tisti, ga Vercel gradi.
[ -n "$Commiti" ] || Commiti=$(git rev-list -n 1 HEAD)

Slabi=""
for c in $Commiti; do
  Mail=$(git log -1 --format='%ae' "$c")
  Najden=0
  for d in "${DOVOLJENI[@]}"; do
    [ "$Mail" = "$d" ] && { Najden=1; break; }
  done
  if [ "$Najden" -eq 0 ]; then
    # $() odstrani končno novo vrstico, zato jo moramo dodati posebej — sicer se
    # sporni avtorji izpišejo v eno samo vrstico in se jih ne da prebrati.
    Slabi+=$(printf '  %s  %s <%s>' "$(git log -1 --format='%h' "$c")" "$(git log -1 --format='%an' "$c")" "$Mail")$'\n'
  fi
done

Stevec=$(printf '%s\n' "$Commiti" | grep -c . || true)

if [ -n "$Slabi" ]; then
  echo "BLOKIRANI AVTORJI — Vercel bi zadržal production deploy:"
  printf '%s\n' "$Slabi"
  echo
  echo "Popravek (en commit):    git -c user.name=\"Robert Pezdirc\" -c user.email=\"robert.pezdirc12@gmail.com\" commit --amend --reset-author --no-edit"
  echo "Popravek (več commitov): commite ponovno ustvari z --reset-author (interaktivni rebase)"
  echo "Ponovni preizkus:        bash tests/deploy-author-check.sh"
  exit 1
fi

echo "✓ $Stevec commitov preverjenih — vsi avtorji so povezani z GitHub računom (${DOVOLJENI[*]})"
