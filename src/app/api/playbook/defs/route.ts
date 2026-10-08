// /api/playbook/defs — R458 (issue #13 §14/§15)
// GET  — seznam definicij playbookov z verzijami (nalog.read)
//        ?key=OGRAJA — samo en ključ; ?vse=1 — tudi RETIRED/DRAFT
// POST — nova verzija definicije { key, def } (ADMIN/VODJA — admin editor §15)
// PATCH — status verzije { id, status } (ADMIN/VODJA)

import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { db } from '@/lib/db'
import { ensurePlaybookSeed, novejsaVerzija, nastaviStatus } from '@/lib/playbook-engine'
import { deserializiraj, type PlaybookDefinition } from '@/lib/playbook-core'

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'nalog.read')
  if (auth instanceof NextResponse) return auth
  const url = new URL(req.url)
  const key = url.searchParams.get('key')
  const vse = url.searchParams.get('vse') === '1'
  await ensurePlaybookSeed()
  const rows = await db.playbookDef.findMany({
    where: {
      ...(key ? { key } : {}),
      ...(vse ? {} : { status: 'ACTIVE' }),
    },
    orderBy: [{ key: 'asc' }, { version: 'desc' }],
    include: { author: { select: { name: true } }, _count: { select: { runs: true } } },
  })
  return NextResponse.json({
    data: rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      version: r.version,
      status: r.status,
      effectiveFrom: r.effectiveFrom.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      author: r.author?.name ?? null,
      zagonov: r._count.runs,
      korakov: deserializiraj(r.definition)?.steps.length ?? 0,
    })),
  })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'nalog.read')
  if (auth instanceof NextResponse) return auth
  let body: unknown
  try { body = await req.json() } catch { return jsonError(400, 'Neveljaven JSON.') }
  const o = body as { key?: unknown; def?: unknown }
  if (typeof o.key !== 'string' || !o.key.trim()) return jsonError(400, 'Manjka ključ playbooka.')
  if (!o.def || typeof o.def !== 'object') return jsonError(400, 'Manjka definicija (def).')
  const def = o.def as PlaybookDefinition
  const rez = await novejsaVerzija(auth.user, { key: o.key.trim(), def })
  if (!rez.ok) return jsonError(rez.status, rez.napaka)
  return NextResponse.json({ data: { key: o.key.trim(), version: rez.version } }, { status: 201 })
}

export async function PATCH (req: NextRequest) {
  const auth = await requirePermission(req, 'nalog.read')
  if (auth instanceof NextResponse) return auth
  let body: unknown
  try { body = await req.json() } catch { return jsonError(400, 'Neveljaven JSON.') }
  const o = body as { id?: unknown; status?: unknown }
  if (typeof o.id !== 'string' || !o.id.trim()) return jsonError(400, 'Manjka id definicije.')
  if (o.status !== 'DRAFT' && o.status !== 'ACTIVE' && o.status !== 'RETIRED') {
    return jsonError(400, 'Status mora biti DRAFT, ACTIVE ali RETIRED.')
  }
  const rez = await nastaviStatus(auth.user, o.id, o.status)
  if (!rez.ok) return jsonError(rez.status, rez.napaka ?? 'Napaka.')
  return NextResponse.json({ data: { id: o.id, status: o.status } })
}
