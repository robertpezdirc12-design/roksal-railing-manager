#!/usr/bin/env bash
# ops/restore.sh — obnova/preverba varnostne kopije (R441 / issue #3).
#
# Načini:
#   ops/restore.sh --list-remote
#       Seznam off-site kopij na GitLabu (generic package registry).
#
#   ops/restore.sh --verify [--file KOPIJA.rkb | --remote [VERZIJA]]
#       OBNOVA V IZOLACIJO + preverba (brez dotika delujoče aplikacije):
#         1. dešifriranje (zahteva ROKSAL_BACKUP_PASSPHRASE)
#         2. kontrolne vsote SHA-256 iz manifest.json
#         3. git clone iz git.bundle → fsck + ujemanje HEAD SHA
#         4. baza: prstni odtis sheme + števci vrstic proti manifestu
#       Izhod: JSON { ok, checks: [...], durationSec } + izhodna koda 0/1.
#
#   ops/restore.sh --target-dir DIR [--file KOPIJA.rkb]
#       DEJANSKA obnova v podano mapo (baza + izvorna koda iz bundle).
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
      curl -s --max-time 90 -H "PRIVATE-TOKEN: $t" "$GITLAB_API$path" "$@" || true
      # uspeh: datoteka neprazna IN ni Cloudflare HTML blok strani
      if [ -s "$target" ] && ! head -c 64 "$target" | grep -q '^<'; then return 0; fi
    else
      out="$(curl -s --max-time 60 -H "PRIVATE-TOKEN: $t" "$GITLAB_API$path" "$@" || true)"
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
import hashlib, json, sys
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
    ("db/custom.db", sha(f"{base}/db/custom.db") == m["db"]["sha256"]),
]
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
print(f"   {'OK ' if ok else '✗  '} prstni odtis sheme")
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

T1="$(date +%s)"
DURATION=$((T1 - T0))

if [ "$MODE" = target ]; then
  [ -n "$TARGET_DIR" ] || die "--target-dir zahteva pot"
  mkdir -p "$TARGET_DIR"
  cp "$WORK/vsebina/db/custom.db" "$TARGET_DIR/custom.db"
  log "baza obnovljena v: $TARGET_DIR/custom.db"
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
