#!/bin/bash
# tests/r437.sh — R437 (Task 11-a, GitLab issue #2): testi 10 novih API rut
# Uporaba: bash tests/r437.sh  (dev strežnik mora teči na :3000)
set -u
BASE="${BASE_URL:-http://localhost:3000}"
DB_URL="${TEST_DB_URL:-postgresql://roksal:roksal@localhost:54329/roksal}"
PASS=0; FAIL=0
CODE=""; BODY=""

t() { # t <opis> <pričakovano> <dejansko>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✓ $1 ($3)"
  else FAIL=$((FAIL+1)); echo "  ✗ $1 — pričakovano $2, dobljeno $3"; fi
}
numt() { # numt <opis> <pričakovano> <dejansko> — številsko primerjanje (±0,005)
  if awk -v a="$2" -v b="$3" 'BEGIN { exit !(a-b < 0.005 && b-a < 0.005) }'; then
    PASS=$((PASS+1)); echo "  ✓ $1 ($3)"
  else FAIL=$((FAIL+1)); echo "  ✗ $1 — pričakovano $2, dobljeno $3"; fi
}

# req <žeton> <metoda> <url> [json-telo] → nastavi CODE in BODY
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
# pub <metoda> <url> [json-telo] — javni klic brez avtentikacije
pub() {
  local m="$1" u="$2" d="${3:-}"
  local out
  if [ -n "$d" ]; then
    out=$(curl -s -w "\n%{http_code}" -X "$m" "$u" -H 'Content-Type: application/json' -d "$d")
  else
    out=$(curl -s -w "\n%{http_code}" -X "$m" "$u")
  fi
  CODE=$(echo "$out" | tail -1)
  BODY=$(echo "$out" | sed '$d')
}
noauth() { # brez žetona (401 teste)
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X "$1" "$2" ${3:+-H 'Content-Type: application/json' -d "$3"})
}

echo "════ R437 — testi novih API rut ════"

# ── 1. prijava ──────────────────────────────────────────────────────────────
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@roksal.si","password":"Admin123!"}' | jq -r '.token // empty')
MTOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"monter@roksal.si","password":"Monter123!"}' | jq -r '.token // empty')
t "prijava admin" 1 $([ -n "$TOKEN" ] && echo 1 || echo 0)
t "prijava monter" 1 $([ -n "$MTOKEN" ] && echo 1 || echo 0)

# ── 2. POST /api/notifications/read ────────────────────────────────────────
echo "── notifications/read"
# sveže globalno (userId null) neprebrano obvestilo — vidi ga vsak prijavljeni
DATABASE_URL="$DB_URL" bun -e "
const { PrismaClient } = await import('@prisma/client')
const db = new PrismaClient()
await db.notification.create({ data: { userId: null, title: 'R437 test', body: 'testno globalno obvestilo' } })
await db.\$disconnect()
" >/dev/null 2>&1
req "$TOKEN" POST "$BASE/api/notifications/read" '{}'
UPD=$(echo "$BODY" | jq -r '.updated // -1')
[ "$UPD" -ge 1 ] 2>/dev/null && t "read vse (updated ≥ 1)" "$UPD≥1" "${UPD}≥1" || t "read vse (updated ≥ 1)" "≥1" "$UPD"
req "$TOKEN" POST "$BASE/api/notifications/read" '{}'
t "ponovni read → 0 sprememb" 0 "$(echo "$BODY" | jq -r '.updated // -1')"
noauth POST "$BASE/api/notifications/read" '{}'
t "brez prijave 401" 401 "$CODE"

# ── 3. deljena meritev + javni dostop ───────────────────────────────────────
echo "── measurements share + public/measure"
req "$TOKEN" GET "$BASE/api/measurements"
MID=$(echo "$BODY" | jq -r '.data[0].id // empty')
t "seznam meritev (admin)" 1 $([ -n "$MID" ] && echo 1 || echo 0)
req "$TOKEN" POST "$BASE/api/measurements/$MID/share"
t "POST share 201" 201 "$CODE"
STOKEN=$(echo "$BODY" | jq -r '.data.token // empty')
SURL=$(echo "$BODY" | jq -r '.data.url // empty')
t "žeton ima predpono jm-" 1 $(grep -Eq '^jm-' <<<"$STOKEN" && echo 1 || echo 0)
t "url kaže na public/measure" 1 $(grep -Eq '^/api/public/measure\?token=' <<<"$SURL" && echo 1 || echo 0)
pub GET "$BASE/api/public/measure?token=$STOKEN"
t "javni GET 200" 200 "$CODE"
t "javni payload BREZ authorId" false "$(echo "$BODY" | jq -r '.data | has("authorId")')"
t "javni payload ima type/lengthCm/project/customer" true \
  "$(echo "$BODY" | jq -r '(.data.type != null) and (.data | has("lengthCm")) and (.data | has("project")) and (.data | has("customer"))')"
