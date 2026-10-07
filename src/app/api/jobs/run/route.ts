import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { JOB_DEFS, runJob } from '@/lib/jobs'

// /api/jobs/run — R437 (route-map izvirnika: POST /api/jobs/run { key })
// Takojšnji zagon vzdrževalnega opravila (security.read). Runner je skupen v src/lib/jobs.ts
// (enak kot POST /api/jobs) — vsak zagon se zabeleži v JobRun + revizijo MAINTENANCE_RUN.

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
