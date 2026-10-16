import { NextRequest, NextResponse } from 'next/server'
import { rateLimited } from '@/lib/rate-limit'

// /api/csp-report — SPREJEMNA TOČKA za Content-Security-Policy-Report-Only glavo
// (R536, naslednji korak po reviziji: CSP je bil namenoma odložen — glava
// next.config.ts pošilja poročila SEM, politika ŠE NE blokira ničesar).
// BREZ avtentikacije (brskalnik pošlje poročilo sam, brez naših žetonov);
// tempomat 30/min na bucket 'csp-report' (celoten vhod — javna točka, preprečuje
// ZAPLAVO dnevnikov z lažnimi poročili).

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
    // SAMO tri varna polja: kje (document-uri), kaj (violated-directive),
    // kaj je bilo blokirano (blocked-uri). NIKOLI celotne politike ali drugih
    // polj — poročilo potuje po isti strani kot uporabnikova seja, polja pa
    // bi lahko nosila vrednosti s sejnimi žetoni (npr. query string document-uri).
    console.warn(
      `[csp-report] ${trim(report['document-uri'])} | ${trim(report['violated-directive'])} | ${trim(report['blocked-uri'])}`
    )
  }
  return new NextResponse(null, { status: 204 })
}