pub GET "$BASE/api/public/measure?token=jm-neveljaven-zeton"
t "napačen žeton 404" 404 "$CODE"
pub GET "$BASE/api/public/measure"
t "brez žetona 404" 404 "$CODE"
# monterja tuja meritev → 403 (obseg issue #1)
req "$TOKEN" GET "$BASE/api/measurements"
echo "$BODY" | jq -r '.data[].id' | sort > /tmp/r437-all-m.txt
req "$MTOKEN" GET "$BASE/api/measurements"
echo "$BODY" | jq -r '.data[].id' | sort > /tmp/r437-monter-m.txt
FOREIGNM=$(comm -23 /tmp/r437-all-m.txt /tmp/r437-monter-m.txt | head -1)
if [ -n "$FOREIGNM" ]; then
  req "$MTOKEN" POST "$BASE/api/measurements/$FOREIGNM/share"
  t "monter: tuja meritev share 403" 403 "$CODE"
fi
req "$TOKEN" DELETE "$BASE/api/measurements/$MID/share"
t "DELETE share (preklic) 200" 200 "$CODE"
pub GET "$BASE/api/public/measure?token=$STOKEN"
t "javni GET po preklicu 404" 404 "$CODE"

# ── 4. GET /api/equipment/events ───────────────────────────────────────────
echo "── equipment/events"
req "$TOKEN" GET "$BASE/api/equipment/events"
t "GET 200" 200 "$CODE"
t "seznam ima podatke (seed)" true "$(echo "$BODY" | jq -r '(.data | length) >= 1')"
t "vrstica ima equipment(code,status,category)+user" true \
  "$(echo "$BODY" | jq -r '.data[0] | has("equipment") and (.equipment | has("code")) and (.equipment | has("status")) and (.equipment | has("category")) and ((.user == null) or (.user | has("name")))')"
EQID=$(echo "$BODY" | jq -r '.data[0].equipmentId // empty')
req "$TOKEN" GET "$BASE/api/equipment/events?limit=1&equipmentId=$EQID"
t "filter equipmentId + limit=1" 1 "$(echo "$BODY" | jq -r '.data | length')"
req "$MTOKEN" GET "$BASE/api/equipment/events"
t "monter (equipment.read) 200" 200 "$CODE"
noauth GET "$BASE/api/equipment/events"
t "brez prijave 401" 401 "$CODE"

# ── 5. GET/POST /api/customers/dedup ────────────────────────────────────────
echo "── customers/dedup"
req "$TOKEN" POST "$BASE/api/customers" '{"name":"R437 Testni Dvojnik","email":"dvojnik@test.si"}'
D1=$(echo "$BODY" | jq -r '.data.id // empty')
req "$TOKEN" POST "$BASE/api/customers" '{"name":"r437 testni dvojnik  ","email":"DVOJNIK@test.si"}'
D2=$(echo "$BODY" | jq -r '.data.id // empty')
t "ustvarjena dva dvojnika (ime+email normalizirano sovpada)" 1 $([ -n "$D1" ] && [ -n "$D2" ] && echo 1 || echo 0)
# izvor dobi projekt, da je spajanje merljivo
req "$TOKEN" POST "$BASE/api/projects" "{\"title\":\"R437 dedup testni projekt\",\"customerId\":\"$D2\"}"
DPROJ=$(echo "$BODY" | jq -r '.data.id // empty')
t "testni projekt na izvorni stranki" 1 $([ -n "$DPROJ" ] && echo 1 || echo 0)
req "$TOKEN" GET "$BASE/api/customers/dedup"
t "GET dedup 200" 200 "$CODE"
GRP=$(echo "$BODY" | jq -r --arg a "$D1" --arg b "$D2" \
  '[.data[] | select((.ids | index($a) != null) and (.ids | index($b) != null))] | length')
