# MONTAŽA QA & PRIMOPREDAJA — R489 (GitHub issue #12, P1)

> Dokazljiva kontrola kakovosti od začetka montaže do zaključka: kontrolne
> točke s statusnim strojem, zapisi odstopanj, korektivni ukrepi, blokada
> zaključka ob kritičnih nerešenih zadevah in verzionirano primopredajno
> poročilo s podpisom stranke (zabeležena potrditev).

**Datum:** 12. 10. 2026 · **Verzija:** v1.44.0 · **Testi:** `tests/r489.py` 127 kontrol

---

## 1. AUDIT obstoječega stanja (§1 — brez podvajanja)

Pred implementacijo je raziskovalni podagent (1-a-R489) pregledal aktualni
`main` (132323a). Ključne ugotovitve:

| Obstoječe | Stanje | Vloga v R489 |
|---|---|---|
| `InstallationChecklist` (R444) | binarni odkljuk, brez statusov/dokazil | ostane vzporedno (preprost seznam) — NE nadomeščen |
| Playbook MONTAZA (R458, def v1) | 12 korakov, kategorija KONTROLA, checklist-i, evidence, verzioniranje `PlaybookDef` | **VIR PREDLOGE** kontrolnih točk (§3) |
| `segmentsZaProjekt` (P5, R488) | POTRJEN tekač → segmenti seg-N | **VIR** segmentnih točk |
| `EngineeringRule` (R449) | aktivna potrjena tehnična pravila | **VIR** kritičnih točk |
| `QcCheck` (proizvodnja) | OK/NOK na proizvodnem nalogu | nedotaknjeno (proizvodnja ≠ montaža) |
| Dostave (R445) | logistika, `recipientNote` besedilo | nedotaknjene |
| `diffTwin`/AS-INSTALLED (R461/462) | primerjava dvojčkov | ponovno uporabljeno v `zgradiDiff` |
| SignaturePad (signatura.tsx R459) | canvas → dataURL | vzorec za podpis stranke |
| pdf-mini + measure-package-pdf | lastni generator PDF | vzorec za primopredajni PDF |
| sync/offline (R439/486) | `SyncOp` idempotenca po opId, KINDS | nova vrsta `montaza-check` |

**Vrzeli, ki jih issue #12 opisuje** (vse zapolnjene): statusni stroj točk,
odstopanja z vplivi, korektivni ukrepi, blokada zaključka, primopredajno
poročilo s primerjavo načrtovano/potrjeno/izvedeno, verzioniranje poročila,
podpis stranke kot zabeležena potrditev.

## 2. Podatkovni model (migracija `20261017_r489_montaza_qa`)

```
MontazaCheck      kontrolna točka (workOrderId, templateKey+templateVersion snapshot,
                  stepId?, label, instruction?, critical, targetKey? seg-N,
                  status NI_ZACETO|V_REDU|NAPAKA|NI_RELEVANTNO|CAKA_PREVERJANJE,
                  photoId? (FOTO meritev), note?, checkedBy/At, resolutionNote?)
MontazaDeviation  odstopanje (reason OBVEZNO, checkId? SetNull, location?, targetKey?,
                  photoId?, impactMaterial/Price/Safety, createdBy, resolvedBy/At)
MontazaAction     korektivni ukrep (deviationId Cascade, description, assigneeId?,
                  dueAt?, status ODPRTO→V_OBRAVNAVI→ODRAVLJENO→PREVERJENO,
                  completedAt, verifiedBy/At, photoId?, note?)
HandoverReport    primopredaja (workOrderId+version UNIQUE — zgodovina verzij;
                  designedSnapshotId/installedSnapshotId/producedBomId,
                  diffJson seg-N primerjava z viri, photosJson PRED/MED/PO,
                  monterConfirmedBy/At, customerSignature (dataURL ≤2 MB) + SignedBy/At
                  + customerRemark (prenese se v nove verzije!), status
                  ZAKLJUCENA|POGOJNA|NEPOPOLNA)
```

## 3. API (vsaka mutacija ima revizijo; obseg fail-closed po nalogu)

