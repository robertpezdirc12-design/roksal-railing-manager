// auth — REKONSTRUKCIJA R431
// Seje: Authorization: Bearer <token> (CSRF-varen dizajn, kot original).
// Uporaba v API rutah:
//   const auth = await requirePermission(req, 'projects.read')
//   if (auth instanceof NextResponse) return auth
//   // auth.user, auth.perms

import { randomUUID, scryptSync, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { permissionsForRole, type Permission } from '@/lib/permissions-core'

const SESSION_DAYS = 7

export function hashPassword (password: string): string {
  const salt = randomUUID().replace(/-/g, '')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword (password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const test = scryptSync(password, salt, 64)
  const orig = Buffer.from(hash, 'hex')
  return test.length === orig.length && timingSafeEqual(test, orig)
}

export interface SessionUser {
  id: string
  email: string
  name: string
  role: string
  perms: string[]
}

export function toSessionUser (u: { id: string; email: string; name: string; role: string }): SessionUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role, perms: permissionsForRole(u.role) }
}

export async function createSession (userId: string): Promise<string> {
  const token = randomUUID() + '.' + randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000)
  await db.session.create({ data: { token, userId, expiresAt } })
  return token
}

export async function getSessionUser (req: NextRequest): Promise<SessionUser | null> {
  const header = req.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (!token) return null
  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  })
  if (!session || session.expiresAt < new Date() || !session.user.active) return null
  return toSessionUser(session.user)
}

export function jsonError (status: number, error: string, detail?: string): NextResponse {
  return NextResponse.json({ error, ...(detail ? { detail } : {}) }, { status })
}

export type AuthResult = { user: SessionUser; perms: string[] } | NextResponse

/** Vrata 1/1: zahtevana pravica (fail-closed). */
export async function requirePermission (req: NextRequest, perm: Permission): Promise<AuthResult> {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'Ni prijave.', 'Zahtevan je veljaven Authorization: Bearer žeton.')
  if (!user.perms.includes(perm)) {
    return jsonError(403, `Dostop zavrnjen — manjka pravica ${perm}.`, 'Vrata določa permissions-core katalog.')
  }
  return { user, perms: user.perms }
}

// ─── Obseg podatkov (issue #1: monter vidi SAMO svoje projekte/naloge) ──────

/** Vidi vse projekte/naloge: ADMIN, VODJA, SKLADISCE, PROIZVODNJA (ne MONTER). */
export function readsAllData (user: { role: string }): boolean {
  return ['ADMIN', 'VODJA', 'SKLADISCE', 'PROIZVODNJA'].includes(user.role)
}

/** Upravlja dodelitve (assignee): samo ADMIN in VODJA. */
export function managesAssignments (user: { role: string }): boolean {
  return user.role === 'ADMIN' || user.role === 'VODJA'
}

/** Preveri, da nalog pripada prijavljenemu monterju (sicer 403). */
export async function requireOwnWorkOrder (
  user: SessionUser,
  workOrderId: string
): Promise<{ id: string; projectId: string | null } | NextResponse> {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, projectId: true, assigneeId: true },
  })
  if (!wo) return jsonError(404, 'Nalog ne obstaja.')
  if (wo.assigneeId !== user.id) {
    return jsonError(403, 'Nalog ni dodeljen vam.', 'Monter vidi samo svoje naloge; dodelitve upravlja pisarna.')
  }
  return { id: wo.id, projectId: wo.projectId }
}