t "skupina z obema dvojnikoma" 1 "$GRP"
req "$MTOKEN" GET "$BASE/api/customers/dedup"
t "monter (brez customers.write) 403" 403 "$CODE"
req "$TOKEN" POST "$BASE/api/customers/dedup" "{\"sourceId\":\"$D2\",\"targetId\":\"$D1\"}"
t "POST merge 200" 200 "$CODE"
t "merge ok=true" true "$(echo "$BODY" | jq -r '.ok // false')"
t "merge prestavi 1 projekt" 1 "$(echo "$BODY" | jq -r '.moved.projects // -1')"
req "$TOKEN" GET "$BASE/api/customers/$D2"
t "izvorna stranka izbrisana (404)" 404 "$CODE"
req "$TOKEN" GET "$BASE/api/customers/$D1"
t "ciljna stranka obstaja" 200 "$CODE"
req "$TOKEN" POST "$BASE/api/customers/dedup" "{\"sourceId\":\"$D1\",\"targetId\":\"$D1\"}"
t "isti id zavrnjen (400)" 400 "$CODE"

# ── 6. GET/POST /api/deal-lock ─────────────────────────────────────────────
echo "── deal-lock"
req "$TOKEN" GET "$BASE/api/deal-lock"
t "GET seznam ZAKLENJENIH 200" 200 "$CODE"
t "vse vrstice ZAKLENJEN" true "$(echo "$BODY" | jq -r '[.data[] | select(.status != "ZAKLENJEN")] | length == 0')"
t "vrstica ima projekt/stranko/podpis/_count.invoices" true \
  "$(echo "$BODY" | jq -r '.data[0] | has("project") and has("customer") and has("signedAt") and (._count | has("invoices"))')"
QINV=$(echo "$BODY" | jq -r '[.data[] | select(._count.invoices > 0)][0].id // empty')
# nov testni posel: OSNUTEK → POSLAN → SPREJET → zaklep/odklep (vsi prehodi prek deal-lock)
req "$TOKEN" POST "$BASE/api/quotes" '{"lines":[{"description":"R437 deal-lock test","qty":1,"unitPrice":100}]}'
QFREE=$(echo "$BODY" | jq -r '.data.id // empty')
QCODE=$(echo "$BODY" | jq -r '.data.code // empty')
t "testna ponudba ustvarjena ($QCODE)" 1 $([ -n "$QFREE" ] && echo 1 || echo 0)
req "$TOKEN" PATCH "$BASE/api/quotes/$QFREE" '{"status":"POSLAN"}'
t "POSLAN (quotes.create)" 200 "$CODE"
req "$TOKEN" PATCH "$BASE/api/quotes/$QFREE" '{"status":"SPREJET"}'
t "SPREJET (quotes.approve)" 200 "$CODE"
req "$TOKEN" POST "$BASE/api/deal-lock" "{\"quoteId\":\"$QFREE\",\"locked\":true}"
t "zaklep iz SPREJET → 200" 200 "$CODE"
req "$TOKEN" GET "$BASE/api/quotes/$QFREE"
t "status po zaklepu ZAKLENJEN" ZAKLENJEN "$(echo "$BODY" | jq -r '.data.status')"
req "$TOKEN" POST "$BASE/api/deal-lock" "{\"quoteId\":\"$QFREE\",\"locked\":false}"
t "odkleni → 200" 200 "$CODE"
req "$TOKEN" GET "$BASE/api/quotes/$QFREE"
t "status po odklepu SPREJET" SPREJET "$(echo "$BODY" | jq -r '.data.status')"
req "$TOKEN" POST "$BASE/api/deal-lock" "{\"quoteId\":\"$QFREE\",\"locked\":true}"
t "ponovni zaklep → 200" 200 "$CODE"
if [ -n "$QINV" ]; then
  req "$TOKEN" POST "$BASE/api/deal-lock" "{\"quoteId\":\"$QINV\",\"locked\":false}"
  t "odklep ponudbe z računi 409" 409 "$CODE"
