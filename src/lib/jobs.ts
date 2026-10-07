// jobs — R437: izluščen vzdrževalni runner (iz /api/jobs POST)
// Uporabljata ga oba vnosa: POST /api/jobs { job } in POST /api/jobs/run { key } (route-map izvirnika).
// Vsak zagon se zabeleži v JobRun dnevnik + revizija MAINTENANCE_RUN.
// R438 (issue #5): nov job obvestila-retry (retryPending iz src/lib/notify.ts).

import { db } from '@/lib/db'
import { writeAudit } from '@/lib/audit'
import { retryPending } from '@/lib/notify'

export interface JobDef {
  job: string
  label: string
  desc: string
  cron: string
}

/** Opravila po imenih izvirnika (cron jobs). */
export const JOB_DEFS: JobDef[] = [
  { job: 'seje-gc', label: 'Čiščenje sej', desc: 'Izbriše potekle prijavne seje (varnostna higiena).', cron: 'vsak dan 03:00 (izvirnik)' },
  { job: 'portal-gc', label: 'Čiščenje portala', desc: 'Odstrani potekle/preklicane povezave portala strank po 30 dneh.', cron: 'vsak teden (izvirnik: viz/gc)' },
  { job: 'obvestila-gc', label: 'Čiščenje obvestil', desc: 'Izbriše prebrana obvestila, starejša od 30 dni.', cron: 'vsak dan 03:10 (izvirnik)' },
  { job: 'obvestila-retry', label: 'Ponovitev obvestil', desc: 'Ponovi neuspešne/čakajoče dostave obvestil (max 3 poskusi, varno pred podvajanjem).', cron: 'vsakih 15 min (issue #5)' },
]

export function isKnownJob (key: string): boolean {
  return JOB_DEFS.some((d) => d.job === key)
}

export interface RunJobResult {
  job: string
  affected: number
  durationMs: number
  runId: string
}

/**
 * Zažene vzdrževalno opravilo in zapiše dnevnik + revizijo.
 * @returns null, če ključ ni znan; ob napaki zabeleži neuspešen zagon in vrže napako.
 */
export async function runJob (key: string, userId: string | null): Promise<RunJobResult | null> {
  if (!isKnownJob(key)) return null

  const startedAt = new Date()
  let affected = 0
  let detail: Record<string, unknown> = {}
  try {
    const cutoff30 = new Date(Date.now() - 30 * 86400000)
    if (key === 'seje-gc') {
      const res = await db.session.deleteMany({ where: { expiresAt: { lt: startedAt } } })
      affected = res.count
      detail = { izbrisanih_sej: affected }
    } else if (key === 'portal-gc') {
      const res = await db.portalLink.deleteMany({
        where: { createdAt: { lt: cutoff30 }, OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: startedAt } }] },
      })
      affected = res.count
      detail = { odstranjenih_povezav: affected }
    } else if (key === 'obvestila-retry') {
      // R438 (issue #5): ponovitev PENDING/FAILED dostav (attempts < 3)
      const res = await retryPending(50)
      affected = res.processed
      detail = { obdelanih: res.processed, poslanih: res.sent, spodletelih: res.failed }
    } else {
      const res = await db.notification.deleteMany({ where: { read: true, createdAt: { lt: cutoff30 } } })
      affected = res.count
      detail = { izbrisanih_obvestil: affected }
    }
  } catch (err) {
    const run = await db.jobRun.create({
      data: {
        job: key, ok: false, affected: 0, detail: JSON.stringify({ napaka: err instanceof Error ? err.message : String(err) }),
        startedAt, finishedAt: new Date(), userId,
      },
    })
    await writeAudit({ userId, action: 'MAINTENANCE_RUN', entity: 'jobRun', entityId: run.id, detail: { job: key, ok: false } })
    throw err instanceof Error ? err : new Error(String(err))
  }

  const run = await db.jobRun.create({
    data: { job: key, ok: true, affected, detail: JSON.stringify(detail), startedAt, finishedAt: new Date(), userId },
  })
  await writeAudit({
    userId, action: 'MAINTENANCE_RUN', entity: 'jobRun', entityId: run.id,
    detail: { job: key, affected },
  })

  return { job: key, affected, durationMs: run.finishedAt.getTime() - startedAt.getTime(), runId: run.id }
}
