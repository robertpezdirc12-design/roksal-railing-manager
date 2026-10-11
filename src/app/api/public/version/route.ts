import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET () {
  return NextResponse.json({ build: process.env.ROKSAL_BUILD ?? process.env.ROKSAL_BUILD_RESOLVED ?? 'neznano' }) // R478: VERCEL_GIT_COMMIT_SHA ob buildu
}
