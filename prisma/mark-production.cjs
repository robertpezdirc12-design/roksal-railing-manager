// mark-production — R534 (issue #21 §1): enkratna oznaka, da je TA baza produkcija.
// Postavi Setting 'system.production' = 'true' — od tega trenutka seed-guard
// ZAVRNE vsak demo-seed/reset na tej bazi, NEODVISNO od okoljskih spremenljivk
// (ime okolja je lahko napačno, URL pa zavedno preusmerjen — oznaka v bazi paša).
//
// Zahteva izrecno potrditev: PRODUCTION_MARK=YES (proti pomoti).
// Poženi na PRODUKCIJSKI bazi: PRODUCTION_MARK=YES DATABASE_URL=<produkcija> bun run db:mark-production
/* eslint-disable @typescript-eslint/no-require-imports */

const KEY = 'system.production'

async function main () {
  if (process.env.PRODUCTION_MARK !== 'YES') {
    console.error('[mark-production] ZAVRNJENO: manjka izrecna potrditev.')
    console.error('  ↳ To orodje OZNAČI bazo kot produkcijo (seed na njej bo trajno zavrnjen).')
    console.error('  ↳ Če je to zavedna odločitev: PRODUCTION_MARK=YES bun run db:mark-production')
    process.exit(1)
  }

  const { PrismaClient } = require('@prisma/client')
  const db = new PrismaClient({ log: ['error'] })
  try {
    const obstojeci = await db.setting.findUnique({ where: { key: KEY } })
    await db.setting.upsert({
      where: { key: KEY },
      update: { value: 'true', updatedAt: new Date() },
      create: { key: KEY, value: 'true' },
    })
    if (obstojeci) {
      console.log(`[mark-production] oznaka JE ŽE obstajala — osvežena (Setting »${KEY}« = true).`)
    } else {
      console.log(`[mark-production] baza je OZNAČENA kot produkcija (Setting »${KEY}« = true).`)
    }
    console.log('[mark-production] od zdaj seed-guard na tej bazi ZAVRNE vsak demo-seed/reset.')
    console.log('[mark-production] odstranitev oznake (izrecna lastnikova odločitev):')
    console.log('  bun -e \'const{PrismaClient}=require("@prisma/client");const db=new PrismaClient();await db.setting.delete({where:{key:"system.production"}});await db.$disconnect()\'')
  } finally {
    await db.$disconnect().catch(() => {})
  }
}

main().catch((e) => {
  console.error(`[mark-production] NAPAKA: ${e.message}`)
  process.exit(1)
})
