// crew-core — R445 (issue #7 §9): skupna validacija ekipe/podizvajalca.
// Čist client-safe lib — NIČ strežniških uvozov (uporabljata jo API ruti in morebitni UI).

export const CREW_TYPES = ['INTERNA', 'PODIZVAJALEC'] as const

/** Podatkovna oblika ekipe, kot jo sprejema API (vsi opcijski razen imena). */
export interface CrewInput {
  name: string
  type: string
  region: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  workTypes: string | null
  availabilityNote: string | null
  priceNote: string | null
  rating: number | null
  active: boolean
  note: string | null
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null

/**
 * Validiraj telo zahtevka v celoten podatkovni objekt ekipe.
 * Uporaba: POST (ustvari) — vsa polja; PATCH uporablja parseCrewPatch (delna posodobitev).
 */
export function parseCrewBody (body: Record<string, unknown> | null): { ok: true; data: CrewInput } | { ok: false; error: string } {
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return { ok: false, error: 'Ime ekipe je obvezno.' }

  const type = typeof body?.type === 'string' && body.type ? body.type : 'INTERNA'
  if (!CREW_TYPES.includes(type as (typeof CREW_TYPES)[number])) {
    return { ok: false, error: 'Tip ekipe mora biti INTERNA ali PODIZVAJALEC.' }
  }

  let rating: number | null = null
  if (body?.rating !== undefined && body?.rating !== null) {
    if (typeof body.rating !== 'number' || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) {
      return { ok: false, error: 'Ocena (rating) mora biti celo število med 1 in 5.' }
    }
    rating = body.rating
  }

  return {
    ok: true,
    data: {
      name: name.slice(0, 200),
      type,
      region: str(body?.region, 100),
      contactName: str(body?.contactName, 150),
      contactPhone: str(body?.contactPhone, 60),
      contactEmail: str(body?.contactEmail, 150),
      workTypes: str(body?.workTypes, 300),
      availabilityNote: str(body?.availabilityNote, 300),
      priceNote: str(body?.priceNote, 300),
      rating,
      active: typeof body?.active === 'boolean' ? body.active : true,
      note: str(body?.note, 2000),
    },
  }
}

/**
 * Delna posodobitev ekipe (PATCH) — sprejme SAMO podana polja.
 * Vrača patch objekt za Prisma update ali opis napake.
 */
export function parseCrewPatch (body: Record<string, unknown> | null): { ok: true; data: Partial<CrewInput> } | { ok: false; error: string } {
  const patch: Partial<CrewInput> = {}

  if (body?.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return { ok: false, error: 'Ime ekipe ne more biti prazno.' }
    patch.name = name.slice(0, 200)
  }
  if (body?.type !== undefined) {
    if (typeof body.type !== 'string' || !CREW_TYPES.includes(body.type as (typeof CREW_TYPES)[number])) {
      return { ok: false, error: 'Tip ekipe mora biti INTERNA ali PODIZVAJALEC.' }
    }
    patch.type = body.type
  }
  if (body?.rating !== undefined) {
    if (body.rating === null) patch.rating = null
    else {
      if (typeof body.rating !== 'number' || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) {
        return { ok: false, error: 'Ocena (rating) mora biti celo število med 1 in 5 (ali null).' }
      }
      patch.rating = body.rating
    }
  }
  if (body?.active !== undefined) {
    if (typeof body.active !== 'boolean') return { ok: false, error: 'active mora biti logična vrednost.' }
    patch.active = body.active
  }
  if (body?.region !== undefined) patch.region = str(body.region, 100)
  if (body?.contactName !== undefined) patch.contactName = str(body.contactName, 150)
  if (body?.contactPhone !== undefined) patch.contactPhone = str(body.contactPhone, 60)
  if (body?.contactEmail !== undefined) patch.contactEmail = str(body.contactEmail, 150)
  if (body?.workTypes !== undefined) patch.workTypes = str(body.workTypes, 300)
  if (body?.availabilityNote !== undefined) patch.availabilityNote = str(body.availabilityNote, 300)
  if (body?.priceNote !== undefined) patch.priceNote = str(body.priceNote, 300)
  if (body?.note !== undefined) patch.note = str(body.note, 2000)

  if (Object.keys(patch).length === 0) return { ok: false, error: 'Ni sprememb za izvedbo.' }
  return { ok: true, data: patch }
}
