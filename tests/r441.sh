#!/bin/bash
# tests/r441.sh — R441 (GitLab issue #3): DISASTER RECOVERY & SECURITY
# Preverja: /api/health, skrivnostni pregled, backup job (API + dnevnik),
# obnovo v izolacijo (kontrolne vsote + git fsck + števci), GitLab zaščito
# (main brez direktnega push, MR pogoj, off-site paket), CI pipeline, RBAC.
# Uporaba: bash tests/r441.sh  (dev strežnik mora teči na :3000)
set -u
BASE="${BASE_URL:-http://localhost:3000}"
ROOT="/home/z/my-project"
DB_URL="file:$ROOT/db/custom.db"
GTOKEN="$(sed -n 's/^GITLAB_TOKEN=//p' $ROOT/.env.recovery 2>/dev/null | tail -n1)"
PASS=0; FAIL=0
CODE=""; BODY=""

t() { # t <opis> <pričakovano> <dejansko>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✓ $1 ($3)"
  else FAIL=$((FAIL+1)); echo "  ✗ $1 — pričakovano $2, dobljeno $3"; fi
}
gett() { # gett <opis> <min> <dejansko>
  if [ "$3" -ge "$2" ] 2>/dev/null; then PASS=$((PASS+1)); echo "  ✓ $1 ($3)"
  else FAIL=$((FAIL+1)); echo "  ✗ $1 — pričakovano ≥ $2, dobljeno $3"; fi
}
contains() {
  if echo "$2" | rg -q "$3"; then PASS=$((PASS+1)); echo "  ✓ $1"
  else FAIL=$((FAIL+1)); echo "  ✗ $1 — vzorca '$3' ni v odgovoru"; fi
}
notcontains() {
  if echo "$2" | rg -q "$3"; then FAIL=$((FAIL+1)); echo "  ✗ $1 — vzorec '$3' NE sme biti, pa je"
  else PASS=$((PASS+1)); echo "  ✓ $1"; fi
}
req() {
  local tok="$1" m="$2" u="$3" d="${4:-}"
  local out
  if [ -n "$d" ]; then
    out=$(curl -s -w "\n%{http_code}" -X "$m" "$u" -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d "$d")
  else
    out=$(curl -s -w "\n%{http_code}" -X "$m" "$u" -H "Authorization: Bearer $tok")
  fi
  CODE=$(echo "$out" | tail -1)
  BODY=$(echo "$out" | sed '$d')
}
uuid() { cat /proc/sys/kernel/random/uuid; }

echo "════ R441 — testi disaster recovery & security (issue #3) ════"

# ── 0. prijava ──────────────────────────────────────────────────────────────
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@roksal.si","password":"Admin123!"}' | jq -r '.token // empty')
MTOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"monter@roksal.si","password":"Monter123!"}' | jq -r '.token // empty')
t "prijava admin" 1 $([ -n "$TOKEN" ] && echo 1 || echo 0)
t "prijava monter" 1 $([ -n "$MTOKEN" ] && echo 1 || echo 0)

# ── 1. /api/health (javni deploy-check) ────────────────────────────────────
echo "── 1. /api/health"
req "" GET "$BASE/api/health"
t "health 200 brez prijave" 200 "$CODE"
contains "health status ok" "$BODY" '"status":"ok"'
contains "health db ok" "$BODY" '"ok":true'
contains "health verzija" "$BODY" '"version"'
notcontains "health brez občutljivih podatkov (token)" "$BODY" 'glpat-'
req "" GET "$BASE/api/public/health"
t "route-mapa /api/public/health ostaja (200)" 200 "$CODE"

