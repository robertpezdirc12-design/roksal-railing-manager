#!/bin/bash
# tests/r439.sh — R439 (GitLab issue #6): MOBILNI TEREN & OFFLINE
# POST /api/sync: idempotenca (opId), konflikti, obseg (fail-closed monter),
# foto z merilnimi podatki, zaključek terena, revizija SYNC_RUN, RBAC, regresija.
# Uporaba: bash tests/r439.sh  (dev strežnik mora teči na :3000)
set -u
BASE="${BASE_URL:-http://localhost:3000}"
DB_URL="${TEST_DB_URL:-file:$(cd "$(dirname "$0")/.." && pwd)/db/roksal.db}"
PASS=0; FAIL=0
CODE=""; BODY=""

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
req() { # req <žeton> <metoda> <url> [json-telo] → nastavi CODE in BODY
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
dbq() { # dbq <skripta> — poizvedba direktno v bazo (Prisma) → izpis stdout
  DATABASE_URL="$DB_URL" bun -e "$1" 2>/dev/null
}
uuid() { cat /proc/sys/kernel/random/uuid; }

echo "════ R439 — testi mobilnega terena in offline sinhronizacije (issue #6) ════"

# ── 0. prijava ──────────────────────────────────────────────────────────────
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@roksal.si","password":"Admin123!"}' | jq -r '.token // empty')
MTOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"monter@roksal.si","password":"Monter123!"}' | jq -r '.token // empty')
t "prijava admin" 1 $([ -n "$TOKEN" ] && echo 1 || echo 0)
t "prijava monter" 1 $([ -n "$MTOKEN" ] && echo 1 || echo 0)

MID=$(req "$TOKEN" GET "$BASE/api/users"; echo "$BODY" | jq -r '.data[] | select(.email=="monter@roksal.si") | .id')
PID=$(req "$TOKEN" GET "$BASE/api/projects"; echo "$BODY" | jq -r '.data[0].id')
t "id monterja" 1 $([ -n "$MID" ] && echo 1 || echo 0)
t "id projekta" 1 $([ -n "$PID" ] && echo 1 || echo 0)

# ── testni nalog (dodeljen monterju) + tuj nalog (adminov, brez monterja) ────
WO=$(curl -s -X POST $BASE/api/nalog -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"title\":\"TEST R439 sync teren\",\"projectId\":\"$PID\",\"assigneeId\":\"$MID\",\"instructions\":\"Testni nalog za offline sync\"}" | jq -r '.data.id // empty')
FOREIGN=$(curl -s -X POST $BASE/api/nalog -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"TEST R439 tuj nalog"}' | jq -r '.data.id // empty')
t "ustvarjen testni nalog" 1 $([ -n "$WO" ] && echo 1 || echo 0)
t "ustvarjen tuj nalog" 1 $([ -n "$FOREIGN" ] && echo 1 || echo 0)

DEV="test-dev-r439"

echo "── 1. avtentikacija in validacija ──"
noauth_test() {
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/api/sync -H 'Content-Type: application/json' -d '{"deviceId":"x","ops":[]}')
}
noauth_test; t "brez prijave → 401" 401 "$CODE"

req "$MTOKEN" POST "$BASE/api/sync" '{"ops":[]}'
t "brez deviceId → 400" 400 "$CODE"
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"$DEV\"}"
t "prazna vrsta → 200 (nič za poslati)" 200 "$CODE"
contains "prazna vrsta: synced 0" "$BODY" '"synced":0'

# prevelik paket (51 opov)
BIG=$(python3 -c "import json;print(json.dumps({'deviceId':'$DEV','ops':[{'opId':'bulk-%d'%i,'kind':'nalog-opomba','payload':{'workOrderId':'x','note':'x'}} for i in range(51)]}))")
req "$MTOKEN" POST "$BASE/api/sync" "$BIG"
t "51 opov → 400" 400 "$CODE"
contains "razlog: preveč operacij" "$BODY" "manjše pakete"

