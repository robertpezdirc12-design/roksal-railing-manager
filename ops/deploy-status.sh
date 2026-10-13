#!/usr/bin/env bash
# ops/deploy-status.sh — R498: ALI JE PRODUKCIJA V KORAKU Z main?
#
# Incident, ki ga ta skripta zazna: devet production deployev (R493 … R495-dodatek)
# je Vercel zadržal (BLOCKED — avtor commita nima ujemajočega se GitHub računa),
# zato je produkcija tekla main-fe11901 (R492), medtem ko je bil na GitHubu
# združenih pet naslednjih nalog. Testi so bili zeleni, zato noben pas ni
# opozoril: zelena koda ne pomeni žive kode.
#
# Uporaba: ops/deploy-status.sh
#   ROKSAL_PROD_URL  produkcija (privzeto https://roksal-railing-manager.vercel.app)
#   ROKSAL_PROD_REF  veja, jo Vercel gradi (privzeto main)
#
# Izhod:  0 = USKLAJENO   (oznaka builda == trenutni vrh ROKSAL_PROD_REF)
#         1 = ZASTARELO    (produkcija zaostaja ali je baza okvarjena)
#         2 = ni podatkov (produkcija ne odgovarja ali ni git dosežka)
#
# Berje samo JAVNO zdravstveno točko /api/public/health — brez žetonov,
# brez prijave, brez posegov v bazo.

set -euo pipefail
. "$(dirname "$0")/lib.sh"

# IMENA SPREMENLJISK SO NAMENSKO BREZ ŠUMNIKOV: bash prepozna samo ASCII
# identifikatorje, "Pričakovano=x" zato razpade na "command not found" (R498).
PROD_URL="${ROKSAL_PROD_URL:-https://roksal-railing-manager.vercel.app}"
PROD_REF="${ROKSAL_PROD_REF:-main}"

Odziv=$(curl -s --max-time 20 "$PROD_URL/api/public/health" 2>/dev/null || true)
if [ -z "$Odziv" ]; then
  echo "NI PODATKOV: $PROD_URL/api/public/health ne odgovarja — usklajenosti ni bilo mogoče preveriti" >&2
  exit 2
fi

# Razčlenjenje je tolerantno na presledke okoli dvopičja: Next/Vercel jih ne piše,
# odgovor pa je videti enako tudi z drugim odjemalcem — strogi vzorec bi lažno
# javil "ni podatkov" (videno v lokalnem preizkusu).
Build=$(printf '%s' "$Odziv" | sed -n 's/.*"build"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
Db=$(printf '%s' "$Odziv" | sed -n 's/.*"db"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
[ -n "$Build" ] || { echo "NI PODATKOV: odgovora ni mogoče razčleniti (manjka \"build\"): $(printf '%s' "$Odziv" | head -c 120)" >&2; exit 2; }

if [ "$Db" != "ok" ]; then
  echo "ZASTARELO/OKVAREN: db=$Db build=$Build"
  exit 1
fi

if ! git -C "$ROOT_DIR" rev-parse --verify -q "origin/$PROD_REF" > /dev/null 2>&1 \
   && ! git -C "$ROOT_DIR" rev-parse --verify -q "$PROD_REF" > /dev/null 2>&1; then
  echo "NI PODATKOV: veja '$PROD_REF' (niti origin/$PROD_REF) ni dosegljiva — primerjave ni bilo mogoče izvesti (build=$Build)" >&2
  exit 2
fi
# Vercel gradi DISTANČNO vejo: če je lokalni main za njo, bi primerjava z lokalnim
# vrhom lažno javila uskladjenost — primerjamo vedno origin/<veja>, če je na voljo.
if git -C "$ROOT_DIR" rev-parse --verify -q "origin/$PROD_REF" > /dev/null 2>&1; then
  RefZaPrimerjavo="origin/$PROD_REF"
else
  RefZaPrimerjavo="$PROD_REF"
fi
Oznaka=$(git -C "$ROOT_DIR" rev-parse --short=7 "$RefZaPrimerjavo")
Pricakovano="$PROD_REF-$Oznaka"

if [ "$Build" = "$Pricakovano" ]; then
  echo "USKLAJENO: productionski build = $Build (vrh $RefZaPrimerjavo)"
  exit 0
fi

Zaostanek="neznano"
OznaceniSha="${Build##*-}"
if git -C "$ROOT_DIR" rev-parse --verify -q "$OznaceniSha^{commit}" > /dev/null 2>&1; then
  Zaostanek=$(git -C "$ROOT_DIR" rev-list --count "$OznaceniSha..$RefZaPrimerjavo")
fi

echo "ZASTARELO: produkcija = $Build, vrh $RefZaPrimerjavo = $Pricakovano (zaostanek: $Zaostanek commitov)"
echo "  Vprašanje, ki ga je treba zastaviti: je bil deploy sploh poskušan? Vercel zadrži"
echo "  deploy brez napake v kodi, če avtorja commita ni mogoče povezati z GitHub"
echo "  računom (tests/deploy-author-check.sh). Stanje: Vercel dashboard → Deployments."
exit 1