fi
req "$TOKEN" GET "$BASE/api/quotes?status=OSNUTEK"
QOSN=$(echo "$BODY" | jq -r '.data[0].id // empty')
if [ -n "$QOSN" ]; then
  req "$TOKEN" POST "$BASE/api/deal-lock" "{\"quoteId\":\"$QOSN\",\"locked\":true}"
  t "zaklep iz OSNUTEK 409" 409 "$CODE"
fi
req "$TOKEN" POST "$BASE/api/deal-lock" '{"quoteId":"ne-obstaja","locked":true}'
t "neznana ponudba 404" 404 "$CODE"
req "$TOKEN" GET "$BASE/api/audit?action=DEAL_UNLOCK&limit=5"
t "revizija DEAL_UNLOCK zabeležena" true "$(echo "$BODY" | jq -r '(.data | length) >= 1')"
req "$TOKEN" GET "$BASE/api/audit?action=DEAL_LOCK&limit=5"
t "revizija DEAL_LOCK zabeležena" true "$(echo "$BODY" | jq -r '(.data | length) >= 1')"
req "$MTOKEN" GET "$BASE/api/deal-lock"
t "monter (brez deal.lock) 403" 403 "$CODE"

# ── 7. GET/PATCH/DELETE /api/payments/[id] ─────────────────────────────────
echo "── payments/[id]"
req "$TOKEN" GET "$BASE/api/invoices"
INVID=$(echo "$BODY" | jq -r '[.data[] | select(.status != "ZAPRT")][0].id // empty')
PAID0=$(echo "$BODY" | jq -r '[.data[] | select(.status != "ZAPRT")][0].paid')
req "$TOKEN" POST "$BASE/api/payments" "{\"invoiceId\":\"$INVID\",\"amount\":50,\"method\":\"GOTOVINA\"}"
NPID=$(echo "$BODY" | jq -r '.data.payment.id // empty')
t "testno plačilo (50 €) ustvarjeno" 1 $([ -n "$NPID" ] && echo 1 || echo 0)
req "$TOKEN" GET "$BASE/api/payments/$NPID"
t "GET plačila 200 (+invoice)" 200 "$CODE"
t "GET vsebuje invoice.code" true "$(echo "$BODY" | jq -r '.data.invoice | has("code")')"
req "$TOKEN" PATCH "$BASE/api/payments/$NPID" '{"amount":75,"method":"KARTICA","reference":"SI12 R437"}'
t "PATCH plačila 200" 200 "$CODE"
numt "invoice.paid pravilno preštet (PAID0+75)" "$(awk -v p="$PAID0" 'BEGIN { printf "%.2f", p + 75 }')" \
  "$(echo "$BODY" | jq -r '.data.invoice.paid')"
req "$TOKEN" PATCH "$BASE/api/payments/$NPID" '{"method":"BITCOIN"}'
t "PATCH napačna metoda 400" 400 "$CODE"
req "$TOKEN" PATCH "$BASE/api/payments/$NPID" '{"amount":0}'
t "PATCH znesek 0 zavrnjen" 400 "$CODE"
req "$MTOKEN" PATCH "$BASE/api/payments/$NPID" '{"amount":10}'
t "monter PATCH 403" 403 "$CODE"
req "$MTOKEN" GET "$BASE/api/payments/$NPID"
t "monter (brez payments.read) GET 403" 403 "$CODE"
req "$TOKEN" DELETE "$BASE/api/payments/$NPID"
t "DELETE plačila 200" 200 "$CODE"
numt "recalc po brisanju → nazaj na $PAID0" "$PAID0" "$(echo "$BODY" | jq -r '.data.recalc.paid')"
req "$TOKEN" DELETE "$BASE/api/payments/$NPID"
t "ponovni DELETE 404" 404 "$CODE"

# ── 8. POST /api/payments/reconciliation ───────────────────────────────────
echo "── payments/reconciliation"
req "$TOKEN" POST "$BASE/api/payments/reconciliation"
t "poročilo 200" 200 "$CODE"
t "povzetek (total/paid/odprto/št. statusov)" true \
  "$(echo "$BODY" | jq -r '.data.summary | has("total") and has("paid") and has("open") and has("placani") and has("delnoPlacani") and has("neplacani")')"
t "vrstica ima vsa polja (code/paid/sumPayments/diff/paymentsCount/lastPaymentAt)" true \
  "$(echo "$BODY" | jq -r '.data.rows[0] | has("code") and has("paid") and has("sumPayments") and has("diff") and has("paymentsCount") and has("lastPaymentAt")')"
