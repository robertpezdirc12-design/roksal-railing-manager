// project-progress — R456 (issue #11 §3/§10): POSLOVNI TOK PROJEKTA + NASLEDNJI KORAK.
// En izračun (en vir) za podrobnost projekta (/api/projects/[id]/progress) in
// ploščo »Naslednji koraki« (/api/projects/next-actions).
//
// 13-stopenjski tok (issue #11 §10):
//   POVPRAŠEVANJE → STRANKA → IZMERA → KONFIGURACIJA → BOM → PONUDBA → PODPIS
//   → REZERVACIJA → DOSTAVA → MONTAŽA → PREDAJA → RAČUN → GARANCIJA
//
// Naslednji korak je PRVA nedokončana stopnja — sistem uporabniku pove, kaj
// sledi (»NADALJUJ S KONFIGURACIJO«), namesto da bi jo iskal po menijih.
// targetTab se preslika v navigacijski zavihek (nav-registry id).

import { db } from '@/lib/db'

export interface ProgressStep {
  key: string
  label: string
  state: 'done' | 'todo'
  detail: string | null
}

export interface NextAction {
  key: string
  label: string
  targetTab: string
  reason: string
}

export interface ProjectProgress {
  projectId: string
  steps: ProgressStep[]
  done: number
  total: number
  pct: number
  next: NextAction | null
}

interface FlowDef { key: string; label: string; action: string; targetTab: string }

export const FLOW: FlowDef[] = [
  { key: 'POVPRAŠEVANJE', label: 'Povpraševanje', action: 'Zabeleži povpraševanje', targetTab: 'crm' },
  { key: 'STRANKA', label: 'Stranka', action: 'Dodeli stranko', targetTab: 'stranke' },
  { key: 'IZMERA', label: 'Izmera', action: 'Izmeri (kamera / ročno)', targetTab: 'meritve' },
  { key: 'KONFIGURACIJA', label: 'Konfiguracija', action: 'Konfiguriraj rešitev', targetTab: 'konfigurator' },
  { key: 'BOM', label: 'BOM', action: 'Pregled kosovnic', targetTab: 'material-v5' },
  { key: 'PONUDBA', label: 'Ponudba', action: 'Pripravi ponudbo', targetTab: 'ponudbe' },
  { key: 'PODPIS', label: 'Podpis', action: 'Zajemi podpis', targetTab: 'signatura' },
  { key: 'REZERVACIJA', label: 'Rezervacija', action: 'Rezerviraj material', targetTab: 'zaloga' },
  { key: 'DOSTAVA', label: 'Dostava', action: 'Planiraj dostavo', targetTab: 'dostave' },
  { key: 'MONTAŽA', label: 'Montaža', action: 'Vodi montažo', targetTab: 'nalogi' },
  { key: 'PREDAJA', label: 'Predaja', action: 'Zaključi predajo', targetTab: 'nalogi' },
  { key: 'RAČUN', label: 'Račun', action: 'Izdaj račun', targetTab: 'racuni' },
  { key: 'GARANCIJA', label: 'Garancija', action: 'Oddaj garancijo', targetTab: 'servis' },
]

/** Podatki, potrebni za izračun stopnjev. */
export interface ProgressCounts {
  customerId: string | null
  projectStatus: string
  leads: number
  measurements: number
  packages: number
  boms: number
  quotes: number
  signedQuotes: number
  reservations: number
  deliveries: number
  workOrders: number
  completedWorkOrders: number
  invoices: number
  warranties: number
}

