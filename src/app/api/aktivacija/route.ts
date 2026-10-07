import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// /api/aktivacija — licenca aplikacije (route-map izvirnika: /aktivacija)
// GET  (security.read): stanje licence (status, maskirani ključ, datum aktivacije)
// POST (security.read): { key } → preveri obliko RS-XXXXX-XXXXX-XXXXX + kontrolno vsoto
//   mod 97; ob uspehu shrani v Setting in zapiši revizijo ACTIVATION.

const KEY_RE = /^RS-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/

/** Kontrolni znaki ključa: vsota (i+1)·kodaZnaka prvih 15 znakov, mod 97, dve števki. */
function checkDigits (body15: string): string {
  let sum = 0
  for (let i = 0; i < body15.length; i++) sum += (i + 1) * body15.charCodeAt(i)
  return (sum % 97).toString().padStart(2, '0')
}

function keyValid (key: string): boolean {
  if (!KEY_RE.test(key)) return false
  const raw = key.replace(/-/g, '') // RS + 13 + 2 kontrolni = 17
  if (raw.length !== 17) return false
  const check = raw.slice(15)
  if (!/^\d{2}$/.test(check)) return false
  return checkDigits(raw.slice(0, 15)) === check
}

async function readLicence () {
  const rows = await db.setting.findMany({ where: { key: { startsWith: 'licence.' } } })
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const key = map.get('licence.key') ?? null
  return {
    status: key ? 'AKTIVNA' : 'NEAKTIVNA',
    key: key ? key.slice(0, 8) + '·' + '·'.repeat(4) + key.slice(-4) : null, // maskirano
    activatedAt: map.get('licence.activatedAt') ?? null,
    activatedBy: map.get('licence.activatedBy') ?? null,
  }
}

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'security.read')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({ data: await readLicence() })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'security.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null) as { key?: string } | null
  const key = typeof body?.key === 'string' ? body.key.trim().toUpperCase() : ''
  if (!key) return jsonError(400, 'Vnesite aktivacijski ključ.')

  if (!keyValid(key)) {
    return jsonError(422, 'Neveljaven aktivacijski ključ.', 'Pričakovana oblika RS-XXXXX-XXXXX-XXXXX s kontrolno vsoto mod 97.')
  }

  const now = new Date().toISOString()
  // upsert (SQLite ne podpira skipDuplicates pri createMany)
  await Promise.all([
    db.setting.upsert({ where: { key: 'licence.key' }, create: { key: 'licence.key', value: key }, update: { value: key } }),
    db.setting.upsert({ where: { key: 'licence.status' }, create: { key: 'licence.status', value: 'AKTIVNA' }, update: { value: 'AKTIVNA' } }),
    db.setting.upsert({ where: { key: 'licence.activatedAt' }, create: { key: 'licence.activatedAt', value: now }, update: { value: now } }),
    db.setting.upsert({ where: { key: 'licence.activatedBy' }, create: { key: 'licence.activatedBy', value: user.email }, update: { value: user.email } }),
  ])

  await writeAudit({ userId: user.id, action: 'ACTIVATION', entity: 'sistem', detail: JSON.stringify({ key: key.slice(0, 8) + '…' }) })
  return NextResponse.json({ data: await readLicence() })
}
