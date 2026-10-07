import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { JOB_DEFS, runJob } from '@/lib/jobs'

// /api/jobs — vzdrževalna opravila (route-map izvirnika: cron /api/jobs/run, viz/gc)
// GET  (security.read): definicije opravil + zadnji zagon vsakega + dnevnik zadnjih zagonov
// POST (security.read): { job } → takojšnji zagon (runner v src/lib/jobs.ts, R437 izluščen)
//    + dnevnik JobRun + revizija MAINTENANCE_RUN.

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'security.read')
  if (auth instanceof NextResponse) return auth

  const runs = await db.jobRun.findMany({ orderBy: { startedAt: 'desc' }, take: 30, include: { user: { select: { name: true } } } })
  const lastByJob = new Map<string, (typeof runs)[number]>()
  for (const r of runs) if (!lastByJob.has(r.job)) lastByJob.set(r.job, r)

  const definitions = JOB_DEFS.map((d) => ({ ...d, last: lastByJob.get(d.job) ?? null }))

  return NextResponse.json({ data: { definitions, runs: runs.slice(0, 12) } })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'security.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null) as { job?: string } | null
  const job = typeof body?.job === 'string' ? body.job : ''
  if (!job) return jsonError(400, 'Manjka ime opravila.', `Možnosti: ${JOB_DEFS.map((d) => d.job).join(', ')}.`)

  try {
    const result = await runJob(job, user.id)
    if (!result) {
      return jsonError(400, 'Neznano opravilo.', `Možnosti: ${JOB_DEFS.map((d) => d.job).join(', ')}.`)
    }
    return NextResponse.json({ data: { job: result.job, affected: result.affected, durationMs: result.durationMs } })
  } catch (err) {
    return jsonError(500, 'Opravilo je spodletelo.', err instanceof Error ? err.message : undefined)
  }
}
