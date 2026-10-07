import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// /api/public/portal — JAVNI pogled portala stranke (route-map izvirnika: /p/[token])
// Brez avtentikacije — dostop ureja neuraden žeton povezave (veljaven, ne preklican).
// Payload je namerno VARNI podskupina: brez zneskov, internih opomb, dodelitev in revizije.
// Šteje ogled (views, lastViewedAt) + osnovni tempomat na žeton (60 zahtev/min).

export const dynamic = 'force-dynamic'

const STATUS_PUBLIC: Record<string, string> = {
  NACRT: 'V pripravi',
  AKTIVNI: 'V teku',
  TEREN: 'Montaža na terenu',
  ZAKLJUCEN: 'Zaključen',
  ARHIV: 'Zaključen (arhiv)',
}

const COMPANY = {
  name: 'Roksal d.o.o.',
  phone: '+386 3 548 22 00',
  email: 'info@roksal.si',
  web: 'www.roksal.si',
}

// tempomat: max 60 zahtev na žeton/minuto (lokalni pomnilnik)
const hits = new Map<string, number[]>()
function throttled (key: string): boolean {
  const now = Date.now()
  const window = (hits.get(key) ?? []).filter((t) => now - t < 60_000)
  if (window.length >= 60) { hits.set(key, window); return true }
  window.push(now)
  hits.set(key, window)
  if (hits.size > 500) hits.clear() // preprosto čiščenje
  return false
}

export async function GET (req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!token || token.length < 8 || token.length > 80) {
    return NextResponse.json({ error: 'Neveljavna povezava.' }, { status: 404 })
  }
  if (throttled(token)) {
    return NextResponse.json({ error: 'Preveč zahtev — poskusite kasneje.' }, { status: 429 })
  }

  const link = await db.portalLink.findUnique({
    where: { token },
    include: {
      project: {
        select: {
          code: true, title: true, status: true, address: true, createdAt: true,
          customer: { select: { name: true } },
          quotes: { select: { code: true, signedAt: true, signedBy: true }, where: { signedAt: { not: null } }, orderBy: { signedAt: 'asc' } },
          workOrders: { select: { code: true, startedAt: true, completedAt: true }, orderBy: { createdAt: 'asc' } },
          measurements: { select: { type: true, location: true, params: true, createdAt: true }, where: { type: 'FOTO' }, orderBy: { createdAt: 'desc' }, take: 6 },
          warranties: { select: { startsAt: true, months: true, status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
      },
    },
  })
  if (!link || link.revokedAt || link.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Povezava ne velja več (preklicana ali potekla).' }, { status: 404 })
  }

  // štetje ogleda
  await db.portalLink.update({
    where: { id: link.id },
    data: { views: { increment: 1 }, lastViewedAt: new Date() },
  })

  const p = link.project
  const addMonths = (d: Date, m: number) => { const r = new Date(d); r.setMonth(r.getMonth() + m); return r }

  // javna časovnica — samo zunanje relevantni mejniki (brez zneskov in intern)
  const timeline: { at: string; type: string; label: string }[] = [
    { at: p.createdAt.toISOString(), type: 'ODPERTJE', label: 'Projekt odprt' },
  ]
  for (const q of p.quotes) {
    if (q.signedAt) timeline.push({ at: q.signedAt.toISOString(), type: 'PODPIS', label: 'Pogodba/ponudba podpisana' })
  }
  for (const w of p.workOrders) {
    if (w.startedAt) timeline.push({ at: w.startedAt.toISOString(), type: 'MONTAZA', label: 'Montaža začeta' })
    if (w.completedAt) timeline.push({ at: w.completedAt.toISOString(), type: 'ZAKLJUCEK', label: 'Montaža zaključena' })
  }
  timeline.sort((a, b) => a.at.localeCompare(b.at))

  const w = p.warranties[0] ?? null
  const warranty = w
    ? {
        endsAt: addMonths(w.startsAt, w.months).toISOString(),
        valid: w.status === 'AKTIVNA' && addMonths(w.startsAt, w.months) >= new Date(),
      }
    : null

  const photos = p.measurements
    .map((m) => {
      try {
        const params = m.params ? (JSON.parse(m.params) as { photo?: string }) : {}
        return { location: m.location ?? 'Zaključeno delo', photo: params.photo ?? null, at: m.createdAt.toISOString() }
      } catch { return null }
    })
    .filter((x): x is { location: string; photo: string | null; at: string } => x !== null && !!x.photo)

  return NextResponse.json({
    data: {
      project: {
        code: p.code,
        title: p.title,
        status: p.status,
        statusLabel: STATUS_PUBLIC[p.status] ?? p.status,
        address: p.address,
      },
      customer: { name: p.customer?.name ?? null },
      timeline,
      warranty,
      photos,
      company: COMPANY,
      link: { expiresAt: link.expiresAt.toISOString() },
    },
  })
}
