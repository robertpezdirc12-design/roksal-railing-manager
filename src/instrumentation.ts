// instrumentation — R543: enkratni zagon ob startu strežnika (konvencija
// Next.js: export async function register() se izvede ENKRAT na proces, pred
// prvim zahtevkom — v dev ob vsakem (ponovnem) zagonu, na produkciji ob
// zagonu serverless instance). Namen: GLASNA opozorila o nevarnih ali
// pomembnih kombinacijah okoljskih spremenljivk, ki jih sicer nihče ne vidi,
// dokler ni prepozno (dnevnika nihče ne bere, dokler nekaj ne zazida).

// Relativni uvoz (vzorec csp.ts/R543): instrumentation teče izven app
// kompilacije — alias @/ tu ni zagotovljen, relativna pot pa vedno dela.
import { DEMO_PROD_KEY_FRAZA, demoVrata } from './lib/demo-access'

export async function register (): Promise<void> {
  // R543 (analiza R543-a): DEMO_ACCESS=on v PRODUKCIJI pomeni, da je demo
  // prijava (javno znana gesla iz prisma/seed.cjs!) dovoljena na produkciji —
  // vsakdo se lahko prijavi kot admin. V razvoju je to legitimno stanje.
  // R551: DVOJNA VRATA — demo prijava v produkciji zdaj zahteva še
  // DEMO_PROD_KEY (glej src/lib/demo-access.ts); opozorilo je TRI-STANJSKO,
  // da lastnik točno ve, katera kombinacija teče.
  if (process.env.DEMO_ACCESS === 'on' && process.env.NODE_ENV === 'production') {
    const vrata = demoVrata(process.env)
    if (vrata.odprt) {
      console.error(
        '[R551] VARNOSTNA NAPAKA: demo prijava je ODPRTA v produkciji — ' +
          'DEMO_ACCESS=on IN DEMO_PROD_KEY sta obe potrjeni. Gesla demo ' +
          'računov so javno znana (prisma/seed.cjs) — vsakdo se lahko prijavi ' +
          'kot admin! Če to NI namerena odločitev, takoj odstranite DEMO_ACCESS ' +
          'ali DEMO_PROD_KEY.'
      )
    } else {
      console.error(
        '[R551] OPOZORILO: DEMO_ACCESS=on v produkciji, a demo prijava je ' +
          'ZAVRNJENA (dvojna vrata R551) — manjka ali ne ustreza DEMO_PROD_KEY. ' +
          `Če želite demo prijavo NAMERNO odpreti, nastavite DEMO_PROD_KEY=${DEMO_PROD_KEY_FRAZA} ` +
          '(glejte config/ENV-VARS.md).'
      )
    }
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
