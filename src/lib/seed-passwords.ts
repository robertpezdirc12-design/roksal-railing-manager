// seed-passwords — R578: gesla iz JAVNEGA demo seeda (prisma/seed.cjs).
//
// ZAKAJ: demo seed je v javnem repozitoriju, zato so ta gesla javno znana.
// Dokler so veljavna v produkciji, si vsak, ki prebere repo, naredi admin sejo
// prek /api/auth/login — ne glede na DEMO_ACCESS (demo pot je le ena od poti).
//
// ZATO: v produkciji ta gesla ZAVRNEMO (fail-closed). Lastnik jih mora
// zamenjati (Uporabniki → geslo ali scripts/rotate-seed-passwords.mjs).
// Izjemoma jih je mogoče dovoliti z ALLOW_PUBLIC_SEED_PASSWORDS (samo za
// zavedno odločitev, npr. javni demo z ločeno bazo) — vrednost mora biti
// dobesedna fraza, da je ni mogoče prilepiti po pomoti.
//
// Modul je ČIST (brez uvozov) — uvažata ga login route in test.

/** Geslo, ki je v produkciji dovoljeno samo z izrecno frazo. */
export const DOVOLI_JAVNA_GESLA_FRAZA = 'YES_I_KNOW_SEED_PASSWORDS_ARE_PUBLIC'

/** Pari e-pošta/geslo iz prisma/seed.cjs (javni demo računi). */
export const JAVNA_SEED_GESLA: ReadonlyArray<readonly [email: string, geslo: string]> = [
  ['admin@roksal.si', 'Admin123!'],
  ['vodja@roksal.si', 'Vodja123!'],
  ['monter@roksal.si', 'Monter123!'],
  ['skladisce@roksal.si', 'Skladisce123!'],
  ['proizvodnja@roksal.si', 'Proizvodnja123!'],
]

const MNOZICA = new Set(JAVNA_SEED_GESLA.map(([e, g]) => `${e}\u0000${g}`))

/** Ali je to geslo iz javnega demo seeda za tega uporabnika? */
export function jeJavnoSeedGeslo (email: string, geslo: string): boolean {
  return MNOZICA.has(`${email.trim().toLowerCase()}\u0000${geslo}`)
}

/** Ali je lastnik javna seed gesla izrecno dovolil (nujno za javni demo)? */
export function javnaGeslaDovoljena (env: Record<string, string | undefined>): boolean {
  return env.ALLOW_PUBLIC_SEED_PASSWORDS === DOVOLI_JAVNA_GESLA_FRAZA
}
