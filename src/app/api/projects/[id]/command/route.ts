import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'

// /api/projects/[id]/command — R437 (route-map izvirnika): "Ukaz" za projekt
// Konsolidirani podatki za izdelavo dokumenta (delovni ukaz / izvedbeni list):
//   project     — koda, naslov, status, naslov objekta + kontakti stranke
//   measurements — meritve (tip, lokacija, mere, nagib) + skupna dolžina
//   workOrders   — nalogi (koda, naslov, status, izvajalec, termin, prioriteta)
//   quotes       — ponudbe (zadnja SPREJET/ZAKLENJEN prva)
//   production   — proizvodni nalogi
//   timeline     — ključni datumi: prva meritev, podpis ponudbe, zadnji dogodek naloga
// Vrata: projects.read; MONTER obseg — samo projekti svojih nalogov (enak vzorec kot [id]).

type Params = { params: Promise<{ id: string }> }

/** Obseg (issue #1): monter dostopa samo do projektov svojih nalogov. */
async function projectInScope (userId: string, id: string): Promise<'missing' | boolean> {
  const p = await db.project.findUnique({
    where: { id },
    select: { id: true, workOrders: { select: { assigneeId: true } } },
  })
  if (!p) return 'missing'
  return p.workOrders.some((w) => w.assigneeId === userId)
}

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  if (!readsAllData(user)) {
    const inScope = await projectInScope(user.id, id)
    if (inScope === 'missing') return jsonError(404, 'Projekt ne obstaja.')
    if (!inScope) return jsonError(403, 'Projekt ni v vašem obsegu.', 'Monter vidi samo projekte svojih nalogov.')
  }

  const project = await db.project.findUnique({
    where: { id },
    select: {
      code: true, title: true, status: true, address: true, createdAt: true,
      customer: { select: { name: true, phone: true, email: true, address: true } },
      measurements: {
        select: { type: true, location: true, lengthCm: true, heightCm: true, posts: true, slopeDeg: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
      workOrders: {
        select: {
          code: true, title: true, status: true, scheduledFor: true,
          assignee: { select: { name: true } },
          events: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { scheduledFor: 'asc' },
      },
      quotes: {
        select: { code: true, status: true, total: true, signedAt: true },
        orderBy: { createdAt: 'desc' },
      },
      productionOrders: { select: { code: true, status: true }, orderBy: { createdAt: 'asc' } },
    },
  })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')

  // zadnja sprejeta/zaklenjena ponudba na vrh (za dokument je odločilna podpisana)
  const quoteRank = (s: string) => (s === 'SPREJET' || s === 'ZAKLENJEN' ? 0 : 1)
  const quotes = [...project.quotes].sort((a, b) => quoteRank(a.status) - quoteRank(b.status))

  // skupna dolžina meritev (cm, samo izpolnjene)
  const skupnaDolzinaCm = project.measurements.reduce((s, m) => s + (m.lengthCm ?? 0), 0)

  // ključni datumi za ukaz
  const prvaMeritev = project.measurements[0]?.createdAt.toISOString() ?? null
  const podpisPonudbe = project.quotes
    .map((q) => q.signedAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() ?? null
  const zadnjiDogodekNaloga = project.workOrders
    .flatMap((w) => w.events)
    .map((e) => e.createdAt)
    .sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() ?? null

  return NextResponse.json({
    data: {
      project: {
        code: project.code,
        title: project.title,
        status: project.status,
        address: project.address,
        customer: project.customer
          ? { name: project.customer.name, phone: project.customer.phone, email: project.customer.email, address: project.customer.address }
          : null,
      },
      measurements: project.measurements.map((m) => ({
        type: m.type,
        location: m.location,
        lengthCm: m.lengthCm,
        heightCm: m.heightCm,
        posts: m.posts,
        slopeDeg: m.slopeDeg,
        createdAt: m.createdAt.toISOString(),
      })),
      skupnaDolzinaCm: Math.round(skupnaDolzinaCm * 100) / 100,
      workOrders: project.workOrders.map((w) => ({
        code: w.code,
        title: w.title,
        status: w.status,
        assignee: w.assignee?.name ?? null,
        termin: w.scheduledFor?.toISOString() ?? null,
        priority: null, // OPOMBA: shema rekonstrukcije ne pozna prioritete nalogov (route-map izvirnika jo ima)
      })),
      quotes: quotes.map((q) => ({
        code: q.code,
        status: q.status,
        total: q.total,
        signedAt: q.signedAt?.toISOString() ?? null,
      })),
      production: project.productionOrders,
      timeline: {
        prvaMeritev,
        podpisPonudbe,
        zadnjiDogodekNaloga,
      },
    },
  })
}
