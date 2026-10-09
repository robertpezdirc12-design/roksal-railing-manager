#!/usr/bin/env bash
# ops/backup.sh — varnostna kopija Roksal Manager (R441 / issue #3, točki 2–4;
# R464: provider-agnostično — PostgreSQL primarni, SQLite združljivost ohranjena).
#
# Kaj vsebuje ena kopija (šifrirani .rkb = tar.gz):
#   • git.bundle   — CEL repozitorij: vsa zgodovina, veje, tagi, Prisma migrations, CI
#   • db/          — SQLite: dosleden posnetek custom.db (online backup API)
#                    PostgreSQL: PG-NOTES.txt (razlaga — pg_dump ni na voljo,
#                    nosilec podatkov je export/*.json) + schema.prisma (pri obeh)
#   • export/*.json — strojno berljiv export VSEH modelov po Prisma shemi
#                    (ops/export-db.mjs — deluje za PG in SQLite)
#   • manifest.json — časi, SHA-256 kontrolne vsote, števci vrstic, prstni odtis
#                     sheme (sha256 prisma/schema.prisma), provider
#
# Šifriranje: AES-256-CBC + PBKDF2 (200 000 iteracij). Geslo IZKLJUČNO iz okolja
# ROKSAL_BACKUP_PASSPHRASE ali .env.recovery (gitignored) — brez gesla je kopija neuporabna.
#
# Off-site hramba: GitLab generic package registry (ločeno od izvorne kode, dostop
# z istim žetonom; brez gesla neuporabna — geslo hranimo ločeno, glej docs/SECRETS.md).
#
# Uporaba:  ops/backup.sh [--local-only] [--keep N]
#          (baza se izbere iz ROKSAL_DATABASE_URL oz. DATABASE_URL;
#           brez URL-ja zgodovinska privzeta SQLite pot db/custom.db)
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

# ── R464: izbira baze iz okolja — provider-agnostično ────────────────────────
#   1) ROKSAL_DATABASE_URL, 2) DATABASE_URL, 3) zgodovinska SQLite pot.
DB_URL="${ROKSAL_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$DB_URL" ]; then
  DB_URL="file:${ROKSAL_DB_PATH:-$ROOT_DIR/db/custom.db}"
fi
case "$DB_URL" in
  postgres://*|postgresql://*) DB_PROVIDER="postgresql" ;;
  file:*) DB_PROVIDER="sqlite"; DB_PATH="${DB_URL#file:}" ;;
  *) die "nepodprt DATABASE_URL (pričakovan postgresql:// ali file:): ${DB_URL%%\?*}" ;;
esac
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

log "2/6 posnetek baze (provider: $DB_PROVIDER)…"
mkdir -p "$STAGE/db"
# Prisma shema arhiviramo pri OBEH providerjih: (a) kontrolna vsota prstnega
# odtisa v manifestu se nanaša natančno nanjo (git bundle vsebuje le commite,
# delovno drevo pa je ob kopiranju lahko pred commitom), (b) je pri obnovi
# PG baze natančen vir resnice za `prisma migrate deploy` / `db push`.
cp "$ROOT_DIR/prisma/schema.prisma" "$STAGE/db/schema.prisma"
if [ "$DB_PROVIDER" = "sqlite" ]; then
  [ -f "$DB_PATH" ] || die "baza ne obstaja: $DB_PATH"
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
  DB_BLOCK="{ \"provider\": \"sqlite\", \"bytes\": $DB_BYTES, \"sha256\": \"$DB_SHA\""
else
  # PostgreSQL: pg_dump NI na voljo v peskovnici → RAW posnetek izpuščamo.
  # Nosilec podatkov je export/*.json (korak 3); PG-NOTES.txt razloži obnovo.
  # URL zapišemo SANITIZIRANO (geslo nikoli v manifest — ta ostaja tudi v
  # nešifriranih --local-only kopijah).
  SAN_DB_URL="$(printf '%s' "$DB_URL" | sed -E 's#(postgres(ql)?://[^:/@]+):[^@]*@#\1:***@#')"
  cat > "$STAGE/db/PG-NOTES.txt" << EOF
PostgreSQL kopija — RAW posnetek baze NI vključen.

V peskovniku (in minimalnih CI okoljih) orodje pg_dump ni na voljo, zato ta
paket ne vsebuje binarnega/neposrednega posnetka baze. Nosilec PODATKOV je:

  export/<Model>.json  — vse vrstice vseh modelov po Prisma shemi
                         (izvozio jih je ops/export-db.mjs prek PrismaClient)
  db/schema.prisma     — natančna shema, iz katere je bil izvoz narejen
                         (SHA-256 = manifest.db.schemaFingerprint)
  git/git.bundle       — cel repozitorij vključno s Prisma migracijami

