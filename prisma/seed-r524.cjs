// prisma/seed-r524.cjs — R524 (issue #14): DETAJL čipi površine za OGRAJE iz
// uradnih barvnih lestvic v izvirni ločljivosti.
//
// Zakaj:
//  - R523 je KUBO (fasada) iz uradne lestvice dobil 4 FOTOGRAFSKE čipe
//    površine (184–210 px, vlakna navpična) — nevtralna VLM primerjava
//    4/10 → 8/10; ograje pa so ostale na izrezih iz sceničnih fotografij;
//  - VSE uradne lestvice vsebujejo FOTOGRAFSKE čipe po odtenku (VLM prebral
//    oznake DVAKRAT: 1024 px sličica + izvirnik; enaka zaporedja, množice se
//    točno ujemajo z aktivnimi variantami kataloga):
//      POLNA 57/32 (namenska, 2217×675): 3 čipi — AMW, OKW, RWA
//      POLNA 128 (izvirnik 2560×683):      6 čipov — AMW, ASH, BUT, OKW, ROAK, RWA
//      POLNA 100 (izvirnik 2560×600):      8 čipov — AMW, ASH, GLT, BUT, OKW, WHT, ROAK, RWA
//      ROMB 67 (izvirnik 2560×669):        7 čipov — AMW, ASH, GLT, BUT, OKW, ROAK, RWA
//  - lestvice POLNA 128/100 + ROMB 67 + TERASA 150 so v katalogu samo kot
//    1024 px sličice — nadgradnja na izvirnike (enaka logika kot KUBO v R523).
//
// Kaj naredi (idempotentno, na koncu verige db:seed):
//  A. lestvice → IZVIRNIKI (2560 px): POLNA 128, POLNA 100, ROMB 67;
//  B. lestvica TERASA 150 → izvirnik (2560 px) za 3 izdelke (DESKA 150 +
//     TER KLASIK + TER RUSTIC) — NAMENOMERNO BREZ čipov: lestvica kaže
//     žlebičasto (namestitveno) stran terasne deskе, ograja DESKA 150 pa
//     gladko stran (VLM dokaz) — vir površine za DESKA-150 ostajajo scenske
//     fotografije (dokazano R518);
//  C. 24 DETAJL čipov po varianti (izrez: ops/r524-cipi.mjs — deterministično,
//     revizija ops/r524-cipi.json): POLNA-57 (3), POLNA-128 (6), POLNA-100 (8),
//     ROMB-67 (7) — vir teksture za fotomontažo ograj (DETAJL prednost).
//
// Iskreno zapisano (issue #14 ostaja odprt):
//  - RWA 57/32 posnetkа NI v uradnih virih (galerija Pokončne ograje: samo
//    OAK WOOD in AMAZON WOOD zapisi za 57-32; salon: OKW) — oskrba #6;
//  - PROFIL_PRESEK za POLNA/DESKA NE obstaja (knjižnica: »presek« 0 zadetkov,
//    »profil«: samo votli ročaj; obeh produktnih strani preverjeni) — oskrba #6.
//
// Vsi vnosi preverijo sha256 proti public/assets/roksal/src/MANIFEST.json
// (isti revizijski standard kot seed-r493/r494/r495/r523).
/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const db = new PrismaClient()
const MARKER = '[seed-r524]'
const SRC_DIR = path.join(__dirname, '..', 'public', 'assets', 'roksal', 'src')
const SOURCE_NAME = 'Roksal d.o.o. — roksal.com (neposreden prenos iz uradne medijske knjižnice, R524)'
const PERMISSION = 'Lastnik aplikacije (2026-10-16): izvajalec dela za Roksal d.o.o. — javna produktna gradiva roksal.com dovoljena za poslovno orodje'

// ── A/B. lestvice → izvirniki ───────────────────────────────────────────────
const LESTVICE = [
  {
    file: 'roksal-barvna-lestvica-polna-128-full.png',
    productSkus: ['ROK-OG-POLNA-128'],
    url: 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_4-polna-128-4.png',
    opis: 'izvirnik 2560×683 (stran prikazuje 1024 px sličico) — vir DETAJL čipov R524',
    odtenki: 'Amazon wood, Ash wood, Burma teak, Oak wood, Rustic oak, Rustic walnut',
    // iskrenost do vira (isti zapis kot r494): slika 6 odtenkov, besedilo strani 5
    neskladje: 'NESKLADJE: slika prikazuje 6 odtenkov, besedilo strani pravi »petimi barvami« — oboje zabeleženo.',
  },
  {
    file: 'roksal-barvna-lestvica-polna-100-full.png',
    productSkus: ['ROK-OGP-POLNA-100'],
    url: 'https://roksal.com/wp-content/uploads/2024/10/BARVNA_LESTVICA_2_polna.png',
    opis: 'izvirnik 2560×600 (stran prikazuje 1024 px sličico) — vir DETAJL čipov R524',
    odtenki: 'Amazon wood, Ash wood, Golden teak, Burma teak, Oak wood, White, Rustic oak, Rustic walnut',
  },
  {
    file: 'roksal-barvna-lestvica-romb-67-full.png',
    productSkus: ['ROK-OG-ROMB-67'],
    url: 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_3-rombi4.png',
    opis: 'izvirnik 2560×669 (stran prikazuje 1024 px sličico) — vir DETAJL čipov R524',
    odtenki: 'Amazon wood, Ash wood, Golden teak, Burma teak, Oak wood, Rustic oak, Rustic walnut',
  },
  {
    file: 'roksal-barvna-lestvica-terasa-150-full.png',
    productSkus: ['ROK-OG-DESKA-150', 'ROK-TER-KLASIK', 'ROK-TER-RUSTIC'],
    url: 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_1-terasa4.png',
    opis: 'izvirnik 2560×680 (stran prikazuje 1024 px sličico); BREZ DETAJL čipov — lestvica kaže žlebičasto stran terasne deskе, ograja DESKA 150 pa gladko (VLM dokaz; vir površine DESKA-150 ostajajo scenične fotografije)',
    odtenki: 'Amazon wood, Ash wood, Golden teak, Burma teak, Oak wood, Rustic oak, Rustic walnut',
  },
]