t "seznama preplačil/odstopanj prisotna" true \
  "$(echo "$BODY" | jq -r '.data | has("preplacila") and has("odstopanja")')"
req "$TOKEN" POST "$BASE/api/payments/reconciliation?fix=1"
t "fix=1 (admin, payments.manage) 200" 200 "$CODE"
t "fix poroča št. popravljenih" true "$(echo "$BODY" | jq -r '.data | has("fixed")')"
req "$MTOKEN" POST "$BASE/api/payments/reconciliation"
t "monter (brez payments.read) 403" 403 "$CODE"

# ── 9. GET /api/projects/[id]/command ──────────────────────────────────────
echo "── projects/[id]/command"
req "$TOKEN" GET "$BASE/api/projects"
PID=$(echo "$BODY" | jq -r '[.data[] | select((._count.workOrders // 0) > 0)][0].id // .data[0].id')
req "$TOKEN" GET "$BASE/api/projects/$PID/command"
t "ukaz 200 (admin)" 200 "$CODE"
t "payload: project(+customer)/measurements/workOrders/quotes/production/timeline" true \
  "$(echo "$BODY" | jq -r '.data | has("project") and (.project | has("customer")) and has("measurements") and has("workOrders") and has("quotes") and has("production") and has("timeline")')"
t "skupna dolžina je število" true "$(echo "$BODY" | jq -r '.data.skupnaDolzinaCm | type == "number"')"
t "timeline ima ključne datume" true \
  "$(echo "$BODY" | jq -r '.data.timeline | has("prvaMeritev") and has("podpisPonudbe") and has("zadnjiDogodekNaloga")')"
req "$MTOKEN" GET "$BASE/api/projects"
MPID=$(echo "$BODY" | jq -r '.data[0].id // empty')
echo "$BODY" | jq -r '.data[].id' | sort > /tmp/r437-monter-p.txt
req "$TOKEN" GET "$BASE/api/projects"
echo "$BODY" | jq -r '.data[].id' | sort > /tmp/r437-all-p.txt
if [ -n "$MPID" ]; then
  req "$MTOKEN" GET "$BASE/api/projects/$MPID/command"
  t "monter: svoj projekt 200" 200 "$CODE"
fi
FOREIGNP=$(comm -23 /tmp/r437-all-p.txt /tmp/r437-monter-p.txt | head -1)
if [ -n "$FOREIGNP" ]; then
  req "$MTOKEN" GET "$BASE/api/projects/$FOREIGNP/command"
  t "monter: projekt brez svojega naloga 403" 403 "$CODE"
fi
noauth GET "$BASE/api/projects/$PID/command"
t "brez prijave 401" 401 "$CODE"

# ── 10. POST /api/jobs/run + /api/security/rate-limit ──────────────────────
echo "── jobs/run + security/rate-limit"
req "$TOKEN" POST "$BASE/api/jobs/run" '{"key":"seje-gc"}'
t "jobs/run seje-gc 200" 200 "$CODE"
req "$TOKEN" POST "$BASE/api/jobs/run" '{"key":"neznano-opravilo"}'
t "jobs/run neznano 400" 400 "$CODE"
req "$TOKEN" POST "$BASE/api/jobs" '{"job":"obvestila-gc"}'
t "stara ruta POST /api/jobs še deluje" 200 "$CODE"
req "$MTOKEN" POST "$BASE/api/jobs/run" '{"key":"seje-gc"}'
t "monter jobs/run 403" 403 "$CODE"
# javni klic z neveljavnim žetonom vseeno zabeleži bucket (tempomat teče pred DB)
pub GET "$BASE/api/public/measure?token=testtoken123"
req "$TOKEN" POST "$BASE/api/security/rate-limit" '{"action":"list"}'
t "rate-limit list 200" 200 "$CODE"
t "bucket prisoten (≥1)" true "$(echo "$BODY" | jq -r '.data.total >= 1')"
MASK=$(echo "$BODY" | jq -r '[.data.items[] | select(.bucket | startswith("measure:test"))][0].bucket // empty')
t "ključ prikrit (measure:testto…)" 1 $(grep -Eq 'measure:testto' <<<"$MASK" && echo 1 || echo 0)
t "prikrit ključ ne razkrije žetona" 1 $(grep -Eq 'testtoken123' <<<"$MASK" && echo 0 || echo 1)
req "$TOKEN" POST "$BASE/api/security/rate-limit" "{\"action\":\"clear\",\"bucket\":\"$MASK\"}"
t "clear specifičen bucket ≥1" true "$(echo "$BODY" | jq -r '.data.cleared >= 1')"
req "$TOKEN" POST "$BASE/api/security/rate-limit" '{"action":"clear"}'
t "clear vse 200" 200 "$CODE"
req "$TOKEN" POST "$BASE/api/security/rate-limit" '{"action":"reset"}'
t "neznana akcija 400" 400 "$CODE"
req "$MTOKEN" POST "$BASE/api/security/rate-limit" '{"action":"list"}'
t "monter rate-limit 403" 403 "$CODE"

