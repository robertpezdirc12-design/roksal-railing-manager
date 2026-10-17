import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { rateLimited } from '@/lib/rate-limit'
import { db } from '@/lib/db'

// /api/csp-report — SPREJEMNA TOČKA za Content-Security-Policy glavo (R536
// Report-Only; od R543 tudi izvršilni način CSP_MODE=enforce — report-uri
// velja v obeh). BREZ avtentikacije (brskalnik pošlje poročilo sam, brez
// naših žetonov); tempomat 30/min na bucket 'csp-report' (celoten vhod —
// javna točka, preprečuje ZAPLAVO z lažnimi poročili).
//
// R543: poročilo se ZAPIŠE V BAZO (tabela CspReport) — opazovalno obdobje je
// končno izmerljivo (raziskava R543-a: do zdaj samo dnevnik). raw = CELO
// telo poročila kot jsonb OBJEKT (konvencija R542 — ne stringify). Napaka
// shranjevanja NE sme zlomiti 204 (točka je opazovalna, ne pogodbena).

export const dynamic = 'force-dynamic'

/** Omeji dolžino posameznega polja — poročilo je ena ZGOŠČENA vrstica v
 * konzoli; nasilneje dolge vrednosti porežemo (log injection / hrup). */
function trim (v: unknown): string {
  return typeof v === 'string' ? v.slice(0, 200) : ''
}

export async function POST (req: NextRequest) {
  // tempomat: če je presežen, NE beremo telesa in NE pišemo v dnevnik — 204
  // (brskalnik odgovora poročila ne upošteva; točka je opazovalna, ne pogodbena)
  if (await rateLimited('csp-report', 30)) {
    return new NextResponse(null, { status: 204 })
  }

  const body = await req.json().catch(() => null) as { 'csp-report'?: Record<string, unknown> } | null
  const report = body?.['csp-report'] ?? null
  if (report) {
    // SAMO tri varna polja v dnevnik: kje (document-uri), kaj
    // (violated-directive), kaj je bilo blokirano (blocked-uri). NIKOLI
    // celotne politike ali drugih polj — poročilo potuje po isti strani kot
    // uporabnikova seja, polja pa bi lahko nosila vrednosti s sejnimi
    // žetoni (npr. query string document-uri).
    console.warn(
      `[csp-report] ${trim(report['document-uri'])} | ${trim(report['violated-directive'])} | ${trim(report['blocked-uri'])}`
    )
    // R543: zapis v bazo — pošteno pogojen z uspešnim razčlenitvijo telesa;
    // napaka shranjevanja se samo zabeleži (204 ostane).
    try {
      await db.cspReport.create({
        data: {
          documentUri: trim(report['document-uri']),
          violatedDirective: trim(report['violated-directive']),
          blockedUri: trim(report['blocked-uri']) || null,
          // R542: jsonb objekt direktno — celoten JSON body poročila
          raw: body as Prisma.InputJsonValue,
          userAgent: (req.headers.get('user-agent') ?? '').slice(0, 200) || null,
        },
      })
    } catch (err) {
      console.error('[csp-report] shranjevanje v bazo ni uspelo:', err instanceof Error ? err.message : String(err))
    }
  }
  return new NextResponse(null, { status: 204 })
}