| Ruta | Vrata | Revizija |
|---|---|---|
| `GET/POST /api/nalog/[id]/qa` | `nalog.read` / `nalog.write` | `MONTAZA_TEMPLATE_APPLY` |
| `PATCH /api/nalog/[id]/qa/check` | `nalog.write` | `MONTAZA_CHECK_STATUS` (+ `MONTAZA_DEVIATION_CREATE` avto ob NAPAKA) |
| `POST/PATCH /api/nalog/[id]/qa/deviation` | `nalog.write` | `MONTAZA_DEVIATION_CREATE` / `_RESOLVE` |
| `POST/PATCH /api/nalog/[id]/qa/action` | `nalog.write` | `MONTAZA_ACTION_CREATE` / `_STATUS` |
| `GET/POST/PATCH /api/nalog/[id]/handover` | `nalog.read` / `nalog.write` | `HANDOVER_CREATE` / `_MONTER_CONFIRM` / `_SIGN` / `_REMARK` / `_SUMMARY` |
| `GET /api/pdf/handover/[id]` | `documents.generate` | `DOC_GENERATE` (entity handover) |
| sync vrsta `montaza-check` | `nalog.write` | ISTA logika kot PATCH (sync = transport) |

**Pravila statusnega stroja** (§2B):
- `NAPAKA` **zahteva razlog** → samodejno ustvari odstopanje (sledljiv zapis,
  ne samo status); kritična/varnostna napaka doda še dogodek `TEZAVA` na nalog
  in obvestilo pisarni (`MONTAZA_NOK`, nov tip v katalogu obvestil);
- `NI_RELEVANTNO` **zahteva razlog** (opombo);
- odprava (`NAPAKA/CAKA → V_REDU`) **zahteva** `resolutionNote`;
- nazaj ni mogoče (zgodovina se ohranja, razen `NI_RELEVANTNO → NI_ZACETO`).

**Blokada zaključka** (§2C) — v OBEH kopijah FLOW (spletna + sync, da offline
NE more obiti varovala): kritična točka v NAPAKA/CAKA ali nerešeno varnostno
odstopanje → `409` z imeni blokirajočih točk; izvzem SAMO vodstvo
(`managesAssignments`) z `force` + `forceReason` (revizija `WO_ZAKLJUCEK_OVERRIDE`).
Brez QA točk zaključek NI blokiran (QA je neobvezen sloj nad obstoječim tokom).

**Status primopredaje** (§2D — poročilo NIKOLI ne pokaže navideznega popolnega
zaključka):
- `NEPOPOLNA` — kritične odprte zadeve ALI manjka kateri od podpisov;
- `POGOJNA` — vsi podpisi, a odprte nekritične zadeve ali pripomba stranke;
- `ZAKLJUCENA` — vse kontrole V redu/Ni relevantno, vsa odstopanja odpravljena,
  ukrepi preverjeni, oba podpisa, brez pripombe.

**Pripomba stranke** se obnovi poročila PRENESE v novo verzijo (odprta postavka
ne sme tihe izginiti); izbris je izrecen (`remark: ''`) in se zapiše v revizijo.

## 4. Predloga točk — podatkovno vodena (§3)

`sestaviPredlogo(projectId)` sestavi točke IZ VIROV (nikoli hardcoded):
1. **playbook MONTAZA** (aktivna verzija iz baze, fallback vgrajena v1) — koraki
   razen PREDAJA; koraki s checklist-om razpadejo na posamezne točke;
   varnost/kontrola → kritične;
2. **segmenti POTRJENEGA tekača** (`segmentsZaProjekt`, P5) — `seg-N` z dolžino;
3. **aktivna inženirska pravila** (`EngineeringRule`) — kritične.

Vsaka točka nosi `templateKey` (vir) + `templateVersion` (verzija graditelja) —
sprememba predloge NE spremeni že izvedene montaže za nazaj. Ponovna priprava
na istem nalogu → 409 (ali `force`, dokler NOBENA točka ni obdelana).

## 5. UI (mobile-first, 390 px, ena roka)