echo "── 2. meritev prek sync (offline zajem) ──"
OP1=$(uuid)
M_BEFORE=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.measurement.count({where:{workOrderId:'$WO'}}).then(n=>{console.log(n);return p.\$disconnect()})")
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"$DEV\",\"ops\":[{\"opId\":\"$OP1\",\"kind\":\"meritev\",\"payload\":{\"workOrderId\":\"$WO\",\"type\":\"OGRAJA\",\"lengthCm\":435.5,\"heightCm\":98,\"posts\":5,\"note\":\"offline meritev s terena\"}}]}"
t "meritev → 200" 200 "$CODE"
contains "rezultat OK" "$BODY" '"status":"OK"'
MID_SYNC=$(echo "$BODY" | jq -r '.data.results[0].data.id // empty')
M_AFTER=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.measurement.count({where:{workOrderId:'$WO'}}).then(n=>{console.log(n);return p.\$disconnect()})")
t "meritev zapisana v bazi" "$((M_BEFORE+1))" "$M_AFTER"
VER1=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.measurementVersion.count({where:{measurementId:'$MID_SYNC'}}).then(n=>{console.log(n);return p.\$disconnect()})")
t "verzija v1 samodejno" 1 "$VER1"
AUD1=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.auditLog.count({where:{action:'MEASUREMENT_CONFIRM',entityId:'$MID_SYNC'}}).then(n=>{console.log(n);return p.\$disconnect()})")
t "revizija MEASUREMENT_CONFIRM" 1 "$AUD1"

echo "── 3. IDEMPOTENCA — ponovitev istega opa ──"
IDEM_BEFORE=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.measurement.count({where:{workOrderId:'$WO'}}).then(n=>{console.log(n);return p.\$disconnect()})")
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"$DEV\",\"ops\":[{\"opId\":\"$OP1\",\"kind\":\"meritev\",\"payload\":{\"workOrderId\":\"$WO\",\"type\":\"OGRAJA\",\"lengthCm\":435.5,\"heightCm\":98,\"note\":\"offline meritev s terena\"}}]}"
t "ponovitev → 200" 200 "$CODE"
contains "ponovitev: OK" "$BODY" '"status":"OK"'
IDEM_AFTER=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.measurement.count({where:{workOrderId:'$WO'}}).then(n=>{console.log(n);return p.\$disconnect()})")
t "BREZ podvajanja meritev" "$IDEM_BEFORE" "$IDEM_AFTER"
SYNCOPS=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.syncOp.count({where:{id:'$OP1'}}).then(n=>{console.log(n);return p.\$disconnect()})")
t "SyncOp zadetek zapisan" 1 "$SYNCOPS"

echo "── 4. fotografija z merilnimi podatki (offline zajem s kamero) ──"
# 1×1 rdeč PNG kot dataUrl (~100 bajtov, veljaven data:image/png)
IMG=$(python3 - << 'PYEOF'
import base64
png = bytes.fromhex(
 '89504e470d0a1a0a0000000d494844520000000100000001080200000090'
 '7753de0000000c4944415408d763f8cfc000000301010018dd8db00000'
 '000049454e44ae426082')
print('data:image/png;base64,' + base64.b64encode(png).decode())
PYEOF
)
OP2=$(uuid)
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"$DEV\",\"ops\":[{\"opId\":\"$OP2\",\"kind\":\"foto\",\"payload\":{\"workOrderId\":\"$WO\",\"dataUrl\":\"$IMG\",\"type\":\"NAGIB\",\"lengthCm\":250,\"slopeDeg\":32.5,\"note\":\"stopnišče offline\"}}]}"
t "foto → 200" 200 "$CODE"
contains "foto: OK" "$BODY" '"status":"OK"'
FOTO_ID=$(echo "$BODY" | jq -r '.data.results[0].data.photo.id // empty')
M_FOTO=$(echo "$BODY" | jq -r '.data.results[0].data.measurement.id // empty')
t "foto zapis nastal" 1 $([ -n "$FOTO_ID" ] && echo 1 || echo 0)
t "meritev iz foto podatkov nastala" 1 $([ -n "$M_FOTO" ] && echo 1 || echo 0)
FOTO_TYPE=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.measurement.findUnique({where:{id:'$FOTO_ID'},select:{type:true,source:true}}).then(m=>{console.log(m.type+'|'+m.source);return p.\$disconnect()})")
contains "foto tip FOTO, vir KAMERA" "$FOTO_TYPE" 'FOTO\|KAMERA'
AUD2=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.auditLog.count({where:{action:'PHOTO_UPLOAD',entityId:'$FOTO_ID'}}).then(n=>{console.log(n);return p.\$disconnect()})")
t "revizija PHOTO_UPLOAD" 1 "$AUD2"

