import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// /api/jobs — vzdrževalna opravila (route-map izvirnika: cron /api/jobs/run, viz/gc)
// GET  (security.read): definicije opravil + zadnji zagon vsakega
// POST (security.read): { job } → takojšnji zagon; dnevnik JobRun + revizija MAINTENANCE_RUN
// Opravila (po imenih izvirnika):
//   seje-gc       — izbriši potekle seje (izvirnik: jobs/run seje)
//   portal-gc     — počisti potekle/preklicane povezave portala, starejše od 30 dni
//   obvestila-gc  — izbriši prebrana obvestila, starejša od 30 dni

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'security.read')
  if (auth instanceof NextResponse) return auth

  const runs = await db.jobRun.findMany({ orderBy: { startedAt: 'desc' }, take: 30, include: { user: { select: { name: true } } } })
  const lastByJob = new Map<string, (typeof runs)[number]>()
  for (const r of runs) if (!lastByJob.has(r.job)) lastByJob.set(r.job, r)

  const definitions = [
    { job: 'seje-gc', label: 'Čiščenje sej', desc: 'Izbriše potekle prijavne seje (varnostna higiena).', cron: 'vsak dan 03:00 (izvirnik)' },
    { job: 'portal-gc', label: 'Čiščenje portala', desc: 'Odstrani potekle/preklicane povezave portala strank po 30 dneh.', cron: 'vsak teden (izvirnik: viz/gc)' },
    { job: 'obvestila-gc', label: 'Čiščenje obvestil', desc: 'Izbriše prebrana obvestila, starejša od 30 dni.', cron: 'vsak dan 03:10 (izvirnik)' },
  ].map((d) => ({ ...d, last: lastByJob.get(d.job) ?? null }))

  return NextResponse.json({ data: { definitions, runs: runs.slice(0, 12) } })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'security.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null) as { job?: string } | null
  const job = typeof body?.job === 'string' ? body.job : ''
  if (!['seje-gc', 'portal-gc', 'obvestila-gc'].includes(job)) {
    return jsonError(400, 'Neznano opravilo.', 'Možnosti: seje-gc, portal-gc, obvestila-gc.')
  }

  const startedAt = new Date()
  let affected = 0
  let detail: Record<string, unknown> = {}
  try {
    const cutoff30 = new Date(Date.now() - 30 * 86400000)
    if (job === 'seje-gc') {
      const res = await db.session.deleteMany({ where: { expiresAt: { lt: startedAt } } })
      affected = res.count
      detail = { izbrisanih_sej: affected }
    } else if (job === 'portal-gc') {
      const res = await db.portalLink.deleteMany({
        where: { createdAt: { lt: cutoff30 }, OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: startedAt } }] },
      })
      affected = res.count
      detail = { odstranjenih_povezav: affected }
    } else {
      const res = await db.notification.deleteMany({ where: { read: true, createdAt: { lt: cutoff30 } } })
      affected = res.count
      detail = { izbrisanih_obvestil: affected }
    }
  } catch (err) {
    const run = await db.jobRun.create({
      data: {
        job, ok: false, affected: 0, detail: JSON.stringify({ napaka: err instanceof Error ? err.message : String(err) }),
        startedAt, finishedAt: new Date(), userId: user.id,
      },
    })
    await writeAudit({ userId: user.id, action: 'MAINTENANCE_RUN', entity: 'jobRun', entityId: run.id, detail: JSON.stringify({ job, ok: false }) })
    return jsonError(500, 'Opravilo je spodletelo.', err instanceof Error ? err.message : undefined)
  }

  const run = await db.jobRun.create({
    data: { job, ok: true, affected, detail: JSON.stringify(detail), startedAt, finishedAt: new Date(), userId: user.id },
  })
  await writeAudit({
    userId: user.id, action: 'MAINTENANCE_RUN', entity: 'jobRun', entityId: run.id,
    detail: JSON.stringify({ job, affected }),
  })

  return NextResponse.json({ data: { job, affected, durationMs: run.finishedAt.getTime() - startedAt.getTime() } })
}
