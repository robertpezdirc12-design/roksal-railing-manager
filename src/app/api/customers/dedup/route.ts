import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// /api/customers/dedup — R437 (route-map izvirnika): notranje orodje za razrez dvojnikov
// GET  (customers.write): skupine duplikatov — enak e-poštni naslov (ne-občutljivo na velikost
//      črk, ne-null) ALI enako normalizirano ime (male črke + obrez presledkov).
//      → { data: [{ ids, name, email, counts: { projects, quotes, leads } }] } (samo ≥ 2)
// POST (customers.write): { sourceId, targetId } — spajanje: v transakciji prestavi
//      projects/quotes/leads z izvora na cilj in izbriše izvorno stranko.
//      Revizija CUSTOMER_MERGE; odgovor { ok: true, moved }.

interface CustomerRow {
  id: string
  name: string
  email: string | null
  _count: { projects: number; quotes: number; leads: number }
}

const normEmail = (e: string | null) => (e && e.trim() ? e.trim().toLowerCase() : null)
const normName = (n: string) => n.trim().toLowerCase()

/** Unija-find po id-jih strank (spoji skupine po e-pošti in po imenu v eno). */
function groupDuplicates (rows: CustomerRow[]): CustomerRow[][] {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root) ?? root
    return root
  }
  const union = (a: string, b: string) => {
    const ra = find(a); const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const r of rows) parent.set(r.id, r.id)

  const byEmail = new Map<string, string[]>()
  const byName = new Map<string, string[]>()
  for (const r of rows) {
    const e = normEmail(r.email)
    const nk = normName(r.name)
    if (e) byEmail.set(e, [...(byEmail.get(e) ?? []), r.id])
    byName.set(nk, [...(byName.get(nk) ?? []), r.id])
  }
  // povežemo samo skupine z ≥ 2 člani (sami sebi niso duplikati)
  for (const group of [...byEmail.values(), ...byName.values()]) {
    if (group.length >= 2) for (let i = 1; i < group.length; i++) union(group[0], group[i])
  }

  const clusters = new Map<string, CustomerRow[]>()
  for (const r of rows) {
    const root = find(r.id)
    clusters.set(root, [...(clusters.get(root) ?? []), r])
  }
  return [...clusters.values()].filter((g) => g.length >= 2)
}

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'customers.write')
  if (auth instanceof NextResponse) return auth

  const rows = await db.customer.findMany({
    select: {
      id: true, name: true, email: true,
      _count: { select: { projects: true, quotes: true, leads: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const data = groupDuplicates(rows).map((group) => {
    // predstavnik: stranka z največ povezavami (padajoče), nato po imenu
    const weight = (c: CustomerRow) => c._count.projects + c._count.quotes + c._count.leads
    const rep = [...group].sort((a, b) => weight(b) - weight(a) || a.name.localeCompare(b.name))[0]
    // najpogostejši ne-prazen e-poštni naslov v skupini (sicer null)
    const emails = group.map((c) => normEmail(c.email)).filter((e): e is string => !!e)
    const email = emails.length > 0
      ? [...emails.reduce((m, e) => m.set(e, (m.get(e) ?? 0) + 1), new Map<string, number>())]
          .sort((a, b) => b[1] - a[1])[0][0]
      : null
    return {
      ids: group.map((c) => c.id),
      name: rep.name,
      email,
      counts: group.reduce(
        (acc, c) => ({
          projects: acc.projects + c._count.projects,
          quotes: acc.quotes + c._count.quotes,
          leads: acc.leads + c._count.leads,
        }),
        { projects: 0, quotes: 0, leads: 0 }
      ),
    }
  })

  return NextResponse.json({ data })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'customers.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null) as { sourceId?: unknown; targetId?: unknown } | null
  const sourceId = typeof body?.sourceId === 'string' ? body.sourceId : ''
  const targetId = typeof body?.targetId === 'string' ? body.targetId : ''
  if (!sourceId || !targetId) return jsonError(400, 'Potrebna sta sourceId in targetId.')
  if (sourceId === targetId) return jsonError(400, 'Izvor in cilj morata biti različna.', 'Stranke ne morete spojiti same s sabo.')

  const [source, target] = await Promise.all([
    db.customer.findUnique({ where: { id: sourceId }, select: { id: true, name: true } }),
    db.customer.findUnique({ where: { id: targetId }, select: { id: true, name: true } }),
  ])
  if (!source || !target) return jsonError(404, 'Ena od strank ne obstaja.', !source ? 'sourceId ni veljaven.' : 'targetId ni veljaven.')

  const moved = await db.$transaction(async (tx) => {
    const projects = await tx.project.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } })
    const quotes = await tx.quote.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } })
    const leads = await tx.lead.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } })
    await tx.customer.delete({ where: { id: sourceId } })
    return { projects: projects.count, quotes: quotes.count, leads: leads.count }
  })

  await writeAudit({
    userId: user.id,
    action: 'CUSTOMER_MERGE',
    entity: 'customer',
    entityId: targetId,
    detail: { from: source.name, to: target.name, moved },
  })

  return NextResponse.json({ ok: true, moved })
}
