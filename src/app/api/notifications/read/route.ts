import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, jsonError } from '@/lib/auth'

// /api/notifications/read — R437 (route-map izvirnika: POST /api/notifications/read)
// Označi lastna obvestila za prebrana. Body { ids?: string[] }:
//   - prazno/manjkajoče → VSE lastne (+ globalne z userId null)
//   - ids → samo teh n obvestil (izključno lastna/globalne — tujih ni mogoče prebrati)
// Vrne { updated: n } (št. dejansko spremenjenih).

export async function POST (req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'Ni prijave.')

  const body = await req.json().catch(() => null) as { ids?: unknown } | null
  const ids = Array.isArray(body?.ids)
    ? body!.ids.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : null

  // lastni + globalni obseg (enak kot GET /api/notifications)
  const scope = { OR: [{ userId: user.id }, { userId: null }] }

  const res = await db.notification.updateMany({
    where: {
      ...scope,
      ...(ids ? { id: { in: ids } } : {}),
      read: false, // štejemo samo dejanske spremembe
    },
    data: { read: true },
  })

  return NextResponse.json({ updated: res.count })
}
