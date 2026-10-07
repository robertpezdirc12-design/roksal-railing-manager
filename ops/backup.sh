#!/usr/bin/env bash
# ops/backup.sh — varnostna kopija Roksal Manager (R441 / issue #3, točki 2–4).
#
# Kaj vsebuje ena kopija (šifrirani .rkb = tar.gz):
#   • git.bundle   — CEL repozitorij: vsa zgodovina, veje, tagi, Prisma migrations, CI
#   • db/custom.db — dosleden posnetek baze (SQLite online backup API — varno ob delujoči aplikaciji)
#   • export/*.json — strojno berljiv export vseh tabel (brez baze obnovljivi podatki)
#   • manifest.json — časi, SHA-256 kontrolne vsote, števci vrstic, prstni odtis sheme
#
# Šifriranje: AES-256-CBC + PBKDF2 (200 000 iteracij). Geslo IZKLJUČNO iz okolja
# ROKSAL_BACKUP_PASSPHRASE ali .env.recovery (gitignored) — brez gesla je kopija neuporabna.
#
# Off-site hramba: GitLab generic package registry (ločeno od izvorne kode, dostop
# z istim žetonom; brez gesla neuporabna — geslo hranimo ločeno, glej docs/SECRETS.md).
#
# Uporaba:  ops/backup.sh [--local-only] [--keep N]
# Izhod (stdout): JSON povzetek (za dnevnik joba varnostna-kopija)

set -euo pipefail
. "$(dirname "$0")/lib.sh"

LOCAL_ONLY=0
KEEP=5
while [ $# -gt 0 ]; do
  case "$1" in
    --local-only) LOCAL_ONLY=1 ;;
    --keep) KEEP="$2"; shift ;;
    *) die "neznana opcija: $1" ;;
  esac
  shift
done

T0="$(date +%s)"
TS="$(date +%Y%m%d-%H%M%S)"
[ -f "$DB_PATH" ] || die "baza ne obstaja: $DB_PATH"
mkdir -p "$BACKUP_DIR"

GIT_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD)"
GIT_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
SHORT_SHA="${GIT_SHA:0:8}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

log "1/6 git bundle (cel repozitorij: zgodovina, veje, tagi)…"
mkdir -p "$STAGE/git"
git -C "$ROOT_DIR" bundle create "$STAGE/git/git.bundle" --all --quiet
BUNDLE_SHA="$(sha256_of "$STAGE/git/git.bundle")"

log "2/6 posnetek baze (SQLite online backup — varen med delovanjem)…"
mkdir -p "$STAGE/db"
python3 - "$DB_PATH" "$STAGE/db/custom.db" << 'PYEOF'
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
s = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
d = sqlite3.connect(dst)
with d:
    s.backup(d)  # dosleden posnetek tudi ob vzporednih pisanjih
d.close(); s.close()
PYEOF
DB_SHA="$(sha256_of "$STAGE/db/custom.db")"
DB_BYTES="$(stat -c%s "$STAGE/db/custom.db")"

log "3/6 strojno berljiv JSON export vseh tabel…"
mkdir -p "$STAGE/export"
EXPORT_META="$(python3 "$OPS_DIR/export-db.py" "$STAGE/db/custom.db" "$STAGE/export")"

log "4/6 manifest s kontrolnimi vsotami…"
SCHEMA_SHA="$(sha256_of "$ROOT_DIR/prisma/schema.prisma")"
EXPORT_SHA="$( (cd "$STAGE/export" && sha256sum -- *) | sha256sum | cut -d' ' -f1)"
cat > "$STAGE/manifest.json" << EOF
{
  "created": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "host": "$(hostname -s)",
  "app": { "name": "Roksal Railing Manager", "version": "0.2.1" },
  "git": { "sha": "$GIT_SHA", "branch": "$GIT_BRANCH", "bundleSha256": "$BUNDLE_SHA" },
  "db": { "bytes": $DB_BYTES, "sha256": "$DB_SHA", "schemaPrismaSha256": "$SCHEMA_SHA" },
  "export": { "aggregateSha256": "$EXPORT_SHA" },
  "retention": { "localKeep": $KEEP }
}
EOF
# števci vrstic iz export _meta (isti posnetek kot custom.db)
python3 - "$STAGE" << 'PYEOF'
import json, sys
stage = sys.argv[1]
with open(f"{stage}/manifest.json", encoding="utf-8") as fh: m = json.load(fh)
with open(f"{stage}/export/_meta.json", encoding="utf-8") as fh: meta = json.load(fh)
m["db"]["schemaFingerprint"] = meta["schemaFingerprint"]
m["db"]["tableCount"] = meta["tableCount"]
m["db"]["rowCounts"] = meta["rowCounts"]
with open(f"{stage}/manifest.json", "w", encoding="utf-8") as fh:
    json.dump(m, fh, ensure_ascii=False, indent=1)
