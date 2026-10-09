#!/usr/bin/env bash
# ops/restore.sh — obnova/preverba varnostne kopije (R441 / issue #3; R464: PG).
#
# Načini:
#   ops/restore.sh --list-remote
#       Seznam off-site kopij na GitLabu (generic package registry).
#
#   ops/restore.sh --verify [--file KOPIJA.rkb | --remote [VERZIJA]]
#       OBNOVA V IZOLACIJO + preverba (brez dotika delujoče aplikacije):
#         1. dešifriranje (zahteva ROKSAL_BACKUP_PASSPHRASE)
#         2. kontrolne vsote SHA-256 iz manifest.json
#            (git.bundle + export agregat + db/custom.db za SQLite kopije)
#         3. git clone iz git.bundle → fsck + ujemanje HEAD SHA
#         4. baza: prstni odtis sheme + števci vrstic
#              SQLite (zgodovinske kopije): iz db/custom.db (sqlite_master)
#              PostgreSQL (R464): export/_meta.json + DEJANSKO preštete vrstice
#                v export/*.json, prstni odtis = sha256(db/schema.prisma);
#                če je živa baza dosegljiva, se izvede še informativno
#                navzkrižno preverbo prek ops/export-db.mjs (v temp)
#       Izhod: JSON { ok, checks: [...], durationSec } + izhodna koda 0/1.
#
#   ops/restore.sh --target-dir DIR [--file KOPIJA.rkb]
#       DEJANSKA obnova v podano mapo:
#         SQLite: baza (custom.db) + izvorna koda iz bundle
#         PostgreSQL (R464): export/*.json + schema.prisma + manifest
#         (PostgreSQL se nato obnovi z `prisma migrate deploy` + uvozom JSON —
#          docs/RECOVERY.md, razdelek R464)
#
# Privzeta kopija: zadnja lokalna (db/backups/*.rkb). Brez lokalne: --remote.

set -euo pipefail
. "$(dirname "$0")/lib.sh"

TMP_FILES="$(mktemp)"
trap 'rm -f "$TMP_FILES"' EXIT

MODE=""
FILE=""
REMOTE_VERSION=""
TARGET_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --list-remote) MODE=list ;;
    --verify) MODE=verify ;;
    --file) FILE="$2"; shift ;;
    --remote) MODE="${MODE:-verify}"; if [ $# -ge 2 ] && [ "${2#--}" = "$2" ]; then REMOTE_VERSION="$2"; shift; fi ;;
    --target-dir) MODE=target; TARGET_DIR="$2"; shift ;;
    *) die "neznana opcija: $1" ;;
  esac
  shift
done
[ -n "$MODE" ] || die "navedi način: --list-remote | --verify [--file X | --remote [V]] | --target-dir DIR"

