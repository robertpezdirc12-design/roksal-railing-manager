import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { CRON_JOB_KEYS, JOB_DEFS, runJob } from '@/lib/jobs'
import { isCronRequest } from '@/lib/cron'

// /api/jobs/run — R437 (route-map izvirnika: POST /api/jobs/run { key })
// Takojšnji zagon vzdrževalnega opravila (security.read). Runner je skupen v src/lib/jobs.ts
// (enak kot POST /api/jobs) — vsak zagon se zabeleži v JobRun + revizijo MAINTENANCE_RUN.
//
// R496: GET je vstopna točka Vercel crona (vercel.json → GET /api/jobs/run). Vercel cron
// vedno pošlje GET brez seje, zato ga avtentificira CRON_SECRET v glavi Authorization.
// Brez nastavljene spremenljivke GET vrne 401 — cron je eksplicitno onemogočen, ne odprt.

export const dynamic = 'force-dynamic'

interface JobOutcome {
  job: string
  ok: boolean
  affected?: number
  durationMs?: number
  error?: string
}

async function runOne (key: string, userId: string | null): Promise<JobOutcome> {
  try {
    const result = await runJob(key, userId)
    if (!result) return { job: key, ok: false, error: 'neznano opravilo' }
    return { job: key, ok: true, affected: result.affected, durationMs: result.durationMs }
  } catch (err) {
    return { job: key, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function GET (req: NextRequest) {
  if (!isCronRequest(req)) {
    return jsonError(401, 'Cron pooblastilo ni veljavno.', 'Maka CRON_SECRET in glava Authorization: Bearer <secret>.')
  }
  const results: JobOutcome[] = []
  for (const key of CRON_JOB_KEYS) results.push(await runOne(key, null))
  const failed = results.filter((r) => !r.ok)
  // 500 samo, kadar je katero od opravil spodletelo — JobRun dnevnik ima podrobnosti.
  const status = failed.length > 0 ? 500 : 200
  return NextResponse.json({ data: { ran: results.length, ok: failed.length === 0, results } }, { status })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'security.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null) as { key?: string } | null
  const key = typeof body?.key === 'string' ? body.key : ''
  if (!key) return jsonError(400, 'Manjka ključ opravila.', `Možnosti: ${JOB_DEFS.map((d) => d.job).join(', ')}.`)

  try {
    const result = await runJob(key, user.id)
    if (!result) {
      return jsonError(400, 'Neznano opravilo.', `Možnosti: ${JOB_DEFS.map((d) => d.job).join(', ')}.`)
    }
    return NextResponse.json({ data: { job: result.job, affected: result.affected, durationMs: result.durationMs } })
  } catch (err) {
    return jsonError(500, 'Opravilo je spodletelo.', err instanceof Error ? err.message : undefined)
  }
}
