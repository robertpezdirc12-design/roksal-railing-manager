// /api/playbook/runs/[id]/action — R458 (issue #13 §1)
// POST { stepId, akcija: ZACNI|ZAKLJUCI|NI_PRIMERNO|BLOKIRANO|PONOVNO,
//        evidence?, razlog? } (nalog.write)
// PLAYBOOK → STEP → ACTION → VALIDATION → NEXT STEP:
//  • ZACNI — korak v izvajanje (poskus +1);
//  • ZAKLJUCI — validacija dokazil (§10); napake → 400 + korak ostane odprt;
//    ODLOCITEV odgovor gre v kontekst (§5 veje);
//  • NI_PRIMERNO/BLOKIRANO — §6 izjema SAMO z razlogom (≥ 5 znakov) + revizija;
//  • PONOVNO — ponovitev zaključenega/neuspešnega koraka (§16).

import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { izvediAkcijo, type Akcija } from '@/lib/playbook-engine'
import type { Evidence } from '@/lib/playbook-core'

const AKCIJE: Akcija[] = ['ZACNI', 'ZAKLJUCI', 'NI_PRIMERNO', 'BLOKIRANO', 'PONOVNO']

export async function POST (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  let body: unknown
  try { body = await req.json() } catch { return jsonError(400, 'Neveljaven JSON.') }
  const o = body as { stepId?: unknown; akcija?: unknown; evidence?: unknown; razlog?: unknown }
  if (typeof o.stepId !== 'string' || !o.stepId.trim()) return jsonError(400, 'Manjka stepId.')
  if (typeof o.akcija !== 'string' || !AKCIJE.includes(o.akcija as Akcija)) {
    return jsonError(400, `akcija mora biti ena izmed: ${AKCIJE.join(', ')}.`)
  }
  if (o.evidence !== undefined && o.evidence !== null && typeof o.evidence !== 'object') {
    return jsonError(400, 'evidence mora biti objekt.')
  }
  const razlog = typeof o.razlog === 'string' ? o.razlog : null
  const rez = await izvediAkcijo(auth.user, {
    runId: id,
    stepId: o.stepId.trim(),
    akcija: o.akcija as Akcija,
    evidence: (o.evidence as Evidence) ?? null,
    razlog,
  })
  if (rez.napake && rez.napake.length > 0) {
    return NextResponse.json({ error: 'Validacija dokazil ni uspela.', napake: rez.napake }, { status: 400 })
  }
  if (!rez.stanje) return jsonError(rez.status, rez.napaka ?? 'Napaka.')
  return NextResponse.json({ data: rez.stanje })
}
