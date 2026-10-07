// seed-r446.cjs — issue #7 §10 P2 SERVIS: reklamacije, servisni primeri in obiski
// (v OBSTOJEČO demo bazo, idempotentno — po vzoru seed-r445.cjs).
// Povezuje se na OBSTOJEČE podatke: zaključen projekt z garancijo (P-2026-004),
// arhiviran projekt s POTEKLO garancijo (P-2026-008) in aktiven projekt (P-2026-006).
// Ne briše ničesar; deluje samo, če R446 podatkov še ni.
// Uporaba: node prisma/seed-r446.cjs
/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

// koda <prefix><leto>-NNN iz zasedenih (enaka logika kot lib/codes.ts)
function nextCode (existing, prefix) {
  const year = new Date().getFullYear()
  const full = `${prefix}${year}-`
  const used = new Set(existing.filter((c) => c.startsWith(full)))
  let next = used.size + 1
  while (used.has(`${full}${String(next).padStart(3, '0')}`)) next++
  return `${full}${String(next).padStart(3, '0')}`
}

async function main () {
  const claimCount = await db.claim.count()
  if (claimCount > 0) {
    console.log('[seed-r446] reklamacije že obstajajo:', claimCount, '— preskočeno')
    return
  }

  const admin = await db.user.findUnique({ where: { email: 'admin@roksal.si' }, select: { id: true, name: true } })
  const monter = await db.user.findUnique({ where: { email: 'monter@roksal.si' }, select: { id: true, name: true } })
  const vodja = await db.user.findUnique({ where: { email: 'vodja@roksal.si' }, select: { id: true, name: true } })

  const p004 = await db.project.findUnique({
    where: { code: 'P-2026-004' },
    select: { id: true, code: true, customerId: true, customer: { select: { name: true } } },
  })
  const p008 = await db.project.findUnique({
    where: { code: 'P-2026-008' },
    select: { id: true, code: true, customerId: true, customer: { select: { name: true } } },
  })
  const p006 = await db.project.findUnique({
    where: { code: 'P-2026-006' },
    select: { id: true, code: true, customerId: true },
  })

  // garanciji obstoječih projektov (P-2026-004 veljavna, P-2026-008 potekla)
  const w004 = await db.warranty.findFirst({ where: { projectId: p004?.id }, select: { id: true, months: true, startsAt: true, status: true } })
  const w008 = await db.warranty.findFirst({ where: { projectId: p008?.id }, select: { id: true, months: true, startsAt: true, status: true } })

  const day = 86400000
  const now = Date.now()
  let claims = 0, cases = 0, visits = 0

  // ── 1. ZAKLJUČENA reklamacija s SERVISNIM PRIMEROM (garancija pokriva) ──────
  //     Tok: stranka → reklamacija → preveritev → odločitev (utemeljena) →
  //     servis (1 obisk) → zaključek. Vezano na P-2026-004 (veljavna garancija).
  if (p004 && p004.customerId && w004) {
    const claimCodes = (await db.claim.findMany({ select: { code: true } })).map((c) => c.code)
    const rekCode = nextCode(claimCodes, 'REK-')
    const claim1 = await db.claim.create({
      data: {
        code: rekCode,
        customerId: p004.customerId,
        projectId: p004.id,
        warrantyId: w004.id,
        title: 'Šum zaključnega profila pri vetru',
        desc: 'Stranka poroča, da zaključni profil ograje nadstreška pri močnem vetru oddaja šum. Težava se pojavlja od viharja septembra.',
        channel: 'TELEFON',
        status: 'ZAKLJUCENA',
        reportedBy: p004.customer.name,
        resolutionNote: 'Profil zatesnjen z matico z varnostnim obročem po navodilu proizvajalca; obnova v 12 mesecih brezplačna (garancija).',
        createdAt: new Date(now - 21 * day), updatedAt: new Date(now - 6 * day),
      },
    })
    claims++

    const caseCodes = (await db.serviceCase.findMany({ select: { code: true } })).map((c) => c.code)
    const srvCode = nextCode(caseCodes, 'SRV-')
    const case1 = await db.serviceCase.create({
      data: {
        code: srvCode,
        claimId: claim1.id,
        projectId: p004.id,
        warrantyId: w004.id,
        title: 'Preveritev in odprava šuma zaključnega profila',
        desc: 'Preveriti pritrditev zaključnega profila na severni strani nadstreška; po potrebi zatesniti.',
        status: 'ZAKLJUCEN',
        decision: 'UTEMELJENA',
        decisionNote: 'Utrditev profila je pokrita z garancijo — vzrok je nedotegnjena varnostna matica iz montaže.',
        decidedById: admin?.id ?? null,
        decidedAt: new Date(now - 18 * day),
        resolutionNote: 'Zatesnjeno z varnostnim obročem; stranka potrjuje, da šuja ni več.',
        billable: false, // garancija velja → ne zaračunamo
        createdAt: new Date(now - 20 * day), updatedAt: new Date(now - 6 * day),
      },
    })
    cases++

    if (monter) {
      await db.serviceVisit.create({
        data: {
          caseId: case1.id, userId: monter.id,
          date: new Date(now - 12 * day),
          note: 'Obisk na terenu: profil odvijačen, dodan varnostni obroč, ponovno pritrjen z momentom 12 Nm. Šum odpravljen.',
          hours: 1.5,
        },
      })
      visits++
    }
    console.log(`[seed-r446] ${rekCode} ZAKLJUCENA → ${srvCode} ZAKLJUCEN (utemeljena, garancija pokriva, 1 obisk)`)
  } else {
    console.log('[seed-r446] P-2026-004 ali njegova garancija manjkata — prvi par preskočen')
  }

  // ── 2. V_OBRAVNAVI reklamacija s primerom V_SERVISU (garancija potekla) ────
  //     Odločitev DELNO_UTEMELJENA, zaračunano (billable), 2 obiska.
  if (p008 && p008.customerId) {
    const claimCodes = (await db.claim.findMany({ select: { code: true } })).map((c) => c.code)
    const rekCode2 = nextCode(claimCodes, 'REK-')
    const claim2 = await db.claim.create({
      data: {
        code: rekCode2,
        customerId: p008.customerId,
        projectId: p008.id,
        warrantyId: w008?.id ?? null,
        title: 'Pojedina premaza na ograji vrta',
        desc: 'Na spodnji veji vrtne ograje se lušči praškasti premaz; gostilna želi obnovo pred sezono na vrtu.',
        channel: 'EMAIL',
        status: 'V_OBRAVNAVI',
        reportedBy: p008.customer.name,
        createdAt: new Date(now - 9 * day), updatedAt: new Date(now - 3 * day),
      },
    })
    claims++

    const caseCodes = (await db.serviceCase.findMany({ select: { code: true } })).map((c) => c.code)
    const srvCode2 = nextCode(caseCodes, 'SRV-')
    const case2 = await db.serviceCase.create({
      data: {
        code: srvCode2,
        claimId: claim2.id,
        projectId: p008.id,
        warrantyId: w008?.id ?? null,
        title: 'Obnova premaza vrtne ograje',
        desc: 'Izbrusiti in na novo praškasto prevleči poškodovano vejo ograje (približno 4 m).',
        status: 'V_SERVISU',
        decision: 'DELNO_UTEMELJENA',
        decisionNote: 'Garancija je potekla 07/2026; poškodba je posledica mehanske obremenitve (kolesarski nosilec). Obnova se zaračuna po ceniku.',
        decidedById: vodja?.id ?? admin?.id ?? null,
        decidedAt: new Date(now - 7 * day),
        billable: true, // garancija potekla → zaračunano
        createdAt: new Date(now - 8 * day), updatedAt: new Date(now - 2 * day),
      },
    })
    cases++

    if (monter) {
      await db.serviceVisit.create({
        data: {
          caseId: case2.id, userId: monter.id,
          date: new Date(now - 4 * day),
          note: 'Prvi obisk: odvzeta matica in odvita poškodovana veja; odpeljana v peskanje pri izvajalcu.',
          hours: 2,
        },
      })
      await db.serviceVisit.create({
        data: {
          caseId: case2.id, userId: monter.id,
          date: new Date(now - 1 * day),
          note: 'Drugi obisk: nova praškasta prevleka RAL 7016 pritrjena nazaj; čaka se še pregled gostilničarja pred zaključkom.',
          hours: 1.5,
        },
      })
      visits += 2
    }
    console.log(`[seed-r446] ${rekCode2} V_OBRAVNAVI → ${srvCode2} V_SERVISU (delno utemeljena, zaračunano, 2 obiska)`)
  } else {
    console.log('[seed-r446] P-2026-008 manjka — drugi par preskočen')
  }

  // ── 3. Samostojen primer v PREVERITEV (brez reklamacije, aktiven projekt) ──
  if (p006) {
    const caseCodes = (await db.serviceCase.findMany({ select: { code: true } })).map((c) => c.code)
    const srvCode3 = nextCode(caseCodes, 'SRV-')
    await db.serviceCase.create({
      data: {
        code: srvCode3,
        projectId: p006.id,
        title: 'Preveritev nestabilnega stebra stopniščne ograje',
        desc: 'Ob čiščenju je lastnica opazila rahlo zeros gumba na prstem stebru — preveriti pritrditev in po potrebi pritegniti.',
        status: 'PREVERITEV',
        createdAt: new Date(now - 1 * day),
      },
    })
    cases++
    console.log(`[seed-r446] ${srvCode3} PREVERITEV (brez reklamacije)`)
  }

  console.log(`[seed-r446] skupaj: ${claims} reklamacij, ${cases} servisnih primerov, ${visits} obiskov`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
