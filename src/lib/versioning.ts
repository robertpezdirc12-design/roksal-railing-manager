// versioning — R536: pomočniki za verižne verzije (dirke P2002).
//
// Verige verzij (MeasurementVersion, PhotoVisualizationVersion, FenceRunVersion,
// Registration) imajo od R536 @@unique([starš, version]) — baza ZAVARUJE
// enoličnost. Vzorec "preberi zadnjo verzijo → ustvari naslednjo" je sicer
// še vedno ranljiv na sočasnost (dva zapisovalca izračunata isto številko),
// a namesto tihe podvojene vrstice zdaj sledi P2002, ki jo tu ujamemo in
// poskusimo znova z NASLEDNJO številko.
//
// Uporaba (fn mora ob vsakem poskusu znova prebrati zadnjo verzijo!):
//   const version = await retryOnUnique(async () => {
//     const last = await db.measurementVersion.findFirst({
//       where: { measurementId }, orderBy: { version: 'desc' }, select: { version: true },
//     })
//     return db.measurementVersion.create({ data: { …, version: (last?.version ?? 0) + 1 } })
//   })

import { Prisma } from '@prisma/client'

/** Ali je napaka kršitev enoličnosti (P2002) — kandidat za ponovni poskus. */
export function isUniqueViolation (err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

/**
 * Ponovni poskus ob P2002 (sočasen zapis iste verzije/ključa).
 * fn se ponovi do `attempts`-krat; ob vsakem klicu MORA znova izračunati
 * vrednosti (branje zadnje verzije ipd.). Zadnja napaka se vrže naprej.
 */
export async function retryOnUnique<T> (fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i < attempts && isUniqueViolation(err)) continue
      throw err
    }
  }
}
