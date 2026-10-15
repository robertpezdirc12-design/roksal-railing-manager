// prisma/seed-r523.cjs — R523 (issue #14): kakovost teksture KUBO + manjkajoči
// uradni materiali + poštena ureditev variant po uradnih lestvicah.
//
// Zakaj:
//  - R520 je teksturo KUBO fasade rezal iz sceničnih namestitvenih fotografij
//    (17–21 px na desko — na povečavi zamegljeno, vse letvice identičen klon);
//  - uradna barvna lestvica KUBO v IZVIRNIKU (2217×675, wp-content/uploads,
//    ne 1024 px sličica) vsebuje 4 FOTOGRAFSKE čipe površine po odtenku;
//  - v uradni medijski knjižnici obstaja NAMENJENA lestvica POLNA 57/32
//    (2026-02, 3 čipi: Amazon wood, Oak wood, Rustic walnut) — stran Barvni
//    odtenki za 57/32 namreč lenobno prikazuje lestvico KUBO;
//  - POLNA 100/128/57: manjkajoči produktni/tehnični posnetki.
//
// Kaj naredi (idempotentno, na koncu verige db:seed):
//  A. odstrani odvečno varianto ROK-OGP-POLNA-57-ROAK (namenska lestvica 57/32
//     ima 3 čipe; Rustic oak zanjo ne obstaja — schema.variantSku je niz brez
//     FK prav zato, da varianto smemo odstraniti);
//  B. KUBO BARVNA_LESTVICA → IZVORNIK 2217×675 (nadgradnja obstoječega zapisa);
//  C. POLNA-57 BARVNA_LESTVICA → NAMENJENA lestvica 57/32 (ne zrcalo KUBO);
//  D. KUBO: 4 DETAJL čipi površine po varianti (AMW/OKW/ROAK/RWA) — vir
//     teksture za fotomontažo fasade (izberiGradivo, DETAJL prednost);
//  E. KUBO: PROFIL_PRESEK (uradni tehnični posnetek profilov z alu cevmi);
//  F. POLNA-57: produktni posnetek (FOTO_IZDELEK, družinska raven).
//
// Vsi vnosi preverijo sha256 proti public/assets/roksal/src/MANIFEST.json
// ( isti revizijski standard kot seed-r493/r494/r495). Izrez čipov je
// determinističen in revizijsko zabeležen v ops/r523-cipi.json (orodje:
// ops/r523-cipi.mjs — brez AI, brez retuširanja: samo izrez in rotacija
// vlaken po izmeri anizotropije).
/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const db = new PrismaClient()
const MARKER = '[seed-r523]'
const SRC_DIR = path.join(__dirname, '..', 'public', 'assets', 'roksal', 'src')
const SOURCE_NAME = 'Roksal d.o.o. — roksal.com (neposreden prenos iz uradne medijske knjižnice, R523)'
const PERMISSION = 'Lastnik aplikacije (2026-10-15): izvajalec dela za Roksal d.o.o. — javna produktna gradiva roksal.com dovoljena za poslovno orodje'

// ── datoteke (sha256 se preveri proti MANIFEST.json) ───────────────────────
const KUBO_LESTVICA_FULL = {
  file: 'roksal-barvna-lestvica-kubo-full.png',
  url: 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_5-kubo4.png',
}
const POLNA57_LESTVICA = {
  file: 'roksal-barvna-lestvica-polna-57.png',
  url: 'https://roksal.com/wp-content/uploads/2026/02/BARVNA_LESTVICA_5-polna-deska-57-32_3.png',
}
const KUBO_PROFIL = {
  file: 'roksal-kubo-profil-cevi.jpg',
  url: 'https://roksal.com/wp-content/uploads/2024/03/deske-kubo-razlicne-cevi.jpg',
}
const POLNA57_PRODUKT = {
  file: 'roksal-polna57-produkt.jpg',
  url: 'https://roksal.com/wp-content/uploads/2025/07/polna-deska-57-32.jpg',
}

// KUBO čipi površine po varianti (izrez iz uradne lestvice — revizija ops/r523-cipi.json)
const KUBO_CIPI = [
  { koda: 'AMW', odtenek: 'Amazon wood', file: 'roksal-kubo-cip-amw.png' },
  { koda: 'OKW', odtenek: 'Oak wood', file: 'roksal-kubo-cip-okw.png' },
  { koda: 'ROAK', odtenek: 'Rustic oak', file: 'roksal-kubo-cip-roak.png' },
  { koda: 'RWA', odtenek: 'Rustic walnut', file: 'roksal-kubo-cip-rwa.png' },
]

const REVIZIJA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ops', 'r523-cipi.json'), 'utf8'))

