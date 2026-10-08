import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'

// /api/reports — NAPREDNA POROČILA (R451, issue #7 §16 P3).
// GET ?type=prodaja|servis|zaloga|projekti&months=3|6|12 (default 6).
//
// Vrata: projects.read (osnova vseh 4 tipov) — brez žetona 401, brez pravice 403.
// Dodatna vrata po tipih/sklopih (fail-closed, ENAK vzorec kot /api/dashboard —
// sklop brez pravic je null, strežnik ga sploh ne izračuna):
//   • prodaja: invoicedMonthly/paymentsMonthly/topCustomers SAMO invoices.read;
//     quotesMonthly/conversion SAMO quotes.read (monter vidi števila ponudb, NE denarja).
//   • servis: claimsByDecision/claimsMonthly SAMO pisarna (readsAllData — reklamacije
//     vodi pisarna, vzorec /api/claims); warrantyVisits/serviceVisits/billable/free
//     so za monterja omejeni na NJEGOVE obiske/primere (vzorec /api/service-cases).
//   • zaloga: cel tip zahteva inventory.read (sicer 403 — tip je čisto skladiški).
//   • projekti: projects.read (statusFlow celoten portfelj, newMonthly po createdAt).
//
// Obdobje: zadnjih N mesecev VKLJUČNO s tekočim (košare po ključih 'YYYY-MM').
// onTime: WorkOrder.completedAt se zapisuje ob prehodu ZAKLJUCEK (transition ruta),
// zato je "scheduledFor ≤ dejanski zaključek" dosledno izračunljiv — poleg tega
// poročamo še overdueNow (odprti nalogi s terminom v preteklosti).

const TYPES = ['prodaja', 'servis', 'zaloga', 'projekti'] as const

const MONTHS_ALLOWED = [3, 6, 12]
const round2 = (n: number) => Math.round(n * 100) / 100