api_get () { # $1 = pot (brez osnove), ostalo: curl zastavice — ponovi tudi ob PRAZNEM odgovoru
  local path="$1"; shift
  local t out target=""
  # brskalniški UA — Cloudflare občasno blokira privzeti curl UA (spoznanje R448)
  local ua="Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0"
  t="$(gitlab_token)"
  [ -n "$t" ] || die "manjka GITLAB_TOKEN (okolje ali .env.recovery)"
  # zaznaj -o DATOTEKA (binarni prenosi) — uspešnost merimo po datoteki, ne stdout
  local args=("$@")
  local i
  for i in "${!args[@]}"; do
    if [ "${args[$i]}" = "-o" ] && [ $((i + 1)) -lt ${#args[@]} ]; then
      target="${args[$((i + 1))]}"
    fi
  done
  local poskus
  for poskus in 1 2 3 4 5 6; do
    if [ -n "$target" ]; then
      rm -f "$target"
      curl -s -A "$ua" --max-time 90 -H "PRIVATE-TOKEN: $t" "$GITLAB_API$path" "$@" || true
      # uspeh: datoteka neprazna IN ni Cloudflare HTML blok strani
      if [ -s "$target" ] && ! head -c 64 "$target" | grep -q '^<'; then return 0; fi
    else
      out="$(curl -s -A "$ua" --max-time 60 -H "PRIVATE-TOKEN: $t" "$GITLAB_API$path" "$@" || true)"
      if [ -n "$out" ] && ! printf '%s' "$out" | head -c 64 | grep -q '^<'; then printf '%s' "$out"; return 0; fi
    fi
    log "   API ni odgovoril koristno ($path), poskus $poskus/6 čez 5s…"
    sleep 5
  done
  die "API ni odgovoril: $path"
}

latest_remote_file () { # izpiše verzijo najnovejše off-site kopije
  api_get "/projects/$GITLAB_PROJECT_ID/packages?package_name=$BACKUP_PACKAGE&per_page=100&sort=desc&order_by=created_at" \
    | python3 -c "
import json, sys
pkgs = json.load(sys.stdin)
if not pkgs: sys.exit(1)
print(pkgs[0]['version'])
" 2>/dev/null || return 1
}

download_remote () { # $1 = verzija, $2 = ciljna datoteka (sestavljena .rkb)
  local ver="$1" dst="$2"
  local json pid files sidecar
  json="$(api_get "/projects/$GITLAB_PROJECT_ID/packages?package_name=$BACKUP_PACKAGE&per_page=100")"
  pid="$(printf '%s' "$json" | python3 -c "
import json, sys
ver = sys.argv[1]
for p in json.load(sys.stdin):
    if p['version'] == ver:
        print(p['id']); break
" "$ver")"
  [ -n "$pid" ] || die "verzija $ver ni najdena med off-site kopijami"
  files="$(api_get "/projects/$GITLAB_PROJECT_ID/packages/$pid/package_files")"
  printf '%s' "$files" | python3 -c "
import json, sys
fs = json.load(sys.stdin)
if not fs: sys.exit(1)
names = sorted(f['file_name'] for f in fs)
print('\n'.join(names))
" > "$TMP_FILES" || die "verzija $ver nima datotek"
  local n
  n="$(wc -l < "$TMP_FILES")"
  if [ "$n" -eq 1 ]; then
    # ena sama datoteka (starejše kopije) — neposredna
    api_get "/projects/$GITLAB_PROJECT_ID/packages/generic/$BACKUP_PACKAGE/$ver/$(head -n1 "$TMP_FILES")" -o "$dst"
  else
    # kosna kopija: stranski manifest + kosov .NN — sestavi in preveri
    local dir; dir="$(dirname "$dst")"
    api_get "/projects/$GITLAB_PROJECT_ID/packages/generic/$BACKUP_PACKAGE/$ver/manifest.json" -o "$dir/manifest.json"
    local base
    base="$(python3 -c "import json; print(json.load(open('$dir/manifest.json'))['file'])")"
    : > "$dst"
    local total_bytes=0
    while IFS= read -r fname; do
      case "$fname" in
        manifest.json) continue ;;
      esac
      api_get "/projects/$GITLAB_PROJECT_ID/packages/generic/$BACKUP_PACKAGE/$ver/$fname" -o "$dir/$fname"
      cat "$dir/$fname" >> "$dst"
      total_bytes=$(( total_bytes + $(stat -c%s "$dir/$fname") ))
      rm -f "$dir/$fname"
    done < "$TMP_FILES"
    python3 - "$dir/manifest.json" "$dst" << 'PYEOF' || die "sestavljena off-site kopija SE NE UJEMA s stranskim manifestom"
import hashlib, json, sys
meta, path = json.load(open(sys.argv[1], encoding="utf-8")), sys.argv[2]
h = hashlib.sha256()
with open(path, "rb") as f:
    for c in iter(lambda: f.read(1 << 20), b""):
        h.update(c)
ok = h.hexdigest() == meta["totalSha256"]
print(f"   {'OK ' if ok else '✗  '} sestavljena kopija: {meta['chunks']} kosov, {meta['totalBytes']} bajtov")
sys.exit(0 if ok else 1)
PYEOF
  fi
  log "   prenešeno: $ver ($(( $(stat -c%s "$dst") / 1024 )) KiB)"
}

if [ "$MODE" = list ]; then
  api_get "/projects/$GITLAB_PROJECT_ID/packages?package_name=$BACKUP_PACKAGE&per_page=100&sort=desc&order_by=created_at" \
    | python3 -c "
import json, sys
pkgs = json.load(sys.stdin)
if not pkgs:
    print('Ni off-site kopij.'); sys.exit(0)
for p in pkgs:
    print(f\"{p['version']}  (ustvarjeno {p['created_at']})\")
"
  exit 0
fi

# ── izbira izvorne kopije ────────────────────────────────────────────────────
if [ -z "$FILE" ] && [ -n "$REMOTE_VERSION" ]; then
  TMP_DL="$(mktemp -d)"; trap 'rm -rf "$TMP_DL"' EXIT
  FILE="$TMP_DL/kopija.rkb"
  log "prenašam off-site kopijo $REMOTE_VERSION…"
  download_remote "$REMOTE_VERSION" "$FILE"
elif [ -z "$FILE" ]; then
  FILE="$(find "$BACKUP_DIR" -maxdepth 1 \( -name 'roksal-backup-*.rkb' -o -name 'roksal-backup-*.tar.gz.local' \) -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n1 | cut -d' ' -f2-)"
  if [ -z "$FILE" ]; then
    # ni lokalne — vzemi najnovejšo off-site
    VER="$(latest_remote_file || true)"
    [ -n "$VER" ] || die "ni lokalnih niti off-site kopij"
    TMP_DL="$(mktemp -d)"; trap 'rm -rf "$TMP_DL"' EXIT
    FILE="$TMP_DL/kopija.rkb"
    log "ni lokalnih kopij — prenašam najnovejšo off-site ($VER)…"
    download_remote "$VER" "$FILE"
  fi
fi
[ -f "$FILE" ] || die "kopija ne obstaja: $FILE"

log "obdelava: $(basename "$FILE")"
T0="$(date +%s)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" ${TMP_DL:-}' EXIT

# ── 1. dešifriranje ──────────────────────────────────────────────────────────
log "1/4 dešifriranje…"
if printf '%s' "$FILE" | grep -q '\.rkb$'; then
  PASSPHRASE="$(backup_passphrase)"
  [ -n "$PASSPHRASE" ] || die "manjka ROKSAL_BACKUP_PASSPHRASE (okolje ali .env.recovery)"
  export ROKSAL_BACKUP_PASSPHRASE="$PASSPHRASE"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -in "$FILE" -out "$WORK/kopija.tar.gz" -pass env:ROKSAL_BACKUP_PASSPHRASE 2>/dev/null \
    || die "dešifriranje spodletelo — napačno geslo ali pokvarjena datoteka"
  unset ROKSAL_BACKUP_PASSPHRASE
else
  cp "$FILE" "$WORK/kopija.tar.gz"
fi

# ── 2. razpakiranje + kontrolne vsote ───────────────────────────────────────
log "2/4 razpakiranje + kontrolne vsote…"
mkdir -p "$WORK/vsebina"
tar -xzf "$WORK/kopija.tar.gz" -C "$WORK/vsebina"
[ -f "$WORK/vsebina/manifest.json" ] || die "manjka manifest.json — kopija ni veljavna"
python3 - "$WORK/vsebina" << 'PYEOF' || die "kontrolne vsote SE NE UJEMAJO"
import hashlib, json, os, sys
base = sys.argv[1]
def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()
m = json.load(open(f"{base}/manifest.json", encoding="utf-8"))
checks = [
    ("git.bundle", sha(f"{base}/git/git.bundle") == m["git"]["bundleSha256"]),
]
# R464: export/*.json je pri PostgreSQL nosilec podatkov — agregatna kontrolna
# vsota (ista deterministična formula kot v backup.sh: sha256sum vrstic,
# sortiranih po C kolaciji, spet zloženih skozi sha256)
if "export" in m and "aggregateSha256" in m["export"] and os.path.isdir(f"{base}/export"):
    names = sorted(n for n in os.listdir(f"{base}/export") if not n.startswith("."))
    lines = sorted(f"{sha(f'{base}/export/{n}')}  {n}" for n in names)  # sort vrstic = LC_ALL=C sort
    agg = hashlib.sha256(("\n".join(lines) + "\n").encode()).hexdigest()
    checks.append(("export/*.json (agregat)", agg == m["export"]["aggregateSha256"]))
# zgodovinske SQLite kopije: posnetek custom.db
if os.path.isfile(f"{base}/db/custom.db") and "sha256" in m["db"]:
    checks.append(("db/custom.db", sha(f"{base}/db/custom.db") == m["db"]["sha256"]))
# R464: arhivirana Prisma shema (pri obeh providerjih od R464)
if os.path.isfile(f"{base}/db/schema.prisma") and "schemaPrismaSha256" in m["db"]:
    checks.append(("db/schema.prisma", sha(f"{base}/db/schema.prisma") == m["db"]["schemaPrismaSha256"]))
ok = all(c[1] for c in checks)
for name, passed in checks:
    print(f"   {'OK ' if passed else '✗  '} {name}")
sys.exit(0 if ok else 1)
PYEOF

# ── 3. git obnova v izolacijo ───────────────────────────────────────────────
log "3/4 git obnova (clone iz bundle) + fsck…"
GIT_HEAD_SHA="$(python3 -c "import json; print(json.load(open('$WORK/vsebina/manifest.json'))['git']['sha'])")"
git clone -q --mirror "$WORK/vsebina/git/git.bundle" "$WORK/obnovljeni-repo.git" 2>/dev/null \
  || git clone -q "$WORK/vsebina/git/git.bundle" "$WORK/obnovljeni-repo"
if [ -d "$WORK/obnovljeni-repo.git" ]; then
  RESTORED_SHA="$(git -C "$WORK/obnovljeni-repo.git" rev-parse HEAD 2>/dev/null || echo "")"
  git -C "$WORK/obnovljeni-repo.git" fsck --full --no-progress >/dev/null 2>&1 || die "git fsck je odkril napake v zgodovini"
  BRANCH_COUNT="$(git -C "$WORK/obnovljeni-repo.git" for-each-ref --format='%(refname)' refs/heads | wc -l)"
  TAG_COUNT="$(git -C "$WORK/obnovljeni-repo.git" for-each-ref --format='%(refname)' refs/tags | wc -l)"
else
  RESTORED_SHA="$(git -C "$WORK/obnovljeni-repo" rev-parse HEAD 2>/dev/null || echo "")"
  git -C "$WORK/obnovljeni-repo" fsck --full --no-progress >/dev/null 2>&1 || die "git fsck je odkril napake v zgodovini"
  BRANCH_COUNT="$(git -C "$WORK/obnovljeni-repo" for-each-ref --format='%(refname)' refs/heads refs/remotes | wc -l)"
  TAG_COUNT="$(git -C "$WORK/obnovljeni-repo" for-each-ref --format='%(refname)' refs/tags | wc -l)"
fi
[ "$RESTORED_SHA" = "$GIT_HEAD_SHA" ] || die "obnovljeni HEAD ($RESTORED_SHA) se ne ujema z manifestom ($GIT_HEAD_SHA)"
log "   HEAD $RESTORED_SHA ✓ · $BRANCH_COUNT vej · $TAG_COUNT tagov"

# ── 4. preverba baze ────────────────────────────────────────────────────────
log "4/4 preverba baze (prstni odtis sheme + števci vrstic)…"
if [ -f "$WORK/vsebina/db/custom.db" ]; then
  # ZGODOVINSKE (SQLite) kopije: prstni odtis iz sqlite_master posnetka.
  python3 - "$WORK/vsebina" << 'PYEOF' || die "preverba baze JE SPODLETELA"
import hashlib, json, sqlite3, sys
base = sys.argv[1]
m = json.load(open(f"{base}/manifest.json", encoding="utf-8"))
conn = sqlite3.connect(f"file:{base}/db/custom.db?mode=ro", uri=True)
rows = conn.execute(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL "
    "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' ORDER BY type, name"
).fetchall()
fp = hashlib.sha256("\n".join(r[2] for r in rows).encode()).hexdigest()
ok = fp == m["db"]["schemaFingerprint"]
print(f"   {'OK ' if ok else '✗  '} prstni odtis (sqlite_master)")
for table, expected in sorted(m["db"]["rowCounts"].items()):
    n = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
    passed = n == expected
    ok = ok and passed
    if not passed:
        print(f"   ✗   {table}: {n} vrstic, manifest pravi {expected}")
print(f"   {sum(m['db']['rowCounts'].values())} vrstic v {m['db']['tableCount']} tabelah — vsi števci se ujemajo")
conn.close()
sys.exit(0 if ok else 1)
PYEOF
else
  # R464 (PostgreSQL): nosilec podatkov je export/*.json — preverimo ga NE glede
  # na db/custom.db datoteko:
  #   (a) prstni odtis: manifest.schemaFingerprint (sha256 prisma/schema.prisma,
  #       ki ga je zapisal export/_meta.json) se mora ujemati s sha256 arhivirane
  #       db/schema.prisma (notranja skladnost celotne kopije) in z _meta.json;
  #   (b) števci: DEJANSKO preštejemo vrstice vsakega export/<Model>.json in
  #       jih primerjamo z manifest.rowCounts (iz export/_meta.json).
  python3 - "$WORK/vsebina" << 'PYEOF' || die "preverba baze JE SPODLETELA"
import hashlib, json, sys
base = sys.argv[1]
m = json.load(open(f"{base}/manifest.json", encoding="utf-8"))
meta = json.load(open(f"{base}/export/_meta.json", encoding="utf-8"))
def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()
checks = [("manifest ↔ export/_meta.json", m["db"].get("schemaFingerprint") == meta.get("schemaFingerprint"))]
try:
    checks.append(("sha256(db/schema.prisma) iz kopije", sha(f"{base}/db/schema.prisma") == m["db"]["schemaFingerprint"]))
except FileNotFoundError:
    print("   ✗   manjka db/schema.prisma — kopija ni popolna")
    checks.append(("sha256(db/schema.prisma) iz kopije", False))
ok = all(c[1] for c in checks)
for name, passed in checks:
    print(f"   {'OK ' if passed else '✗  '} prstni odtis — {name}")
for table, expected in sorted(m["db"]["rowCounts"].items()):
    try:
        with open(f"{base}/export/{table}.json", encoding="utf-8") as fh:
            n = len(json.load(fh))
    except FileNotFoundError:
        n = -1
    if n != expected:
        ok = False
        print(f"   ✗   {table}: {n} vrstic v exportu, manifest pravi {expected}")
print(f"   {sum(m['db']['rowCounts'].values())} vrstic v {m['db']['tableCount']} tabelah — vsi števci se ujemajo")
sys.exit(0 if ok else 1)
PYEOF

  # Informativna navzkrižna preverba proti ŽIVI bazi (če je dosegljiva):
  # export-db.mjs v temp nam da trenutni prstni odtis + števce, ki jih primerjamo
  # z manifestom. NEUSPEH TUKAJ NE POGREŠI kopije — živa baza se po zaključku
  # kopiranja zakonito spreminja (dnevnik JobRun + revizija se zapišeta ŠTEVILKO
  # PO koncu backupa, seje prijav rastejo …); gre samo za zaznavo odmika sheme.
  LIVE_DB_URL="${ROKSAL_DATABASE_URL:-${DATABASE_URL:-}}"
  if [ -n "$LIVE_DB_URL" ] && command -v bun >/dev/null 2>&1; then
    LIVE_TMP="$(mktemp -d)"
    if DATABASE_URL="$LIVE_DB_URL" timeout 120 bun "$OPS_DIR/export-db.mjs" "$LIVE_TMP" >/dev/null 2>&1; then
      # INFORMATIVNO (brez vpliva na izhodno kodo): živa baza se po zaključku
      # kopiranja zakonito spreminja — primerjamo le odmik, ne usodnost.
      python3 - "$WORK/vsebina" "$LIVE_TMP" << 'PYEOF' || log "   navzkrižna preverba žive baze ni uspela (neusodno)"
import json, sys
arch = json.load(open(f"{sys.argv[1]}/export/_meta.json", encoding="utf-8"))
live = json.load(open(f"{sys.argv[2]}/_meta.json", encoding="utf-8"))
same = arch.get("schemaFingerprint") == live.get("schemaFingerprint")
print(f"   {'OK  prstni odtis — živa baza se ujema' if same else '⚠   živa shema se je od kopije razvila (kopija je samozadostna)'}")
a, l = arch["rowCounts"], live.get("rowCounts", {})
diff = {t: l.get(t, 0) - a.get(t, 0) for t in set(a) | set(l) if l.get(t, 0) != a.get(t, 0)}
razlike = ", ".join(f"{t} {'+' if d > 0 else ''}{d}" for t, d in sorted(diff.items())) or "brez"
print(f"   živa baza: {sum(l.values())} vrstic (kopija: {sum(a.values())}; spremembe po zaključku kopiranja: {razlike})")
PYEOF
    else
      log "   živa baza ni dosegljiva — navzkrižna preverba izpuščena (kopija je samozadostna)"
    fi
    rm -rf "$LIVE_TMP"
  fi
fi

T1="$(date +%s)"
DURATION=$((T1 - T0))

if [ "$MODE" = target ]; then
  [ -n "$TARGET_DIR" ] || die "--target-dir zahteva pot"
  mkdir -p "$TARGET_DIR"
  if [ -f "$WORK/vsebina/db/custom.db" ]; then
    cp "$WORK/vsebina/db/custom.db" "$TARGET_DIR/custom.db"
    log "baza obnovljena v: $TARGET_DIR/custom.db"
  else
    # R464 (PostgreSQL): podatki + shema + manifest (brez RAW posnetka)
    mkdir -p "$TARGET_DIR/export"
    cp "$WORK/vsebina/export/"*.json "$TARGET_DIR/export/"
    cp "$WORK/vsebina/db/schema.prisma" "$TARGET_DIR/schema.prisma"
    cp "$WORK/vsebina/manifest.json" "$TARGET_DIR/manifest.json"
    log "PostgreSQL kopija razpakirana v: $TARGET_DIR (export/*.json + schema.prisma)"
    log "obnova PG: git clone iz bundle → prisma migrate deploy → uvoz export/*.json (docs/RECOVERY.md — R464)"
  fi
  if [ -d "$WORK/obnovljeni-repo" ]; then
    cp -r "$WORK/obnovljeni-repo" "$TARGET_DIR/repo"
  else
    git clone -q "$WORK/vsebina/git/git.bundle" "$TARGET_DIR/repo"
  fi
  log "izvorna koda obnovljena v: $TARGET_DIR/repo"
fi

python3 -c "
import json
print(json.dumps({
  'ok': True,
  'file': '$(basename "$FILE")',
  'gitSha': '$GIT_HEAD_SHA',
  'branches': $BRANCH_COUNT,
  'tags': $TAG_COUNT,
  'durationSec': $DURATION,
}, ensure_ascii=False))
"
log "OBNOVA/PREVERBA USPEŠNA ✓ (${DURATION}s)"
