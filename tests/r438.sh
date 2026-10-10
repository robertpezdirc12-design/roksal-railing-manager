#!/bin/bash
# tests/r438.sh — R438 (GitLab issue #5): OBVESTILA IN KOMUNIKACIJA
# event → notification model: emit WO_ASSIGNED, dedup, prefs, stranka EMAIL (maskirano),
# deliveries RBAC, prefs validacija, job obvestila-retry, obstoječe rute nedotaknjene.
# Uporaba: bash tests/r438.sh  (dev strežnik mora teči na :3000)
set -u
BASE="${BASE_URL:-http://localhost:3000}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_URL="${TEST_DB_URL:-postgresql://roksal:roksal@localhost:54329/roksal}"
PASS=0; FAIL=0
CODE=""; BODY=""
TEST_START=$(date -u +%Y-%m-%dT%H:%M:%S)

t() { # t <opis> <pričakovano> <dejansko>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✓ $1 ($3)"
  else FAIL=$((FAIL+1)); echo "  ✗ $1 — pričakovano $2, dobljeno $3"; fi
}
gett() { # gett <opis> <pričakovano> <dejansko> — ≥ primerjava za številke
  if [ "$3" -ge "$2" ] 2>/dev/null; then PASS=$((PASS+1)); echo "  ✓ $1 ($3)"
  else FAIL=$((FAIL+1)); echo "  ✗ $1 — pričakovano ≥ $2, dobljeno $3"; fi
}
contains() { # contains <opis> <niz> <vzorec>
  if grep -Eq "$3" <<<"$2"; then PASS=$((PASS+1)); echo "  ✓ $1"
  else FAIL=$((FAIL+1)); echo "  ✗ $1 — vzorca '$3' ni v odgovoru"; fi
}
notcontains() { # notcontains <opis> <niz> <vzorec>
  if grep -Eq "$3" <<<"$2"; then FAIL=$((FAIL+1)); echo "  ✗ $1 — vzorec '$3' NE sme biti v odgovoru, pa je"
  else PASS=$((PASS+1)); echo "  ✓ $1"; fi
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
noauth() { # brez žetona (401 teste)
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X "$1" "$2" ${3:+-H 'Content-Type: application/json' -d "$3"})
}
# dbq <skripta> — poizvedba direktno v bazo (Prisma) → izpis stdout
dbq() {
  DATABASE_URL="$DB_URL" bun -e "$1" 2>/dev/null
}

echo "════ R438 — testi obvestil in komunikacije (issue #5) ════"

# ── 0. prijava ──────────────────────────────────────────────────────────────
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@roksal.si","password":"Admin123!"}' | jq -r '.token // empty')
MTOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"monter@roksal.si","password":"Monter123!"}' | jq -r '.token // empty')
VTOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"vodja@roksal.si","password":"Vodja123!"}' | jq -r '.token // empty')
t "prijava admin" 1 $([ -n "$TOKEN" ] && echo 1 || echo 0)
t "prijava monter" 1 $([ -n "$MTOKEN" ] && echo 1 || echo 0)

MID=$(req "$TOKEN" GET "$BASE/api/users"; echo "$BODY" | jq -r '.data[] | select(.email=="monter@roksal.si") | .id')
AID=$(req "$TOKEN" GET "$BASE/api/users"; echo "$BODY" | jq -r '.data[] | select(.email=="admin@roksal.si") | .id')
t "id monterja pridobljen" 1 $([ -n "$MID" ] && echo 1 || echo 0)
t "id admina pridobljen" 1 $([ -n "$AID" ] && echo 1 || echo 0)

# projekt s stranko z e-pošto (P-2026-006, ivan.zajc@gmail.com)
PID=$(req "$TOKEN" GET "$BASE/api/projects"; echo "$BODY" | jq -r '.data[] | select(.code=="P-2026-006") | .id')
t "projekt P-2026-006 najden" 1 $([ -n "$PID" ] && echo 1 || echo 0)

# ── 1. emit WO_ASSIGNED: dodelitev → monter dobi IN_APP obvestilo ──────────
echo "── 1. emit WO_ASSIGNED"
req "$TOKEN" POST "$BASE/api/nalog" "{\"title\":\"R438 testni nalog A\",\"assigneeId\":\"$MID\",\"instructions\":\"R438 navodila za test\"}"
t "POST nalog A (assignee monter) 201" 201 "$CODE"
WOA=$(echo "$BODY" | jq -r '.data.id // empty')
CODEA=$(echo "$BODY" | jq -r '.data.code // empty')
t "nalog A ima id" 1 $([ -n "$WOA" ] && echo 1 || echo 0)

