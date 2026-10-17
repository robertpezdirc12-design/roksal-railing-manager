// validate — R536: skupna validacija zahtevkov (zod) za API rute.
// Namesto ročnih preverjanj (typeof body?.x === 'string' …) na 195 rutah:
//   const parsed = await parseBody(req, SchemaProgram)
//   if (!parsed.ok) return parsed.response   // 400 + slovenska polja
//   const data = parsed.data                 // tipovno varno
// Načela: fail-closed (napačno telo → 400, nikoli tiho privzeto), sporočila
// v slovenščini, podrobnosti začrtane po poljih (max 8, brez izliva vrednosti).

import { NextRequest, NextResponse } from 'next/server'
import type { ZodType } from 'zod'

// R541: dovoljeni statusi projekta — ena sama množica za zod validacijo
// (POST/PATCH /api/projects) in CHECK omejitev v bazi (migracija
// 20261023000000_r541_status_check). Prej je z.string() spustil poljuben niz.
export const PROJECT_STATUSES = ['NACRT', 'AKTIVNI', 'TEREN', 'ZAKLJUCEN', 'ARHIV'] as const

export type ParsedOk<T> = { ok: true; data: T; response?: undefined }
export type ParsedErr = { ok: false; data?: undefined; response: NextResponse }

/** Zgradi 400 odgovor s začrtanimi polji (brez vrednosti — samo pot + sporočilo). */
function fieldErrors (issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .slice(0, 8)
    .map((i) => `${i.path.length > 0 ? i.path.join('.') : 'telo'}: ${i.message}`)
    .join('; ')
}

/**
 * Prebere in validira JSON telo zahteve.
 * Neveljaven JSON / neveljavna polja → 400 z začrtanimi polji.
 */
export async function parseBody<T> (req: NextRequest, schema: ZodType<T>): Promise<ParsedOk<T> | ParsedErr> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    raw = null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Neveljavno telo zahteve.', detail: 'Pričakovan je veljaven JSON objekt.' },
        { status: 400 }
      ),
    }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Neveljavni podatki.', detail: fieldErrors(parsed.error.issues) },
        { status: 400 }
      ),
    }
  }
  return { ok: true, data: parsed.data }
}

/**
 * Prebere in validira query parametre (?a=1&b=…).
 * Vrednosti so vedno nizi — uporabi z.coerce (npr. z.coerce.number()) za tipe.
 */
export function parseQuery<T> (req: NextRequest, schema: ZodType<T>): ParsedOk<T> | ParsedErr {
  const params: Record<string, string> = {}
  new URL(req.url).searchParams.forEach((v, k) => { params[k] = v })
  const parsed = schema.safeParse(params)
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Neveljavni parametri.', detail: fieldErrors(parsed.error.issues) },
        { status: 400 }
      ),
    }
  }
  return { ok: true, data: parsed.data }
}
