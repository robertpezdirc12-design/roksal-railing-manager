// instrumentation — R543: enkratni zagon ob startu strežnika (konvencija
// Next.js: export async function register() se izvede ENKRAT na proces, pred
// prvim zahtevkom — v dev ob vsakem (ponovnem) zagonu, na produkciji ob
// zagonu serverless instance). Namen: GLASNA opozorila o nevarnih ali
// pomembnih kombinacijah okoljskih spremenljivk, ki jih sicer nihče ne vidi,
// dokler ni prepozno (dnevnika nihče ne bere, dokler nekaj ne zazida).

export async function register (): Promise<void> {
  // R543 (analiza R543-a): DEMO_ACCESS=on v PRODUKCIJI pomeni, da je demo
  // prijava (javno znana gesla iz prisma/seed.cjs!) dovoljena na produkciji —
  // vsakdo se lahko prijavi kot admin. V razvoju je to legitimno stanje.
  if (process.env.DEMO_ACCESS === 'on' && process.env.NODE_ENV === 'production') {
    console.error(
      '[R543] VARNOSTNO OPOZORILO: DEMO_ACCESS=on v PRODUKCIJSKEM okolju — ' +
        'demo prijava z javno znanimi gesli je dovoljena! Takoj odstranite ' +
        'DEMO_ACCESS ali ga nastavite na karkoli drugega kot "on" (glejte ' +
        'config/ENV-VARS.md).'
    )
  }
  // R543: enforce način brez frame-ancestors — clickjacking zaščita teče samo
  // prek X-Frame-Options: SAMEORIGIN (frame-ancestors je namenoma izpuščen,
  // ker bi prelomil peskovniški predogled iframe). Opozorilo, da lastnik ve,
  // katera kombinacija teče — ne blokira zagona.
  if (process.env.CSP_MODE === 'enforce' && !process.env.CSP_FRAME_ANCESTORS) {
    console.warn(
      '[R543] CSP_MODE=enforce brez CSP_FRAME_ANCESTORS — direktiva ' +
        'frame-ancestors je izpuščena; zaščita pred vstavljanjem v iframe teče ' +
        'samo prek glave X-Frame-Options: SAMEORIGIN.'
    )
  }
}