req "$MTOKEN" GET "$BASE/api/notifications"
contains "monter vidi obvestilo 'Nov nalog dodeljen'" "$BODY" 'Nov nalog dodeljen'
contains "obvestilo vsebuje kodo naloga A" "$BODY" "$CODEA"
UNREAD=$(echo "$BODY" | jq -r '.unread // 0')
gett "unread ≥ 1" 1 "$UNREAD"
req "$MTOKEN" POST "$BASE/api/notifications/read" '{}'
gett "POST read (updated ≥ 1)" 1 "$(echo "$BODY" | jq -r '.updated // -1')"

# dostave za event: IN_APP SENT + EMAIL SKIPPED (privzeto izklopljen)
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1"
DELIA=$(echo "$BODY" | jq -c "[.data[] | select(.event.key | contains(\"$WOA\"))]")
t "IN_APP dostava SENT" "SENT" "$(echo "$DELIA" | jq -r '[.[] | select(.channel=="IN_APP")][0].status // "NI"')"
t "EMAIL dostava SKIPPED (privzeto izklopljen)" "SKIPPED" "$(echo "$DELIA" | jq -r '[.[] | select(.channel=="EMAIL")][0].status // "NI"')"
t "EMAIL SKIPPED razlog" "izklopljeno v nastavitvah" "$(echo "$DELIA" | jq -r '[.[] | select(.channel=="EMAIL")][0].error // "NI"')"

# ── 2. dedup: isti assignee brez spremembe → 0 novih; nov nalog → +1 ────────
echo "── 2. dedup po ključu"
req "$TOKEN" POST "$BASE/api/nalog" "{\"title\":\"R438 testni nalog B\",\"assigneeId\":\"$MID\"}"
t "POST nalog B 201" 201 "$CODE"
WOB=$(echo "$BODY" | jq -r '.data.id // empty')
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1"
CNT=$(echo "$BODY" | jq -r "[.data[] | select(.event.type==\"WO_ASSIGNED\" and .userId==\"$MID\" and .channel==\"IN_APP\")] | length")
gett "dve dodelitvi → 2 IN_APP dostavi" 2 "$CNT"

# PATCH istega naloga Z ISTIM assigneeId → brez novega duplikata
req "$TOKEN" PATCH "$BASE/api/nalog/$WOA" "{\"assigneeId\":\"$MID\",\"title\":\"R438 testni nalog A (posodobljen)\"}"
t "PATCH isti assignee 200" 200 "$CODE"
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1"
CNT2=$(echo "$BODY" | jq -r "[.data[] | select(.event.type==\"WO_ASSIGNED\" and .userId==\"$MID\" and .channel==\"IN_APP\")] | length")
t "ponovni PATCH brez spremembe assigneeja → 0 novih" "$CNT" "$CNT2"

