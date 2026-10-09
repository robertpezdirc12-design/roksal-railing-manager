// R464: lokalni razvojni PostgreSQL (embedded-postgres) — issue #1 §2
// Zagon:  bun run db:up   (prvič inicializira .pgdata, nato samo zažene)
// Ustavitev: bun run db:down
// URL: postgresql://roksal:roksal@localhost:54329/roksal
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// ICU 60 knjižnice za zonky PG binarke (neodvisne od sistema — ekstrahirane ob namestitvi)
const ICU_DIR = resolve('node_modules/.icu-libs')
if (existsSync(ICU_DIR)) {
  process.env.LD_LIBRARY_PATH = [ICU_DIR, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
}
const { default: EmbeddedPostgres } = await import('embedded-postgres')

const DATA_DIR = resolve('.pgdata')
const PORT = 54329
const URL = `postgresql://roksal:roksal@localhost:${PORT}/roksal`

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'roksal',
  password: 'roksal',
  port: PORT,
  persistent: true,
})

const cmd = process.argv[2] ?? 'up'

if (cmd === 'down') {
  try {
    await pg.stop()
    console.log('[db] embedded PostgreSQL ustavljen')
    process.exit(0)
  } catch (err) {
    console.error('[db] ustavitev spodletela (morda ni tekel):', err.message)
    process.exit(0)
  }
}

const fresh = !existsSync(DATA_DIR)
if (fresh) {
  await pg.initialise()
  console.log('[db] inicializiran podatkovni imenik .pgdata')
}
await pg.start()
console.log(`[db] embedded PostgreSQL teče na :${PORT} (svež zagon: ${fresh})`)
try {
  await pg.createDatabase('roksal')
  console.log('[db] baza roksal ustvarjena')
} catch (err) {
  if (!/already exists/i.test(String(err?.message ?? err))) throw err
}
console.log(`[db] DATABASE_URL=${URL}`)
console.log('[db] naslednji korak: bun run db:migrate:deploy  (+ seed po potrebi)')
// drži proces živega (postgres teče kot otrok tega procesa)
setInterval(() => {}, 1 << 30)
