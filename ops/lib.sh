#!/usr/bin/env bash
# ops/lib.sh — skupni pomožniki za operacijske skripte Roksal Manager (R441, issue #3).
# Skrivnosti izključno iz okolja ali .env.recovery (gitignored) — NIKOLI v repozitoriju.

set -euo pipefail

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$OPS_DIR/.." && pwd)"

GITLAB_API="https://gitlab.com/api/v4"
GITLAB_PROJECT_ID="87314539" # markec-group/roksal-railing-manager
DB_PATH="${ROKSAL_DB_PATH:-$ROOT_DIR/db/custom.db}"
BACKUP_DIR="${ROKSAL_BACKUP_DIR:-$ROOT_DIR/db/backups}"
SECRETS_FILE="$ROOT_DIR/.env.recovery"
BACKUP_PACKAGE="roksal-backup" # ime paketa v GitLab generic package registry

# Prebere vrednost ključa iz .env.recovery (KEY=VALUE), če datoteka obstaja.
secrets_get () { # $1 = ime spremenljivke
  [ -f "$SECRETS_FILE" ] || return 0
  sed -n "s/^$1=//p" "$SECRETS_FILE" | tail -n 1
}

# Žeton GitLab: 1) okolje GITLAB_TOKEN, 2) .env.recovery, 3) zaledni vir PAT iz
# remote URL — vendar SAMO, če je remote dejansko gitlab.com (R464: origin je
# zdaj GitHub; njegov PAT kot PRIVATE-TOKEN na gitlab.com ne deluje in nikoli
# ne sme zapustiti stroja v tujo roko).
gitlab_token () {
  local t="${GITLAB_TOKEN:-$(secrets_get GITLAB_TOKEN)}"
  if [ -z "$t" ]; then
    local url
    url="$(git -C "$ROOT_DIR" remote get-url origin 2>/dev/null || true)"
    case "$url" in
      *gitlab.com*)
        t="$(printf '%s' "$url" | sed -n 's#.*://\([^@]*\)@.*#\1#p' | sed 's/^oauth2://')"
        ;;
    esac
  fi
  printf '%s' "$t"
}

# Šifrirno geslo za varnostne kopije — IZKLJUČNO okolje / .env.recovery.
backup_passphrase () {
  printf '%s' "${ROKSAL_BACKUP_PASSPHRASE:-$(secrets_get ROKSAL_BACKUP_PASSPHRASE)}"
}

log () { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die () { printf '[%s] NAPAKA: %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

sha256_of () { sha256sum "$1" | cut -d' ' -f1; }

# Maskiranje žetona/ključa za izpis (prvih 10 znakov).
mask () {
  local s="$1"
  if [ "${#s}" -le 10 ]; then printf '%s' "$s"; else printf '%s…' "${s:0:10}"; fi
}
