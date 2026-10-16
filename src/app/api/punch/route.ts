// API /api/punch — R437 (route-map izvirnik: prisotnost)
// GET  vnosi prisotnosti — lastni za vsakega prijavljenega; ?all=1 zahteva users.read
//      ?day=YYYY-MM-DD ?from= ?to= (filter obdobje)
// POST prijava/odjava { action: 'in' | 'out', day?, note? } — vedno ZASE (upsert na dan)
//      → reviziji PUNCH_IN / PUNCH_OUT.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getSessionUser, jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'

// lokalni dan YYYY-MM-DD (evropski časovni pas strežnika)
function localDay (d = new Date ()): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// action se preslika na 'in'/'out' (vse ostalo ⇒ '' → handlerjev 400 z
// specifičnim sporočilom, kot prej); day je NIZ YYYY-MM-DD (ne datum — regex
// in privzeti današnji dan ostajata v handlerju, zato NI z.coerce/z.preprocess
// kot pri scheduledFor v R536-d; žiga inAt/outAt generira strežnik);
// note se NE stiska (prazen niz ostane '', null ⇒ null — kot prej).
const PunchBodySchema = z.object({
  action: z.string().nullish().transform((v) => (v === 'out' ? 'out' : v === 'in' ? 'in' : '')),
  day: z.string().nullish().transform((v) => v ?? undefined),
  note: z.string().nullish().transform((v) => v ?? null),
})

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'users.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const all = url.searchParams.get('all') === '1'
  const day = url.searchParams.get('day')
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  const entries = await db.punchEntry.findMany({
    where: {
      ...(all ? {} : { userId: auth.user.id }),
      ...(day ? { day } : {}),
      ...(from || to
        ? { day: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    include: { user: { select: { id: true, name: true, role: true } } },
    orderBy: { day: 'desc' },
    take: 365,
  })
  return NextResponse.json({ data: entries })
}

export async function POST (req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'Ni prijave.')

  const parsed = await parseBody(req, PunchBodySchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  const action = data.action
  const day = typeof data.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.day) ? data.day : localDay()
  const note = data.note

  if (!action) return jsonError(400, "Manjka action ('in' ali 'out').")
  if (day > localDay()) return jsonError(400, 'Prijava v prihodnost ni mogoča.')

  const existing = await db.punchEntry.findUnique({
    where: { userId_day: { userId: user.id, day } },
  })

  if (action === 'in') {
    if (existing?.inAt) return jsonError(409, 'Za ta dan ste že prijavljeni.')
    // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
    const entry = await db.$transaction(async (tx) => {
      const entry = await tx.punchEntry.upsert({
        where: { userId_day: { userId: user.id, day } },
        create: { userId: user.id, day, inAt: new Date(), note },
        update: { inAt: new Date(), note },
      })
      await writeAudit({ userId: user.id, action: 'PUNCH_IN', entity: 'punchEntry', entityId: entry.id, detail: { day } }, tx)
      return entry
    })
    return NextResponse.json({ data: entry }, { status: 201 })
  }

  // odjava
  if (!existing?.inAt) return jsonError(409, 'Za ta dan ni prijave, ki bi jo lahko odjavili.')
  if (existing.outAt) return jsonError(409, 'Odjava za ta dan je že zabeležena.')
  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
  const entry = await db.$transaction(async (tx) => {
    const entry = await tx.punchEntry.update({
      where: { userId_day: { userId: user.id, day } },
      data: { outAt: new Date(), note: note ?? existing.note },
    })
    await writeAudit({ userId: user.id, action: 'PUNCH_OUT', entity: 'punchEntry', entityId: entry.id, detail: { day } }, tx)
    return entry
  })
  return NextResponse.json({ data: entry })
}
