import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimited } from '@/lib/rate-limit'

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
      segments: true, slopeDeg: true, source: true, note: true, createdAt: true,
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

  // varni javni payload — brez avtorja, internih params in ID-jev
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
      note: m.note,
      createdAt: m.createdAt.toISOString(),
      project: m.project ? { code: m.project.code, title: m.project.title } : null,
      customer: m.project?.customer ? { name: m.project.customer.name } : null,
    },
  })
}