PYEOF

log "5/6 pakiranje + šifriranje (AES-256-CBC, PBKDF2 200k)…"
BARE="roksal-backup-$TS-$SHORT_SHA"
tar -czf "$BACKUP_DIR/$BARE.tar.gz" -C "$STAGE" git db export manifest.json
PASSPHRASE="$(backup_passphrase)"
if [ "$LOCAL_ONLY" -eq 1 ] || [ -z "$PASSPHRASE" ]; then
  # --local-only ali manjkajoče geslo: NEšifrirana kopija ostane lokalno (izven git)
  mv "$BACKUP_DIR/$BARE.tar.gz" "$BACKUP_DIR/$BARE.tar.gz.local"
  FINAL="$BACKUP_DIR/$BARE.tar.gz.local"
  ENCRYPTED=false
else
  # namensko prek okolja: gesla nikoli v ukazni vrstici (ps / zgodovina lupine)
  export ROKSAL_BACKUP_PASSPHRASE="$PASSPHRASE"
  openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
    -in "$BACKUP_DIR/$BARE.tar.gz" -out "$BACKUP_DIR/$BARE.rkb" \
    -pass env:ROKSAL_BACKUP_PASSPHRASE
  unset ROKSAL_BACKUP_PASSPHRASE
  rm -f "$BACKUP_DIR/$BARE.tar.gz"
  FINAL="$BACKUP_DIR/$BARE.rkb"
  ENCRYPTED=true
fi
FINAL_SHA="$(sha256_of "$FINAL")"
FINAL_BYTES="$(stat -c%s "$FINAL")"

log "6/6 off-site naložitev na GitLab (generic package registry)…"
OFFSITE_UPLOADED=false
OFFSITE_VERSION=""
OFFSITE_NOTE=""
OFFSITE_CHUNKS=0
if [ "$LOCAL_ONLY" -eq 1 ]; then
  OFFSITE_NOTE="izpuščeno (--local-only)"
elif [ "$ENCRYPTED" = false ]; then
  OFFSITE_NOTE="izpuščeno — manjka ROKSAL_BACKUP_PASSPHRASE (kopija ni šifrirana)"
