// /api/playbook/runs — R458 (issue #13)
// GET  — zagoni playbookov; ?workOrderId=… za nalog (monter: SAMO svoji nalogi)
//        brez workOrderId: svoji zadnji zagoni (mobile MOJ DAN §12)
// POST — začni zagon { workOrderId, key } (nalog.write) — idempotentno:
//        obstoječi V_TEKU zagon istega playbooka se vrne brez podvajanja.

import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission, readsAllData } from '@/lib/auth'
import { db } from '@/lib/db'
import { ensurePlaybookSeed, zagoniZaNalog, zacniZagon, type RunOverviewRow } from '@/lib/playbook-engine'
import { deserializiraj, napredek, type KorakStanje } from '@/lib/playbook-core'

interface RunPovzetek {
  id: string
  key: string
  version: number
  naziv: string
  status: string
  startedAt: string
  completedAt: string | null
  workOrderId?: string | null
  napredek: { trenutni: number; skupaj: number; koncanih: number; izjem: number; odstotek: number } | null
}

function povzetek (run: RunOverviewRow): RunPovzetek {
  const def = deserializiraj(run.playbookDef.definition)
  let odgovori: Record<string, boolean | string> = {}
  try { odgovori = run.context ? (JSON.parse(run.context) as { odgovori?: Record<string, boolean | string> }).odgovori ?? {} : {} } catch { /* prazno */ }
  const stanja: KorakStanje[] = run.steps.map((s) => ({
    stepId: s.stepId, status: s.status as KorakStanje['status'], attempts: s.attempts,
  }))
  return {
    id: run.id,
    key: run.playbookKey,
    version: run.playbookVersion,
    naziv: def?.naziv ?? run.playbookKey,
    status: run.status,
    workOrderId: run.workOrderId,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    napredek: def ? napredek({ ...def, version: run.playbookVersion }, stanja, odgovori) : null,
  }
}

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'nalog.read')
  if (auth instanceof NextResponse) return auth
  const url = new URL(req.url)
  const workOrderId = url.searchParams.get('workOrderId')
  await ensurePlaybookSeed()

  if (workOrderId) {
    const rez = await zagoniZaNalog(auth.user, workOrderId)
    if (!rez.ok) return jsonError(rez.status, rez.napaka)
    return NextResponse.json({ data: rez.runs.map(povzetek) })
  }

  // brez workOrderId: zadnjih 20 zagonov uporabnika (pisarna: vseh zadnjih 50)
  const runs = await db.playbookRun.findMany({
    where: readsAllData(auth.user) ? {} : { userId: auth.user.id },
    orderBy: { startedAt: 'desc' },
    take: readsAllData(auth.user) ? 50 : 20,
    include: { steps: true, playbookDef: true },
  })
  return NextResponse.json({ data: (runs as unknown as RunOverviewRow[]).map(povzetek) })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  let body: unknown
  try { body = await req.json() } catch { return jsonError(400, 'Neveljaven JSON.') }
  const o = body as { workOrderId?: unknown; key?: unknown }
  if (typeof o.workOrderId !== 'string' || !o.workOrderId.trim()) return jsonError(400, 'Manjka workOrderId.')
  if (typeof o.key !== 'string' || !o.key.trim()) return jsonError(400, 'Manjka ključ playbooka (npr. OGRAJA).')
  const rez = await zacniZagon(auth.user, { workOrderId: o.workOrderId.trim(), key: o.key.trim() })
  if (!rez.ok) return jsonError(rez.status, rez.napaka)
  return NextResponse.json({ data: { runId: rez.runId, nov: rez.nov } }, { status: rez.nov ? 201 : 200 })
}
