// quote-invalidation — ROKSAL (R474 — issue #9 §5 HOVER PARITY)
// Povezava ponudba ↔ paket/kosovnica in INVALIDACIJA ob spremembi obsega:
// sprememba mere/SKU/variante/količine ali regeneracija kosovnice mora
// ponudbo razveljaviti — NIKOLI ne pusti zastarele ponudbe kot veljavne.
//
// Pravila (poštenost + pravna varnost):
//  • OSNUTEK / POSLAN → status nazaj na OSNUTEK + ZASTARELO zastavica z
//    razlogom (pisarna mora ponudbo pregledati in znova potrditi/poslati).
//  • SPREJET / ZAKLENJEN → SAMO zastavica (podpisanega/sprejetega dokumenta
//    se ne spreminja tiho) — pisarna vidi opozorilo in odloči.
//  • ZAVRNJEN → neveljavno zanje (ni poslovnega učinka).
//  • Vsaka invalidacija piše revizijo QUOTE_INVALIDATED.
//
// Zastavica se počisti z IZRECNIM dejanjem pisarne (PATCH status/nova
// ponudba) — nikoli samodejno.

import { db } from '@/lib/db'
import { writeAudit } from '@/lib/audit'

export interface InvalidationResult {
  reset: number // OSNUTEK/POSLAN → OSNUTEK
  flagged: number // SPREJET/ZAKLENJEN → samo zastavica
  codes: string[]
}

/**
 * Invalidira ponudbe, vezane na paket. Kliče se po spremembi obsega paketa
 * (qty/izmera) ali regeneraciji kosovnice.
 */
export async function invalidateQuotesForPackage (
  pkg: { id: string; code: string; projectId: string | null },
  reason: string,
  userId: string
): Promise<InvalidationResult> {
  const quotes = await db.quote.findMany({ where: { packageId: pkg.id }, select: { id: true, code: true, status: true } })
  const res: InvalidationResult = { reset: 0, flagged: 0, codes: [] }
  const now = new Date()

  for (const q of quotes) {
    if (q.status === 'ZAVRNJEN') continue
    const reset = q.status === 'OSNUTEK' || q.status === 'POSLAN'
    await db.quote.update({
      where: { id: q.id },
      data: {
        ...(reset ? { status: 'OSNUTEK' } : {}),
        staleAt: now,
        staleReason: reason.slice(0, 300),
      },
    })
    await writeAudit({
      userId,
      action: 'QUOTE_INVALIDATED',
      entity: 'quote',
      entityId: q.id,
      projectId: pkg.projectId,
      detail: {
        code: q.code, paket: pkg.code, razlog: reason,
        prej: q.status, zdaj: reset ? 'OSNUTEK' : q.status,
        vrsta: reset ? 'ponastavitev' : 'zastavica',
      },
    })
    res.codes.push(q.code)
    if (reset) res.reset++
    else res.flagged++
  }
  return res
}