/** Ključi mesecev 'YYYY-MM' za obdobje (nazaj od tekočega meseca). */
function monthKeys (months: number): string[] {
  const now = new Date()
  const keys: string[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

function countBy (arr: string[]): Record<string, number> {
  return arr.reduce<Record<string, number>>((acc, s) => { acc[s] = (acc[s] ?? 0) + 1; return acc }, {})
}

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user, perms } = auth

  const sp = new URL(req.url).searchParams
  const type = sp.get('type')
  if (!type || !(TYPES as readonly string[]).includes(type)) {
    return jsonError(400, 'Neveljaven tip poročila.', `Dovoljeni tipi: ${TYPES.join(', ')}.`)
  }
  const monthsRaw = sp.get('months') ?? '6'
  const months = Number(monthsRaw)
  if (!MONTHS_ALLOWED.includes(months)) {
    return jsonError(400, 'Neveljavno obdobje.', 'Dovoljene vrednosti months: 3, 6 ali 12.')
  }

  const keys = monthKeys(months)
  const from = new Date(`${keys[0]}-01T00:00:00`)
  const now = new Date()

  // ─── PRODAJA (denar SAMO invoices.read; ponudbe s quotes.read) ──────────────
  if (type === 'prodaja') {
    const canFinance = perms.includes('invoices.read')
    const canQuotes = perms.includes('quotes.read')

    let invoicedMonthly: { month: string; total: number; count: number }[] | null = null
    let paymentsMonthly: { month: string; amount: number; count: number }[] | null = null
    let topCustomers: { name: string; total: number }[] | null = null
    let quotesMonthly: { month: string; created: number; accepted: number }[] | null = null
    let conversion: { total: number; accepted: number; pct: number } | null = null

    if (canFinance) {
      // izdani računi = vse razen osnutkov (status OSNUTEK je ročni osnutek)
      const invoices = await db.invoice.findMany({
        where: { createdAt: { gte: from }, status: { not: 'OSNUTEK' } },
        select: {
          total: true, createdAt: true,
          project: { select: { customer: { select: { name: true } } } },
          quote: { select: { customer: { select: { name: true } } } },
        },
      })
      const invByMonth = new Map<string, { total: number; count: number }>(
        keys.map((k) => [k, { total: 0, count: 0 }])
      )
      const byCustomer = new Map<string, number>()
      for (const i of invoices) {
        const b = invByMonth.get(monthOf(i.createdAt))
        if (b) { b.total += i.total; b.count += 1 }
        const name = i.project?.customer?.name ?? i.quote?.customer?.name ?? 'Brez stranke'
        byCustomer.set(name, (byCustomer.get(name) ?? 0) + i.total)
      }
      invoicedMonthly = keys.map((k) => {
        const b = invByMonth.get(k)!
        return { month: k, total: round2(b.total), count: b.count }
      })

      const payments = await db.payment.findMany({
        where: { createdAt: { gte: from } },
        select: { amount: true, createdAt: true },
      })
      const payByMonth = new Map<string, { amount: number; count: number }>(
        keys.map((k) => [k, { amount: 0, count: 0 }])
      )
      for (const p of payments) {
        const b = payByMonth.get(monthOf(p.createdAt))
        if (b) { b.amount += p.amount; b.count += 1 }
      }
      paymentsMonthly = keys.map((k) => {
        const b = payByMonth.get(k)!
        return { month: k, amount: round2(b.amount), count: b.count }
      })

      topCustomers = [...byCustomer.entries()]
        .map(([name, total]) => ({ name, total: round2(total) }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5)
    }

    if (canQuotes) {
      const quotes = await db.quote.findMany({
        where: { createdAt: { gte: from } },
        select: { status: true, createdAt: true, signedAt: true },
      })
      // sprejeta ponudba = status SPREJET (shema: OSNUTEK|POSLAN|SPREJET|ZAVRNJEN|ZAKLENJEN);
      // košaro sprejetega določa signedAt (datum podpisa), sicer createdAt
      const isAccepted = (q: { status: string }) => q.status === 'SPREJET'
      const accDate = (q: { signedAt: Date | null; createdAt: Date }) => q.signedAt ?? q.createdAt
      const byMonth = new Map<string, { created: number; accepted: number }>(
        keys.map((k) => [k, { created: 0, accepted: 0 }])
      )
      for (const q of quotes) {
        const b = byMonth.get(monthOf(q.createdAt))
        if (b) b.created += 1
        if (isAccepted(q)) {
          const ab = byMonth.get(monthOf(accDate(q)))
          if (ab) ab.accepted += 1
        }
      }
      quotesMonthly = keys.map((k) => ({ month: k, ...byMonth.get(k)! }))
      // konverzija = kohorta: od ponudb, USTVARJENIH v obdobju, koliko je sprejetih
      const total = quotes.length
      const accepted = quotes.filter(isAccepted).length
      conversion = { total, accepted, pct: total > 0 ? Math.round((accepted / total) * 1000) / 10 : 0 }
    }

    return NextResponse.json({
      data: { type, months, from: from.toISOString(), invoicedMonthly, paymentsMonthly, quotesMonthly, conversion, topCustomers },
    })
  }

  // ─── SERVIS (reklamacije vodi pisarna; obiski/primerni za monterja NJEGOVI) ─
  if (type === 'servis') {
    const canClaims = readsAllData(user) // reklamacije vodi pisarna (vzorec /api/claims)
    const ownOnly = !readsAllData(user) // monter: samo lastni obiski/primerni

    let claimsByDecision: { decision: string | null; count: number }[] | null = null
    let claimsMonthly: { month: string; count: number }[] | null = null
    if (canClaims) {
      const claims = await db.claim.findMany({
        where: { createdAt: { gte: from } },
        select: { createdAt: true, serviceCase: { select: { decision: true } } },
      })
      const byDecision = new Map<string, number>()
      const byMonth = new Map<string, number>(keys.map((k) => [k, 0]))
      for (const c of claims) {
        const d = c.serviceCase?.decision ?? null
        byDecision.set(d ?? '__BREZ__', (byDecision.get(d ?? '__BREZ__') ?? 0) + 1)
        const mk = monthOf(c.createdAt)
        if (byMonth.has(mk)) byMonth.set(mk, (byMonth.get(mk) ?? 0) + 1)
      }
      claimsByDecision = [...byDecision.entries()]
        .map(([d, count]) => ({ decision: d === '__BREZ__' ? null : d, count }))
        .sort((a, b) => b.count - a.count)
      claimsMonthly = keys.map((k) => ({ month: k, count: byMonth.get(k) ?? 0 }))
    }

    // obiski garancije (WarrantyVisit) — vidni vsem z projects.read (kot /api/warranty)
    const warrantyVisits = await db.warrantyVisit.count({ where: { date: { gte: from } } })

    // servisni obiski (ServiceVisit) — monter samo SVOJI (obseg po /api/service-cases)
    const serviceVisits = await db.serviceVisit.count({
      where: { date: { gte: from }, ...(ownOnly ? { userId: user.id } : {}) },
    })

    // zaračunani/brezplačni servisni primeri v obdobju — monter samo primeri
    // z lastnim obiskom (visits.some.userId), vzorec /api/service-cases GET
    const cases = await db.serviceCase.findMany({
      where: { createdAt: { gte: from }, ...(ownOnly ? { visits: { some: { userId: user.id } } } : {}) },
      select: { billable: true },
    })

    return NextResponse.json({
      data: {
        type, months, from: from.toISOString(),
        claimsByDecision, claimsMonthly,
        warrantyVisits, serviceVisits,
        billableCount: cases.filter((c) => c.billable).length,
        freeCount: cases.filter((c) => !c.billable).length,
      },
    })
  }

  // ─── ZALOGA (cel tip: inventory.read — sicer 403, tip je čisto skladiški) ───
  if (type === 'zaloga') {
    if (!perms.includes('inventory.read')) {
      return jsonError(403, 'Dostop zavrnjen — manjka pravica inventory.read.', 'Skladiško poročilo je vidno samo vlogam z dostopom do zaloge.')
    }

    // gibanja: PREVZEM (vhod) vs IZDAJA (izhod) po mesecih + kumulativa po artiklih
    const movements = await db.stockMovement.findMany({
      where: { createdAt: { gte: from }, type: { in: ['PREVZEM', 'IZDAJA'] } },
      select: { type: true, qty: true, createdAt: true, item: { select: { name: true, unit: true } } },
    })
    const byMonth = new Map<string, { prevzem: number; izdaja: number }>(
      keys.map((k) => [k, { prevzem: 0, izdaja: 0 }])
    )
    const outByItem = new Map<string, { name: string; unit: string; qty: number }>()
    const movedNames = new Set<string>()
    for (const m of movements) {
      const b = byMonth.get(monthOf(m.createdAt))
      const qtyAbs = Math.abs(m.qty)
      if (b) {
        if (m.type === 'PREVZEM') b.prevzem += qtyAbs
        else b.izdaja += qtyAbs
      }
      if (m.type === 'IZDAJA') {
        movedNames.add(m.item.name)
        const cur = outByItem.get(m.item.name) ?? { name: m.item.name, unit: m.item.unit, qty: 0 }
        cur.qty += qtyAbs
        outByItem.set(m.item.name, cur)
      }
    }
    const movementsMonthly = keys.map((k) => {
      const b = byMonth.get(k)!
      return { month: k, prevzem: round2(b.prevzem), izdaja: round2(b.izdaja) }
    })
    const topMovers = [...outByItem.values()]
      .map((v) => ({ name: v.name, qty: round2(v.qty), unit: v.unit }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 8)

    // vsi artikli z zalogo + loti/cene (vrednost po enaki logiki kot dashboard)
    const items = await db.inventoryItem.findMany({
      where: { qty: { gt: 0 } },
      select: {
        id: true, name: true, unit: true, qty: true,
        lots: { select: { qty: true, unitCost: true } },
        prices: { select: { price: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })
    let stockTotal = 0
    const slowMovers: { name: string; qty: number; unit: string; value: number }[] = []
    for (const it of items) {
      const positive = it.lots.filter((l) => l.qty > 0)
      const qtySum = positive.reduce((s, l) => s + l.qty, 0)
      const unit = qtySum > 0
        ? positive.reduce((s, l) => s + l.qty * l.unitCost, 0) / qtySum
        : it.prices[0]?.price ?? 0
      const value = it.qty * unit
      stockTotal += value
      // počasni menjavci: zaloga > 0 in BREZ izdaje v obdobju
      if (!movedNames.has(it.name)) {
        slowMovers.push({ name: it.name, qty: round2(it.qty), unit: it.unit, value: round2(value) })
      }
    }
    slowMovers.sort((a, b) => b.value - a.value)

    return NextResponse.json({
      data: {
        type, months, from: from.toISOString(),
        movementsMonthly, topMovers,
        slowMovers: slowMovers.slice(0, 10),
        stockValue: { total: round2(stockTotal), items: items.length },
      },
    })
  }

  // ─── PROJEKTI (portfelj: novi po mesecih, statusi, pravočasnost nalogov) ────
  const [projects, workOrders] = await Promise.all([
    db.project.findMany({ select: { status: true, createdAt: true } }),
    db.workOrder.findMany({ select: { status: true, scheduledFor: true, completedAt: true } }),
  ])

  const byMonth = new Map<string, number>(keys.map((k) => [k, 0]))
  for (const p of projects) {
    const mk = monthOf(p.createdAt)
    if (byMonth.has(mk)) byMonth.set(mk, (byMonth.get(mk) ?? 0) + 1)
  }
  const newMonthly = keys.map((k) => ({ month: k, count: byMonth.get(k) ?? 0 }))

  // zaključeni nalogi v obdobju: completedAt se zapiše ob prehodu ZAKLJUCEK
  const completed = workOrders.filter((w) => w.completedAt && w.completedAt >= from)
  const onTimeCount = completed.filter((w) => w.scheduledFor && w.completedAt && new Date(w.scheduledFor) <= w.completedAt).length
  const lateCount = completed.filter((w) => w.scheduledFor && w.completedAt && new Date(w.scheduledFor) > w.completedAt).length
  const noSchedule = completed.filter((w) => !w.scheduledFor).length
  const scheduled = onTimeCount + lateCount
  // zamude ZDAJ: odprti nalogi s terminom v preteklosti (enaka definicija kot dashboard)
  const overdueNow = workOrders.filter(
    (w) => w.status !== 'ZAKLJUCEN' && w.scheduledFor && new Date(w.scheduledFor) < now
  ).length

  return NextResponse.json({
    data: {
      type, months, from: from.toISOString(),
      newMonthly,
      statusFlow: countBy(projects.map((p) => p.status)),
      onTime: {
        completed: completed.length,
        onTime: onTimeCount,
        late: lateCount,
        noSchedule,
        pct: scheduled > 0 ? Math.round((onTimeCount / scheduled) * 1000) / 10 : 0,
        overdueNow,
      },
    },
  })
}
