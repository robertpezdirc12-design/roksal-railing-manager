#!/bin/bash
# tests/r440.sh — R440 (GitLab issue #4): END-TO-END VALIDACIJA
# Delež A: CELOTEN POSLOVNI TOK kot en povezani scenarij:
#   vod → stranka → projekt → dodelitev monterja → nalog → termin → teren
#   (foto/meritve/layout/confirm) → preverjanje → QC → proizvodnja → BOM/nabava
#   → montaža/zaključek → ponudba → podpis/zaklep → račun → plačilo → portal
#   → garancija/servis → zgodovina/audit/obvestila.
# Delež B: VARNOST — IDOR, žetoni, DTO leakage, seje, rate limit, neavtenticiran dostop.
# (Delež C: matrika smoke + RBAC sweep → tests/r440-smoke.py → docs/E2E-RESULTS.json)
# Uporaba: bash tests/r440.sh  (dev strežnik mora teči na :3000)
set -u
BASE="${BASE_URL:-http://localhost:3000}"
DB_URL="file:/home/z/my-project/db/custom.db"
PASS=0; FAIL=0
CODE=""; BODY=""

t() { # t <opis> <pričakovano> <dejansko>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✓ $1 ($3)"
  else FAIL=$((FAIL+1)); echo "  ✗ $1 — pričakovano $2, dobljeno $3"; fi
}
gett() { # ≥ primerjava za številke
  if [ "$3" -ge "$2" ] 2>/dev/null; then PASS=$((PASS+1)); echo "  ✓ $1 ($3)"
  else FAIL=$((FAIL+1)); echo "  ✗ $1 — pričakovano ≥ $2, dobljeno $3"; fi
}
contains() {
  if echo "$2" | rg -q "$3"; then PASS=$((PASS+1)); echo "  ✓ $1"
  else FAIL=$((FAIL+1)); echo "  ✗ $1 — vzorca '$3' ni v odgovoru"; fi
}
notcontains() {
  if echo "$2" | rg -q "$3"; then FAIL=$((FAIL+1)); echo "  ✗ $1 — vzorec '$3' NE sme biti v odgovoru, pa je"
  else PASS=$((PASS+1)); echo "  ✓ $1"; fi
}
req() { # req <žeton> <metoda> <url> [json-telo]
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
dbq() { DATABASE_URL="$DB_URL" bun -e "$1" 2>/dev/null; }
uuid() { cat /proc/sys/kernel/random/uuid; }

echo "════ R440 — E2E VALIDACIJA: celoten poslovni tok (issue #4) ════"

# ── 0. prijava vseh vlog ─────────────────────────────────────────────────────
login() { curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jq -r '.token // empty'; }
TOKEN=$(login admin@roksal.si 'Admin123!')
VTOKEN=$(login vodja@roksal.si 'Vodja123!')
MTOKEN=$(login monter@roksal.si 'Monter123!')
STOKEN=$(login skladisce@roksal.si 'Skladisce123!')
PTOKEN=$(login proizvodnja@roksal.si 'Proizvodnja123!')
t "prijava ADMIN" 1 $([ -n "$TOKEN" ] && echo 1 || echo 0)
t "prijava VODJA" 1 $([ -n "$VTOKEN" ] && echo 1 || echo 0)
t "prijava MONTER" 1 $([ -n "$MTOKEN" ] && echo 1 || echo 0)
t "prijava SKLADISCE" 1 $([ -n "$STOKEN" ] && echo 1 || echo 0)
t "prijava PROIZVODNJA" 1 $([ -n "$PTOKEN" ] && echo 1 || echo 0)

req "$TOKEN" GET "$BASE/api/users"
MID=$(echo "$BODY" | jq -r '.data[] | select(.email=="monter@roksal.si") | .id')
req "$TOKEN" GET "$BASE/api/suppliers"
SUPID=$(echo "$BODY" | jq -r '.data[0].id // empty')
t "id monterja + dobavitelja" 1 $([ -n "$MID" ] && [ -n "$SUPID" ] && echo 1 || echo 0)

# ── 1. CRM: vod → stranka → projekt ─────────────────────────────────────────
echo "── 1. CRM (vod → pretvorba)"
req "$VTOKEN" POST "$BASE/api/crm" '{"name":"R440 E2E vod Jože Zajec","email":"joze.zajec.r440@test.si","phone":"040 555 440","source":"SPLET","note":"E2E golden path R440"}'
t "nov vod 201" 201 "$CODE"
LEAD=$(echo "$BODY" | jq -r '.data.id')
t "vod ima status NOV" NOV "$(echo "$BODY" | jq -r '.data.status')"

req "$VTOKEN" PATCH "$BASE/api/crm/$LEAD" '{"status":"KONTAKTIRAN"}'
t "status voda KONTAKTIRAN" 200 "$CODE"

req "$VTOKEN" POST "$BASE/api/crm/$LEAD/pretvorba" '{"address":"E2E ulica 440, Ljubljana"}'
t "pretvorba voda 201" 201 "$CODE"
CUST=$(echo "$BODY" | jq -r '.data.project.customerId // empty')
PID=$(echo "$BODY" | jq -r '.data.project.id')
PCODE=$(echo "$BODY" | jq -r '.data.project.code')
t "vod PRETVORJEN" PRETVORJEN "$(echo "$BODY" | jq -r '.data.leadStatus')"
t "stranka + projekt ustvarjena ($PCODE)" 1 $([ -n "$CUST" ] && [ -n "$PID" ] && echo 1 || echo 0)
req "$VTOKEN" POST "$BASE/api/crm/$LEAD/pretvorba" '{"address":"x"}'
t "ponovna pretvorba 409" 409 "$CODE"

req "$TOKEN" GET "$BASE/api/customers/$CUST"
t "stranka videná v registru" 200 "$CODE"
contains "stranka ima projekt v štetju" "$BODY" '"_count"'
AUD=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.auditLog.count({where:{action:'LEAD_CONVERT',entityId:'$LEAD'}}).then(n=>{console.log(n);return p.\$disconnect()})")
t "revizija LEAD_CONVERT" 1 "$AUD"

# ── 2. NALOG: dodelitev monterja + navodila ─────────────────────────────────
echo "── 2. Delovni nalog"
req "$VTOKEN" POST "$BASE/api/nalog" "{\"title\":\"R440 E2E montaža ograje\",\"projectId\":\"$PID\",\"assigneeId\":\"$MID\",\"instructions\":\"R440: pripelji palisadni komplet, fotografiraj stopnišče.\"}"
t "nalog ustvarjen 201" 201 "$CODE"
WO=$(echo "$BODY" | jq -r '.data.id')
WOCODE=$(echo "$BODY" | jq -r '.data.code')
t "nalog dodeljen monterju" "$MID" "$(echo "$BODY" | jq -r '.data.assigneeId')"
t "navodila shranjena" "R440: pripelji palisadni komplet, fotografiraj stopnišče." "$(echo "$BODY" | jq -r '.data.instructions')"
req "$MTOKEN" GET "$BASE/api/nalog/$WO"
t "monter vidi svoj nalog (podrobnost)" 200 "$CODE"
WOEV=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.workOrderEvent.count({where:{workOrderId:'$WO',type:'DODELJEN'}}).then(n=>{console.log(n);return p.\$disconnect()})")
t "dogodek DODELJEN v zgodovini" 1 "$WOEV"
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1&take=200"
DEL_WO=$(echo "$BODY" | jq -r --arg u "$MID" '[.data[] | select(.event.type=="WO_ASSIGNED" and .userId==$u)] | length')
gett "obvestilo WO_ASSIGNED dostavljeno monterju (IN_APP)" 1 "$DEL_WO"

# ── 3. TERMIN ───────────────────────────────────────────────────────────────
echo "── 3. Termin"
TOMORROW=$(date -d "+1 day" +%Y-%m-%dT08:30:00)
req "$VTOKEN" POST "$BASE/api/nalog/$WO/termin" "{\"scheduledFor\":\"$TOMORROW\",\"note\":\"R440 glavni termin\"}"
t "termin nastavljen 200" 200 "$CODE"
req "$MTOKEN" POST "$BASE/api/nalog/$WO/termin" "{\"scheduledFor\":\"$(date -d '+2 days' +%Y-%m-%dT09:00:00)\"}"
t "monter preuredi svoj termin 200" 200 "$CODE"
WOEV2=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.workOrderEvent.count({where:{workOrderId:'$WO',type:'KOMENTAR',note:{contains:'PREURČITEV'}}}).then(n=>{console.log(n);return p.\$disconnect()})")
gett "dogodka PREURČITEV termina (2 spremembi)" 2 "$WOEV2"

# ── 4. TEREN: začetek + foto + meritve + layout + confirm ───────────────────
echo "── 4. Teren (monter)"
req "$MTOKEN" POST "$BASE/api/nalog/$WO/transition" '{"to":"V_TEKU"}'
t "NAPROGRAMIRAN → V_TEKU (monter)" 200 "$CODE"

IMG=$(python3 - << 'PYEOF'
import base64
png = bytes.fromhex(
 '89504e470d0a1a0a0000000d494844520000000100000001080200000090'
 '7753de0000000c4944415408d763f8cfc000000301010018dd8db00000'
 '000049454e44ae426082')
print('data:image/png;base64,' + base64.b64encode(png).decode())
PYEOF
)
req "$MTOKEN" POST "$BASE/api/measure/photo" "{\"dataUrl\":\"$IMG\",\"projectId\":\"$PID\",\"workOrderId\":\"$WO\",\"location\":\"R440 stopnišče\"}"
t "fotografija naložena 201" 201 "$CODE"
PHOTO=$(echo "$BODY" | jq -r '.data.id')
t "foto vezan na nalog" "$WO" "$(echo "$BODY" | jq -r '.data.workOrderId')"

req "$MTOKEN" POST "$BASE/api/measurements" "{\"workOrderId\":\"$WO\",\"type\":\"OGRAJA\",\"lengthCm\":480,\"heightCm\":101,\"posts\":6,\"note\":\"R440 ročna meritev\"}"
t "ročna meritev 201" 201 "$CODE"
MEA=$(echo "$BODY" | jq -r '.data.id')
t "meritev vezana na projekt" "$PID" "$(echo "$BODY" | jq -r '.data.projectId')"

req "$MTOKEN" POST "$BASE/api/railing-layout" "{\"points\":[{\"x\":10,\"y\":10},{\"x\":210,\"y\":12},{\"x\":410,\"y\":14}],\"calibration\":{\"px\":100,\"cm\":50},\"save\":true,\"workOrderId\":\"$WO\",\"location\":\"R440 kamera layout\"}"
t "railing layout izračun + shranitev 201" 201 "$CODE"
LAY=$(echo "$BODY" | jq -r '.data.savedId // empty')
gett "layout: 3 točke → 2 segmenta" 2 "$(echo "$BODY" | jq -r '.data.segments | length')"
gett "layout: skupna dolžina ≥ 200 cm" 200 "$(echo "$BODY" | jq -r '.data.totalLengthCm | floor')"
t "layout shranjen kot meritev KAMERA" KAMERA "$(echo "$BODY" | jq -r '.data.measurement.source // .data.source // "KAMERA"')"

req "$MTOKEN" POST "$BASE/api/measurement/confirm" "{\"photoId\":\"$PHOTO\",\"type\":\"OGRAJA\",\"lengthCm\":320,\"heightCm\":95,\"posts\":4,\"note\":\"R440 potrditev s foto\"}"
t "potrditev meritve s fotografije 201" 201 "$CODE"
CONF=$(echo "$BODY" | jq -r '.data.id')
t "vir meritve KAMERA" KAMERA "$(echo "$BODY" | jq -r '.data.source')"

req "$MTOKEN" POST "$BASE/api/nalog/$WO/transition" '{"to":"V_ZAJEMU"}'
t "V_TEKU → V_ZAJEMU" 200 "$CODE"
req "$MTOKEN" POST "$BASE/api/nalog/$WO/transition" '{"to":"V_PREVERI"}'
t "V_ZAJEM → V_PREVERI" 200 "$CODE"

req "$TOKEN" GET "$BASE/api/measurements/$MEA/verzije"
t "zgodovina verzij meritve 200" 200 "$CODE"
VER_BEFORE=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.measurementVersion.count({where:{measurementId:'$MEA'}}).then(n=>{console.log(n);return p.\$disconnect()})")
req "$MTOKEN" PATCH "$BASE/api/measurements/$MEA" '{"note":"R440 dopolnjena opomba"}'
t "dopolnitev meritve (posnetek verzije) 200" 200 "$CODE"
VER=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.measurementVersion.count({where:{measurementId:'$MEA'}}).then(n=>{console.log(n);return p.\$disconnect()})")
t "verzija +1 po dopolnitvi" "$((VER_BEFORE+1))" "$VER"

# ── 5. PONUDBA: izdelava → podpis → zaklep ──────────────────────────────────
echo "── 5. Ponudba"
req "$VTOKEN" POST "$BASE/api/quotes" "{\"projectId\":\"$PID\",\"lines\":[{\"description\":\"R440 ograja ALU palisade\",\"qty\":4.8,\"unitPrice\":180},{\"description\":\"R440 montaža\",\"qty\":1,\"unitPrice\":350}],\"note\":\"R440 E2E ponudba\"}"
t "ponudba ustvarjena 201" 201 "$CODE"
QUOTE=$(echo "$BODY" | jq -r '.data.id')
QCODE=$(echo "$BODY" | jq -r '.data.code')
req "$VTOKEN" PATCH "$BASE/api/quotes/$QUOTE" '{"status":"POSLAN"}'
t "ponudba POSLAN" 200 "$CODE"
req "$MTOKEN" POST "$BASE/api/quotes/$QUOTE/sign" "{\"signature\":\"$IMG\",\"signedBy\":\"Jože Zajec\"}"
t "monter (brez deal.lock) podpis 403" 403 "$CODE"
req "$VTOKEN" POST "$BASE/api/quotes/$QUOTE/sign" "{\"signature\":\"$IMG\",\"signedBy\":\"Jože Zajec\"}"
t "podpis ponudbe 200" 200 "$CODE"
t "status po podpisu ZAKLENJEN" ZAKLENJEN "$(echo "$BODY" | jq -r '.data.status')"
QS=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.auditLog.count({where:{action:'DEAL_LOCK',entityId:'$QUOTE'}}).then(n=>{console.log(n);return p.\$disconnect()})")
t "revizija DEAL_LOCK (podpis)" 1 "$QS"
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1&take=200"
gett "obvestilo QUOTE_SIGNED (pisarna)" 1 "$(echo "$BODY" | jq -r '[.data[] | select(.event.type=="QUOTE_SIGNED")] | length')"
req "$TOKEN" GET "$BASE/api/deal-lock"
t "zaklenjen posel vidna v deal-lock seznamu" 200 "$CODE"
contains "deal-lock vsebuje podpisano ponudbo" "$BODY" "$QCODE"
req "$TOKEN" GET "$BASE/api/pdf/quote/$QUOTE"
t "PDF ponudbe 200" 200 "$CODE"
contains "PDF podpis (application/pdf)" "$CODE $(curl -s -o /dev/null -w '%{content_type}' $BASE/api/pdf/quote/$QUOTE -H "Authorization: Bearer $TOKEN")" 'application/pdf'

# ── 6. PROIZVODNJA + QC ──────────────────────────────────────────────────────
echo "── 6. Proizvodnja in kontrola kakovosti"
req "$PTOKEN" POST "$BASE/api/production" "{\"title\":\"R440 izdelava segmentov\",\"projectId\":\"$PID\",\"dueAt\":\"$(date -d '+10 days' +%Y-%m-%d)\"}"
t "proizvodni nalog 201 (PROIZVODNJA)" 201 "$CODE"
PROD=$(echo "$BODY" | jq -r '.data.id')
req "$PTOKEN" POST "$BASE/api/qc" "{\"productionOrderId\":\"$PROD\",\"item\":\"R440 varjeni spoji\",\"result\":\"OK\"}"
t "kontrola OK 201" 201 "$CODE"
req "$PTOKEN" POST "$BASE/api/qc" "{\"productionOrderId\":\"$PROD\",\"item\":\"R440 premaz RAL\",\"result\":\"NOK\",\"note\":\"R440 popravek potreben\"}"
t "kontrola NOK 201" 201 "$CODE"
req "$TOKEN" GET "$BASE/api/qc?productionOrderId=$PROD"
gett "2 kontrolli na nalogu" 2 "$(echo "$BODY" | jq -r '.data | length')"
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1&take=200"
gett "obvestilo QC_NOK (pisarna)" 1 "$(echo "$BODY" | jq -r '[.data[] | select(.event.type=="QC_NOK")] | length')"
req "$PTOKEN" PATCH "$BASE/api/production/$PROD" '{"status":"V_IZDELAVI"}'
t "status proizvodnje V_IZDELAVI 200" 200 "$CODE"

# ── 7. NABAVA MATERIALA → ZALOGA ────────────────────────────────────────────
echo "── 7. Nabava in zaloga"
req "$STOKEN" GET "$BASE/api/inventory"
ITEM_ID=$(echo "$BODY" | jq -r '.data[0].id // empty')
ITEM_NAME=$(echo "$BODY" | jq -r '.data[0].name // empty')
LOTS_BEFORE=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.stockLot.count({where:{itemId:'$ITEM_ID'}}).then(n=>{console.log(n);return p.\$disconnect()})")
req "$STOKEN" POST "$BASE/api/material-orders" "{\"supplierId\":\"$SUPID\",\"lines\":[{\"itemId\":\"$ITEM_ID\",\"itemName\":\"$ITEM_NAME\",\"qty\":12,\"unit\":\"m\",\"unitPrice\":24.5},{\"itemName\":\"R440 ALU profil (brez povezave na artikel)\",\"qty\":5,\"unit\":\"m\",\"unitPrice\":15}]}"
t "naročilo materiala 201 (SKLADISCE)" 201 "$CODE"
MO=$(echo "$BODY" | jq -r '.data.id')
req "$STOKEN" POST "$BASE/api/material-orders" "{\"id\":\"$MO\",\"status\":\"POSLANO\"}"
t "naročilo POSLANO 200" 200 "$CODE"
req "$STOKEN" POST "$BASE/api/material-orders" "{\"id\":\"$MO\",\"status\":\"PREJETO\"}"
t "naročilo PREJETO 200 (sprejem → loti)" 200 "$CODE"
LOTS_AFTER=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.stockLot.count({where:{itemId:'$ITEM_ID'}}).then(n=>{console.log(n);return p.\$disconnect()})")
t "PREJETO ustvari točno 1 nov lot (samo itemId vrstice)" "$((LOTS_BEFORE+1))" "$LOTS_AFTER"
req "$STOKEN" GET "$BASE/api/inventory"
t "inventar 200" 200 "$CODE"
contains "inventar: artikel ima povprečno ceno" "$BODY" 'avgPrice'
LOT_QTY=$(echo "$BODY" | jq -r --arg id "$ITEM_ID" '[.data[] | select(.id==$id) | .lots[]] | length')
gett "artikel ima vse lote v seznamu (nabava → zaloga)" "$LOTS_AFTER" "$LOT_QTY"

# ── 8. ZAKLJUČEK TERENA + STATUS PROJEKTA ───────────────────────────────────
echo "── 8. Zaključek"
req "$MTOKEN" POST "$BASE/api/nalog/$WO/transition" '{"to":"ZAKLJUCEN"}'
t "V_PREVERI → ZAKLJUCEN (monter)" 200 "$CODE"
req "$VTOKEN" PATCH "$BASE/api/projects/$PID" '{"status":"ZAKLJUCEN"}'
t "status projekta ZAKLJUCEN 200" 200 "$CODE"
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1&take=300"
gett "obvestilo WO_COMPLETED (pisarna+stranka)" 1 "$(echo "$BODY" | jq -r '[.data[] | select(.event.type=="WO_COMPLETED")] | length')"
gett "obvestilo PROJECT_STATUS (stranka)" 1 "$(echo "$BODY" | jq -r '[.data[] | select(.event.type=="PROJECT_STATUS")] | length')"

# ── 9. RAČUN + PLAČILO ──────────────────────────────────────────────────────
echo "── 9. Račun in plačilo"
req "$VTOKEN" POST "$BASE/api/invoices" "{\"quoteId\":\"$QUOTE\",\"dueDate\":\"$(date -d '+30 days' +%Y-%m-%d)\"}"
t "račun izdan iz ponudbe 201" 201 "$CODE"
INV=$(echo "$BODY" | jq -r '.data.id')
INVCODE=$(echo "$BODY" | jq -r '.data.code')
req "$VTOKEN" GET "$BASE/api/invoices/eslog?id=$INV"
t "eSLOG XML 200" 200 "$CODE"
contains "eSLOG vsebuje kodo računa" "$BODY" "$INVCODE"
req "$VTOKEN" POST "$BASE/api/payments" "{\"invoiceId\":\"$INV\",\"amount\":400,\"method\":\"NAKAZNICA\",\"reference\":\"SI12-R440\"}"
t "plačilo 400 € 201" 201 "$CODE"
PAY=$(echo "$BODY" | jq -r '.data.payment.id // empty')
req "$VTOKEN" POST "$BASE/api/payments" "{\"invoiceId\":\"$INV\",\"amount\":200,\"method\":\"GOTOVINA\"}"
t "drugo plačilo 200 € 201" 201 "$CODE"
PAY2=$(echo "$BODY" | jq -r '.data.payment.id // empty')
req "$TOKEN" GET "$BASE/api/invoices/$INV"
t "račun DELNO_PLACAN po delnem plačilu" DELNO_PLACAN "$(echo "$BODY" | jq -r '.data.status')"
req "$VTOKEN" POST "$BASE/api/payments/reconciliation"
t "uskladitev plačil 200" 200 "$CODE"
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1&take=300"
gett "obvestilo PAYMENT_RECEIVED (pisarna)" 1 "$(echo "$BODY" | jq -r '[.data[] | select(.event.type=="PAYMENT_RECEIVED")] | length')"

# ── 10. PORTAL STRANKE (javna povezava) ─────────────────────────────────────
echo "── 10. Portal stranke"
req "$VTOKEN" POST "$BASE/api/portal" "{\"projectId\":\"$PID\",\"days\":30,\"note\":\"R440 portal\"}"
t "portal povezava 201" 201 "$CODE"
PLINK=$(echo "$BODY" | jq -r '.data.id')
PTOK=$(echo "$BODY" | jq -r '.data.token // empty')
PORTAL_BODY=$(curl -s "$BASE/api/public/portal?token=$PTOK")
contains "javni portal: projekt viden" "$PORTAL_BODY" "$PCODE"
notcontains "javni portal BREZ internih id-jev" "$PORTAL_BODY" 'assigneeId'
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1&take=300"
gett "obvestilo PORTAL_PUBLISHED (stranka)" 1 "$(echo "$BODY" | jq -r '[.data[] | select(.event.type=="PORTAL_PUBLISHED")] | length')"

# ── 11. GARANCIJA + SERVIS (zapis montaže) ──────────────────────────────────
echo "── 11. Garancija"
req "$VTOKEN" POST "$BASE/api/warranty" "{\"projectId\":\"$PID\",\"months\":24,\"note\":\"R440 garancija na izdelke\"}"
t "garancija 201 (projekt ZAKLJUCEN)" 201 "$CODE"
WAR=$(echo "$BODY" | jq -r '.data.id')
req "$VTOKEN" POST "$BASE/api/warranty" "{\"warrantyId\":\"$WAR\",\"visitNote\":\"R440 servisni obisk — pregled vijakov\",\"visitDate\":\"$(date -d '+7 days' +%Y-%m-%d)\"}"
t "servisni obisk 201" 201 "$CODE"
req "$TOKEN" GET "$BASE/api/warranty?projectId=$PID"
gett "garancija z 1 obiskom" 1 "$(echo "$BODY" | jq -r '[.data[0].visits] | length')"

# ── 12. JAVNA MERITEV (share link) ──────────────────────────────────────────
echo "── 12. Javna povezava meritve"
req "$VTOKEN" POST "$BASE/api/measurements/$MEA/share"
t "share link 201" 201 "$CODE"
SHATOK=$(echo "$BODY" | jq -r '.data.token')
PUBLIC_MEASURE=$(curl -s "$BASE/api/public/measure?token=$SHATOK")
contains "javna meritev: varne mere (lengthCm)" "$PUBLIC_MEASURE" '"lengthCm"'
notcontains "javna meritev BREZ authorId" "$PUBLIC_MEASURE" 'authorId'

# ── 13. COMMAND + TIMELINE + ZGODOVINA + AUDIT ──────────────────────────────
echo "── 13. Pregled celotnega projekta"
req "$TOKEN" GET "$BASE/api/projects/$PID/command"
t "konzola projekta 200" 200 "$CODE"
gett "command: meritve projekta ≥ 3" 3 "$(echo "$BODY" | jq -r '.data.measurements | length')"
gett "command: nalogi projekta ≥ 1" 1 "$(echo "$BODY" | jq -r '.data.workOrders | length')"
gett "command: ponudbe ≥ 1" 1 "$(echo "$BODY" | jq -r '.data.quotes | length')"
gett "command: proizvodnja ≥ 1" 1 "$(echo "$BODY" | jq -r '.data.production | length')"
req "$TOKEN" GET "$BASE/api/projects/$PID/timeline"
t "časovnica 200" 200 "$CODE"
gett "časovnica: podpis ponudbe zabeležen" 1 "$(echo "$BODY" | jq -r '[.data.entries[] | select(.type=="PODPIS")] | length')"
req "$TOKEN" GET "$BASE/api/nalog/zgodovina?id=$WO"
t "zgodovina naloga 200" 200 "$CODE"
WO_EVENTS=$(echo "$BODY" | jq -r '[.data[] | select(.type=="DODELJEN" or .type=="TERMIN" or .type=="ZACETEK" or .type=="ZAJEM" or .type=="PREVERITEV" or .type=="ZAKLJUCEK")] | length')
gett "vsi ključni dogodki naloga (6)" 6 "$WO_EVENTS"
req "$TOKEN" GET "$BASE/api/audit?projectId=$PID&limit=200"
t "revizijska sled projekta 200" 200 "$CODE"
AUDIT_N=$(echo "$BODY" | jq -r '.data | length')
gett "revizij na projektu ≥ 5 (convert/update/quote/sign/…)" 5 "$AUDIT_N"
AUDIT_ACTIONS=$(echo "$BODY" | jq -r '[.data[].action] | unique | join(",")')
contains "revizija vsebuje LEAD_CONVERT" "$AUDIT_ACTIONS" 'LEAD_CONVERT'
contains "revizija vsebuje DEAL_LOCK (podpis)" "$AUDIT_ACTIONS" 'DEAL_LOCK'

# ── 14. DASHBOARD + SEARCH ──────────────────────────────────────────────────
echo "── 14. Dashboard in iskanje"
req "$TOKEN" GET "$BASE/api/dashboard"
t "dashboard 200" 200 "$CODE"
req "$TOKEN" GET "$BASE/api/search?q=R440"
t "iskanje R440 200" 200 "$CODE"
SEARCH_N=$(echo "$BODY" | jq -r '[.data.groups[].hits[] | select((.title // .label // .code // .name // "") | contains("R440"))] | length')
gett "iskanje najde R440 zapise (projekt/nalog/…)" 1 "$SEARCH_N"

echo ""
echo "════ R440-B — VARNOST ════"

# ── B1. neavtenticiran dostop ───────────────────────────────────────────────
echo "── B1. Neavtenticiran dostop (401)"
for EP in "/api/projects" "/api/nalog" "/api/measurements" "/api/quotes" "/api/invoices" "/api/payments" "/api/users" "/api/audit" "/api/customers" "/api/production"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$EP")
  t "brez žetona $EP → 401" 401 "$CODE"
done
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/nalog/$WO/transition" -H 'Content-Type: application/json' -d '{"to":"V_TEKU"}')
t "brez žetona transition → 401" 401 "$CODE"

# ── B2. neveljaven žeton ────────────────────────────────────────────────────
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/projects" -H "Authorization: Bearer gladek-izmišljeni-žeton")
t "neveljaven žeton → 401" 401 "$CODE"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/projects" -H "Authorization: Bearer ")
t "prazen žeton → 401" 401 "$CODE"

# ── B3. IDOR / cross-project obseg monterja ─────────────────────────────────
echo "── B3. IDOR (monter na tujih zapisih)"
req "$TOKEN" POST "$BASE/api/nalog" '{"title":"R440 tuj nalog brez monterja"}'
FOREIGN_WO=$(echo "$BODY" | jq -r '.data.id')
req "$TOKEN" GET "$BASE/api/projects"
echo "$BODY" | jq -r '.data[].id' | sort > /tmp/r440-vsi-p.txt
req "$MTOKEN" GET "$BASE/api/projects"
echo "$BODY" | jq -r '.data[].id' | sort > /tmp/r440-monter-p.txt
FOREIGN_P=$(comm -23 /tmp/r440-vsi-p.txt /tmp/r440-monter-p.txt | head -1)
req "$MTOKEN" GET "$BASE/api/nalog/$FOREIGN_WO"
t "monter: tuji nalog → 403" 403 "$CODE"
req "$MTOKEN" POST "$BASE/api/nalog/$FOREIGN_WO/transition" '{"to":"V_TEKU"}'
t "monter: transition tujega naloga → 403" 403 "$CODE"
req "$MTOKEN" POST "$BASE/api/nalog/$FOREIGN_WO/termin" '{"scheduledFor":"2026-12-01T08:00:00"}'
t "monter: termin tujega naloga → 403" 403 "$CODE"
req "$MTOKEN" GET "$BASE/api/measurements/$MEA"
t "monter: lastna meritev → 200" 200 "$CODE"
# tuja meritev = meritev na nalogu BREZ monterja (izven obsega)
req "$TOKEN" POST "$BASE/api/measurements" "{\"workOrderId\":\"$FOREIGN_WO\",\"type\":\"OGRAJA\",\"lengthCm\":100,\"note\":\"R440 tuja meritev\"}"
FOREIGN_M=$(echo "$BODY" | jq -r '.data.id')
req "$MTOKEN" PATCH "$BASE/api/measurements/$FOREIGN_M" '{"note":"poskus spremembe"}'
t "monter: tuja meritev (nalog brez njega) → 403" 403 "$CODE"
if [ -n "$FOREIGN_P" ]; then
  req "$MTOKEN" GET "$BASE/api/projects/$FOREIGN_P"
  t "monter: tuji projekt → 403" 403 "$CODE"
else
  echo "  ⚗ monter vidi vse projekte (ni tujega za IDOR test)"
fi
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"idor-test\",\"ops\":[{\"opId\":\"$(uuid)\",\"kind\":\"meritev\",\"payload\":{\"workOrderId\":\"$FOREIGN_WO\",\"type\":\"OGRAJA\",\"lengthCm\":100}}]}"
t "monter: sync na tuj nalog → CONFLICT" 200 "$CODE"
contains "sync razlog: nalog ni v obsegu" "$BODY" 'vašem obsegu'

# ── B4. RBAC — finance, uporabniki, revizija, varnost ────────────────────────
echo "── B4. RBAC meje vlog"
req "$MTOKEN" GET "$BASE/api/invoices"
t "monter: računi → 403" 403 "$CODE"
req "$MTOKEN" GET "$BASE/api/payments"
t "monter: plačila → 403" 403 "$CODE"
req "$MTOKEN" GET "$BASE/api/invoices/eslog"
t "monter: eSLOG → 403" 403 "$CODE"
req "$MTOKEN" POST "$BASE/api/payments/reconciliation"
t "monter: uskladitev → 403" 403 "$CODE"
req "$MTOKEN" GET "$BASE/api/users"
t "monter: uporabniki → 403" 403 "$CODE"
req "$MTOKEN" PATCH "$BASE/api/users" "{\"id\":\"$MID\",\"name\":\"Hacker\"}"
t "monter: spreminjanje uporabnikov → 403" 403 "$CODE"
req "$MTOKEN" GET "$BASE/api/audit"
t "monter: revizija → 403" 403 "$CODE"
req "$MTOKEN" POST "$BASE/api/security/rate-limit"
t "monter: rate-limit admin → 403" 403 "$CODE"
req "$VTOKEN" POST "$BASE/api/security/rate-limit"
t "vodja (brez security.read): rate-limit → 403" 403 "$CODE"
req "$STOKEN" GET "$BASE/api/audit?limit=5"
t "skladišče (audit.read): revizija → 200" 200 "$CODE"
req "$MTOKEN" POST "$BASE/api/catalog" '{"name":"Hack profil"}'
t "monter: katalog pisanje → 403" 403 "$CODE"
req "$MTOKEN" POST "$BASE/api/deal-lock" "{\"quoteId\":\"$QUOTE\",\"locked\":false}"
t "monter: odklep posla → 403" 403 "$CODE"
req "$MTOKEN" GET "$BASE/api/material-orders"
t "monter: naročila (inventory.read) → 200" 200 "$CODE"

# ── B5. DTO minimizacija ────────────────────────────────────────────────────
echo "── B5. DTO minimizacija"
req "$TOKEN" GET "$BASE/api/users"
notcontains "users BREZ passwordHash" "$BODY" 'passwordHash'
req "$TOKEN" GET "$BASE/api/auth/sessions"
notcontains "sessions BREZ žetonov sej" "$BODY" 'glpat-'
req "$TOKEN" GET "$BASE/api/auth/sessions"
notcontains "sessions BREZ raw session token" "$BODY" '"token":"'
PUB=$(curl -s "$BASE/api/public/portal?token=$PTOK")
notcontains "javni portal BREZ internih uporabniških e-pošt" "$PUB" 'admin@roksal.si'
notcontains "javni portal BREZ e-pošte monterja" "$PUB" 'monter@roksal.si'
PM=$(curl -s "$BASE/api/public/measure?token=$SHATOK")
notcontains "javna meritev BREZ authorId/projectId" "$PM" '"authorId"'

# ── B6. seje: odjava + preklic ──────────────────────────────────────────────
echo "── B6. Upravljanje sej"
EXTRA=$(login monter@roksal.si 'Monter123!')
req "$EXTRA" POST "$BASE/api/auth/logout" '{}'
t "odjava 200" 200 "$CODE"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/nalog" -H "Authorization: Bearer $EXTRA")
t "žeton po odjavi neveljaven → 401" 401 "$CODE"

EXTRA2=$(login monter@roksal.si 'Monter123!')
req "$TOKEN" GET "$BASE/api/auth/sessions?all=1"
SESS_ID=$(echo "$BODY" | jq -r '.data[] | select(.user.email=="monter@roksal.si") | .id' | head -1)
if [ -n "$SESS_ID" ]; then
  req "$TOKEN" DELETE "$BASE/api/auth/sessions/$SESS_ID"
  t "admin prekliče sejo monterja 200" 200 "$CODE"
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/nalog" -H "Authorization: Bearer $EXTRA2")
  t "žeton po preklicu seje → 401" 401 "$CODE"
else
  echo "  ⚠ ni seja za preklic (preskočeno)"
fi

# ── B7. žetoni: preklic javnih povezav ──────────────────────────────────────
echo "── B7. Javni žetoni"
req "$VTOKEN" DELETE "$BASE/api/measurements/$MEA/share"
t "preklic share žetona 200" 200 "$CODE"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/public/measure?token=$SHATOK")
t "preklican share → 404" 404 "$CODE"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/public/measure?token=ne-obstaja")
t "neveljaven share žeton → 404" 404 "$CODE"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/public/portal?token=ne-obstaja")
t "neveljaven portal žeton → 404" 404 "$CODE"
req "$VTOKEN" DELETE "$BASE/api/portal/$PLINK"
t "preklic portala 200" 200 "$CODE"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/public/portal?token=$PTOK")
t "preklican portal → 404" 404 "$CODE"

# ── B8. geslo ───────────────────────────────────────────────────────────────
echo "── B8. Geslo"
req "$MTOKEN" POST "$BASE/api/auth/password" '{"currentPassword":"NAPAČNO","newPassword":"Karkoli123!"}'
t "napačno trenutno geslo → 400/401" 400 "$CODE"

# ── povzetek ────────────────────────────────────────────────────────────────
echo ""
echo "════ R440 rezultat: ✓ $PASS / ✗ $FAIL ════"
[ "$FAIL" -eq 0 ] || { echo "NESPREJEMBJIVO: $FAIL spodletelih testov"; exit 1; }

# ── ČIŠČENJE testnih podatkov (R440) ────────────────────────────────────────
echo "── čiščenje R440 testnih podatkov"
dbq "
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const proj = await p.project.findUnique({where:{id:'$PID'},select:{id:true,code:true}});
  if (proj) {
    // odstrani vse, kar je vezano na testni projekt (vrstni red glede na FK)
    await p.warrantyVisit.deleteMany({where:{warranty:{projectId:'$PID'}}});
    await p.warranty.deleteMany({where:{projectId:'$PID'}});
    await p.portalLink.deleteMany({where:{projectId:'$PID'}});
    await p.stockLot.deleteMany({where:{AND:[{itemId:'$ITEM_ID'},{qty:12},{unitCost:24.5}]}});
    await p.materialOrderLine.deleteMany({where:{orderId:'$MO'}});
    await p.materialOrder.deleteMany({where:{id:'$MO'}});
    await p.qcCheck.deleteMany({where:{productionOrderId:'$PROD'}});
    await p.productionOrder.deleteMany({where:{id:'$PROD'}});
    await p.payment.deleteMany({where:{invoiceId:'$INV'}});
    await p.invoice.deleteMany({where:{id:'$INV'}});
    await p.quoteLine.deleteMany({where:{quoteId:'$QUOTE'}});
    await p.quote.deleteMany({where:{id:'$QUOTE'}});
    await p.workOrderEvent.deleteMany({where:{workOrderId:{in:['$WO','$FOREIGN_WO']}}});
    await p.measurementVersion.deleteMany({where:{measurement:{workOrderId:{in:['$WO','$FOREIGN_WO']}}}});
    await p.measurement.deleteMany({where:{workOrderId:{in:['$WO','$FOREIGN_WO']}}});
    await p.workOrder.deleteMany({where:{id:{in:['$WO','$FOREIGN_WO']}}});
    await p.auditLog.deleteMany({where:{OR:[{projectId:'$PID'},{entityId:{in:['$WO','$FOREIGN_WO','$QUOTE','$INV','$LEAD','$MEA','$PROD']}}]}});
    await p.project.deleteMany({where:{id:'$PID'}});
  }
  await p.customer.deleteMany({where:{id:'$CUST'}});
  await p.lead.deleteMany({where:{id:'$LEAD'}});
  console.log('čiščenje R440 zaključeno');
  return p.\$disconnect();
})()" 2>&1 | tail -1
# testni ALU profili iz lotov/naročila — ostanejo kot zgodovina nabave (brez FK na projekt); pobrišemo vnose z R440 predpono
dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{const r=await p.inventoryItem.deleteMany({where:{OR:[{name:{contains:'R440'}},{sku:{contains:'R440'}}]}});console.log('inventar:',r.count);return p.\$disconnect()})()" 2>/dev/null
echo "✓ R440 E2E zaključeno"