# prevelika fotografija → ERROR (ne 500) — telo pošljemo iz datoteke (prevelik za argv)
BIGIMG="data:image/png;base64,$(python3 -c "print('A'*9000000)")"
OP2B=$(uuid)
printf '{"deviceId":"%s","ops":[{"opId":"%s","kind":"foto","payload":{"workOrderId":"%s","dataUrl":"%s"}}]}' \
  "$DEV" "$OP2B" "$WO" "$BIGIMG" > /tmp/r439-bigimg.json
CODE=$(curl -s -o /tmp/r439-bigimg-out.json -w "%{http_code}" -X POST $BASE/api/sync \
  -H "Authorization: Bearer $MTOKEN" -H 'Content-Type: application/json' --data-binary @/tmp/r439-bigimg.json)
BODY=$(cat /tmp/r439-bigimg-out.json)
t "prevelika foto → 200 s ERROR rezultatom" 200 "$CODE"
contains "prevelika foto: ERROR" "$BODY" '"status":"ERROR"'
contains "razlog: prevelika" "$BODY" "prevelika"

echo "── 5. opomba naloga prek sync ──"
OP3=$(uuid)
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"$DEV\",\"ops\":[{\"opId\":\"$OP3\",\"kind\":\"nalog-opomba\",\"payload\":{\"workOrderId\":\"$WO\",\"note\":\"stranka zahteva kasnejši začetek\"}}]}"
t "opomba → 200 OK" 200 "$CODE"
contains "opomba: OK" "$BODY" '"status":"OK"'
EV1=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.workOrderEvent.count({where:{workOrderId:'$WO',type:'OPOMBA'}}).then(n=>{console.log(n);return p.\$disconnect()})")
t "dogodek OPOMBA zapisan" 1 "$EV1"
AUD3=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.auditLog.count({where:{action:'WO_NOTE',entityId:'$WO'}}).then(n=>{console.log(n);return p.\$disconnect()})")
t "revizija WO_NOTE" 1 "$AUD3"

echo "── 6. sprememba statusa + KONFLIKT ob ponovitvi ──"
OP4=$(uuid)
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"$DEV\",\"ops\":[{\"opId\":\"$OP4\",\"kind\":\"nalog-status\",\"payload\":{\"workOrderId\":\"$WO\",\"to\":\"V_TEKU\"}}]}"
t "status V_TEKU → 200 OK" 200 "$CODE"
contains "status: OK" "$BODY" '"status":"OK"'
WO_ST=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.workOrder.findUnique({where:{id:'$WO'},select:{status:true}}).then(w=>{console.log(w.status);return p.\$disconnect()})")
t "nalog je V_TEKU" "V_TEKU" "$WO_ST"

# isti prehod še enkrat (drugi opId) → CONFLICT — strežnik je že v V_TEKU
OP5=$(uuid)
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"$DEV\",\"ops\":[{\"opId\":\"$OP5\",\"kind\":\"nalog-status\",\"payload\":{\"workOrderId\":\"$WO\",\"to\":\"V_TEKU\"}}]}"
t "ponovljen prehod → 200 s CONFLICT" 200 "$CODE"
contains "ponovljen prehod: CONFLICT" "$BODY" '"status":"CONFLICT"'
contains "razlog: že v statusu" "$BODY" "že v statusu"