/** Izračuna 13 stopnjev toka + naslednji korak iz številskih podatkov. */
export function stepsFromCounts (c: ProgressCounts): Omit<ProjectProgress, 'projectId'> {
  const doneMap: Record<string, boolean> = {
    POVPRAŠEVANJE: c.leads > 0 || c.quotes > 0,
    STRANKA: c.customerId !== null,
    IZMERA: c.measurements > 0,
    KONFIGURACIJA: c.packages > 0,
    BOM: c.boms > 0,
    PONUDBA: c.quotes > 0,
    PODPIS: c.signedQuotes > 0,
    REZERVACIJA: c.reservations > 0,
    DOSTAVA: c.deliveries > 0,
    MONTAŽA: c.completedWorkOrders > 0,
    PREDAJA: c.projectStatus === 'ZAKLJUCEN',
    RAČUN: c.invoices > 0,
    GARANCIJA: c.warranties > 0,
  }
  const detailMap: Record<string, string> = {
    POVPRAŠEVANJE: c.leads > 0 ? `${c.leads} povpraševanj` : c.quotes > 0 ? 'posredno (ponudba)' : 'ni zapisa',
    STRANKA: c.customerId ? 'dodeljena' : 'manjka',
    IZMERA: `${c.measurements} meritev`,
    KONFIGURACIJA: `${c.packages} paketov`,
    BOM: `${c.boms} kosovnic`,
    PONUDBA: `${c.quotes} ponudb`,
    PODPIS: c.signedQuotes > 0 ? `${c.signedQuotes} podpisanih` : 'ni podpisa',
    REZERVACIJA: `${c.reservations} rezervacij`,
    DOSTAVA: `${c.deliveries} dostav`,
    MONTAŽA: c.workOrders > 0 ? `${c.completedWorkOrders}/${c.workOrders} zaključenih` : 'ni nalogov',
    PREDAJA: c.projectStatus === 'ZAKLJUCEN' ? 'projekt zaključen' : c.projectStatus,
    RAČUN: `${c.invoices} računov`,
    GARANCIJA: c.warranties > 0 ? 'oddana' : 'ni garancije',
  }

  const steps: ProgressStep[] = FLOW.map((f) => ({
    key: f.key,
    label: f.label,
    state: doneMap[f.key] ? 'done' : 'todo',
    detail: detailMap[f.key] ?? null,
  }))

  const done = steps.filter((s) => s.state === 'done').length
  const firstTodo = FLOW.find((f) => !doneMap[f.key])
  const next: NextAction | null = firstTodo
    ? {
        key: firstTodo.key,
        label: `NADALJUJ: ${firstTodo.action.toUpperCase()}`,
        targetTab: firstTodo.targetTab,
        reason: `Manjka korak ${firstTodo.label.toLowerCase()} — ${detailMap[firstTodo.key] ?? 'ni podatka'}.`,
      }
    : null

  return { steps, done, total: FLOW.length, pct: Math.round((done / FLOW.length) * 100), next }
}

/** Pridobi vse števce za EN projekt (paralelna poizvedba). */
export async function countsForProject (projectId: string): Promise<ProgressCounts | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, customerId: true, status: true },
  })
  if (!project) return null

  const [leads, measurements, packages, boms, quoteRows, reservations, deliveries, woRows, invoices, warranties] = await Promise.all([
    project.customerId
      ? db.lead.count({ where: { customerId: project.customerId } })
      : Promise.resolve(0),
    db.measurement.count({ where: { projectId } }),
    db.projectPackage.count({ where: { projectId } }),
    db.bom.count({ where: { package: { projectId } } }),
    db.quote.findMany({ where: { projectId }, select: { signedAt: true } }),
    db.stockReservation.count({ where: { projectId } }),
    db.delivery.count({ where: { projectId } }),
    db.workOrder.findMany({ where: { projectId }, select: { status: true } }),
    db.invoice.count({ where: { projectId } }),
    db.warranty.count({ where: { projectId } }),
  ])

  return {
    customerId: project.customerId,
    projectStatus: project.status,
    leads,
    measurements,
    packages,
    boms,
    quotes: quoteRows.length,
    signedQuotes: quoteRows.filter((q) => q.signedAt !== null).length,
    reservations,
    deliveries,
    workOrders: woRows.length,
    completedWorkOrders: woRows.filter((w) => w.status === 'ZAKLJUCEN').length,
    invoices,
    warranties,
  }
}

/** Napredek enega projekta (null, če projekt ne obstaja). */
export async function progressForProject (projectId: string): Promise<ProjectProgress | null> {
  const counts = await countsForProject(projectId)
  if (!counts) return null
  return { projectId, ...stepsFromCounts(counts) }
}

export interface ProjectNextAction {
  id: string; code: string; title: string; status: string
  done: number; total: number; pct: number
  next: NextAction | null
}

/**
 * Naslednji koraki za aktivne projekte (plošča na Preglednici, issue #11 §2).
 * Skupinske poizvedbe (groupBy/findMany z IN) — brez N+1; BOM po projektu se
 * izračuna prek paketov (Prisma groupBy ne podpira polj relacij).
 */
