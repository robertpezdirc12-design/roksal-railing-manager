// R509 (issue #7 §8): DOKAZ ORIGINALA — iz fotografije, na kateri je bila mera
// narejena, dobimo SHA-256 in velikost. Dokument (izvoz, PDF, revizija) sme
// trditi «ta zajem se ni spremenil» samo s takšnim prstnim odtisom; brez njega
// je priložena slika samo datoteka, ki jo lahko kdorkoli zamenja.
//
// Modul je čist (DOM-free, brez Prisma): obe poti, ki originali potrebita
// (`/api/measure-engine/export` in `/api/pdf/measure`), uporabita ISTE funkcije,
// da se izkaz originala ne more več razhajati med izvozi.

import { createHash } from 'node:crypto'

function razcleni (params: string | null | undefined): Record<string, unknown> | null {
  if (!params) return null
  try {
    const v = JSON.parse(params) as unknown
    return v && typeof v === 'object' ? v as Record<string, unknown> : null
  } catch { return null }
}

/**
 * ID-ji fotografij, na katere se sklicuje meritev: glavni pogled (`photoId`) in
 * dodatni pogledi (`views[].photoId` — R455). Podvojitve so odstranjene, vrstni
 * red je viden (prvi = glavni).
 */
export function fotografiIzParametrov (params: string | null | undefined): string[] {
  const p = razcleni(params)
  const ids: string[] = []
  if (typeof p?.photoId === 'string' && p.photoId) ids.push(p.photoId)
  const pogledi = p?.views
  if (Array.isArray(pogledi)) {
    for (const v of pogledi as Record<string, unknown>[]) {
      if (v && typeof v.photoId === 'string' && v.photoId) ids.push(v.photoId)
    }
  }
  return [...new Set(ids)]
}

export interface OriginalDokaz {
  id: string
  zajeto: string | null
  lokacija: string | null
  vir: string | null
  /** npr. `image/jpeg` iz dataUrl prefe; `null` ko slike ni (ali je okvarjena) */
  format: string | null
  bayti: number
  sha256: string | null
  /** binarna vsebina — pot jo izroči SAMO ob izrecni zahtevi (`originals=1`) */
  dataUrl: string | null
}

export interface OriginalVrsta {
  id: string
  createdAt?: Date | null
  location?: string | null
  source?: string | null
  params?: string | null
}

/**
 * Izkaz enega originala. Manjkajoča/okvarjena dataUrl ni napaka, ampak POŠTEN
 * odgovor brez dokaza: `sha256 = null`, `bayti = 0` — dokument potem pravilno
 * pokaže »ni datoteke« namesto izmišljenega prstnega odtisa.
 */
export function originalDokaz (vrsta: OriginalVrsta): OriginalDokaz {
  const p = razcleni(vrsta.params)
  const dataUrl = typeof p?.photo === 'string' && (p.photo as string).startsWith('data:image/') ? p.photo as string : null
  const bayti = dataUrl !== null ? Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64') : null
  return {
    id: vrsta.id,
    zajeto: vrsta.createdAt instanceof Date ? vrsta.createdAt.toISOString() : null,
    lokacija: vrsta.location ?? null,
    vir: vrsta.source ?? null,
    format: dataUrl !== null ? dataUrl.slice(5, dataUrl.indexOf(';')) : null,
    bayti: bayti?.length ?? 0,
    sha256: bayti !== null ? createHash('sha256').update(bayti).digest('hex') : null,
    dataUrl,
  }
}