# ── 2. skrivnostni pregled ──────────────────────────────────────────────────
echo "── 2. ops/secret-audit.sh"
AUDIT_OUT=$(bash $ROOT/ops/secret-audit.sh 2>&1); AUDIT_RC=$?
t "skrivnostni pregled čist (izhod 0)" 0 "$AUDIT_RC"
contains "higiena .gitignore" "$AUDIT_OUT" 'prezrto'
contains "zgodovina prebrana" "$AUDIT_OUT" 'zgodovini'
# negativni test: lažni žeton v SLEDOVANI datoteki MORA biti zaznan
# (sestavimo ga ob izvajanju — literal v tej datoteki ne sme ustrezati vzorcu,
#  sicer bi audit prijavil lastne teste!)
FAKE_TOKEN="glpat-""FAKETOKEN""1234567890""12345678"
echo "$FAKE_TOKEN" > $ROOT/src/__r441_fake.ts
git -C $ROOT add src/__r441_fake.ts 2>/dev/null
AUDIT_NEG=$(bash $ROOT/ops/secret-audit.sh --tree-only 2>&1); AUDIT_NEG_RC=$?
t "lažni žeton zaznan (izhod 1)" 1 "$AUDIT_NEG_RC"
contains "lažni žeton poročan" "$AUDIT_NEG" 'NAJDENA SKRIVNOST'
git -C $ROOT rm --cached -q src/__r441_fake.ts 2>/dev/null; rm -f $ROOT/src/__r441_fake.ts
AUDIT_RE=$(bash $ROOT/ops/secret-audit.sh --tree-only 2>&1); AUDIT_RE_RC=$?
t "pregled spet čist po odstranitvi" 0 "$AUDIT_RE_RC"
# .env.recovery in baza NISTA v gitu
t ".env.recovery prezrt" 1 "$(git -C $ROOT check-ignore -q .env.recovery && echo 1 || echo 0)"
t "db/custom.db prezrt" 1 "$(git -C $ROOT check-ignore -q db/custom.db && echo 1 || echo 0)"

# ── 3. RBAC na job varnostna-kopija ─────────────────────────────────────────
echo "── 3. RBAC job-a"
req "$MTOKEN" POST "$BASE/api/jobs" '{"job":"varnostna-kopija"}'
t "monter NE sme pognati backup job (403)" 403 "$CODE"
req "" POST "$BASE/api/jobs" '{"job":"varnostna-kopija"}'
t "brez prijave 401" 401 "$CODE"
req "$TOKEN" POST "$BASE/api/jobs" '{"job":"neznany-job"}'
t "neznano opravilo 400" 400 "$CODE"

