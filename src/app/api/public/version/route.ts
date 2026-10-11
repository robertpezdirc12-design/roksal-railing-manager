import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET () {
  return NextResponse.json({ build: process.env.ROKSAL_BUILD_RESOLVED ?? process.env.ROKSAL_BUILD ?? 'neznano' }) // R478: VERCEL_GIT_COMMIT_SHA ob buildu
}
