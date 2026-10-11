import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/auth'

// /api/version — informacije o različici (route-map: GET /api/version)
// Avtenticirana različica; javna je na /api/public/version.

export const dynamic = 'force-dynamic'

export async function GET (req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'Ni prijave.')
  return NextResponse.json({
    data: {
      app: 'Roksal Railing Manager',
      build: process.env.ROKSAL_BUILD_RESOLVED ?? process.env.ROKSAL_BUILD ?? 'neznano', // R478: VERCEL_GIT_COMMIT_SHA ob buildu
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? 'main',
      user: user.email,
    },
  })
}