# ── 4. backup job prek API-ja (polna kopija + off-site) ─────────────────────
echo "── 4. job varnostna-kopija (izvedba)"
req "$TOKEN" POST "$BASE/api/jobs" '{"job":"varnostna-kopija"}'
t "admin zagon job 200" 200 "$CODE"
contains "job poroča trajanje" "$BODY" 'durationMs'
# dnevnik + revizija (baza)
RUN_OK=$(python3 -c "
import sqlite3
c = sqlite3.connect('$ROOT/db/custom.db')
r = c.execute(\"SELECT ok, detail FROM JobRun WHERE job='varnostna-kopija' ORDER BY startedAt DESC LIMIT 1\").fetchone()
print(1 if r and r[0] else 0)")
t "JobRun dnevnik ok" 1 "$RUN_OK"
DETAIL=$(python3 -c "
import sqlite3, json
c = sqlite3.connect('$ROOT/db/custom.db')
r = c.execute(\"SELECT detail FROM JobRun WHERE job='varnostna-kopija' ORDER BY startedAt DESC LIMIT 1\").fetchone()
print(r[0] if r else '{}')")
contains "detail: šifrirano" "$DETAIL" '"sifrirano":true'
contains "detail: off-site" "$DETAIL" '"off_site":true'
notcontains "detail BREZ celotnega sha256" "$DETAIL" '"sha256":"[a-f0-9]{64}"'
AUD_BACKUP=$(python3 -c "
import sqlite3
c = sqlite3.connect('$ROOT/db/custom.db')
n = c.execute(\"SELECT COUNT(*) FROM AuditLog WHERE action='MAINTENANCE_RUN' AND detail LIKE '%varnostna-kopija%'\").fetchone()[0]
print(1 if n > 0 else 0)")
t "revizija MAINTENANCE_RUN zapisana" 1 "$AUD_BACKUP"
# local .rkb obstaja in je šifriran (glava Salted__)
LAST_RKB=$(find $ROOT/db/backups -maxdepth 1 -name 'roksal-backup-*.rkb' -printf '%T@ %p\n' | sort -rn | head -n1 | cut -d' ' -f2-)
t "lokalna .rkb kopija obstaja" 1 $([ -n "$LAST_RKB" ] && echo 1 || echo 0)
contains "kopija šifrirana (openssl glava)" "$(head -c 8 "$LAST_RKB" | od -c | head -1)" 'S   a   l   t   e   d'
t "last-backup.json obstaja" 1 $([ -f "$ROOT/db/backups/last-backup.json" ] && echo 1 || echo 0)
contains "status: off-site naloženo" "$(cat $ROOT/db/backups/last-backup.json)" '"uploaded": *true'

# ── 5. obnova v izolacijo (restore --verify nad zadnjo LOKALNO kopijo) ──────
echo "── 5. restore --verify"
VERIFY_OUT=$(bash $ROOT/ops/restore.sh --verify --file "$LAST_RKB" 2>&1); VERIFY_RC=$?
t "preverba obnove uspešna (izhod 0)" 0 "$VERIFY_RC"
contains "kontrolne vsote ujemajo" "$VERIFY_OUT" 'OK  git.bundle'
contains "prstni odtis sheme ustreza" "$VERIFY_OUT" 'OK  prstni odtis'
contains "števci vrstic ujemajo" "$VERIFY_OUT" 'vrstic v'
contains "git fsck brez napak (implicitno — uspeh)" "$VERIFY_OUT" 'OBNOVA/PREVERBA USPEŠNA'
# napačno geslo MORA pasti
VERIFY_BAD_RC=$(ROKSAL_BACKUP_PASSPHRASE="napacno-geslo" bash $ROOT/ops/restore.sh --verify --file "$LAST_RKB" >/dev/null 2>&1; echo $?)
t "napačno geslo → zavrnjeno (izhod 1)" 1 "$VERIFY_BAD_RC"

# ── 6. off-site kopija na GitLabu ───────────────────────────────────────────
echo "── 6. off-site (GitLab packages)"
GAPI="https://gitlab.com/api/v4/projects/87314539"
# Cloudflare občasno blokira privzeti curl UA („Blocked“ HTML) — brskalniški UA
# je zanesljiv (spoznanje R448, velja za VSE prihodnje GitLab API klice)
UA="Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0"
for i in 1 2 3 4 5; do PKGS=$(curl -s -A "$UA" --max-time 30 "$GAPI/packages?package_name=roksal-backup&per_page=100" -H "PRIVATE-TOKEN: $GTOKEN"); [ -n "$PKGS" ] && ! echo "$PKGS" | head -c 30 | grep -q '^<' && break; sleep 5; done
PKGC=$(echo "$PKGS" | jq 'length')
gett "off-site kopije obstajajo (≥1 verzija)" 1 "$PKGC"
contains "zadnja verzija ima datoteke" "$(echo "$PKGS" | jq -r '.[0].version')" '20[0-9]+-[0-9]+-'
for i in 1 2 3 4 5; do OFFSITE_FILES=$(curl -s -A "$UA" --max-time 30 "$GAPI/packages/$(echo "$PKGS" | jq -r '.[0].id')/package_files" -H "PRIVATE-TOKEN: $GTOKEN"); [ -n "$OFFSITE_FILES" ] && ! echo "$OFFSITE_FILES" | head -c 30 | grep -q '^<' && break; sleep 5; done
gett "kosov + manifest off-site (≥2)" 2 "$(echo "$OFFSITE_FILES" | jq 'length')"
contains "manifest med datotekami" "$(echo "$OFFSITE_FILES" | jq -r '.[].file_name' | tr '\n' ' ')" 'manifest.json'

# ── 7. GitLab zaščita main + MR pogoji ─────────────────────────────────────
echo "── 7. zaščita repozitorija"
for i in 1 2 3 4 5; do PROT=$(curl -s -A "$UA" --max-time 30 "$GAPI/protected_branches/main" -H "PRIVATE-TOKEN: $GTOKEN"); [ -n "$PROT" ] && ! echo "$PROT" | head -c 30 | grep -q '^<' && break; sleep 5; done
t "main zaščitena (id obstaja)" 1 "$(echo "$PROT" | jq -r '.id // empty' | wc -w | tr -d ' ')"
t "direktni push: NOBODY" 0 "$(echo "$PROT" | jq -r '.push_access_levels[0].access_level')"
t "force push prepovedan" false "$(echo "$PROT" | jq -r '.allow_force_push')"
for i in 1 2 3 4 5; do PROJ=$(curl -s -A "$UA" --max-time 30 "$GAPI" -H "PRIVATE-TOKEN: $GTOKEN"); [ -n "$PROJ" ] && ! echo "$PROJ" | head -c 30 | grep -q '^<' && break; sleep 5; done
t "merge zahteva zelen CI" true "$(echo "$PROJ" | jq -r '.only_allow_merge_if_pipeline_succeeds')"
# prazen poskusni commit (lokalni main je lahko sinhron — treba je nekaj pushati)
git -C $ROOT commit --allow-empty -q -m "r441-test: preverba zaščite main (ne bo pushan)"
# push poskusi do 5×: prehodni Cloudflare 403 NI odgovor strežnika; končamo,
# ko strežnik dejansko odgovori (zavrnitev pre-receive ali uspeh)
PUSH_TEST=""
for i in 1 2 3 4 5; do
  PUSH_TEST=$(git -C $ROOT push origin main 2>&1 || true)
  if echo "$PUSH_TEST" | grep -qE 'pre-receive hook declined|Everything up-to-date|new file|To https'; then break; fi
  sleep $((i * 3))
done
contains "direktni push na main ZAVRNJEN" "$PUSH_TEST" 'pre-receive hook declined'
git -C $ROOT reset -q --soft HEAD~1 # povrni (delovne spremembe ostanejo)

# ── 8. CI pipeline ──────────────────────────────────────────────────────────
echo "── 8. CI"
t ".gitlab-ci.yml sleden" 1 "$(git -C $ROOT ls-files --error-unmatch .gitlab-ci.yml >/dev/null 2>&1 && echo 1 || echo 0)"
t ".github ODSTRANJEN iz repa" 0 "$(git -C $ROOT ls-files | grep -c '^\.github/' || true)"
for i in 1 2 3 4 5; do PIPES=$(curl -s -A "$UA" --max-time 30 "$GAPI/pipelines?per_page=10" -H "PRIVATE-TOKEN: $GTOKEN"); [ -n "$PIPES" ] && ! echo "$PIPES" | head -c 30 | grep -q '^<' && break; sleep 5; done
gett "pipelines obstajajo" 1 "$(echo "$PIPES" | jq 'length')"

# ── 9. MR obstaja (r441-dr → main) ──────────────────────────────────────────
echo "── 9. MR"
# filter po source_branch (ne per_page=10 — seznam MR-jev raste z fazami,
# r441-dr pada iz prvih 10)
for i in 1 2 3 4 5; do MRS=$(curl -s -A "$UA" --max-time 30 "$GAPI/merge_requests?source_branch=r441-dr&per_page=20" -H "PRIVATE-TOKEN: $GTOKEN"); [ -n "$MRS" ] && ! echo "$MRS" | head -c 30 | grep -q '^<' && break; sleep 5; done
contains "MR !1 obstaja (r441-dr → main)" "$(echo "$MRS" | jq -r '.[] | select(.source_branch=="r441-dr") | .title')" 'R441'

# ── 10. UI: API odgovor vsebuje novi job ────────────────────────────────────
echo "── 10. UI vir"
req "$TOKEN" GET "$BASE/api/jobs"
contains "definitions vsebujejo varnostna-kopija" "$BODY" 'varnostna-kopija'
contains "zadnji zagon prikazan (last polje)" "$BODY" '"last":'

# ── 11. drill poročilo (če je bil drill izveden) ────────────────────────────
echo "── 11. drill"
DRILL_REPORTS=$(ls $ROOT/docs/RECOVERY-DRILL-*.md 2>/dev/null | wc -l)
gett "recovery drill poročila obstajajo" 1 "$DRILL_REPORTS"

# ── 12. regresija (osnovne rute) ────────────────────────────────────────────
echo "── 12. regresija"
req "$TOKEN" GET "$BASE/api/projects"
t "projekti 200" 200 "$CODE"
req "$TOKEN" GET "$BASE/api/nalog"
t "nalogi 200" 200 "$CODE"
req "$TOKEN" GET "$BASE/api/notifications"
t "obvestila 200" 200 "$CODE"
req "$TOKEN" GET "$BASE/api/audit"
t "revizije 200" 200 "$CODE"
req "$TOKEN" GET "$BASE/api/jobs"
t "jobs 200" 200 "$CODE"

echo
echo "════ REZULTAT: ✓ $PASS / ✗ $FAIL ════"
[ "$FAIL" -eq 0 ]
