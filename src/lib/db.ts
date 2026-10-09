import { PrismaClient, Prisma } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// R464 (issue #1 §5): denarna polja so v bazi Decimal(12,2) — Prisma jih vrne
// kot Prisma.Decimal. Da JSON odgovori API-jev ostanejo številke (združljivo
// s frontendom in testi), Decimal serializiramo kot number.
// Natančnost notranjih izračunov ostaja decimalna (baza + Prisma.Decimal);
// na JSON meji se zaokroži na najbližjo predstavljivo vrednost.
;(Prisma.Decimal.prototype as unknown as { toJSON: () => number }).toJSON = function (this: { toNumber: () => number }) {
  return this.toNumber()
}
