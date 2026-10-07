import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// /api/health — JAVNI health check za deploy verifikacijo in rollback mehanizem
// (R441 / issue #3: CI/CD recovery — GitLab → CI → deploy → health check).
//
// Razlika od /api/public/health (route-map izvirnika, ostaja nespremenjena):
// ta endpoint je kanonična nadzorna točka za avtomatizacijo — vrne 503, ko baza
// ne odgovarja (rollback sprožilec), in dodaja verzijo + uptime + latenco.
//
// Namenso BREZ avtentikacije in BREZ občutljivih podatkov.

export const dynamic = 'force-dynamic'

export async function GET () {
  const started = Date.now()
  let dbOk = false
  let dbCheck: string

  try {
    // najcenejša resnična poizvedba v bazo (ne pragma) — dokazuje povezljivost
    const res = await db.$queryRaw`SELECT 1 AS ok`
    dbOk = Array.isArray(res) && res.length === 1
    dbCheck = dbOk ? 'ok' : 'neveljaven odgovor'
  } catch (err) {
    dbCheck = err instanceof Error ? err.message : 'napaka baze'
  }

  const body = {
    status: dbOk ? 'ok' : 'degraded',
    db: { ok: dbOk, check: dbCheck },
    app: { name: 'Roksal Railing Manager', version: '0.2.1' },
    uptimeSec: Math.round(process.uptime()),
    latencyMs: Date.now() - started,
    checkedAt: new Date().toISOString(),
  }

  return NextResponse.json(body, { status: dbOk ? 200 : 503 })
}
