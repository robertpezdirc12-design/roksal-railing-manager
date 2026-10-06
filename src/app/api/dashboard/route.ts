import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'

// agregirana preglednica (KPI) — vrata projects.read
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const [projects, workOrders, invoices, lowStock, opportunities] = await Promise.all([
    db.project.findMany({ select: { status: true } }),
    db.workOrder.findMany({ select: { status: true, scheduledFor: true } }),
    db.invoice.findMany({ select: { status: true, total: true, paid: true, dueDate: true } }),
    db.inventoryItem.findMany({ where: { qty: { lte: db.inventoryItem.fields.reorderAt } }, select: { id: true, name: true, qty: true, reorderAt: true, unit: true } }),
    db.opportunity.findMany({ select: { stage: true, value: true } }),
  ])

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const outstanding = invoices.filter((i) => i.status !== 'PLACAN' && i.status !== 'ZAPRT')
  const overdue = outstanding.filter((i) => i.dueDate && i.dueDate < new Date())

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
        today: workOrders.filter((w) => w.scheduledFor && new Date(w.scheduledFor) >= today && new Date(w.scheduledFor) < new Date(today.getTime() + 86400000)).length,
        byStatus: countBy(workOrders.map((w) => w.status)),
      },
      invoices: {
        outstanding: outstanding.reduce((s, i) => s + (i.total - i.paid), 0),
        overdueCount: overdue.length,
        overdueSum: overdue.reduce((s, i) => s + (i.total - i.paid), 0),
      },
      lowStock,
      pipeline: {
        value: opportunities.filter((o) => o.stage !== 'IZGUBLJENA').reduce((s, o) => s + o.value, 0),
        count: opportunities.filter((o) => o.stage !== 'IZGUBLJENA').length,
      },
    },
  })
}

function countBy (arr: string[]): Record<string, number> {
  return arr.reduce<Record<string, number>>((acc, s) => { acc[s] = (acc[s] ?? 0) + 1; return acc }, {})
}
