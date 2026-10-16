import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { ROLE_PERMISSIONS } from '@/lib/permissions-core'

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'users.read')
  if (auth instanceof NextResponse) return auth
  const users = await db.user.findMany({
    select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ data: users })
}

// aktivacija/deaktivacija + sprememba vloge (users.write)
export async function PATCH (req: NextRequest) {
  const auth = await requirePermission(req, 'users.write')
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return jsonError(400, 'Manjka id uporabnika.')

  const target = await db.user.findUnique({ where: { id } })
  if (!target) return jsonError(404, 'Uporabnik ne obstaja.')

  const patch: { active?: boolean; role?: string; passwordHash?: string } = {}
  if (typeof body.active === 'boolean') patch.active = body.active
  if (typeof body.role === 'string') {
    if (!(body.role in ROLE_PERMISSIONS)) return jsonError(400, 'Neznana vloga.', 'Veljavne vloge: ADMIN, VODJA, MONTER, SKLADISCE, PROIZVODNJA.')
    patch.role = body.role
  }
  if (typeof body.password === 'string' && body.password.length >= 8) {
    // R536: hashPassword asinhrona (scrypt v2, N=2^17)
    patch.passwordHash = await hashPassword(body.password)
  }
  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.')

  // R537 (transakcijska celovitost): sprememba uporabnika + revizija v ENI
  // transakciji (občutljiva mutacija — vloga/deaktivacija ne sme ostati brez sledi).
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data: patch,
      select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
    })
    await writeAudit({
      userId: auth.user.id,
      action: patch.role ? 'USER_ROLE_CHANGE' : patch.active === false ? 'USER_DEACTIVATE' : 'USER_ACTIVATE',
      entity: 'user',
      entityId: id,
      detail: { from: { role: target.role, active: target.active }, to: { role: updated.role, active: updated.active } },
    }, tx)
    return updated
  })
  return NextResponse.json({ data: updated })
}
