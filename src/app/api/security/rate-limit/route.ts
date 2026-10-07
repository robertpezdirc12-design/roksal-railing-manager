import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { rateLimitClear, rateLimitList, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from '@/lib/rate-limit'

// /api/security/rate-limit — R437 (route-map izvirnika): pregled/reset tempomata javnih poti
// POST (security.read): { action: 'list' | 'clear', bucket? }
//   list  → stanje: št. bucketov, zadetki v oknu, zadnji dostopi — BREZ vrednosti
//           žetonov (samo prikriti ključi/števci)
//   clear → reset vseh bucketov (brez bucket) ali točnega bucketa (prikrit ključ iz liste)
// Tempomat je skupen za javne poti (portal:, measure:) — lib/rate-limit.ts.
// Revizija SECURITY_RATELIMIT.

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'security.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null) as { action?: unknown; bucket?: unknown } | null
  const action = typeof body?.action === 'string' ? body.action : ''
  const bucket = typeof body?.bucket === 'string' && body.bucket.trim() ? body.bucket.trim() : null

  if (action === 'list') {
    const state = rateLimitList()
    return NextResponse.json({
      data: {
        ...state,
        limits: { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS },
      },
    })
  }

  if (action === 'clear') {
    const cleared = rateLimitClear(bucket ?? undefined)
    await writeAudit({
      userId: user.id,
      action: 'SECURITY_RATELIMIT',
      entity: 'system',
      detail: { operacija: 'clear', scope: bucket ?? 'vsi', pociscenih: cleared },
    })
    return NextResponse.json({ data: { ok: true, cleared, scope: bucket ?? 'vsi' } })
  }

  return jsonError(400, 'Neznana akcija.', "Možnosti: action='list' ali action='clear' (neobvezno bucket).")
}
