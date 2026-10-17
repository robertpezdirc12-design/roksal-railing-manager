import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'
import { asJsonObject } from '@/lib/json'

// DIREKTOR COCKPIT / PREGLEDNICA (R444, issue #7 §8 DIREKTOR + RBAC popravek).
// Osnovna vrata ostajajo projects.read (KPI: projekti, nalogi, zaloga-meje).
// RBAC VRZEL popravljena: DENARNI podatki (terjatve, zastarevanje, marže,
// vrednost zaloge) se izračunajo in vrnejo SAMO z invoices.read (ADMIN/VODJA)
// — monter/skladišče/proizvodnja jih ne vidijo NITI prek API-ja.
// Prodajni lijak (pipeline) samo za vloge z crm.read.

interface MarginCalc {
  margin?: unknown
  marginPct?: unknown
  totalSale?: unknown
}

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const perms = auth.perms

  const canFinance = perms.includes('invoices.read')
  const canPipeline = perms.includes('crm.read')

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today.getTime() + 86400000)

  const [projects, workOrders, lowStock] = await Promise.all([
    db.project.findMany({ select: { status: true } }),
    db.workOrder.findMany({
      select: {
        status: true, scheduledFor: true, code: true, title: true, id: true,
        assignee: { select: { name: true } },
      },
    }),
    db.inventoryItem.findMany({ where: { qty: { lte: db.inventoryItem.fields.reorderAt } }, select: { id: true, name: true, qty: true, reorderAt: true, unit: true } }),
  ])

  // ─── finance (SAMO invoices.read — drugače sploh ne beremo računov) ────────
  let finance: {
    invoices: { outstanding: number; overdueCount: number; overdueSum: number }
    aging: { d0_30: number; d30_60: number; d60plus: number }
    marginsTop: { projectId: string; code: string; title: string; margin: number; marginPct: number; totalSale: number }[]
  } | null = null
  let operations: {
    overdue: { count: number; list: { id: string; code: string; title: string; scheduledFor: string; status: string; assignee: string | null }[] }
    capacity: { days: { date: string; count: number }[]; byAssignee: { name: string; count: number }[] }
    stockValue: { total: number; items: number }
  } | null = null

  if (canFinance) {
    const [invoices, packages, items] = await Promise.all([
      db.invoice.findMany({ select: { status: true, total: true, paid: true, dueDate: true } }),
      db.projectPackage.findMany({
        // R542: calcJson je jsonb — not-null filter potrebuje DbNull
        where: { calcJson: { not: Prisma.DbNull } },
        select: { calcJson: true, project: { select: { id: true, code: true, title: true } } },
      }),
      db.inventoryItem.findMany({
        where: { qty: { gt: 0 } },
        select: { qty: true, lots: { select: { qty: true, unitCost: true } }, prices: { select: { price: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
      }),
    ])

    const outstanding = invoices.filter((i) => i.status !== 'PLACAN' && i.status !== 'ZAPRT')
    const overdue = outstanding.filter((i) => i.dueDate && i.dueDate < new Date())
    const dayMs = 86400000
    const age = (d: Date) => Math.floor((Date.now() - d.getTime()) / dayMs)

    // marže po projektih (Σ margin iz ProjectPackage.calcJson) — top 5
    const byProject = new Map<string, { code: string; title: string; margin: number; totalSale: number }>()
    for (const p of packages) {
      // R542: calcJson je jsonb objekt — branje brez JSON.parse
      const calc: MarginCalc | null = asJsonObject(p.calcJson)
      const margin = typeof calc?.margin === 'number' && Number.isFinite(calc.margin) ? calc.margin : 0
      const totalSale = typeof calc?.totalSale === 'number' && Number.isFinite(calc.totalSale) ? calc.totalSale : 0
      const prev = byProject.get(p.project.id) ?? { code: p.project.code, title: p.project.title, margin: 0, totalSale: 0 }
      byProject.set(p.project.id, { ...prev, margin: prev.margin + margin, totalSale: prev.totalSale + totalSale })
    }
    const marginsTop = [...byProject.entries()]
      .map(([projectId, v]) => ({
        projectId, code: v.code, title: v.title,
        margin: Math.round(v.margin * 100) / 100,
        totalSale: Math.round(v.totalSale * 100) / 100,
        marginPct: v.totalSale > 0 ? Math.round((v.margin / v.totalSale) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.margin - a.margin)
      .slice(0, 5)

    // vrednost zaloge: Σ qty × povprečna cena (povprečje lotov; fallback zadnja MaterialPrice)
    let stockTotal = 0
    for (const it of items) {
      const positive = it.lots.filter((l) => l.qty > 0)
      const qtySum = positive.reduce((s, l) => s + l.qty, 0)
      const unit = qtySum > 0
        ? positive.reduce((s, l) => s + l.qty * l.unitCost.toNumber(), 0) / qtySum
        : it.prices[0]?.price.toNumber() ?? 0
      stockTotal += it.qty * unit
    }

    finance = {
      invoices: {
        outstanding: outstanding.reduce((s, i) => s + (i.total.toNumber() - i.paid.toNumber()), 0),
        overdueCount: overdue.length,
        overdueSum: overdue.reduce((s, i) => s + (i.total.toNumber() - i.paid.toNumber()), 0),
      },
      aging: {
        d0_30: overdue.filter((i) => i.dueDate && age(i.dueDate) <= 30).reduce((s, i) => s + (i.total.toNumber() - i.paid.toNumber()), 0),
        d30_60: overdue.filter((i) => i.dueDate && age(i.dueDate) > 30 && age(i.dueDate) <= 60).reduce((s, i) => s + (i.total.toNumber() - i.paid.toNumber()), 0),
        d60plus: overdue.filter((i) => i.dueDate && age(i.dueDate) > 60).reduce((s, i) => s + (i.total.toNumber() - i.paid.toNumber()), 0),
      },
      marginsTop,
    }

    // ─── operativa direktorja (zamude, kapaciteta, vrednost zaloge) ──────────
    const weekEnd = new Date(today.getTime() + 7 * dayMs)
    const now = new Date()
    const openWo = workOrders.filter((w) => w.status !== 'ZAKLJUCEN')
    // zamuda = termin v preteklosti (scheduledFor < zdaj) in nalog ni zaključen
    const overdueWo = openWo
      .filter((w) => w.scheduledFor && new Date(w.scheduledFor) < now)
      .sort((a, b) => new Date(a.scheduledFor ?? 0).getTime() - new Date(b.scheduledFor ?? 0).getTime())
    const weekWo = openWo.filter((w) => {
      const d = w.scheduledFor ? new Date(w.scheduledFor) : null
      return d && d >= today && d < weekEnd
    })
    const days = Array.from({ length: 7 }, (_, i) => {
      const dayStart = new Date(today.getTime() + i * dayMs)
      const dayEnd = new Date(today.getTime() + (i + 1) * dayMs)
      return {
        date: dayStart.toISOString().slice(0, 10),
        count: weekWo.filter((w) => {
          const d = w.scheduledFor ? new Date(w.scheduledFor) : null
          return d && d >= dayStart && d < dayEnd
        }).length,
      }
    })
    const byAssignee = new Map<string, number>()
    for (const w of weekWo) {
      const name = w.assignee?.name ?? 'Nedodeljeni'
      byAssignee.set(name, (byAssignee.get(name) ?? 0) + 1)
    }

    operations = {
      overdue: {
        count: overdueWo.length,
        list: overdueWo.slice(0, 12).map((w) => ({
          id: w.id, code: w.code, title: w.title,
          scheduledFor: (w.scheduledFor ?? new Date(0)).toISOString(),
          status: w.status, assignee: w.assignee?.name ?? null,
        })),
      },
      capacity: {
        days,
        byAssignee: [...byAssignee.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
      },
      stockValue: { total: Math.round(stockTotal * 100) / 100, items: items.length },
    }
  }

  // ─── prodajni lijak (SAMO crm.read — drugače sploh ne beremo priložnosti) ─
  let pipeline: { value: number; count: number } | null = null
  if (canPipeline) {
    const opportunities = await db.opportunity.findMany({ select: { stage: true, value: true } })
    const live = opportunities.filter((o) => o.stage !== 'IZGUBLJENA')
    pipeline = { value: live.reduce((s, o) => s + o.value.toNumber(), 0), count: live.length }
  }

  return NextResponse.json({
    data: {
      projects: {
        total: projects.length,
        byStatus: countBy(projects.map((p) => p.status)),
        active: projects.filter((p) => p.status === 'AKTIVNI' || p.status === 'TEREN').length,
      },
      workOrders: {
        total: workOrders.length,
        open: workOrders.filter((w) => w.status !== 'ZAKLJUCEN').length,
        today: workOrders.filter((w) => w.scheduledFor && new Date(w.scheduledFor) >= today && new Date(w.scheduledFor) < tomorrow).length,
        byStatus: countBy(workOrders.map((w) => w.status)),
      },
      lowStock,
      // finančni in direktorski sklopi so null za vloge brez pravic (fail-closed)
      finance,
      operations,
      pipeline,
    },
  })
}

function countBy (arr: string[]): Record<string, number> {
  return arr.reduce<Record<string, number>>((acc, s) => { acc[s] = (acc[s] ?? 0) + 1; return acc }, {})
}