# nedovoljen prehod (preskok) → CONFLICT z dovoljenimi prehodi
OP6=$(uuid)
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"$DEV\",\"ops\":[{\"opId\":\"$OP6\",\"kind\":\"nalog-status\",\"payload\":{\"workOrderId\":\"$WO\",\"to\":\"ZAKLJUCEN\"}}]}"
t "preskok statusa → CONFLICT" 200 "$CODE"
contains "preskok: CONFLICT" "$BODY" '"status":"CONFLICT"'
contains "razlog: ni dovoljen" "$BODY" "ni dovoljen"

echo "── 7. zaključek terena prek sync ──"
# V_TEKU → V_ZAJEMU → V_PREVERI → ZAKLJUCEN (zaključek op)
OP7=$(uuid)
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"$DEV\",\"ops\":[{\"opId\":\"$OP7\",\"kind\":\"nalog-status\",\"payload\":{\"workOrderId\":\"$WO\",\"to\":\"V_ZAJEMU\"}}]}"
contains "V_ZAJEMU: OK" "$BODY" '"status":"OK"'
OP8=$(uuid)
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"$DEV\",\"ops\":[{\"opId\":\"$OP8\",\"kind\":\"nalog-status\",\"payload\":{\"workOrderId\":\"$WO\",\"to\":\"V_PREVERI\"}}]}"
contains "V_PREVERI: OK" "$BODY" '"status":"OK"'
OP9=$(uuid)
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"$DEV\",\"ops\":[{\"opId\":\"$OP9\",\"kind\":\"nalog-zakljucek\",\"payload\":{\"workOrderId\":\"$WO\",\"summary\":\"Ograja montirana, teren urejen in prepreden.\"}}]}"
t "zaključek → 200 OK" 200 "$CODE"
contains "zaključek: OK" "$BODY" '"status":"OK"'
WO_ST2=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.workOrder.findUnique({where:{id:'$WO'},select:{status:true,completedAt:true,summary:true}}).then(w=>{console.log(w.status+'|'+(w.completedAt?'1':'0'));return p.\$disconnect()})")
t "nalog ZAKLJUCEN s časom" "ZAKLJUCEN|1" "$WO_ST2"
WO_EV=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.workOrderEvent.count({where:{workOrderId:'$WO',type:'ZAKLJUCEK'}}).then(n=>{console.log(n);return p.\$disconnect()})")
t "dogodek ZAKLJUCEK" 1 "$WO_EV"
NOTIF=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.notificationEvent.count({where:{key:'wo-completed:$WO'}}).then(n=>{console.log(n);return p.\$disconnect()})")
t "obvestilo WO_COMPLETED (R438 povezava)" 1 "$NOTIF"

