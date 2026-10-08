import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { nextActionsForProjects } from '@/lib/project-progress'

// /api/projects/next-actions — R456 (issue #11 §2 COCKPIT / NEXT BEST ACTION).
// GET ?limit=12 (projects.read) → naslednji korak za aktivne (nearhivirane)
// projekte: { id, code, title, status, done, total, pct, next { label,
// targetTab, reason } | null }. Plošča »Naslednji koraki« na Preglednici —
// direktor/vodja takoj vidi, kje posel čaka in z enim klikom skoči na pravi
// modul. Skupinske poizvedbe (brez N+1). Staticna pot ima prednost pred
// [id] v Next.js App Routerju.

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams
  const limitRaw = Number(sp.get('limit') ?? '12')
  const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, Math.round(limitRaw))) : 12

  const rows = await nextActionsForProjects(limit)
  return NextResponse.json({ data: rows })
}
