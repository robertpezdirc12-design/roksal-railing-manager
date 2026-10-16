// seed-guard — R534 (issue #21 §1): fail-closed varovalo pred destruktivnim seedom.
// VSAK vstop v demo-seed ali reset gre skozi to varovalko:
//   - veriga `db:seed`/`db:reset`/`db:seed:test` v package.json JOŽ začne z njo,
//   - seed.cjs/seed-test.cjs jo pokličeta tudi sami (varovana je tudi neposredna
//     izvedba `node prisma/seed.cjs`).
//
// Plasti zavrnitve (vse morajo pasti skozi, da seed steče):
//   1. NODE_ENV=production            → ZAVRNJENO (ime okolja prvo, najcenejše)
//   2. gostitelj DATABASE_URL ni lokalen → ZAVRNJENO (dovožljeno: localhost,
//      127.0.0.1, ::1, servisni alias »postgres«, file: / brez gostitelja).
//      Ne zanašamo se SAMO na ime spremenljivke — preverimo, KAM ukaz piše.
//      Prehodni izhod za izrecne interne potrebe: SEED_ALLOW_REMOTE=YES_I_ACCEPT_REMOTE_SEED
//      (ne ublaži plasti 1 ne 4 — ti sta trdi).
//   3. SEED_CONFIRM != 'YES_DEMO_DATA' → ZAVRNJENO (izrecna potrditev destruktivnega
//      koraka; v CI/belt skriptah je VIDNA, nikoli vtipkana po pomoti)
//   4. baza ima oznako produkcije (Setting 'system.production') → ZAVRNJENO.
//      Oznako postavi lastnik z `bun run db:mark-production` na produkcijski
//      bazi — NAPAČNO okolje je ne more odstraniti (seed briše Setting vrstice,
//      zato varovalo preverja oznako PRED prvim deleteMany).
//      Sveža baza brez migracij (tabela Setting ne obstaja, P2021) ni produkcija
//      → dovoljeno; VSA druga napaka pri branju oznake = ZAVRNJENO (fail-closed).
//
// Izhod: 0 = dovoljeno, 1 = zavrnjeno (z razlogom na stderr).
/* eslint-disable @typescript-eslint/no-require-imports */

const CONFIRM_VALUE = 'YES_DEMO_DATA'
const REMOTE_ESCAPE = 'YES_I_ACCEPT_REMOTE_SEED'
const PRODUCTION_MARKER_KEY = 'system.production'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres', '[::1]'])

// DATABASE_URL: bun/Next ga naložita iz .env samodejno; pri neposrednem klicu z
// `node` ga preberemo ročno (ista robustnost kot seed-test.cjs, plus .env).
// Bodi pozoren: to je SAMO berljivi model razvojnega peskovnika — v produkciji
// (Vercel/CI) je DATABASE_URL vedno že v okolju in ta blok ni nikoli sprožen.
function loadEnvFallback () {
  if (process.env.DATABASE_URL) return
  try {
    const fs = require('fs')
    const path = require('path')
    for (const f of ['.env', 'env.sh']) {
      const p = path.join(__dirname, '..', f)
      if (!fs.existsSync(p)) continue
      const m = fs.readFileSync(p, 'utf8').match(/DATABASE_URL="?([^"\n]+)"?/)
      if (m) { process.env.DATABASE_URL = m[1]; return }
    }
  } catch { /* brez URL nadaljujemo — plasti varovala odločijo same */ }
}

function parseHost (url) {
  if (!url) return '' // brez URL → Prisma vzame privzete vrednosti (lokalni razvoj)
  if (url.startsWith('file:')) return 'LOCAL_FILE'
  const m = /^postgres(?:ql)?:\/\/[^@]*@([^/:?]+)/.exec(url)
  if (m) return m[1].toLowerCase()
  const m2 = /^postgres(?:ql)?:\/\/([^/@:]+)/.exec(url) // brez poverilnic
  if (m2) return m2[1].toLowerCase()
  return 'NEZNANO' // ne-URL vrednost → ne moremo dokazati lokalnosti
}

function refuse (reason, hint) {
  console.error(`[seed-guard] ZAVRNJENO: ${reason}`)
  if (hint) console.error(`[seed-guard]   ↳ ${hint}`)
  process.exit(1)
}

async function markerProdukcije () {
  const { PrismaClient } = require('@prisma/client')
  const db = new PrismaClient({ log: ['error'] })
  try {
    const marker = await db.setting.findUnique({ where: { key: PRODUCTION_MARKER_KEY } })
    return marker !== null
  } catch (e) {
    const code = (e && typeof e.code === 'string') ? e.code : ''
    if (code === 'P2021' || code === 'P2022') return false // sveža baza brez migracij ≠ produkcija
    throw e // vsaka druga napaka = neznan status → fail-closed pri klicatelju
  } finally {
    await db.$disconnect().catch(() => {})
  }
}

/** Fail-closed dovoljenje za destruktivni seed/reset. Ob zavrnitvi KONČA proces (exit 1). */
async function assertSeedAllowed (mode = '') {
  loadEnvFallback()
  // 1) ime okolja
  if (process.env.NODE_ENV === 'production') {
    refuse('NODE_ENV=production — demo-seed in reset sta izključno razvojna/testna orodja.',
      'Produkcijska baza se ne seje; raba semena na produkciji pomeni izgubo podatkov.')
  }

  // 2) gostitelj baze (kam ukaz dejansko piše)
  const host = parseHost(process.env.DATABASE_URL)
  const jeLokalno = host === '' || host === 'LOCAL_FILE' || LOCAL_HOSTS.has(host)
  if (!jeLokalno && process.env.SEED_ALLOW_REMOTE !== REMOTE_ESCAPE) {
    refuse(`DATABASE_URL kaže na gostitelja »${host}«, ki ni lokalni razvojni/testni.`,
      'Če je to ZAVESTNA odločitev (npr. interna testna baza), dodaj SEED_ALLOW_REMOTE=YES_I_ACCEPT_REMOTE_SEED.')
  }

  // 3) izrecna potrditev
  if (process.env.SEED_CONFIRM !== CONFIRM_VALUE) {
    refuse('Manjka izrecna potrditev — seed veriga BRIŠE vse tabele in ustvari demo račune.',
      `Ponovno zaženi z: SEED_CONFIRM=${CONFIRM_VALUE} bun run ${mode === '--reset' ? 'db:reset' : 'db:seed'}`)
  }

  // 4) oznaka produkcije v sami bazi (neodvisna od okolja)
  try {
    if (await markerProdukcije()) {
      refuse(`Baza je OZNAČENA kot produkcija (Setting »${PRODUCTION_MARKER_KEY}«).`,
        'Oznako je postavil lastnik z db:mark-production; seed nanjo nikoli ni dovoljen.')
    }
  } catch (e) {
    refuse(`Statusa oznake produkcije ni bilo mogoče prebrati (${e.code ?? e.message.split('\n')[0]}).`,
      'Neznan status = zaprta vrata (fail-closed). Preveri dostopnost baze.')
  }

  console.log(`[seed-guard] dovoljeno: ${mode === '--reset' ? 'reset (migrate reset)' : 'demo-seed veriga'} · gostitelj: ${host || 'privzet'} · potrditev: da`)
  return true
}

module.exports = { assertSeedAllowed, parseHost, CONFIRM_VALUE, REMOTE_ESCAPE, PRODUCTION_MARKER_KEY }

if (require.main === module) {
  assertSeedAllowed(process.argv[2] ?? '').catch((e) => {
    console.error(`[seed-guard] NAPAKA: ${e.message}`)
    process.exit(1)
  })
}