/** Prebere datoteko in preveri sha256 + bytes proti MANIFEST.json (isti standard kot r493). */
function preveriDatoteko (file) {
  const fp = path.join(SRC_DIR, file)
  if (!fs.existsSync(fp)) throw new Error(`manjka datoteka: ${fp}`)
  const buf = fs.readFileSync(fp)
  const sha = crypto.createHash('sha256').update(buf).digest('hex')
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'MANIFEST.json'), 'utf8'))
  const m = manifest.find((e) => e.file === file)
  if (!m) throw new Error(`manjka v MANIFEST.json: ${file}`)
  if (m.sha256 !== sha || m.bytes !== buf.length) throw new Error(`sha256/bytes ne ujema: ${file}`)
  return { buf, sha, bytes: buf.length }
}

async function main () {
  console.log(`${MARKER} ── R523: KUBO tekstura (čipi uradne lestvice) + manjkajoči materiali ──`)

  // ── A. odvečna varianta POLNA-57 ROAK (uradna namenska lestvica: 3 barve) ──
  const odvecna = await db.productVariant.findUnique({ where: { sku: 'ROK-OGP-POLNA-57-ROAK' } })
  if (odvecna) {
    await db.productVariant.delete({ where: { id: odvecna.id } })
    console.log(`${MARKER} odstranjena odvečna varianta ROK-OGP-POLNA-57-ROAK (namenska lestvica 57/32: 3 barve — AMW, OKW, RWA)`)
  } else {
    console.log(`${MARKER} varianta ROAK za POLNA-57 že odstranjena ✓`)
  }

  // ── B/C. lestvici: KUBO → izvirnik 2217×675; POLNA-57 → namenska lestvica ──
  const lestvici = [
    { sku: 'ROK-FAS-KUBO', rec: KUBO_LESTVICA_FULL, opis: 'izvirnik 2217×675 (stran prikazuje 1024 px sličico)', odtenki: 'Amazon wood, Oak wood, Rustic oak, Rustic walnut' },
    { sku: 'ROK-OGP-POLNA-57', rec: POLNA57_LESTVICA, opis: 'NAMENJENA lestvica 57/32 (3 čipi) — nadomesti zrcalo lestvice KUBO s strani Barvni odtenki', odtenki: 'Amazon wood, Oak wood, Rustic walnut' },
  ]
  for (const l of lestvici) {
    const prod = await db.product.findUnique({ where: { sku: l.sku } })
    if (!prod) throw new Error(`manjka izdelek ${l.sku}`)
    const { sha, bytes } = preveriDatoteko(l.rec.file)
    const obstojeci = await db.productAsset.findMany({ where: { productId: prod.id, kind: 'BARVNA_LESTVICA' } })
    const data = {
      status: 'VERIFIED',
      filePath: `public/assets/roksal/src/${l.rec.file}`,
      cdnUrl: null,
      sha256: sha,
      bytes,
      capturedAt: new Date(),
      sourceUrl: l.rec.url,
      sourceName: SOURCE_NAME,
      permission: PERMISSION,
      note: `Uradna barvna lestvica (${l.opis}), prenesena 2026-10-15 z javnega URL-ja roksal.com (agent-brskalnik skozi varnostni izziv, datoteka nespremenjena — sha256 overjen). Odtenki: ${l.odtenki}. Preverjanje: R523 (tests/r523.py).`,
    }
    if (obstojeci.length === 0) {
      await db.productAsset.create({ data: { productId: prod.id, kind: 'BARVNA_LESTVICA', orientation: 'SPLOSNO', ...data } })
    } else {
      for (const o of obstojeci) await db.productAsset.update({ where: { id: o.id }, data })
    }
    console.log(`${MARKER} ${l.sku}: BARVNA_LESTVICA → ${l.rec.file} (${bytes} B, sha ${sha.slice(0, 10)}…)`)
  }

  // ── D. KUBO čipi površine: DETAJL po varianti ─────────────────────────────
  const kubo = await db.product.findUnique({ where: { sku: 'ROK-FAS-KUBO' } })
  if (!kubo) throw new Error('manjka izdelek ROK-FAS-KUBO')
  // idempotenca: pobriši svoje prejšnje DETAJL čipe (marker po sourceName)
  await db.productAsset.deleteMany({ where: { productId: kubo.id, kind: 'DETAJL', sourceName: SOURCE_NAME } })
  for (const c of KUBO_CIPI) {
    const vSku = `ROK-FAS-KUBO-${c.koda}`
    const varianta = await db.productVariant.findUnique({ where: { sku: vSku } })
    if (!varianta) throw new Error(`manjka varianta ${vSku} (katalog mora biti sejan)`)
    const rev = REVIZIJA.cipi.find((x) => x.sku === vSku)
    if (!rev) throw new Error(`revizijsko poročilo ops/r523-cipi.json ne vsebuje ${vSku}`)
    const { sha, bytes } = preveriDatoteko(c.file)
    await db.productAsset.create({
      data: {
        productId: kubo.id,
        variantSku: vSku,
        kind: 'DETAJL',
        orientation: 'SPLOSNO',
        view: 'SPREDAJ',
        colorName: c.odtenek,
        filePath: `public/assets/roksal/src/${c.file}`,
        cdnUrl: null,
        sha256: sha,
        bytes,
        capturedAt: new Date(),
        sourceUrl: KUBO_LESTVICA_FULL.url,
        sourceName: SOURCE_NAME,
        permission: PERMISSION,
        status: 'VERIFIED',
        note: `Čip površine KUBO · ${c.odtenek} — deterministični izrez iz uradne barvne lestvice (izrez ${rev.izrez.w}×${rev.izrez.h} px znotraj čipa premera ${rev.premerCipa} px${rev.rotirano ? ', vlakna rotirana navpično po izmeri anizotropije (skladno z realno KUBO fasado)' : ''}; barvna bližina katalogu ${rev.barvnaRazdalja.toFixed(1)}/255). Revizija: ops/r523-cipi.json. Vir teksture za fotomontažo fasade (DETAJL pred FOTO_IZDELEK).`,
      },
    })
    console.log(`${MARKER} ROK-FAS-KUBO-${c.koda}: DETAJL čip ${c.file} (${rev.izrez.w}×${rev.izrez.h} px, ${rev.rotirano ? 'rotirano' : 'brez rotacije'})`)
  }

  // ── E. KUBO PROFIL_PRESEK (uradni tehnični posnetek) ──────────────────────
  {
    const { sha, bytes } = preveriDatoteko(KUBO_PROFIL.file)
    await db.productAsset.deleteMany({ where: { productId: kubo.id, kind: 'PROFIL_PRESEK', sourceName: SOURCE_NAME } })
    await db.productAsset.create({
      data: {
        productId: kubo.id,
        kind: 'PROFIL_PRESEK',
        orientation: 'SPLOSNO',
        view: 'DETAJL',
        filePath: `public/assets/roksal/src/${KUBO_PROFIL.file}`,
        cdnUrl: null,
        sha256: sha,
        bytes,
        capturedAt: new Date(),
        sourceUrl: KUBO_PROFIL.url,
        sourceName: SOURCE_NAME,
        permission: PERMISSION,
        status: 'VERIFIED',
        note: 'Uradni tehnični posnetek profilov KUBO 80×42 z alu cevmi (20×20, 25×25, 20×60 mm — primerno za PROFIL_PRESEK enako kot ROMB-67). Preneseno 2026-10-15.',
      },
    })
    console.log(`${MARKER} ROK-FAS-KUBO: PROFIL_PRESEK ${KUBO_PROFIL.file} (${bytes} B)`)
  }

  // ── F. POLNA-57 produktni posnetek (družinska raven) ──────────────────────
  {
    const p57 = await db.product.findUnique({ where: { sku: 'ROK-OGP-POLNA-57' } })
    if (!p57) throw new Error('manjka izdelek ROK-OGP-POLNA-57')
    const { sha, bytes } = preveriDatoteko(POLNA57_PRODUKT.file)
    await db.productAsset.deleteMany({ where: { productId: p57.id, kind: 'FOTO_IZDELEK', sourceName: SOURCE_NAME } })
    await db.productAsset.create({
      data: {
        productId: p57.id,
        kind: 'FOTO_IZDELEK',
        orientation: 'POKOCNA',
        view: 'SPREDAJ',
        colorName: 'Oak wood',
        filePath: `public/assets/roksal/src/${POLNA57_PRODUKT.file}`,
        cdnUrl: null,
        sha256: sha,
        bytes,
        capturedAt: new Date(),
        sourceUrl: POLNA57_PRODUKT.url,
        sourceName: SOURCE_NAME,
        permission: PERMISSION,
        status: 'VERIFIED',
        note: 'Uradni produktni posnetek WPC polne deske 5,7/3,2 cm (odtenek Oak wood — posnetek profila, ne scenična namestitev). Preneseno 2026-10-15.',
      },
    })
    console.log(`${MARKER} ROK-OGP-POLNA-57: FOTO_IZDELEK ${POLNA57_PRODUKT.file} (${bytes} B)`)
  }

  // ── povzetek ───────────────────────────────────────────────────────────────
  const p57barve = await db.productVariant.findMany({ where: { productId: (await db.product.findUnique({ where: { sku: 'ROK-OGP-POLNA-57' } })).id }, select: { sku: true } })
  const kuboDetajli = await db.productAsset.count({ where: { productId: kubo.id, kind: 'DETAJL' } })
  console.log(`${MARKER} KONEC: POLNA-57 ${p57barve.length} variant (${p57barve.map(v => v.sku.split('-').pop()).join(',')}), KUBO DETAJL ×${kuboDetajli}, lestvici nadgrajeni ${MARKER}`)
}

main().catch((e) => { console.error(`${MARKER} NAPAKA:`, e); process.exit(1) }).finally(() => db.$disconnect())