export async function nextActionsForProjects (limit = 12): Promise<ProjectNextAction[]> {
  const projects = await db.project.findMany({
    where: { status: { not: 'ARHIV' } },
    select: { id: true, code: true, title: true, status: true, customerId: true },
    orderBy: { createdAt: 'desc' },
    take: 60,
  })
  if (projects.length === 0) return []

  const ids = projects.map((p) => p.id)
  const customerIds = [...new Set(projects.map((p) => p.customerId).filter((c): c is string => c !== null))]

  const [leadsByCustomer, measRows, packRows, quoteRows, resRows, delRows, woRows, invRows, warRows] = await Promise.all([
    customerIds.length > 0
      ? db.lead.groupBy({ by: ['customerId'], where: { customerId: { in: customerIds } }, _count: { _all: true } })
      : Promise.resolve([] as { customerId: string | null; _count: { _all: number } }[]),
    db.measurement.groupBy({ by: ['projectId'], where: { projectId: { in: ids } }, _count: { _all: true } }),
    db.projectPackage.findMany({ where: { projectId: { in: ids } }, select: { id: true, projectId: true } }),
    db.quote.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, signedAt: true } }),
    db.stockReservation.groupBy({ by: ['projectId'], where: { projectId: { in: ids } }, _count: { _all: true } }),
    db.delivery.groupBy({ by: ['projectId'], where: { projectId: { in: ids } }, _count: { _all: true } }),
    db.workOrder.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, status: true } }),
    db.invoice.groupBy({ by: ['projectId'], where: { projectId: { in: ids } }, _count: { _all: true } }),
    db.warranty.groupBy({ by: ['projectId'], where: { projectId: { in: ids } }, _count: { _all: true } }),
  ])

  const packIds = packRows.map((r) => r.id)
  const bomRows = packIds.length > 0
    ? await db.bom.findMany({ where: { packageId: { in: packIds } }, select: { packageId: true } })
    : []
  const bomPackSet = new Set(bomRows.map((b) => b.packageId))
  const packCountByProject = new Map<string, number>()
  const bomCountByProject = new Map<string, number>()
  for (const r of packRows) {
    packCountByProject.set(r.projectId, (packCountByProject.get(r.projectId) ?? 0) + 1)
    if (bomPackSet.has(r.id)) bomCountByProject.set(r.projectId, (bomCountByProject.get(r.projectId) ?? 0) + 1)
  }

  const leadsMap = new Map(leadsByCustomer.filter((l) => l.customerId).map((l) => [l.customerId as string, l._count._all]))
  const measMap = new Map(measRows.filter((m) => m.projectId).map((m) => [m.projectId as string, m._count._all]))
  const resMap = new Map(resRows.filter((m) => m.projectId).map((m) => [m.projectId as string, m._count._all]))
  const delMap = new Map(delRows.filter((m) => m.projectId).map((m) => [m.projectId as string, m._count._all]))
  const invMap = new Map(invRows.filter((m) => m.projectId).map((m) => [m.projectId as string, m._count._all]))
  const warMap = new Map(warRows.filter((m) => m.projectId).map((m) => [m.projectId as string, m._count._all]))

  const out = projects.map((p) => {
    const quotes = quoteRows.filter((q) => q.projectId === p.id)
    const wos = woRows.filter((w) => w.projectId === p.id)
    const counts: ProgressCounts = {
      customerId: p.customerId,
      projectStatus: p.status,
      leads: p.customerId ? (leadsMap.get(p.customerId) ?? 0) : 0,
      measurements: measMap.get(p.id) ?? 0,
      packages: packCountByProject.get(p.id) ?? 0,
      boms: bomCountByProject.get(p.id) ?? 0,
      quotes: quotes.length,
      signedQuotes: quotes.filter((q) => q.signedAt !== null).length,
      reservations: resMap.get(p.id) ?? 0,
      deliveries: delMap.get(p.id) ?? 0,
      workOrders: wos.length,
      completedWorkOrders: wos.filter((w) => w.status === 'ZAKLJUCEN').length,
      invoices: invMap.get(p.id) ?? 0,
      warranties: warMap.get(p.id) ?? 0,
    }
    const prog = stepsFromCounts(counts)
    return {
      id: p.id, code: p.code, title: p.title, status: p.status,
      done: prog.done, total: prog.total, pct: prog.pct, next: prog.next,
    }
  })

  // projekti z odprtim naslednjim korakom najprej, znotraj tega po manjšem napredku
  return out
    .sort((a, b) => (b.next ? 1 : 0) - (a.next ? 1 : 0) || a.pct - b.pct)
    .slice(0, limit)
}
