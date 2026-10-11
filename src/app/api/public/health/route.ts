import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET () {
  let dbOk = false
  try {
    await db.$queryRaw`SELECT 1`
    dbOk = true
  } catch {
    dbOk = false
  }
  // R478: build oznaka iz VERCEL_GIT_COMMIT_SHA (razreši se ob buildu v
  // next.config.ts → env ROKSAL_BUILD_RESOLVED); izrecni ROKSAL_BUILD ima
  // prednost (nadomestitev za testiranje).
  const build = process.env.ROKSAL_BUILD_RESOLVED ?? process.env.ROKSAL_BUILD ?? 'neznano'
  return NextResponse.json({ ok: dbOk, db: dbOk ? 'ok' : 'napaka', build, generatedAt: new Date().toISOString() })
}