echo "── 8. vrstni red znotraj paketa (isti nalog, več opov) ──"
WO2=$(curl -s -X POST $BASE/api/nalog -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"title\":\"TEST R439 vrstni red\",\"projectId\":\"$PID\",\"assigneeId\":\"$MID\"}" | jq -r '.data.id // empty')
OPA=$(uuid); OPB=$(uuid); OPC=$(uuid)
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"$DEV\",\"ops\":[
  {\"opId\":\"$OPA\",\"kind\":\"nalog-status\",\"payload\":{\"workOrderId\":\"$WO2\",\"to\":\"V_TEKU\"}},
  {\"opId\":\"$OPB\",\"kind\":\"nalog-opomba\",\"payload\":{\"workOrderId\":\"$WO2\",\"note\":\"opomba po začetku\"}},
  {\"opId\":\"$OPC\",\"kind\":\"nalog-status\",\"payload\":{\"workOrderId\":\"$WO2\",\"to\":\"V_ZAJEMU\"}}
]}"
t "paket 3 opov → 200" 200 "$CODE"
OKS=$(echo "$BODY" | jq '[.data.results[] | select(.status=="OK")] | length')
t "vsi 3 opov OK (vrstni red upoštevan)" 3 "$OKS"
WO2_ST=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.workOrder.findUnique({where:{id:'$WO2'},select:{status:true}}).then(w=>{console.log(w.status);return p.\$disconnect()})")
t "končni status V_ZAJEMU" "V_ZAJEMU" "$WO2_ST"

echo "── 9. obseg (fail-closed): monter na TUJEM nalogu/projektu ──"
OPF=$(uuid)
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"$DEV\",\"ops\":[{\"opId\":\"$OPF\",\"kind\":\"nalog-opomba\",\"payload\":{\"workOrderId\":\"$FOREIGN\",\"note\":\"poskus na tujem nalogu\"}}]}"
t "tuj nalog → 200 s CONFLICT" 200 "$CODE"
contains "tuj nalog: CONFLICT" "$BODY" '"status":"CONFLICT"'
contains "razlog: ni v vašem obsegu" "$BODY" "ni v vašem obsegu"
EVF=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.workOrderEvent.count({where:{workOrderId:'$FOREIGN',type:'OPOMBA'}}).then(n=>{console.log(n);return p.\$disconnect()})")
t "na tujem nalogu NI dogodka" 0 "$EVF"

OPF2=$(uuid)
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"$DEV\",\"ops\":[{\"opId\":\"$OPF2\",\"kind\":\"meritev\",\"payload\":{\"projectId\":\"$PID\",\"type\":\"OGRAJA\",\"lengthCm\":100}}]}"
# PID pripada nalogu monterja (WO2) → OK; tuj projekt bi bil CONFLICT — uporabimo nov brez nalog
t "meritev na projektu svojega naloga → OK" 200 "$CODE"
contains "meritev na svojem projektu: OK" "$BODY" '"status":"OK"'

echo "── 10. validacija posameznih opov ──"
OPV1=$(uuid)
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"$DEV\",\"ops\":[{\"opId\":\"$OPV1\",\"kind\":\"neh-existent\",\"payload\":{}}]}"
t "neznan kind → ERROR" 200 "$CODE"
contains "neznan kind: ERROR" "$BODY" '"status":"ERROR"'
OPV2=$(uuid)
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"$DEV\",\"ops\":[{\"opId\":\"$OPV2\",\"kind\":\"meritev\",\"payload\":{\"workOrderId\":\"$WO\",\"type\":\"OGRAJA\"}}]}"
contains "meritev brez dolžine: ERROR" "$BODY" '"status":"ERROR"'
contains "razlog: dolžino" "$BODY" "dolžino"
OPV3=$(uuid)
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"$DEV\",\"ops\":[{\"opId\":\"$OPV3\",\"kind\":\"nalog-opomba\",\"payload\":{\"workOrderId\":\"$WO\"}}]}"
contains "opomba brez besedila: ERROR" "$BODY" '"status":"ERROR"'
OPV4=$(uuid)
req "$MTOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"$DEV\",\"ops\":[{\"opId\":\"$OPV4\",\"kind\":\"foto\",\"payload\":{\"workOrderId\":\"$WO2\",\"dataUrl\":\"ni-slika\"}}]}"
contains "foto brez slike: ERROR" "$BODY" '"status":"ERROR"'

echo "── 11. revizija SYNC_RUN ──"
AUDS=$(dbq "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.auditLog.count({where:{action:'SYNC_RUN',entityId:'$DEV'}}).then(n=>{console.log(n);return p.\$disconnect()})")
gett "revizija SYNC_RUN zapisana (vsaj 1)" 1 "$AUDS"

echo "── 12. admin lahko sync-a (pisarna) + monter RBAC ostaja ──"
OPA2=$(uuid)
req "$TOKEN" POST "$BASE/api/sync" "{\"deviceId\":\"office-dev\",\"ops\":[{\"opId\":\"$OPA2\",\"kind\":\"nalog-opomba\",\"payload\":{\"workOrderId\":\"$FOREIGN\",\"note\":\"opomba pisarne na tujem (svojem) nalogu\"}}]}"
t "admin sync na svojem nalogu → OK" 200 "$CODE"
contains "admin: OK" "$BODY" '"status":"OK"'
# monter IMA nalog.write (katalog R425) — ustvarjanje brez dodelitve je dovoljeno;
# RBAC pa velja za DEDELITEV (assigneeId) — samo pisarna (regresija iz R436)
req "$MTOKEN" POST "$BASE/api/nalog" "{\"title\":\"TEST R439 monter brez dodelitve\",\"projectId\":\"$PID\"}"
WO_MONTER=$(echo "$BODY" | jq -r '.data.id // empty')
t "regresija: monter ustvari nalog BREZ dodelitve → 201" 201 "$CODE"
req "$MTOKEN" POST "$BASE/api/nalog" "{\"title\":\"poskus\",\"assigneeId\":\"$MID\"}"
t "regresija: monter POST /api/nalog z assigneeId → 403" 403 "$CODE"

echo "── 13. regresija osnovnih rut ──"
req "$MTOKEN" GET "$BASE/api/nalog"
t "GET /api/nalog (monter) → 200" 200 "$CODE"
req "$TOKEN" GET "$BASE/api/measurements?projectId=$PID"
t "GET /api/measurements → 200" 200 "$CODE"
req "$MTOKEN" GET "$BASE/api/notifications"
t "GET /api/notifications → 200" 200 "$CODE"

# ── čiščenje testnih podatkov ────────────────────────────────────────────────
CLEAN=$(dbq "
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const named=await p.workOrder.findMany({where:{title:{contains:'TEST R439'}},select:{id:true}});
  const ids=[...new Set([...named.map(w=>w.id),...['$WO','$WO2','$FOREIGN','$WO_MONTER'].filter(Boolean)])];
  const meas=await p.measurement.findMany({where:{workOrderId:{in:ids}},select:{id:true}});
  const measIds=meas.map(m=>m.id);
  for (const id of ids) {
    await p.measurementVersion.deleteMany({where:{measurement:{workOrderId:id}}});
    await p.measurement.deleteMany({where:{workOrderId:id}});
    await p.workOrderEvent.deleteMany({where:{workOrderId:id}});
    await p.workOrder.deleteMany({where:{id}});
  }
  // orphan wo-completed dogodki (nalog iz testov je že izbrisan)
  const events=await p.notificationEvent.findMany({where:{key:{contains:'wo-completed:'}},select:{id:true,key:true}});
  for (const e of events) {
    const wo=await p.workOrder.findUnique({where:{id:e.key.split(':')[1]},select:{id:true}});
    if (!wo) {
      await p.notificationDelivery.deleteMany({where:{eventId:e.id}});
      await p.notificationEvent.delete({where:{id:e.id}});
    }
  }
  await p.notification.deleteMany({where:{title:'Zaključek terena'}});
  await p.syncOp.deleteMany({where:{deviceId:{in:['$DEV','office-dev','test-dev-1']}}});
  await p.auditLog.deleteMany({where:{action:{in:['SYNC_RUN','MEASUREMENT_CONFIRM','PHOTO_UPLOAD','WO_NOTE','WO_TRANSITION','WO_CREATE']},entityId:{in:[...ids,...measIds,'$DEV','office-dev']}}});
  console.log('ocisceno');
  return p.\$disconnect();
})()")
t "čiščenje testnih podatkov" "ocisceno" "$CLEAN"

echo ""
echo "════ R439 REZULTAT: ✓ $PASS / ✗ $FAIL ════"
[ "$FAIL" -eq 0 ] && echo "VSI TESTI USPEŠNI" || echo "NEUSPEŠNIH: $FAIL"
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
