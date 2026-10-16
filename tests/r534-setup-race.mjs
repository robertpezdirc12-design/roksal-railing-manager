// tests/r534-setup-race.mjs — R534 (issue #21 §3): dokaz atomarnosti prve namestitve.
// Protivrednost: prej sta bila števec (user.count) in ustvarjanje uporabnika dve
// ločeni operaciji — dve hkratni javni POST /api/setup sta obe preverili števec
// na 0 in ustvarili DVA prva administratorja.
//
// Ta skripta ustreza PRAVI poti route handlerja (uvoz src/app/api/setup/route.ts),
// ne posnema logike: 8 SOČASNIH POST zahtev na SVEŽI prazni bazi (DATABASE_URL
// iz argv[2]) + 1 zaporedna kontrola po dirki.
//
// Uspeh = NATANČNO ena zahteva 201 (ustvari ADMIN-a), vse ostale 403,
// v bazi NATANČNO en uporabnik z vlogo ADMIN in NATANČNO ena zahtevna vrstica
// Setting 'system.setup.completedAt'.
//
// Zagon: bun tests/r534-setup-race.mjs <DATABASE_URL-sveže-prazne-baze>
const RACE_DB = process.argv[2]
if (!RACE_DB || !RACE_DB.startsWith('postgresql://')) {
  console.error('uporaba: bun tests/r534-setup-race.mjs <DATABASE_URL sveže prazne baze>')
  process.exit(2)
}
process.env.DATABASE_URL = RACE_DB // PRED uvozom — db.ts odpre klienta ob uvozu

const { POST } = await import('../src/app/api/setup/route.ts')

const BODY = JSON.stringify({ name: 'Dirka Testni', email: 'dirka@roksal.test', password: 'Dirka-12345!' })
const zahteva = () => new Request('http://dirka.local/api/setup', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: BODY,
})

const N = 8
console.log(`── sočasno streljaj ${N} POST /api/setup na isti prazni bazi …`)
const odgovori = await Promise.all(Array.from({ length: N }, () => POST(zahteva())))
const statusi = odgovori.map((r) => r.status)
const zmagovalka = odgovori.find((r) => r.status === 201)

// zaporedna kontrola PO dirki: vrata morajo biti ZAKLEPANA
console.log('── zaporedna kontrola po dirki (pričakovan 403) …')
const poDirki = await POST(zahteva())

const { PrismaClient } = await import('@prisma/client')
const db = new PrismaClient({ log: ['error'] })
const admini = await db.user.count({ where: { role: 'ADMIN' } })
const uporabniki = await db.user.count()
const zahteve = await db.setting.count({ where: { key: 'system.setup.completedAt' } })
await db.$disconnect()

const rezultat = {
  statusi,
  poDirkiStatus: poDirki.status,
  admini,
  uporabniki,
  zahteveSetting: zahteve,
  zmagovalkaImaZeton: false,
}
if (zmagovalka) {
  const telo = await zmagovalka.json().catch(() => null)
  const zeton = typeof telaToken(telo) === 'string' ? telaToken(telo) : ''
  rezultat.zmagovalkaImaZeton = zeton.length > 40 && zeton.includes('.')
}
function telaToken (t) { return t.token ?? t.data?.token }

console.log(JSON.stringify(rezultat, null, 2))

const napake = []
const stevilo201 = statusi.filter((s) => s === 201).length
const stevilo403 = statusi.filter((s) => s === 403).length
if (stevilo201 !== 1) napake.push(`pričakovana NATANČNO 1×201, dobljeno ${stevilo201}`)
if (stevilo403 !== N - 1) napake.push(`pričakovanih ${N - 1}×403, dobljeno ${stevilo403}`)
if (poDirki.status !== 403) napake.push(`zaporedna kontrola po dirki mora biti 403, dobljeno ${poDirki.status}`)
if (admini !== 1) napake.push(`v bazi mora biti NATANČNO 1 ADMIN, dobljeno ${admini}`)
if (uporabniki !== 1) napake.push(`v bazi mora biti NATANČNO 1 uporabnik, dobljeno ${uporabniki}`)
if (zahteve !== 1) napake.push(`zahtevnih vrstic Setting mora biti NATANČNO 1, dobljeno ${zahteve}`)
if (!rezultat.zmagovalkaImaZeton) napake.push('zmagovalni odgovor ne izda veljaven sejni žeton')

if (napake.length > 0) {
  console.error('✗ DIRKA PADLA:')
  for (const n of napake) console.error(`  - ${n}`)
  process.exit(1)
}
console.log(`✓ ATOMARNOST DOKAZANA: 1×201 + ${N - 1}×403 iz ${N} sočasnih zahtev · 1 ADMIN · 1 zahtevna vrstica · po dirki 403`)