Obnova (GLEJ docs/RECOVERY.md, razdelek R464):
  1. git clone iz git/git.bundle
  2. bun install && DATABASE_URL=<ciljni-PG> bunx prisma migrate deploy
     (ali: bunx prisma db push db/schema.prisma — enaka vsebina kot v repu)
  3. uvoz export/*.json prek Prisma (vsak model: createMany po vrstnem redu
     brez odvisnosti — ali namenski uvozni skript)

Izdelano: $(date -u +%Y-%m-%dT%H:%M:%SZ) · git $GIT_SHA ($GIT_BRANCH)
DATABASE_URL ob izdelavi (sanitiziran): $SAN_DB_URL
EOF
  DB_BLOCK="{ \"provider\": \"postgresql\", \"databaseUrl\": \"$SAN_DB_URL\""
fi

log "3/6 strojno berljiv JSON export vseh tabel ($DB_PROVIDER)…"
mkdir -p "$STAGE/export"
EXPORT_SUMMARY="$(DATABASE_URL="$DB_URL" bun "$OPS_DIR/export-db.mjs" "$STAGE/export")"
[ -f "$STAGE/export/_meta.json" ] || die "export-db.mjs ni ustvaril _meta.json"
log "   $(printf '%s' "$EXPORT_SUMMARY" | python3 -c "
import json, sys
m = json.load(sys.stdin)
print(f\"{m['tableCount']} tabel, {sum(m['rowCounts'].values())} vrstic (provider: {m['provider']})\")")"

log "4/6 manifest s kontrolnimi vsotami…"
SCHEMA_SHA="$(sha256_of "$ROOT_DIR/prisma/schema.prisma")"
# agregat exporta: sha256sum vrstic, sortiranih po C kolaciji (deterministično
# ne glede na locale lupine) — isto formulo preverja restore.sh
EXPORT_SHA="$( (cd "$STAGE/export" && sha256sum -- * | LC_ALL=C sort) | sha256sum | cut -d' ' -f1)"
cat > "$STAGE/manifest.json" << EOF
{
  "created": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "host": "$(hostname -s)",
  "app": { "name": "Roksal Railing Manager", "version": "0.2.1" },
  "git": { "sha": "$GIT_SHA", "branch": "$GIT_BRANCH", "bundleSha256": "$BUNDLE_SHA" },
  "db": $DB_BLOCK, "schemaPrismaSha256": "$SCHEMA_SHA" },
  "export": { "aggregateSha256": "$EXPORT_SHA" },
  "retention": { "localKeep": $KEEP }
}
EOF
# števci vrstic + prstni odtis sheme iz export _meta (isti posnetek kot baza)
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
    # Cloudflare občasno blokira IP peskovnine glede na velikost zahteve —
    # zato kopijo naložimo v kosih po 128 KiB z ročnimi poskusi ponovitve
    # + stranski manifest za ponovno sestavljanje (brez skrivnosti).
    CHUNK_DIR="$(mktemp -d)"
    split -b 131072 -d "$FINAL" "$CHUNK_DIR/$BARE.rkb."
    OFFSITE_CHUNKS="$(find "$CHUNK_DIR" -type f | wc -l)"
    printf '{\n  "file": "%s.rkb",\n  "totalBytes": %s,\n  "totalSha256": "%s",\n  "chunks": %s,\n  "gitSha": "%s",\n  "createdAt": "%s"\n}\n' \
      "$BARE" "$FINAL_BYTES" "$FINAL_SHA" "$OFFSITE_CHUNKS" "$GIT_SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      > "$CHUNK_DIR/manifest.json"
    UPLOAD_OK=true
    # brskalniški UA — Cloudflare občasno blokira privzeti curl UA (spoznanje R448)
    UA="Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0"
    for chunk in "$CHUNK_DIR"/*; do
      CNAME="$(basename "$chunk")"
      # do 6 poskusov z naraščajočo pavzo (403 Cloudflare je verjetnostno blokiranje)
      CODE="000"
      for poskus in 1 2 3 4 5 6; do
        CODE="$(curl -s -A "$UA" --max-time 90 -o /dev/null -w '%{http_code}' \
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
      curl -s -A "$UA" --max-time 60 -H "PRIVATE-TOKEN: $TOKEN" \
        "$GITLAB_API/projects/$GITLAB_PROJECT_ID/packages?package_name=$BACKUP_PACKAGE&per_page=100&sort=desc&order_by=created_at" \
        | python3 -c "import json,sys; [print(p['id']) for p in json.load(sys.stdin)[10:]]" 2>/dev/null \
        | while read -r pid; do
            curl -s -A "$UA" --max-time 30 -X DELETE -H "PRIVATE-TOKEN: $TOKEN" \
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
db = m['db']
man = { 'provider': db.get('provider', 'sqlite'), 'tableCount': db['tableCount'],
        'totalRows': sum(db['rowCounts'].values()) }
if 'bytes' in db: man['dbBytes'] = db['bytes']  # le SQLite (RAW posnetek)
s['manifest'] = man
# povzetek shranimo TUDI v datoteko (status za operativne preverbe/teste)
with open('$BACKUP_DIR/last-backup.json', 'w', encoding='utf-8') as fh:
    json.dump(s, fh, ensure_ascii=False, indent=2)
print(json.dumps(s, ensure_ascii=False))
"