# ── čiščenje testnih artefaktov ────────────────────────────────────────────
DATABASE_URL="$DB_URL" bun -e "
const { PrismaClient } = await import('@prisma/client')
const db = new PrismaClient()
const testLines = await db.quoteLine.findMany({ where: { description: 'R437 deal-lock test' }, select: { quoteId: true } })
const ids = [...new Set(testLines.map((l) => l.quoteId))]
if (ids.length) await db.quote.deleteMany({ where: { id: { in: ids } } }) // vrstice kaskadirajo
await db.project.deleteMany({ where: { title: 'R437 dedup testni projekt' } })
await db.customer.deleteMany({ where: { name: 'R437 Testni Dvojnik' } })
await db.notification.deleteMany({ where: { title: 'R437 test' } })
await db.\$disconnect()
" >/dev/null 2>&1

# ── dopolnitev: R437 druge rute (material-prices/orders, punch, engineering-rules, surveys) ──
echo "── material-prices"
req "$TOKEN" GET "$BASE/api/material-prices" ''
t "GET seznam 200" 200 "$CODE"
MP_ITEM=$(echo "$BODY" | jq -r '.data[0].itemId // empty')
req "$TOKEN" POST "$BASE/api/material-prices" "{\"itemId\":\"$MP_ITEM\",\"price\":61.5}"
t "POST nova cena 201" 201 "$CODE"
req "$MTOKEN" POST "$BASE/api/material-prices" "{\"itemId\":\"$MP_ITEM\",\"price\":10}"
t "monter (brez price.override) 403" 403 "$CODE"

echo "── material-orders"
req "$TOKEN" GET "$BASE/api/material-orders" ''
t "GET seznam 200 (seed 2)" 200 "$CODE"
MO_SUP=$(echo "$BODY" | jq -r '.data[0].supplierId // empty')
req "$TOKEN" POST "$BASE/api/material-orders" "{\"supplierId\":\"$MO_SUP\",\"lines\":[{\"itemName\":\"Testni profil\",\"qty\":5,\"unit\":\"m\",\"unitPrice\":50}]}"
t "POST novo naročilo 201" 201 "$CODE"
MO_ID=$(echo "$BODY" | jq -r '.data.id')
req "$TOKEN" POST "$BASE/api/material-orders" "{\"id\":\"$MO_ID\",\"status\":\"POSLANO\"}"
t "status POSLANO 200" 200 "$CODE"
req "$MTOKEN" POST "$BASE/api/material-orders" "{\"id\":\"$MO_ID\",\"status\":\"PREJETO\"}"
t "monter PREJETO 403" 403 "$CODE"
req "$TOKEN" POST "$BASE/api/material-orders" "{\"id\":\"$MO_ID\",\"status\":\"PREJETO\"}"
t "PREJETO 200" 200 "$CODE"
req "$TOKEN" POST "$BASE/api/material-orders" "{\"id\":\"$MO_ID\",\"status\":\"PREJETO\"}"
t "ponovni PREJETO (končni status) 409" 409 "$CODE"
req "$MTOKEN" POST "$BASE/api/material-orders" '{"lines":[{"itemName":"x","qty":1,"unitPrice":1}]}'
t "monter POST naročilo (brez inventory.write) 403" 403 "$CODE"
req "$MTOKEN" GET "$BASE/api/material-orders" ''
t "monter GET (ima inventory.read) 200" 200 "$CODE"

