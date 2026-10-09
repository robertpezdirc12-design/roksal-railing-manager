// API /api/equipment — orodjarina: seznam z imetnikom + odprto izposojo, iskanje ?q=
// POST novo orodje — SAMO ADMIN/VODJA (katalog 38 pravic se ne razširja; vrata equipment.read
// po sporocumu 6-prep, vloga pa se dodatno preveri — samopostrežna izposoja ostaja MONTER/PROIZVODNJA).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

const CATEGORIES = ['MERITEV', 'MONTAZA', 'PREVERITEV', 'VZDRZEVANJE']

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'equipment.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const q = url.searchParams.get('q')

  const equipment = await db.equipment.findMany({
    where: q ? {
      OR: [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { serialNumber: { contains: q, mode: 'insensitive' } },
        { location: { contains: q, mode: 'insensitive' } },
      ],
    } : {},
    include: {
      holder: { select: { id: true, name: true } },
      // zadnja (odprta) izposoja — inAt = null pomeni "še izposojeno"
      checkouts: { where: { inAt: null }, include: { user: { select: { id: true, name: true } } } },
    },
    orderBy: { code: 'asc' },
  })
  return NextResponse.json({ data: equipment })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'equipment.read')
  if (auth instanceof NextResponse) return auth

  // administrativno vrata: samo ADMIN/VODJA (6-prep sporazum)
  if (auth.user.role !== 'ADMIN' && auth.user.role !== 'VODJA') {
    return jsonError(403, 'Upravljanje orodjarine je rezervirano za vodjo ali administratorja.', 'Nova orodja vpisujejo samo vloge ADMIN/VODJA.')
  }

  const body = await req.json().catch(() => null)
  const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : ''
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!code) return jsonError(400, 'Koda orodja je obvezna.')
  if (!name) return jsonError(400, 'Ime orodja je obvezno.')

  const category = typeof body?.category === 'string' && body.category ? body.category : 'MERITEV'
  if (!CATEGORIES.includes(category)) {
    return jsonError(400, 'Neveljavna kategorija.', `Dovoljene: ${CATEGORIES.join(', ')}.`)
  }

  const existing = await db.equipment.findUnique({ where: { code } })
  if (existing) {
    return jsonError(409, `Orodje s kodo ${code} že obstaja.`, 'Koda mora biti enolična.')
  }

  let calibrationDue: Date | null = null
  if (typeof body?.calibrationDue === 'string' && body.calibrationDue) {
    calibrationDue = new Date(body.calibrationDue)
    if (Number.isNaN(calibrationDue.getTime())) return jsonError(400, 'Rok umeritve ni veljaven datum.')
  }

  const equipment = await db.equipment.create({
    data: {
      code,
      name,
      category,
      serialNumber: typeof body?.serialNumber === 'string' && body.serialNumber.trim() ? body.serialNumber.trim() : null,
      location: typeof body?.location === 'string' && body.location.trim() ? body.location.trim() : null,
      calibrationDue,
      note: typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null,
    },
    include: {
      holder: { select: { id: true, name: true } },
      checkouts: { where: { inAt: null }, include: { user: { select: { id: true, name: true } } } },
    },
  })

  await writeAudit({
    userId: auth.user.id, action: 'EQUIP_CREATE', entity: 'equipment', entityId: equipment.id,
    detail: { code, name, category, calibrationDue },
  })
  return NextResponse.json({ data: equipment }, { status: 201 })
}
