// jobs — R437: izluščen vzdrževalni runner (iz /api/jobs POST)
// Uporabljata ga oba vnosa: POST /api/jobs { job } in POST /api/jobs/run { key } (route-map izvirnika).
// Vsak zagon se zabeleži v JobRun dnevnik + revizija MAINTENANCE_RUN.
// R438 (issue #5): nov job obvestila-retry (retryPending iz src/lib/notify.ts).
// R441 (issue #3): nov job varnostna-kopija (ops/backup.sh — šifrirana + off-site).

import { db } from '@/lib/db'
import { writeAudit } from '@/lib/audit'
import { retryPending } from '@/lib/notify'
import { runBackup } from '@/lib/backup'
import { retryWebhookDeliveries } from '@/lib/webhook-delivery'

export interface JobDef {
  job: string
  label: string
  desc: string
  cron: string
}

/** Opravila po imenih izvirnika (cron jobs). */
export const JOB_DEFS: JobDef[] = [
  { job: 'seje-gc', label: 'Čiščenje sej', desc: 'Izbriše potekle prijavne seje (varnostna higiena).', cron: 'vsak dan 03:00 (izvirnik)' },
  { job: 'portal-gc', label: 'Čiščenje portala', desc: 'Odstrani potekle/preklicane povezave portala strank po 30 dneh.', cron: 'vsak dan 03:30 (jobs/run — R496; izvirnik: viz/gc)' },
  { job: 'obvestila-gc', label: 'Čiščenje obvestil', desc: 'Izbriše prebrana obvestila, starejša od 30 dni.', cron: 'vsak dan 03:10 (izvirnik)' },
  { job: 'obvestila-retry', label: 'Ponovitev obvestil', desc: 'Ponovi neuspešne/čakajoče dostave obvestil (max 3 poskusi, varno pred podvajanjem).', cron: 'vsakih 15 min (issue #5)' },
  { job: 'webhook-retry', label: 'Ponovitev webhookov', desc: 'Ponovi neuspešne webhook dostave partnerjem (backoff 1/5/30 min, mrtvo pismo po 5 poskusih — R481 issue #9 §9).', cron: 'dnevno ob 03:30 (jobs/run) — zamuda dokumentirana v docs/webhooks.md' },
  { job: 'varnostna-kopija', label: 'Varnostna kopija', desc: 'Šifrirana kopija (baza + cel repozitorij) z off-site nalaganjem na GitLab — recovery v docs/RECOVERY.md.', cron: 'ROČNO (ops/backup.sh, issue #3) — ne v cronu: potrebuje tar/openssl in GitLab žeton, kar serverless nima' },
]

export function isKnownJob (key: string): boolean {
  return JOB_DEFS.some((d) => d.job === key)
}

/**
 * Opravila, ki jih zažene Vercel cron (GET /api/jobs/run, vercel.json 03:30 UTC).
 * `varnostna-kopija` NAMENO manjka — kopija teče ročno prek `ops/backup.sh` oziroma
 * POST /api/jobs, ker potrebuje GitLab žeton za off-site nalaganje in zunanje orodje
 * (tar/openssl), kar v serverless funkciji ni zanesljivo na voljo.
 */
export const CRON_JOB_KEYS = ['seje-gc', 'portal-gc', 'obvestila-gc', 'obvestila-retry', 'webhook-retry']

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
    } else if (key === 'webhook-retry') {
      // R481 (issue #9 §9): ponovitev PENDING/FAILED webhook dostav (backoff)
      const res = await retryWebhookDeliveries(50)
      affected = res.processed
      detail = { obdelanih: res.processed, poslanih: res.sent, spodletelih: res.failed, mrtvih: res.dead }
    } else if (key === 'varnostna-kopija') {
      // R441 (issue #3): šifrirana varnostna kopija + off-site nalaganje (ops/backup.sh)
      const res = await runBackup()
      affected = 1
      detail = {
        datoteka: res.file,
        sha256: res.sha256.slice(0, 16) + '…',
        velikost_kb: Math.round(res.bytes / 1024),
        sifrirano: res.encrypted,
        off_site: res.offsite.uploaded,
        ...(res.offsite.chunks ? { kosov_off_site: res.offsite.chunks } : {}),
        ...(res.offsite.note ? { opomba: res.offsite.note } : {}),
        ...(res.manifest ? { tabel: res.manifest.tableCount, vrstic: res.manifest.totalRows } : {}),
        trajanje_s: res.durationSec,
      }
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