# PATCH z NOVIMI navodili → WO_INSTRUCTIONS (monter), NE pa nov WO_ASSIGNED
req "$TOKEN" PATCH "$BASE/api/nalog/$WOA" '{"instructions":"R438 posodobljena navodila"}'
t "PATCH nova navodila 200" 200 "$CODE"
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1"
t "WO_INSTRUCTIONS dostava SENT" "SENT" "$(echo "$BODY" | jq -r "[.data[] | select(.event.type==\"WO_INSTRUCTIONS\" and .channel==\"IN_APP\")][0].status // \"NI\"")"
CNT3=$(echo "$BODY" | jq -r "[.data[] | select(.event.type==\"WO_ASSIGNED\" and .userId==\"$MID\" and .channel==\"IN_APP\")] | length")
t "navodila ne ustvarijo novega WO_ASSIGNED" "$CNT" "$CNT3"

# ── 3. prefs: izklop IN_APP → SKIPPED; ponovna omogočitev ──────────────────
echo "── 3. nastavitve prefs"
req "$MTOKEN" POST "$BASE/api/notifications/prefs" '{"event":"WO_ASSIGNED","channel":"IN_APP","enabled":false}'
t "monter izklopi IN_APP za WO_ASSIGNED" 200 "$CODE"
req "$MTOKEN" GET "$BASE/api/notifications"
UNREAD_BEFORE=$(echo "$BODY" | jq -r '.unread // 0')

req "$TOKEN" POST "$BASE/api/nalog" "{\"title\":\"R438 testni nalog C\",\"assigneeId\":\"$MID\"}"
t "POST nalog C (pref izklopljen) 201" 201 "$CODE"
WOC=$(echo "$BODY" | jq -r '.data.id // empty')

req "$MTOKEN" GET "$BASE/api/notifications"
UNREAD_AFTER=$(echo "$BODY" | jq -r '.unread // 0')
t "monter NIMA novega in-app obvestila" "$UNREAD_BEFORE" "$UNREAD_AFTER"
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1"
t "dostava C kaže SKIPPED" "SKIPPED" "$(echo "$BODY" | jq -r "[.data[] | select(.event.key | contains(\"$WOC\")) | select(.channel==\"IN_APP\")][0].status // \"NI\"")"
t "SKIPPED razlog = izklop v nastavitvah" "izklopljeno v nastavitvah" "$(echo "$BODY" | jq -r "[.data[] | select(.event.key | contains(\"$WOC\")) | select(.channel==\"IN_APP\")][0].error // \"NI\"")"

req "$MTOKEN" POST "$BASE/api/notifications/prefs" '{"event":"WO_ASSIGNED","channel":"IN_APP","enabled":true}'
t "ponovna omogočitev IN_APP" 200 "$CODE"
req "$MTOKEN" GET "$BASE/api/notifications/prefs"
t "GET prefs kaže IN_APP ponovno vklopljen" "true" "$(echo "$BODY" | jq -r '.data.events[] | select(.event=="WO_ASSIGNED") | .channels.IN_APP // "NI"' | tr 'A-Z' 'a-z' | sed 's/true/true/')"

# ── 4. stranka EMAIL: termin + zaključek na nalogu s projektom+stranko ─────
echo "── 4. stranka EMAIL (maskiran naslov)"
req "$TOKEN" POST "$BASE/api/nalog" "{\"title\":\"R438 nalog s projektom\",\"assigneeId\":\"$MID\",\"projectId\":\"$PID\"}"
t "POST nalog D (projekt P-2026-006) 201" 201 "$CODE"
WOD=$(echo "$BODY" | jq -r '.data.id // empty')

req "$TOKEN" POST "$BASE/api/nalog/$WOD/termin" '{"scheduledFor":"2026-11-15T08:00:00.000Z"}'
t "POST termin 200" 200 "$CODE"
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1&status=SENT"
TERMIN_EMAIL=$(echo "$BODY" | jq -c "[.data[] | select(.event.type==\"WO_TERMIN\" and .channel==\"EMAIL\")][0]")
t "WO_TERMIN EMAIL dostava SENT" "SENT" "$(echo "$TERMIN_EMAIL" | jq -r '.status // "NI"')"
contains "naslov je prikrit (*** v recipient)" "$TERMIN_EMAIL" '\*\*\*'
notcontains "celoten e-poštni naslov NI v dostavi" "$TERMIN_EMAIL" 'ivan\.zajc@gmail\.com'
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1&status=SKIPPED"
t "SMS za stranko SKIPPED (kanal ni konfiguriran)" "kanal ni konfiguriran" "$(echo "$BODY" | jq -r "[.data[] | select(.event.type==\"WO_TERMIN\" and .channel==\"SMS\")][0].error // \"NI\"")"

# zaključek terena → WO_COMPLETED: OFFICE (admin+vodja IN_APP) + stranka EMAIL
req "$MTOKEN" POST "$BASE/api/nalog/$WOD/transition" '{"to":"V_TEKU"}'
t "prehod NAPROGRAMIRAN → V_TEKU" 200 "$CODE"
req "$MTOKEN" POST "$BASE/api/nalog/$WOD/transition" '{"to":"V_ZAJEMU"}'
t "prehod V_TEKU → V_ZAJEMU" 200 "$CODE"
req "$MTOKEN" POST "$BASE/api/nalog/$WOD/transition" '{"to":"V_PREVERI"}'
t "prehod V_ZAJEMU → V_PREVERI" 200 "$CODE"
req "$MTOKEN" POST "$BASE/api/nalog/$WOD/transition" '{"to":"ZAKLJUCEN","note":"R438 testni zaključek"}'
t "prehod V_PREVERI → ZAKLJUCEN" 200 "$CODE"
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1"
COMPL=$(echo "$BODY" | jq -c "[.data[] | select(.event.type==\"WO_COMPLETED\")]")
t "WO_COMPLETED IN_APP za admina SENT" "SENT" "$(echo "$COMPL" | jq -r "[.[] | select(.userId==\"$AID\" and .channel==\"IN_APP\")][0].status // \"NI\"")"
t "WO_COMPLETED IN_APP za vodjo SENT (OFFICE)" "SENT" "$(echo "$COMPL" | jq -r "[.[] | select(.userId!=\"$AID\" and .userId!=null and .channel==\"IN_APP\")][0].status // \"NI\"")"
t "WO_COMPLETED EMAIL za stranko SENT" "SENT" "$(echo "$COMPL" | jq -r "[.[] | select(.channel==\"EMAIL\" and .userId==null)][0].status // \"NI\"")"

# ── 5. deliveries RBAC: lastne 200, ?all=1 monter 403, admin 200 ───────────
echo "── 5. RBAC dostav"
req "$MTOKEN" GET "$BASE/api/notifications/deliveries"
t "monter lastne dostave 200" 200 "$CODE"
gett "monter vidi svoje dostave" 1 "$(echo "$BODY" | jq -r '.data | length')"
ONLYOWN=$(echo "$BODY" | jq -r "[.data[] | select(.userId != \"$MID\")] | length")
t "monter vidi SAMO lastne (ni tujih)" 0 "$ONLYOWN"
req "$MTOKEN" GET "$BASE/api/notifications/deliveries?all=1"
t "monter ?all=1 → 403" 403 "$CODE"
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1"
t "admin ?all=1 → 200" 200 "$CODE"
gett "admin vidi vse dostave" 1 "$(echo "$BODY" | jq -r '.data | length')"
req "$VTOKEN" GET "$BASE/api/notifications/deliveries?all=1"
t "vodja ?all=1 → 403 (brez security.read)" 403 "$CODE"
noauth GET "$BASE/api/notifications/deliveries"
t "brez prijave 401" 401 "$CODE"

# ── 6. prefs validacija: kanal/tip/tuji userId ──────────────────────────────
echo "── 6. validacija prefs"
req "$MTOKEN" POST "$BASE/api/notifications/prefs" '{"event":"WO_ASSIGNED","channel":"PISMO","enabled":true}'
t "napačen kanal 400" 400 "$CODE"
req "$MTOKEN" POST "$BASE/api/notifications/prefs" '{"event":"NEZNAN_TIP","channel":"IN_APP","enabled":true}'
t "neznan tip dogodka 400" 400 "$CODE"
req "$MTOKEN" POST "$BASE/api/notifications/prefs" '{"event":"WO_ASSIGNED","channel":"EMAIL"}'
t "manjkajoč enabled 400" 400 "$CODE"
req "$MTOKEN" POST "$BASE/api/notifications/prefs" "{\"event\":\"WO_ASSIGNED\",\"channel\":\"EMAIL\",\"enabled\":true,\"userId\":\"$AID\"}"
t "POST z tujim userId → 200 (upsert LASTNE)" 200 "$CODE"
t "pref je shranjen pod monterjem (ne adminom)" "$MID" "$(echo "$BODY" | jq -r '.data.userId // "NI"')"
req "$MTOKEN" POST "$BASE/api/notifications/prefs" '{"event":"*","channel":"EMAIL","enabled":false}'
t " '*' tip je veljaven" 200 "$CODE"
req "$MTOKEN" POST "$BASE/api/notifications/prefs" '{"event":"WO_ASSIGNED","channel":"EMAIL","enabled":false}'
t "EMAIL pref ponastavljen (izklopljen)" 200 "$CODE"
noauth POST "$BASE/api/notifications/prefs" '{"event":"WO_ASSIGNED","channel":"IN_APP","enabled":true}'
t "prefs brez prijave 401" 401 "$CODE"

# ── 7. jobs: obvestila-retry ────────────────────────────────────────────────
echo "── 7. job obvestila-retry"
req "$TOKEN" POST "$BASE/api/jobs" '{"job":"obvestila-retry"}'
t "admin POST jobs obvestila-retry 200" 200 "$CODE"
t "job se imenuje obvestila-retry" "obvestila-retry" "$(echo "$BODY" | jq -r '.data.job // "NI"')"
req "$MTOKEN" POST "$BASE/api/jobs" '{"job":"obvestila-retry"}'
t "monter POST jobs 403 (security.read)" 403 "$CODE"
req "$TOKEN" GET "$BASE/api/jobs"
contains "GET jobs navaja obvestila-retry" "$BODY" 'obvestila-retry'

# ── 8. ostale rute ostanejo funkcionalne ───────────────────────────────────
echo "── 8. regresija obstoječih rut"
req "$TOKEN" GET "$BASE/api/nalog"
t "GET /api/nalog 200" 200 "$CODE"
req "$MTOKEN" GET "$BASE/api/notifications"
t "GET /api/notifications 200 (monter)" 200 "$CODE"
req "$TOKEN" GET "$BASE/api/audit?limit=5"
t "GET /api/audit 200" 200 "$CODE"
req "$MTOKEN" GET "$BASE/api/notifications/read"
t "GET na /read ni podpiran (405)" 405 "$CODE"

# ── 9. bonus: preostali dogodki (pisarna/stranka) ───────────────────────────
echo "── 9. preostali dogodki"
# PROJECT_STATUS: stranka EMAIL (status površčen nazaj)
PSTATUS=$(dbq "const {PrismaClient}=await import('@prisma/client');const db=new PrismaClient();const p=await db.project.findUnique({where:{id:'$PID'},select:{status:true}});console.log(p.status);await db.\$disconnect()")
req "$TOKEN" PATCH "$BASE/api/projects/$PID" '{"status":"TEREN"}'
t "PATCH projekt status → TEREN" 200 "$CODE"
req "$TOKEN" PATCH "$BASE/api/projects/$PID" "{\"status\":\"$PSTATUS\"}"
t "PATCH projekt status povrnjen" 200 "$CODE"
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1"
t "PROJECT_STATUS EMAIL za stranko SENT" "SENT" "$(echo "$BODY" | jq -r "[.data[] | select(.event.type==\"PROJECT_STATUS\" and .channel==\"EMAIL\" and .userId==null)][0].status // \"NI\"")"

# PORTAL_PUBLISHED: stranka EMAIL, BREZ žetona v telesu
req "$TOKEN" POST "$BASE/api/portal" "{\"projectId\":\"$PID\",\"days\":30,\"note\":\"R438 test\"}"
t "POST portal povezava 201" 201 "$CODE"
LINKID=$(echo "$BODY" | jq -r '.data.id // empty')
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1"
PORTALBODY=$(echo "$BODY" | jq -r "[.data[] | select(.event.type==\"PORTAL_PUBLISHED\")][0].event.body // \"NI\"")
t "PORTAL_PUBLISHED EMAIL SENT" "SENT" "$(echo "$BODY" | jq -r "[.data[] | select(.event.type==\"PORTAL_PUBLISHED\" and .channel==\"EMAIL\")][0].status // \"NI\"")"
contains "portal obvestilo omenja projekt" "$PORTALBODY" 'P-2026-006'
notcontains "portal obvestilo NE vsebuje žetona" "$PORTALBODY" 'pt-'
req "$TOKEN" DELETE "$BASE/api/portal/$LINKID"
t "portal povezava preklicana (čistitev)" 200 "$CODE"

# SURVEY_NEW: pisarna IN_APP
req "$TOKEN" POST "$BASE/api/surveys" '{"name":"R438 Testni kontakt","type":"OGRAJA","location":"Ljubljana","lengthCm":500}'
t "POST anketa 201" 201 "$CODE"
SURVEYID=$(echo "$BODY" | jq -r '.data.id // empty')
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1"
t "SURVEY_NEW IN_APP za pisarno SENT" "SENT" "$(echo "$BODY" | jq -r "[.data[] | select(.event.type==\"SURVEY_NEW\" and .channel==\"IN_APP\")][0].status // \"NI\"")"

# QC_NOK: pisarna IN_APP
PRODID=$(req "$TOKEN" GET "$BASE/api/production"; echo "$BODY" | jq -r '.data[0].id // empty')
req "$TOKEN" POST "$BASE/api/qc" "{\"productionOrderId\":\"$PRODID\",\"item\":\"R438 testna kontrola\",\"result\":\"NOK\",\"note\":\"Rob ni ustrezen\"}"
t "POST qc NOK 201" 201 "$CODE"
QCID=$(echo "$BODY" | jq -r '.data.id // empty')
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1"
t "QC_NOK IN_APP za pisarno SENT" "SENT" "$(echo "$BODY" | jq -r "[.data[] | select(.event.type==\"QC_NOK\" and .channel==\"IN_APP\")][0].status // \"NI\"")"

# PAYMENT_RECEIVED: pisarna IN_APP (plačilo se izbriše → račun povrnjen)
INVID=$(req "$TOKEN" GET "$BASE/api/invoices"; echo "$BODY" | jq -r '.data[] | select(.status != "ZAPRT") | .id' | head -1)
req "$TOKEN" POST "$BASE/api/payments" "{\"invoiceId\":\"$INVID\",\"amount\":1,\"method\":\"GOTOVINA\",\"reference\":\"R438\"}"
t "POST plačilo 1 € 201" 201 "$CODE"
PAYID=$(echo "$BODY" | jq -r '.data.payment.id // empty')
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1"
t "PAYMENT_RECEIVED IN_APP za pisarno SENT" "SENT" "$(echo "$BODY" | jq -r "[.data[] | select(.event.type==\"PAYMENT_RECEIVED\" and .channel==\"IN_APP\")][0].status // \"NI\"")"
req "$TOKEN" DELETE "$BASE/api/payments/$PAYID"
t "testno plačilo izbrisano (čistitev)" 200 "$CODE"

# MEASUREMENT_CONFIRMED: stranka EMAIL (mini fotografija → potrditev meritve)
req "$TOKEN" POST "$BASE/api/measure/photo" "{\"dataUrl\":\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==\",\"projectId\":\"$PID\",\"location\":\"R438 testna lokacija\"}"
t "POST fotografija 201" 201 "$CODE"
PHOTOID=$(echo "$BODY" | jq -r '.data.id // empty')
req "$TOKEN" POST "$BASE/api/measurement/confirm" "{\"photoId\":\"$PHOTOID\",\"type\":\"OGRAJA\",\"lengthCm\":420,\"location\":\"R438 testna lokacija\",\"projectId\":\"$PID\"}"
t "POST potrditev meritve 201" 201 "$CODE"
MEAID=$(echo "$BODY" | jq -r '.data.id // empty')
req "$TOKEN" GET "$BASE/api/notifications/deliveries?all=1"
t "MEASUREMENT_CONFIRMED EMAIL za stranko SENT" "SENT" "$(echo "$BODY" | jq -r "[.data[] | select(.event.type==\"MEASUREMENT_CONFIRMED\" and .channel==\"EMAIL\" and .userId==null)][0].status // \"NI\"")"

# ── čistitev testnih podatkov ───────────────────────────────────────────────
echo "── čistitev"
CLEAN=$(dbq "
const {PrismaClient}=await import('@prisma/client')
const db=new PrismaClient()
const ids=['$WOA','$WOB','$WOC','$WOD']
// eventi + dostave (kaskada) za testne naloge/plačila/ankete/kontrole
const ev=await db.notificationEvent.deleteMany({where:{OR:[
  ...ids.map(id=>({key:{contains:id}})),
  {key:'payment-received:$PAYID'},{key:'survey-new:$SURVEYID'},{key:'qc-nok:$QCID'},
  {key:{contains:'project-status:$PID'}},{key:'measurement-confirmed:$MEAID'},
  {key:'portal-published:$LINKID'},
]}})
// IN_APP obvestila nastala med testom
const nt=await db.notification.deleteMany({where:{createdAt:{gte:new Date('$TEST_START')},title:{in:[
  'Nov nalog dodeljen','Nova navodila za nalog','Sprememba termina','Zaključek terena',
  'Status projekta P-2026-006','Objavljen portal projekta P-2026-006','Novo povpraševanje',
  'QC neustrezno','Prejeto plačilo','Meritev potrjena']}}})
// testni nalogi + anketa + kontrola + meritev + verzije
const wo=await db.workOrder.deleteMany({where:{title:{contains:'R438'}}})
await db.survey.deleteMany({where:{name:{contains:'R438'}}})
await db.qcCheck.deleteMany({where:{item:{contains:'R438'}}})
await db.measurement.deleteMany({where:{location:{contains:'R438'}}})
// prefs monterja povrni na privzeto
await db.notificationPref.deleteMany({where:{userId:'$MID'}})
console.log(JSON.stringify({eventi:ev.count,obvestila:nt.count,nalogi:wo.count}))
await db.\$disconnect()
")
contains "čistitev izvedena" "$CLEAN" 'eventi'

echo ""
echo "════ R438 REZULTAT: ✓ $PASS / ✗ $FAIL ════"
[ "$FAIL" -eq 0 ]
