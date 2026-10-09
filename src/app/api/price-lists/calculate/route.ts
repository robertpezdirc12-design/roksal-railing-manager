import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { calcKonfigCena } from '@/lib/product-core'

// POST /api/price-lists/calculate — R464 (issue #1 P0 §1): ocena cene konfiguracije
// ograje (viz/3D konfigurator). Suhi zagon — brez pisanja v bazo; VSE poslovne
// cene razreši pricing core (PriceRule KONFIG:* pravila + Profile.pricePerM).
// Telo: { tip: OGRAJA|BALUSTRADA|NAGIB, lengthCm, heightCm, posts, handrail?,
//         montaza?, profileId?, colorLabel? }
export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'catalog.read')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const tip = body?.tip
  if (tip !== 'OGRAJA' && tip !== 'BALUSTRADA' && tip !== 'NAGIB') {
    return jsonError(400, 'tip mora biti OGRAJA, BALUSTRADA ali NAGIB.')
  }
  const lengthCm = typeof body?.lengthCm === 'number' ? body.lengthCm : NaN
  const heightCm = typeof body?.heightCm === 'number' ? body.heightCm : NaN
  const postsRaw = typeof body?.posts === 'number' ? body.posts : NaN
  if (!Number.isFinite(lengthCm) || lengthCm < 20 || lengthCm > 6000) {
    return jsonError(400, 'lengthCm mora biti med 20 in 6000 cm.')
  }
  if (!Number.isFinite(heightCm) || heightCm < 20 || heightCm > 400) {
    return jsonError(400, 'heightCm mora biti med 20 in 400 cm.')
  }
  if (!Number.isFinite(postsRaw) || postsRaw < 1 || postsRaw > 40) {
    return jsonError(400, 'posts mora biti med 1 in 40.')
  }
  const posts = Math.round(postsRaw)
  const handrail = typeof body?.handrail === 'boolean' ? body.handrail : true
  const montaza = typeof body?.montaza === 'boolean' ? body.montaza : false
  const profileId = typeof body?.profileId === 'string' && body.profileId ? body.profileId : null
  const colorLabel = typeof body?.colorLabel === 'string' ? body.colorLabel : undefined

  if (profileId) {
    const profile = await db.profile.findUnique({ where: { id: profileId } })
    if (!profile) return jsonError(404, 'Profil ne obstaja.')
  }

  const rezultat = await calcKonfigCena({
    tip, lengthCm, heightCm, posts, handrail, montaza, profileId, colorLabel,
  })
  return NextResponse.json({ data: rezultat })
}