- **Danes → podrobnost naloga**: nova sekcija *Kontrola kakovosti montaže*
  (med Težavami in meritvami) — priprava točk, razpenjanje vrstic, statusni
  gumbi (V redu/Čaka/Napaka/Ni relevantno), obrazci z obveznimi razlogi,
  izbira dokazne fotografije iz FOTO meritev naloga, kartice odstopanj z
  ukrepi (odgovorna oseba, rok, linearni napredek);
- **Primopredaja** (od V_PREVERI): primerjava seg-N načrt/izvedeno z virom,
  fotografije po fazah, potrditev monterja, podpis stranke na zaslonu
  (canvas; izrecna opomba »ni kvalificiran e-podpis«), pripomba, PDF izvoz;
- **Nalogi → podrobnost**: povzetek QA (števci, blokada, status primopredaje,
  PDF) — urejanje ostane v Danes;
- `ui-bits STATUS_MAP`: +11 novih statusov.

## 6. Testi (tests/r489.py — 127 kontrol, faze A–J)

A priprava (tekač 4×250 POTRJEN + nalogi) · B predloga (viri, snapshot, 409,
force, IDOR) · C prehodi (dovoljeni/zavrnjeni, obvezni razlogi, dokazilna
fotografija ostane pripeta) · D napaka→odstopanje→ukrep (avto odstopanje,
TEZAVA dogodek, linearni tok ukrepov, preskok 409) · E1/E2 blokada (spletna +
sync CONFLICT, monter ne more forsirati, admin force + razlog + revizija;
brez QA zaključek prosto) · F primopredaja (v1 NEPOPOLNA kljub podpisoma,
podpis se ne prepiše, pripomba se prenaša, POGOJNA/ZAKLJUCENA pot, zgodovina
verzij) · G PDF (%PDF + revizija) · H RBAC/IDOR (401/403, skladišče brez
nalog.write, proizvodnja z nalog.write lahko pripravi — R425) · I sync
montaza-check (idempotenca po opId, NAPAKA offline ustvari odstopanje) ·
J regresija (R444 checklist sočasno) + kaskadno čiščenje ×2.

**Rezultati:** r489 **127/127 ×2** ✓ · regresija: r439 74/0 · r443 37/0 ·
r465 90/0 · r485 63/0 · r486 70/0 · r487 71/0 · r488 65/0 · `tsc --noEmit` 0 ·
`eslint` 0 · CI: nova skupina `r489` (17. skupina).

## 7. Znane meje (pošteno dokumentirane)

1. **Podpis na zaslonu = zabeležena potrditev** v sistemu — NI kvalificiran
   elektronski podpis (izrecno zapisano v PDF in UI); pravna veljavnost ni
   preverjena (issue §2D zahteva prav to opozorilo).
2. Primerjava izvedeno temelji na **AS-INSTALLED dvojčku** — brez njega
   poročilo prikazuje samo načrtovano mere z virom (izvedeno »—«), nikoli
   ugibanja.
3. Kontrolne točke iz pravil se generirajo iz **aktivnih** pravil ob pripravi
   — kasnejše spremembe pravil ne vplivajo na že izvedene montaže (snapshot).
4. Statusi točk so odvisni od vnest monterja — aplikacija NE preverja
   skladnosti s tehničnimi tolerancami avtomatsko (ni runtime AI); pravila
   služijo kot kontrolni predmet, ne kot senzor.
5. Fotografije v PDF so **navzoče FOTO meritve naloga** — poročilo ne ustvarja
   novih fotografij.
6. Offline: statusne spremembe točk se vrstijo prek `montaza-check` sync vrste;
   podpis stranke zahteva povezavo (namenoma — podpis je enkraten dogodek).

## 8. Povezani issueji

- #7 MONTER CAMERA-FIRST — QA sekcija živi v monterjevem Danes (mobile-first)
- #9 HOVER PARITY — primopredaja izkorišča isti seg-N vir kot merilni paket
- #11 SMART GUIDE — razširitvena točka: kontekstna pomoč na QA korakih (naslednji korak)
- #3 Field Capture — dokazne fotografije iz obstoječega FOTO toka
