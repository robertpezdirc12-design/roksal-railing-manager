// demo-access — R551: DVOJNA VRATA za demo prijavo (revizija LOGIN_DEMO).
// ČIST modul (BREZ uvozov): uvažata ga /api/auth/demo (route) in
// src/instrumentation.ts (opozorilo), testira pa tests/r551.py prek
// bun import (isti vzorec kot src/lib/csp.ts iz R543).
//
// ZAKAJ: demo gesla so JAVNO znana (prisma/seed.cjs je javen repozitorij) —
// en sam DEMO_ACCESS=on v produkciji pomeni, da se lahko KADARKOLI prijavi
// kot admin vsak, ki prebere repozitorij. R543 je dodal le GLASNO opozorilo
// v dnevnik; R551 doda DRUGA VRATA: v produkciji demo prijava odpred zahteva
// IZRECNO potrditev z besedno zvezo (namerna odločitev, ne ponesreči
// pripleskan env). Besedna zveza je NAMERNO javna in dolga — ni skrivnost,
// je premislitev (vzorec "type this exact phrase", npr. --force-with-lease).
//
// POŠTENA TABELA STANJ (vrstni red preverjanj):
//   1. DEMO_ACCESS ≠ 'on'                    → ZAPRTO (enako kot prej —
//      ena sama napačna vrednost ne odpre ničesar)
//   2. NODE_ENV ≠ 'production'               → ODPRTO (razvoj/PAS: ena vrata,
//      obstoječi tokovi se ne spremenijo)
//   3. produkcija + DEMO_PROD_KEY = fraza    → ODPRTO (zavedna odločitev
//      lastnika — obe vrati potrjena)
//   4. produkcija + vse drugo                → ZAPRTO (dvojna vrata R551 —
//      GET se odzove kot izklopljen, POST kot da pot ne obstaja)

/** Besedna zveza drugega vrat (dokumentirana v config/ENV-VARS.md;
 *  namerno javna — preprečuje PONESREČNO odprtje, ne napadalca). */
export const DEMO_PROD_KEY_FRAZA = 'ZNAM-DA-ODPIRAM-DEMO-V-PRODUKCIJI'

export type DemoVrataStanje =
  | 'izklopljeno' // DEMO_ACCESS ni 'on' — vrata zaprta povsod
  | 'razvoj-odprto' // DEMO_ACCESS=on izven produkcije — ena vrata (PAS/dev)
  | 'produkcija-odprto' // obe vrati potrjena — zavedna odločitev lastnika
  | 'produkcija-blokirano' // DEMO_ACCESS=on v produkciji BREZ ujemajočega DEMO_PROD_KEY

export interface DemoVrata {
  /** Ali je demo prijava (GET/POST /api/auth/demo) dovoljena. */
  odprt: boolean
  /** Zakaj — za opozorila ob zagonu (instrumentation) in teste. */
  stanje: DemoVrataStanje
}

/** Ovrednoti vrata iz okoljskih spremenljivk. ČISTA funkcija — sprejme
 *  dobesedno okolje (process.env ali testni literál), ne bere globalov. */
export function demoVrata (env: {
  DEMO_ACCESS?: string | undefined
  DEMO_PROD_KEY?: string | undefined
  NODE_ENV?: string | undefined
}): DemoVrata {
  // 1. vrata: stikalo mora biti IZRECNO 'on'. Kaj drugega (tudi neobstoječe
  // ali ponesreči prilepljeno) NE odpre ničesar — fail-closed.
  if (env.DEMO_ACCESS !== 'on') return { odprt: false, stanje: 'izklopljeno' }
  // 2. vrata: izven produkcije (razvoj/PAS) zadošča stikalo.
  if (env.NODE_ENV !== 'production') return { odprt: true, stanje: 'razvoj-odprto' }
  // 3. vrata: v produkciji je treba še DRUGO vrata — dobesedna fraza. Brez nje
  // je demo prijava zaprta tudi ob DEMO_ACCESS=on (R551).
  if (env.DEMO_PROD_KEY === DEMO_PROD_KEY_FRAZA) return { odprt: true, stanje: 'produkcija-odprto' }
  // 4. produkcija + vse drugo: zaprto.
  return { odprt: false, stanje: 'produkcija-blokirano' }
}