// ── C. čipi (revizijsko poročilo orodja ops/r524-cipi.mjs) ─────────────────
const REVIZIJA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ops', 'r524-cipi.json'), 'utf8'))

/** Prebere datoteko in preveri sha256 + bytes proti MANIFEST.json (isti standard kot r493/r523). */
function preveriDatoteko (file) {
  const fp = path.join(SRC_DIR, file)
  if (!fs.existsSync(fp)) throw new Error(`manjka datoteka: ${fp}`)
  const buf = fs.readFileSync(fp)
  const sha = crypto.createHash('sha256').update(buf).digest('hex')
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'MANIFEST.json'), 'utf8'))
  const m = manifest.find((e) => e.file === file)
  if (!m) throw new Error(`manjka v MANIFEST.json: ${file}`)
  if (m.sha256 !== sha || m.bytes !== buf.length) throw new Error(`sha256/bytes ne ujema: ${file}`)
  return { sha, bytes: buf.length }
}

async function main () {
  console.log(`${MARKER} ── R524: DETAJL čipi za ograje (uradne lestvice, izvirna ločljivost) ──`)

  // ── A/B. lestvice → izvirniki (po (izdelek, vrsta), r523 logika) ──────────
  for (const l of LESTVICE) {
    const { sha, bytes } = preveriDatoteko(l.file)
    for (const sku of l.productSkus) {
      const prod = await db.product.findUnique({ where: { sku } })
      if (!prod) throw new Error(`manjka izdelek ${sku}`)
      const obstojeci = await db.productAsset.findFirst({ where: { productId: prod.id, kind: 'BARVNA_LESTVICA' } })
      const data = {
        status: 'VERIFIED',
        filePath: `public/assets/roksal/src/${l.file}`,
        cdnUrl: null,
        sha256: sha,
        bytes,
        capturedAt: new Date(),
        sourceUrl: l.url,
        sourceName: SOURCE_NAME,
        permission: PERMISSION,
        note: `Uradna barvna lestvica (${l.opis}), prenešena 2026-10-16 z javnega URL-ja roksal.com (brskalniška seja, datoteka nespremenjena — sha256 overjen). Odtenki: ${l.odtenki}.${l.neskladje ? ' ' + l.neskladje : ''} Preverjanje: R524 (tests/r524.py).`,
      }
      if (obstojeci) {
        await db.productAsset.update({ where: { id: obstojeci.id }, data })
      } else {
        await db.productAsset.create({ data: { productId: prod.id, kind: 'BARVNA_LESTVICA', orientation: 'SPLOSNO', ...data } })
      }
    }
    console.log(`${MARKER} lestvica ${l.file}: IZVIRNIK (${bytes} B, sha ${sha.slice(0, 10)}…) → ${l.productSkus.length}×izdelek`)
  }

  // ── C. DETAJL čipi po varianti ────────────────────────────────────────────
  for (const lestvica of REVIZIJA.lestvice) {
    const prod = await db.product.findUnique({ where: { sku: lestvica.sku } })
    if (!prod) throw new Error(`manjka izdelek ${lestvica.sku}`)
    // idempotenca: pobriši svoje prejšnje DETAJL čipe (marker po sourceName)
    await db.productAsset.deleteMany({ where: { productId: prod.id, kind: 'DETAJL', sourceName: SOURCE_NAME } })
    for (const c of lestvica.cipi) {
      const varianta = await db.productVariant.findUnique({ where: { sku: c.sku } })
      if (!varianta) throw new Error(`manjka varianta ${c.sku} (katalog mora biti sejan)`)
      const { sha, bytes } = preveriDatoteko(c.file)
      await db.productAsset.create({
        data: {
          productId: prod.id,
          variantSku: c.sku,
          kind: 'DETAJL',
          orientation: 'SPLOSNO',
          view: 'SPREDAJ',
          colorName: c.odtenek,
          filePath: `public/assets/roksal/src/${c.file}`,
          cdnUrl: null,
          sha256: sha,
          bytes,
          capturedAt: new Date(),
          sourceUrl: lestvica.lestvica.vir,
          sourceName: SOURCE_NAME,
          permission: PERMISSION,
          status: 'VERIFIED',
          note: `Čip površine ${c.odtenek} — deterministični izrez iz uradne barvne lestvice ${lestvica.sku} (izrez ${c.izrez.w}×${c.izrez.h} px znotraj čipa premera ${c.premerCipa} px${c.rotirano ? ', vlakna rotirana navpično po izmeri anizotropije (skladno z realno pokončno ograjo)' : ''}; barvna bližina katalogu ${c.barvnaRazdalja.toFixed(1)}/255). Revizija: ops/r524-cipi.json. Vir teksture za fotomontažo ograje (DETAJL pred FOTO_IZDELEK).`,
        },
      })
    }
    console.log(`${MARKER} ${lestvica.sku}: ${lestvica.cipi.length} DETAJL čipov (${lestvica.cipi.map(c => c.file.split('-').pop().replace('.png', '').toUpperCase()).join(',')})`)
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
