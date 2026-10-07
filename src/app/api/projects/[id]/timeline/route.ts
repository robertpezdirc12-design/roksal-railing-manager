import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'

// /api/projects/[id]/timeline — kronološka združena zgodovina projekta
// (route-map: GET /api/projects/[id]/timeline)
// Združi: projekt (ustvarjen), ponudbe, meritve/foto, delovne naloge + dogodke, račune, plačila, proizvodnjo.

type Params = { params: Promise<{ id: string }> }

interface TimelineEntry {
  at: string
  type: string // ODPRTJE | PONUDBA | MERITEV | NALOG | DOGAJEK | RACUN | PLACILO | PROIZVODNJA
  label: string
  detail: string
  ref: string
}

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const project = await db.project.findUnique({
    where: { id },
    select: {
      id: true, code: true, title: true, createdAt: true,
      quotes: { select: { code: true, status: true, total: true, createdAt: true, signedAt: true, signedBy: true }, orderBy: { createdAt: 'asc' } },
      measurements: { select: { type: true, location: true, createdAt: true, note: true }, orderBy: { createdAt: 'asc' } },
      workOrders: {
        select: {
          code: true, title: true, status: true, createdAt: true, startedAt: true, completedAt: true,
          events: { select: { type: true, note: true, createdAt: true, user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      },
      invoices: { select: { code: true, status: true, total: true, createdAt: true, payments: { select: { amount: true, method: true, createdAt: true } } }, orderBy: { createdAt: 'asc' } },
      productionOrders: { select: { code: true, title: true, status: true, createdAt: true, dueAt: true }, orderBy: { createdAt: 'asc' } },
    },
  })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')

  const eur = (n: number) => n.toLocaleString('sl-SI', { style: 'currency', currency: 'EUR' })
  const entries: TimelineEntry[] = []

  entries.push({ at: project.createdAt.toISOString(), type: 'ODPERTJE', label: 'Projekt odprt', detail: `${project.code} — ${project.title}`, ref: project.code })
  for (const q of project.quotes) {
    entries.push({ at: q.createdAt.toISOString(), type: 'PONUDBA', label: `Ponudba ${q.code} (${q.status.toLowerCase()})`, detail: eur(q.total ?? 0), ref: q.code })
    if (q.signedAt) entries.push({ at: q.signedAt.toISOString(), type: 'PODPIS', label: `Podpis ${q.code}`, detail: q.signedBy ?? '—', ref: q.code })
  }
  for (const m of project.measurements) {
    entries.push({ at: m.createdAt.toISOString(), type: 'MERITEV', label: `${m.type === 'FOTO' ? 'Foto zajem' : 'Meritev'}${m.location ? ` — ${m.location}` : ''}`, detail: m.note ?? '—', ref: m.type })
  }
  for (const w of project.workOrders) {
    entries.push({ at: w.createdAt.toISOString(), type: 'NALOG', label: `Nalog ${w.code} — ${w.title}`, detail: w.status, ref: w.code })
    for (const e of w.events) {
      entries.push({ at: e.createdAt.toISOString(), type: 'DOGAJEK', label: `${e.type}${e.user ? ` · ${e.user.name}` : ''}`, detail: e.note ?? '—', ref: w.code })
    }
    if (w.completedAt) entries.push({ at: w.completedAt.toISOString(), type: 'ZAKLJUCEK', label: `Teren zaključen (${w.code})`, detail: '—', ref: w.code })
  }
  for (const inv of project.invoices) {
    entries.push({ at: inv.createdAt.toISOString(), type: 'RACUN', label: `Račun ${inv.code} (${inv.status.toLowerCase()})`, detail: eur(inv.total ?? 0), ref: inv.code })
    for (const p of inv.payments) {
      entries.push({ at: p.createdAt.toISOString(), type: 'PLACILO', label: `Plačilo — ${inv.code}`, detail: `${eur(p.amount)} · ${p.method.toLowerCase()}`, ref: inv.code })
    }
  }
  for (const pr of project.productionOrders) {
    entries.push({ at: pr.createdAt.toISOString(), type: 'PROIZVODNJA', label: `Proizvodnja ${pr.code} — ${pr.title}`, detail: pr.status, ref: pr.code })
  }

  entries.sort((a, b) => a.at.localeCompare(b.at))
  return NextResponse.json({ data: { project: { id: project.id, code: project.code, title: project.title }, entries, count: entries.length } })
}
