import { PrismaClient, Prisma } from '@prisma/client'

// R534 (issue #21 §3): QUERY-DNEVNIK JE PRIVZETO IZKLOPJEN.
// Prej je bil `log: ['query']` brezpogojen — vsa SQL poizvedba (z vrednostmi
// parametrov: žetoni, geselni soli, osebni podatki strank) je šla v dnevnik
// procesa v VSAKEM okolju, produkcija vključno.
//
// Novo pravilo:
//   - privzeto: SAMO 'error' + 'warn' (brez 'query', brez 'info')
//   - opt-in diagnostika: PRISMA_LOG_QUERIES=1 (ali 'true')
//       · izpis SAMO SQL-besedila (in $1, $2 … mesta parametrov) in trajanje —
//         NIKOLI vrednosti parametrov (redakcija na izvoru: event.params se ne
//         dotakne niti enkrat)
//       · časovno omejena: PRISMA_LOG_QUERIES_MS (privzeto 15 min), potem se
//         samodejno utiša z enkratno opombo — dolgo odprt diagnostični režim je
//         sam po sebi tveganje
//   - NODE_ENV=production NE vklopi ničesar dodatnega (isti pogoj kot drugje)

export interface PrismaLogConfig {
  /** nivoji, poslani Prisma `log:` (nizčno) */
  levels: Array<'error' | 'warn'>
  /** ali smo v opt-in query načinu (event emitter) */
  queryEvents: boolean
  /** epoch ms — po tem trenutku se dogodki utišajo (časovna meja) */
  queryUntil: number
  /** koliko ms diagnostike je bilo zahtevano (za izpis) */
  queryBudgetMs: number
}

export const QUERY_LOG_BUDGET_DEFAULT_MS = 15 * 60 * 1000 // 15 minut

/** Čista presoja okolja → konfiguracija dnevnikov (preizkusljiva brez stranskih učinkov). */
export function resolveLogConfig (env: NodeJS.ProcessEnv, now = Date.now()): PrismaLogConfig {
  const raw = (env.PRISMA_LOG_QUERIES ?? '').trim().toLowerCase()
  const optIn = raw === '1' || raw === 'true' || raw === 'yes'
  let budget = QUERY_LOG_BUDGET_DEFAULT_MS
  if (optIn && env.PRISMA_LOG_QUERIES_MS) {
    const n = Number.parseInt(env.PRISMA_LOG_QUERIES_MS, 10)
    if (Number.isFinite(n) && n > 0) budget = Math.min(n, 24 * 60 * 60 * 1000) // največ 24 h
  }
  return {
    levels: ['error', 'warn'],
    queryEvents: optIn,
    queryUntil: now + budget,
    queryBudgetMs: budget,
  }
}

/** Redigiran izpis enega query dogodka — PARAMETRI NIKOLI niso del izpisa. */
export function formatQueryEvent (e: { query: string; durationMs: number }): string {
  // e.query vsebuje SQL z $N mesti parametrov (brez vrednosti); e.params obstaja
  // posebej in ga NAMENOMO ne beremo.
  return `[prisma:query] ${e.durationMs}ms ${e.query.replace(/\s+/g, ' ').slice(0, 500)}`
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function buildClient (): PrismaClient {
  const cfg = resolveLogConfig(process.env)
  const log: Array<'error' | 'warn' | { emit: 'event'; level: 'query' }> = [...cfg.levels]
  if (cfg.queryEvents) log.push({ emit: 'event', level: 'query' })
  const client = new PrismaClient({ log })
  if (cfg.queryEvents) {
    let utisano = false
    client.$on('query', (e) => {
      if (Date.now() > cfg.queryUntil) {
        if (!utisano) {
          utisano = true
          console.warn(`[prisma:query] diagnostika potekla (meja ${Math.round(cfg.queryBudgetMs / 60000)} min) — nadaljnji izpisi utišani`)
        }
        return
      }
      console.log(formatQueryEvent(e as unknown as { query: string; durationMs: number }))
    })
  }
  return client
}

export const db =
  globalForPrisma.prisma ??
  buildClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// R464 (issue #1 §5): denarna polja so v bazi Decimal(12,2) — Prisma jih vrne
// kot Prisma.Decimal. Da JSON odgovori API-jev ostanejo številke (združljivo
// s frontendom in testi), Decimal serializiramo kot number.
// Natančnost notranjih izračunov ostaja decimalna (baza + Prisma.Decimal);
// na JSON meji se zaokroži na najbližjo predstavljivo vrednost.
;(Prisma.Decimal.prototype as unknown as { toJSON: () => number }).toJSON = function (this: { toNumber: () => number }) {
  return this.toNumber()
}