echo "── punch (prisotnost)"
PUNCH_DAY=$(date -d "-$((RANDOM % 300 + 5)) days" +%Y-%m-%d)
req "$TOKEN" POST "$BASE/api/punch" "{\"action\":\"in\",\"day\":\"$PUNCH_DAY\",\"note\":\"testni dan\"}"
t "prijava 201" 201 "$CODE"
req "$TOKEN" POST "$BASE/api/punch" "{\"action\":\"in\",\"day\":\"$PUNCH_DAY\"}"
t "ponovna prijava 409" 409 "$CODE"
req "$TOKEN" POST "$BASE/api/punch" "{\"action\":\"out\",\"day\":\"$PUNCH_DAY\"}"
t "odjava 200" 200 "$CODE"
req "$TOKEN" GET "$BASE/api/punch?day=$PUNCH_DAY" ''
t "vnos za testni dan prisoten" 1 "$(echo "$BODY" | jq '.data | length')"
req "$TOKEN" GET "$BASE/api/punch" ''
t "GET lastni vnosi 200" 200 "$CODE"
req "$TOKEN" GET "$BASE/api/punch?all=1" ''
t "GET all=1 (users.read) 200" 200 "$CODE"
req "$MTOKEN" GET "$BASE/api/punch?all=1" ''
t "monter all=1 403" 403 "$CODE"

echo "── engineering-rules"
req "$TOKEN" GET "$BASE/api/engineering-rules?all=1" ''
OLD_RULE_ID=$(echo "$BODY" | jq -r '.data[] | select(.key=="test_pravilo") | .id // empty')
if [ -n "$OLD_RULE_ID" ]; then
  req "$TOKEN" PATCH "$BASE/api/engineering-rules/$OLD_RULE_ID" '{"active":false}'
fi
req "$TOKEN" GET "$BASE/api/engineering-rules" ''
t "GET aktivna pravila 200" 200 "$CODE"
RULES_N=$(echo "$BODY" | jq '.data | length')
t "vsaj 6 pravil (seed)" 1 "$([ "$RULES_N" -ge 6 ] && echo 1 || echo 0)"
t "ključno pravilo max_razdalja_stebrov=120" 120 "$(echo "$BODY" | jq '.data[] | select(.key=="max_razdalja_stebrov") | .value')"
req "$TOKEN" POST "$BASE/api/engineering-rules" '{"key":"test_pravilo","label":"Testno pravilo","value":42}'
t "POST upsert 201" 201 "$CODE"
RULE_ID=$(echo "$BODY" | jq -r '.data.id')
req "$TOKEN" PATCH "$BASE/api/engineering-rules/$RULE_ID" '{"value":43}'
t "PATCH vrednost 200" 200 "$CODE"
req "$TOKEN" DELETE "$BASE/api/engineering-rules/$RULE_ID"
t "DELETE (deaktivacija) 200" 200 "$CODE"
req "$MTOKEN" POST "$BASE/api/engineering-rules" '{"key":"x","label":"x","value":1}'
t "monter 403" 403 "$CODE"

echo "── surveys (ankete)"
req "$TOKEN" GET "$BASE/api/surveys" ''
t "GET seznam 200" 200 "$CODE"
req "$TOKEN" POST "$BASE/api/surveys" '{"name":"Testni Uporabnik","email":"t@t.si","type":"TERASA","lengthCm":500}'
t "POST nova anketa 201" 201 "$CODE"
SURVEY_ID=$(echo "$BODY" | jq -r '.data.id')
req "$TOKEN" POST "$BASE/api/surveys" "{\"id\":\"$SURVEY_ID\",\"handled\":true}"
t "obdelava 200" 200 "$CODE"
req "$MTOKEN" GET "$BASE/api/surveys" ''
t "monter GET (ima crm.read) 200" 200 "$CODE"
req "$MTOKEN" POST "$BASE/api/surveys" '{"name":"Mojca Test"}'
t "monter POST anketo (brez crm.write) 403" 403 "$CODE"

echo
echo "══════════════════════════════════════════"
echo "REZULTAT: $PASS ✓ / $FAIL ✗"
[ "$FAIL" -eq 0 ] && echo "VSI TESTI USPEŠNI" || echo "NEUSPEŠNI TESTI!"
# exit koda = uspešnost (CI mora padati ob neuspešnih asercijah)
[ "$FAIL" -eq 0 ]
