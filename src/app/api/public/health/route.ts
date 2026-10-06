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
  return NextResponse.json({ ok: dbOk, db: dbOk ? 'ok' : 'napaka', build: process.env.ROKSAL_BUILD ?? 'rekonstrukcija-R431', generatedAt: new Date().toISOString() })
}
