import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimited } from '@/lib/rate-limit'
import { MEASUREMENT_STATUS_LABELS, type MeasurementStatus } from '@/lib/measure-engine'

// /api/public/measure — R437 (issue #2): JAVNA deljena meritev (route-map izvirnika: /m/[token])
// Brez avtentikacije — dostop ureja žeton deljenja (shareToken na merjitvi).
// Tempomat 60 zahtev/min na žeton (enako public/portal, skupni R437 lib).
// Payload je namerno VARNI podskupina: BREZ authorId, internih opomb params in ID-jev.

export const dynamic = 'force-dynamic'

export async function GET (req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!token || token.length < 8 || token.length > 80) {
    return NextResponse.json({ error: 'Neveljavna povezava.' }, { status: 404 })
  }
  if (rateLimited(`measure:${token}`)) {
    return NextResponse.json({ error: 'Preveč zahtev — poskusite kasneje.' }, { status: 429 })
  }

  const m = await db.measurement.findUnique({
    where: { shareToken: token },
    select: {
      type: true, location: true, lengthCm: true, heightCm: true, posts: true,
      segments: true, slopeDeg: true, source: true, status: true, note: true, createdAt: true,
      shareExpiresAt: true, // R535: potek deljene povezave
      project: {
        select: {
          code: true, title: true,
          customer: { select: { name: true } },
        },
      },
    },
  })
  if (!m) {
    return NextResponse.json({ error: 'Povezava ne velja več (preklicana ali neveljavna).' }, { status: 404 })
  }

  // R535: potek deljene povezave (30 dni od delitenja). Povezave, ustvarjene
  // pred R535 (brez shareExpiresAt), veljajo do preklica — združljivost nazaj.
  if (m.shareExpiresAt && m.shareExpiresAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Povezava je potekla (30 dni od deljenja). Prosite za novo povezavo.' }, { status: 404 })
  }

  // varni javni payload — brez avtorja, internih params in ID-jev.
  // R501 (issue #15): javnosti pokažemo SAMO stanje zaupanja in njegov kratek
  // naziv (MEASUREMENT_STATUS_LABELS), ne interne statusNote — ta lahko imenuje
  // ljudi in notranje razloge.
  return NextResponse.json({
    data: {
      type: m.type,
      location: m.location,
      lengthCm: m.lengthCm,
      heightCm: m.heightCm,
      posts: m.posts,
      segments: m.segments,
      slopeDeg: m.slopeDeg,
      source: m.source,
      status: m.status,
      statusLabel: MEASUREMENT_STATUS_LABELS[m.status as MeasurementStatus] ?? m.status,
      note: m.note,
      createdAt: m.createdAt.toISOString(),
      project: m.project ? { code: m.project.code, title: m.project.title } : null,
      customer: m.project?.customer ? { name: m.project.customer.name } : null,
    },
  })
}