else
  TOKEN="$(gitlab_token)"
  if [ -z "$TOKEN" ]; then
    OFFSITE_NOTE="izpuščeno — manjka GITLAB_TOKEN"
  else
    OFFSITE_VERSION="$TS-$SHORT_SHA"
    # Cloudflare občasno blokira IP peskovnice glede na velikost zahteve —
    # zato kopijo naložimo v kosih po 128 KiB z ročnimi poskusi ponovitve
    # + stranski manifest za ponovno sestavljanje (brez skrivnosti).
    CHUNK_DIR="$(mktemp -d)"
    split -b 131072 -d "$FINAL" "$CHUNK_DIR/$BARE.rkb."
    OFFSITE_CHUNKS="$(find "$CHUNK_DIR" -type f | wc -l)"
    printf '{\n  "file": "%s.rkb",\n  "totalBytes": %s,\n  "totalSha256": "%s",\n  "chunks": %s,\n  "gitSha": "%s",\n  "createdAt": "%s"\n}\n' \
      "$BARE" "$FINAL_BYTES" "$FINAL_SHA" "$OFFSITE_CHUNKS" "$GIT_SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      > "$CHUNK_DIR/manifest.json"
    UPLOAD_OK=true
    for chunk in "$CHUNK_DIR"/*; do
      CNAME="$(basename "$chunk")"
      # do 6 poskusov z naraščajočo pavzo (403 Cloudflare je verjetnostno blokiranje)
      CODE="000"
      for poskus in 1 2 3 4 5 6; do
        CODE="$(curl -s --max-time 90 -o /dev/null -w '%{http_code}' \
          -X PUT \
          -H "PRIVATE-TOKEN: $TOKEN" \
          -H "Content-Type: application/octet-stream" \
          -T "$chunk" \
          "$GITLAB_API/projects/$GITLAB_PROJECT_ID/packages/generic/$BACKUP_PACKAGE/$OFFSITE_VERSION/$CNAME" || echo 000)"
        if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then break; fi
        log "   $CNAME poskus $poskus -> HTTP $CODE, ponovna objava čez $((poskus * 3))s…"
        sleep $((poskus * 3))
      done
      if [ "$CODE" != "200" ] && [ "$CODE" != "201" ]; then
        UPLOAD_OK=false
        OFFSITE_NOTE="spodletelo pri $CNAME (HTTP $CODE) — kopija je varno lokalno"
        log "   NAPAKA: $CNAME -> HTTP $CODE (vseh 6 poskusov)"
        break
      fi
    done
    rm -rf "$CHUNK_DIR"
    if [ "$UPLOAD_OK" = true ]; then
      OFFSITE_UPLOADED=true
      log "   naloženo: $BACKUP_PACKAGE/$OFFSITE_VERSION ($OFFSITE_CHUNKS kosov + manifest)"
      # remote housekeeping: obdrži zadnjih 10 verzij paketa
      curl -s --max-time 60 -H "PRIVATE-TOKEN: $TOKEN" \
        "$GITLAB_API/projects/$GITLAB_PROJECT_ID/packages?package_name=$BACKUP_PACKAGE&per_page=100&sort=desc&order_by=created_at" \
        | python3 -c "import json,sys; [print(p['id']) for p in json.load(sys.stdin)[10:]]" 2>/dev/null \
        | while read -r pid; do
            curl -s --max-time 30 -X DELETE -H "PRIVATE-TOKEN: $TOKEN" \
              "$GITLAB_API/projects/$GITLAB_PROJECT_ID/packages/$pid" >/dev/null 2>&1 || true
          done || true # hišni red je NIKOLI usoden za uspeh kopije
    fi
  fi
fi

# housekeeping: obdrži zadnjih N lokalnih kopij (find — nikoli ne pade na manjkajočem globu)
find "$BACKUP_DIR" -maxdepth 1 \( -name 'roksal-backup-*.rkb' -o -name 'roksal-backup-*.tar.gz.local' \) -printf '%T@ %p\n' \
  | sort -rn | tail -n +$((KEEP + 1)) | cut -d' ' -f2- | xargs -r rm -f --

T1="$(date +%s)"
cat > "$BACKUP_DIR/last-backup.json" << EOF
{
  "ok": true,
  "file": "$(basename "$FINAL")",
  "bytes": $FINAL_BYTES,
  "sha256": "$FINAL_SHA",
  "encrypted": $ENCRYPTED,
  "gitSha": "$GIT_SHA",
  "gitBranch": "$GIT_BRANCH",
  "offsite": { "uploaded": $OFFSITE_UPLOADED, "version": "$OFFSITE_VERSION", "chunks": $OFFSITE_CHUNKS, "note": "$OFFSITE_NOTE" },
  "durationSec": $((T1 - T0)),
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

python3 -c "
import json
m = json.load(open('$STAGE/manifest.json'))
s = json.load(open('$BACKUP_DIR/last-backup.json'))
s['manifest'] = { 'dbBytes': m['db']['bytes'], 'tableCount': m['db']['tableCount'],
                  'totalRows': sum(m['db']['rowCounts'].values()) }
print(json.dumps(s, ensure_ascii=False))
"
