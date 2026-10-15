// seed-r495.cjs — ISSUE #6 nadaljevanje (R495): GALERIJSKE FOTOGRAFIJE PROFIL×BARVA + VRtno POHIŠTVO + POLNA 57/32
// Vir: roksal.com (2026-10-13, tretja raziskovalna seja):
//   - galerije roksal.com (pokončne/prečne ograje, terase, klopi-mize, fasade, pregradne stene, detajli)
//     naslovi lightbox zapisov vsebujejo PROFIL + BARVO (npr. »Deska 57-32, OAK WOOD.«) —
//     to so Roksalovi lastni podatki, zato je colorName POTRJEN (ne VLM približek)
//   - 47 datotek prenesenih z brskalniško sejo (fetch → base64; datoteke nespremenjene, sha256)
//   - vrtno pohištvo: 4 produktnе fotografije s strani /vrtno-pohistvo/ + 4 iz galerije Klopi in mize
// Rešitve odprtih točk R494:
//   - POLNA 57/32: stran pokončnih ograj zdaj izrecno pravi »trenutno na voljo štiri barve« +
//     prikazuje lestvico KUBO (4 odtenki: Amazon wood, Oak wood, Rustic oak, Rustic walnut);
//     barvna stran še vedno pravi »tri barve« (neskladje vira OBOJE zabeleženo) → 4 variante
//   - POLNA 128: lestvica ima 6 odtenkov (brez Golden teak — prebrano znova VLM), besedilo 5 → ostaja 6 (dokumentirano)
//   - KUBO lestvica: ponovno VLM preverjanje potrdilo Amazon wood, Oak wood, Rustic oak, Rustic walnut
//     (enako kot R494 zapis v DB) — galerijski dokazi (kubo: OAK 16, RUSTIC WALNUT 8, AMAZON 1) so skladni
// Cene: IZRECNO BREZ samodejnega vnosa cen (navodilo lastnika 2026-10-13) — salePrice ostaja ročni podatek.
// Idempotenca: gradiva se poveže po (productId, sourceUrl, kind); variante upsert po SKU.

const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

const SRC_DIR = path.join(__dirname, '..', 'public', 'assets', 'roksal', 'src')
const MARKER = '[R495]'
const TODAY = '2026-10-13'
const PERMISSION = 'Lastnik aplikacije (2026-10-13): izvajalec dela za Roksal d.o.o. — javna produktna gradiva roksal.com dovoljena za poslovno orodje'
const SOURCE_NAME = 'Roksal d.o.o. — roksal.com (javna galerija WPC)'

const KODA = {
  'Amazon wood': 'AMW', 'Ash wood': 'ASH', 'Golden teak': 'GLT', 'Burma teak': 'BUT',
  'Oak wood': 'OKW', 'White': 'WHT', 'Rustic oak': 'ROAK', 'Rustic walnut': 'RWA',
}

// ── 1. POLNA 57/32: 3 variante (R523: NAMENJENA lestvica 57/32 iz uradne
// medijske knjižnice, 2026-02, ima 3 čipe: Amazon wood, Oak wood, Rustic
// walnut — to je odločilen dokaz za tri barve; Rustic oak je bil odveč) ──
const POLNA_57_BARVE = ['Amazon wood', 'Oak wood', 'Rustic walnut']
const POLNA_57_OPOMBA =
  'Namenjena barvna lestvica POLNA 57/32 (roksal.com medijska knjižnica, 2026-02, BARVNA_LESTVICA_5-polna-deska-57-32_3.png): 3 odtenki — Amazon wood, Oak wood, Rustic walnut. ' +
  'Stran Barvni odtenki za 57/32 prikazuje lestvico KUBO (4 odtenki) z besedilom »tri barve«; R523 je odkril namensko lestvico in odstranil odvečni Rustic oak. Fotografski dokaz: Amazon wood, Oak wood.'


// ── 2. FOTOGRAFIJE (48 datotek, 50 povezav na izdelke; colorName = Roksalov lastni naziv iz galerije) ──
const PHOTOS = [
  {
    "file": "r495-deske-za-ograje-wpc-pokoncna_384.jpg",
    "sku": "ROK-OGP-POLNA-57",
    "color": "Amazon wood",
    "kind": "FOTO_IZDELEK",
    "ori": "POKOCNA",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/09/deske-za-ograje-wpc-pokoncna_384.jpg",
    "title": "AMAZON WOOD, naleganje na 5,7 cm, razmak 2 cm.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-pokoncne-ograje/ (galerija Pokončne ograje)",
    "furnitureCtx": false,
    "sha256": "885881b8058573fa5fea33a3181a7a12da21298df5039050d9be224d2e2a7bec",
    "bytes": 126197,
    "dims": "1000x712"
  },
  {
    "file": "r495-Polna-deska-57-32_salon1_NOVO.jpg",
    "sku": "ROK-OGP-POLNA-57",
    "color": "Oak wood",
    "kind": "FOTO_IZDELEK",
    "ori": "POKOCNA",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2025/09/Polna-deska-57-32_salon1_NOVO.jpg",
    "title": "Deska 57-32, OAK WOOD.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-pokoncne-ograje/ (galerija Pokončne ograje)",
    "furnitureCtx": false,
    "sha256": "4381a640e5f9b23d65b54daa3929ac880d903740011948173d83e0a86306d12a",
    "bytes": 263764,
    "dims": "929x1080"
  },
  {
    "file": "r495-wpc-deske-za-fasado-545.jpg",
    "sku": "ROK-OGP-POLNA-100",
    "color": "Amazon wood",
    "kind": "FOTO_IZDELEK",
    "ori": "POKOCNA",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/09/wpc-deske-za-fasado-545.jpg",
    "title": "Ograja AMAZON WOOD, naleganje na 5,7 cm, razmak 2 cm. V kombinaciji z Rustic Oak polno 100 za fasado.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-pokoncne-ograje/ (galerija Pokončne ograje)",
    "furnitureCtx": false,
    "sha256": "a4a554fbbdc9e15830fa1ee6416a9e976697394e1bf0f23fc21e3a6cefa574e9",
    "bytes": 247110,
    "dims": "1000x1333"
  },
  {
    "file": "r495-deske-za-ograje-wpc-precna-ograja_374-scaled.jpg",
    "sku": "ROK-OGP-POLNA-100",
    "color": "Rustic oak",
    "kind": "FOTO_IZDELEK",
    "ori": "POKOCNA",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2025/07/deske-za-ograje-wpc-precna-ograja_374-scaled.jpg",
    "title": "Deska 100, RUSTIC OAK",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-pokoncne-ograje/ (galerija Pokončne ograje)",
    "furnitureCtx": false,
    "sha256": "d899335bfde0fbb9679b03dbdb1c30568057cb3da0928d25be6c5b9e6558a9dc",
    "bytes": 581074,
    "dims": "2560x1920"
  },
  {
    "file": "r495-OsN9myO5-scaled.jpg",
    "sku": "ROK-OGP-POLNA-100",
    "color": "Ash wood",
    "kind": "FOTO_IZDELEK",
    "ori": "POKOCNA",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2023/07/OsN9myO5-scaled.jpg",
    "title": "Deska 100, ASH WOOD.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-pokoncne-ograje/ (galerija Pokončne ograje)",
    "furnitureCtx": false,
    "sha256": "1d51cc1836ebdd4300bd23c1d67065bd9da78adad24db085ce39f3cc9e9f7029",
    "bytes": 606918,
    "dims": "2560x1920"
  },
  {
    "file": "r495-deske-za-ograje-wpc-pokoncna_378.jpg",
    "sku": "ROK-OGP-POLNA-100",
    "color": "Rustic walnut",
    "kind": "FOTO_IZDELEK",
    "ori": "POKOCNA",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/07/deske-za-ograje-wpc-pokoncna_378.jpg",
    "title": "Deska 100, RUSTIC WALNUT.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-pokoncne-ograje/ (galerija Pokončne ograje)",
    "furnitureCtx": false,
    "sha256": "1a1e26a9e2706e78d00392daa5bb081556efd0735ab29a4b98347a33547e14c1",
    "bytes": 362226,
    "dims": "1464x678"
  },
  {
    "file": "r495-wpc-deske-za-strop-polna-deska-546.jpg",
    "sku": "ROK-OGP-POLNA-100",
    "color": "Oak wood",
    "kind": "FOTO_IZDELEK",
    "ori": "POKOCNA",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/07/wpc-deske-za-strop-polna-deska-546.jpg",
    "title": "Polna deska 100, OAK WOOD",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-fasada/ (galerija Fasade in stropi)",
    "furnitureCtx": false,
    "sha256": "8904299db6d5381d341f8bdbc6fc82de7938e1c59ec3b7610be600001e01ea36",
    "bytes": 266111,
    "dims": "1440x1440"
  },
  {
    "file": "r495-fasada_poln_deska100.jpg",
    "sku": "ROK-OGP-POLNA-100",
    "color": "Burma teak",
    "kind": "FOTO_IZDELEK",
    "ori": "POKOCNA",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/03/fasada_poln_deska100.jpg",
    "title": "Polna deska 100,  BURMA TEAK",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-fasada/ (galerija Fasade in stropi)",
    "furnitureCtx": false,
    "sha256": "e094bed84c643fa67f82b1c3ce8b76bda529f086afce47a8e4fb29600c353934",
    "bytes": 278283,
    "dims": "1920x1080"
  },
  {
    "file": "r495-web-fasada-golden2.jpg",
    "sku": "ROK-OGP-POLNA-100",
    "color": "Golden teak",
    "kind": "FOTO_IZDELEK",
    "ori": "POKOCNA",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2024/08/web-fasada-golden2.jpg",
    "title": "Polna deska 100,  GOLDEN TEAK",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-fasada/ (galerija Fasade in stropi)",
    "furnitureCtx": false,
    "sha256": "7864d56ca70d10c159fabd49c91673a4fac78128d98085bb3e463458f6a4fc7d",
    "bytes": 186899,
    "dims": "1038x1080"
  },
  {
    "file": "r495-Domzale-4-scaled.jpg",
    "sku": "ROK-OGP-POLNA-100",
    "color": "White",
    "kind": "FOTO_IZDELEK",
    "ori": "POKOCNA",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2023/07/Domzale-4-scaled.jpg",
    "title": "Deska 100, WHITE",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-pokoncne-ograje/ (galerija Pokončne ograje)",
    "furnitureCtx": false,
    "sha256": "19d79fab82c57cd8141584a90f1057600895056b9c5c6ddd059f41feddc72820",
    "bytes": 700807,
    "dims": "2550x1913"
  },
  {
    "file": "r495-deske-za-ograje-wpc-vrtna-ograja_1.jpg",
    "sku": "ROK-OG-POLNA-128",
    "color": "Oak wood",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/09/deske-za-ograje-wpc-vrtna-ograja_1.jpg",
    "title": "Deska 128, OAK WOOD.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-pokoncne-ograje/ (galerija Pokončne ograje)",
    "furnitureCtx": false,
    "sha256": "56545c4fada5b359c2c6a2f998fadb94e0eca155e2fa2e5333ed43161983093c",
    "bytes": 93973,
    "dims": "1000x450"
  },
  {
    "file": "r495-deske-za-ograje-wpc-precna-balkonska-ograja_375.jpg",
    "sku": "ROK-OG-POLNA-128",
    "color": "Amazon wood",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2025/08/deske-za-ograje-wpc-precna-balkonska-ograja_375.jpg",
    "title": "Deska 128, AMAZON WOOD.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-ograje-precne/ (galerija Prečne ograje)",
    "furnitureCtx": false,
    "sha256": "95e24b0613cfdd365bd7fcbebc154df9f58125a280a4b737a3ce7881b7b16492",
    "bytes": 178054,
    "dims": "1000x769"
  },
  {
    "file": "r495-deske-za-ograje-wpc-precna-balkonska-ograja_378.jpg",
    "sku": "ROK-OG-POLNA-128",
    "color": "Rustic walnut",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/05/deske-za-ograje-wpc-precna-balkonska-ograja_378.jpg",
    "title": "Deska 128, RUSTIC WALNUT.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-ograje-precne/ (galerija Prečne ograje)",
    "furnitureCtx": false,
    "sha256": "c44b4fe72e151f2c8f3b67f3058a028ede4b4ea6abca4ef2e41b31f27efb8bc0",
    "bytes": 71379,
    "dims": "1000x646"
  },
  {
    "file": "r495-pokoncna-ograjam-burma128-2.jpg",
    "sku": "ROK-OG-POLNA-128",
    "color": "Burma teak",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2023/12/pokoncna-ograjam-burma128-2.jpg",
    "title": "Deska 128, BURMA TEAK.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-pokoncne-ograje/ (galerija Pokončne ograje)",
    "furnitureCtx": false,
    "sha256": "24507323c32c77fab960ce9cc4f8dcdd6492223590f71c1e500014bfb47f57b7",
    "bytes": 321974,
    "dims": "1920x985"
  },
  {
    "file": "r495-precna-okraja-rustik-oak1.jpg",
    "sku": "ROK-OG-POLNA-128",
    "color": "Rustic oak",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2023/12/precna-okraja-rustik-oak1.jpg",
    "title": "Deska 128, RUSTIC OAK.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-ograje-precne/ (galerija Prečne ograje)",
    "furnitureCtx": false,
    "sha256": "7c6317089ec90de31fa3f8b74f46b663fcdbc5b981617fee6b9f83a922ebf32d",
    "bytes": 215450,
    "dims": "951x1080"
  },
  {
    "file": "r495-wpc-klop-in-miza-model-R-3-scaled.jpg",
    "sku": "ROK-OG-POLNA-128",
    "color": "Ash wood",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/09/wpc-klop-in-miza-model-R-3-scaled.jpg",
    "title": "Deska 128 ASH WOOD",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-klopi-mize/ (galerija Klopi in mize)",
    "furnitureCtx": true,
    "sha256": "2f5b2bd4b7fa241faa0424b157228947b678743dd3b23c9d24e4d3e5b80362fc",
    "bytes": 1093017,
    "dims": "2550x1697"
  },
  {
    "file": "r495-deske-za-fasade-in-pregradne-stene-lesni-kompozit_548-scaled.jpg",
    "sku": "ROK-OG-ROMB-67",
    "color": "Oak wood",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/02/deske-za-fasade-in-pregradne-stene-lesni-kompozit_548-scaled.jpg",
    "title": "Deska romb, OAK WOOD",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-fasada/ (galerija Fasade in stropi)",
    "furnitureCtx": false,
    "sha256": "d31bba7dbc9d943734a7361f8a1b7ea8989df2ebf7c433f85c333cb2d79fab92",
    "bytes": 454691,
    "dims": "1827x2560"
  },
  {
    "file": "r495-deske-za-ograje-wpc-precna-balkonska-ograja_377.jpg",
    "sku": "ROK-OG-ROMB-67",
    "color": "Rustic oak",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/05/deske-za-ograje-wpc-precna-balkonska-ograja_377.jpg",
    "title": "Deska romb, RUSTIC OAK,  razmak: 0,9 cm.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-ograje-precne/ (galerija Prečne ograje)",
    "furnitureCtx": false,
    "sha256": "f111b7fccfa4a929eed7554deccb1b5505c6b08c931393bb93a9b97c667cbe95",
    "bytes": 118087,
    "dims": "1000x750"
  },
  {
    "file": "r495-deske-za-ograje-wpc-precna-balkonska-ograja_381.jpg",
    "sku": "ROK-OG-ROMB-67",
    "color": "Amazon wood",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/09/deske-za-ograje-wpc-precna-balkonska-ograja_381.jpg",
    "title": "Deska romb, AMAZON WOOD,  razmak: 2,8 cm.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-ograje-precne/ (galerija Prečne ograje)",
    "furnitureCtx": false,
    "sha256": "6bc001d9a0662f78eacf755ec879aa31a20655eec73715fcad69db8393bee9a1",
    "bytes": 164165,
    "dims": "1000x645"
  },
  {
    "file": "r495-20230701_131424-scaled.jpg",
    "sku": "ROK-OG-ROMB-67",
    "color": "Ash wood",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2023/07/20230701_131424-scaled.jpg",
    "title": "Deska romb, ASH WOOD",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-ograje-precne/ (galerija Prečne ograje)",
    "furnitureCtx": false,
    "sha256": "0518c4c1732cdd032b38f005dd479725862e2cf8e2a5fcf7a77c9d9546eb1766",
    "bytes": 509256,
    "dims": "2560x1751"
  },
  {
    "file": "r495-wJ9HHeYe-scaled.jpg",
    "sku": "ROK-OG-ROMB-67",
    "color": "Burma teak",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2023/07/wJ9HHeYe-scaled.jpg",
    "title": "Deska romb, BURMA TEAK",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-ograje-precne/ (galerija Prečne ograje)",
    "furnitureCtx": false,
    "sha256": "489d7a8e7aa3ab65271432e2c42f90e0d40215f1ee88a5719a45e1b80a7c82d6",
    "bytes": 781055,
    "dims": "2550x1544"
  },
  {
    "file": "r495-wpc-woodcore-romb-golden-precna-ograja-gasper1.jpg",
    "sku": "ROK-OG-ROMB-67",
    "color": "Golden teak",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2021/03/wpc-woodcore-romb-golden-precna-ograja-gasper1.jpg",
    "title": "Deska romb, GOLDEN TEAK, razmak: 2,5 cm.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-ograje-precne/ (galerija Prečne ograje)",
    "furnitureCtx": false,
    "sha256": "527c23f898dd36afa566fa1fbdd67a7411b5bdc739c71917038da0f5cec43ba7",
    "bytes": 363331,
    "dims": "1434x1080"
  },
  {
    "file": "r495-IMG20241121123012_60.jpg",
    "sku": "ROK-OG-ROMB-67",
    "color": "Rustic walnut",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2025/02/IMG20241121123012_60.jpg",
    "title": "Deska kubo na fasadi, deska romb na stropu, RUSTIC WALNUT.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-fasada/ (galerija Fasade in stropi)",
    "furnitureCtx": false,
    "sha256": "ea6139616841120386a387fa4d2bcacd31e29179d86a0b4f01599332ec45fd05",
    "bytes": 169750,
    "dims": "1200x900"
  },
  {
    "file": "r495-precnapokoncna-ograja-burma.jpg",
    "sku": "ROK-OG-DESKA-150",
    "color": "Burma teak",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2023/12/precnapokoncna-ograja-burma.jpg",
    "title": "Deska 150 in deska 100, Burma Teak",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-pokoncne-ograje/ (galerija Pokončne ograje)",
    "furnitureCtx": false,
    "sha256": "512864f634bfc0748e2747ac7c31acd7694b724ae8945d02b8d9dac403ad9926",
    "bytes": 175187,
    "dims": "901x1080"
  },
  {
    "file": "r495-wpc-woodcore-terasna-amazon-precna-ograja-stul1.jpg",
    "sku": "ROK-OG-DESKA-150",
    "color": "Amazon wood",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2021/03/wpc-woodcore-terasna-amazon-precna-ograja-stul1.jpg",
    "title": "Deska 150, AMAZON WOOD.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-ograje-precne/ (galerija Prečne ograje)",
    "furnitureCtx": false,
    "sha256": "8bd84a3f643bdbee6dce0996c38a943e9863d6157b68ae6f1f1f4b7c1d1e80be",
    "bytes": 350640,
    "dims": "1920x1080"
  },
  {
    "file": "r495-wpc-woodcore-terasna-ash-precna-ograja-rud1.jpg",
    "sku": "ROK-OG-DESKA-150",
    "color": "Ash wood",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2021/03/wpc-woodcore-terasna-ash-precna-ograja-rud1.jpg",
    "title": "Deska 150, ASH WOOD.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-ograje-precne/ (galerija Prečne ograje)",
    "furnitureCtx": false,
    "sha256": "a49da0ae9390139b553c68cfb95cfe58a5fc81ce514583d55e7869f3e48c94e1",
    "bytes": 215015,
    "dims": "1440x1080"
  },
  {
    "file": "r495-1g244-jt-scaled.jpg",
    "sku": "ROK-OG-DESKA-150",
    "color": "Golden teak",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2023/07/1g244-jt-scaled.jpg",
    "title": "Deska 150, GOLDEN TEAK",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-ograje-precne/ (galerija Prečne ograje)",
    "furnitureCtx": false,
    "sha256": "db8da007966bbf6ca6b3d02d5984b66b3a8ba42b6eca2dcee5d11fe67cb1327f",
    "bytes": 779147,
    "dims": "2550x1913"
  },
  {
    "file": "r495-wpc-woodcore-terasna-romb-oakwood-teak-precna-ograja-sita2.jpg",
    "sku": "ROK-OG-DESKA-150",
    "color": "Oak wood",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2021/03/wpc-woodcore-terasna-romb-oakwood-teak-precna-ograja-sita2.jpg",
    "title": "Na zgornjem balkonu je deska 150, na spodnjem na deska romb. Oak Wood. Razmak pri profilu romb: 2,7 cm.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-ograje-precne/ (galerija Prečne ograje)",
    "furnitureCtx": false,
    "sha256": "18304cc4cec948dbc188964df1835f138a478409fa889fd139ea05748f975f4c",
    "bytes": 253300,
    "dims": "1440x1080"
  },
  {
    "file": "r495-slika-rustic-oak-fasada-2-2-scaled.jpg",
    "sku": "ROK-OG-DESKA-150",
    "color": "Rustic oak",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2023/07/slika-rustic-oak-fasada-2-2-scaled.jpg",
    "title": "Deska 150, RUSTIC OAK.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-fasada/ (galerija Fasade in stropi)",
    "furnitureCtx": false,
    "sha256": "4713235f0386ecf75bd641e88b97e25f5e73d8380e78ae140f8a3fd9665984fc",
    "bytes": 382560,
    "dims": "2550x1637"
  },
  {
    "file": "r495-180510216_3698754726901470_6477519107998540882_n.jpg",
    "sku": "ROK-OG-DESKA-150",
    "color": "Rustic walnut",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2023/07/180510216_3698754726901470_6477519107998540882_n.jpg",
    "title": "Deska 150, RUSTIC WALNUT.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-klopi-mize/ (galerija Klopi in mize)",
    "furnitureCtx": false,
    "sha256": "5e98baee869e5b0cf3592e41737a101ce16149f81eec255d4adfe81fabaf4731",
    "bytes": 107560,
    "dims": "960x747"
  },
  {
    "file": "r495-deske-za-fasade-in-pregradne-stene-lesni-kompozit_545.jpg",
    "sku": "ROK-FAS-KUBO",
    "color": "Rustic walnut",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2024/11/deske-za-fasade-in-pregradne-stene-lesni-kompozit_545.jpg",
    "title": "Deska kubo, RUSTIC WALNUT.",
    "gallery": "roksal.com/galerija-wpc-deske/terase/ (galerija Terase)",
    "furnitureCtx": false,
    "sha256": "7538a96280a1a56fc07051b4e25f7b97e7c506c3222b7cfe678fb8bc3807015a",
    "bytes": 219911,
    "dims": "1400x1050"
  },
  {
    "file": "r495-pp-kubo-fasada_2.jpg",
    "sku": "ROK-FAS-KUBO",
    "color": "Oak wood",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2025/02/pp-kubo-fasada_2.jpg",
    "title": "Deska kubo, OAK WOOD.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-fasada/ (galerija Fasade in stropi)",
    "furnitureCtx": false,
    "sha256": "8bfcefe0b53fb7c58c2d19b40e7a994cedb4951a25b8204f2a3839e1d58739eb",
    "bytes": 223799,
    "dims": "1440x900"
  },
  {
    "file": "r495-20240208_140526-1.jpg",
    "sku": "ROK-FAS-KUBO",
    "color": "Rustic oak",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2024/08/20240208_140526-1.jpg",
    "title": "Deska kubo, RUSTIC OAK.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-fasada/ (galerija Fasade in stropi)",
    "furnitureCtx": false,
    "sha256": "a6e588b7fca589af981c0adcbfab6e22965647a9fa918c04c3b770f32fea4014",
    "bytes": 246807,
    "dims": "1632x1080"
  },
  {
    "file": "r495-pregradna-stena-k.jpg",
    "sku": "ROK-FAS-KUBO",
    "color": "Amazon wood",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2024/08/pregradna-stena-k.jpg",
    "title": "Deska kubo, AMAZON WOOD.",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-pregradne-stene/ (galerija Pregradne stene)",
    "furnitureCtx": false,
    "sha256": "c148669b41f4e0cda54c55c7e7401ca01296da307e4b654990b403849e57d3ae",
    "bytes": 190769,
    "dims": "1185x1080"
  },
  {
    "file": "r495-wpc-miza-kubo-vrtno-pohistvo-768x429.jpg.webp",
    "sku": "ROK-VRT-MIZA-KUBO",
    "color": null,
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/05/wpc-miza-kubo-vrtno-pohistvo-768x429.jpg.webp",
    "title": "WPC vrtno pohištvo miza kubo v parku (stran Vrtno pohištvo)",
    "gallery": "roksal.com/woodcore-wpc-deske/vrtno-pohistvo/ (stran Vrtno pohištvo)",
    "furnitureCtx": false,
    "sha256": "cf72d01d0b5edfda05035d33f7543fcde70e45b686db3b158ccfa93f6bd63368",
    "bytes": 98662,
    "dims": "768x429"
  },
  {
    "file": "r495-wpc-klop-kubo-vrtno-pohistvo-768x429.jpg.webp",
    "sku": "ROK-VRT-KLOP-KUBO",
    "color": null,
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/05/wpc-klop-kubo-vrtno-pohistvo-768x429.jpg.webp",
    "title": "WPC vrtno pohištvo klop kubo v parku (stran Vrtno pohištvo)",
    "gallery": "roksal.com/woodcore-wpc-deske/vrtno-pohistvo/ (stran Vrtno pohištvo)",
    "furnitureCtx": false,
    "sha256": "6b78873241f90f2f5b8d17a25fb066789a67c45099e9904dedf304e243626701",
    "bytes": 98048,
    "dims": "768x429"
  },
  {
    "file": "r495-wpc-miza-linea-vrtno-pohistvo-768x429.jpg.webp",
    "sku": "ROK-VRT-MIZA-LINEA",
    "color": null,
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/05/wpc-miza-linea-vrtno-pohistvo-768x429.jpg.webp",
    "title": "WPC vrtno pohištvo — miza pod nadstreškom (stran Vrtno pohištvo)",
    "gallery": "roksal.com/woodcore-wpc-deske/vrtno-pohistvo/ (stran Vrtno pohištvo)",
    "furnitureCtx": false,
    "sha256": "a29dd82e741cd0d11dfd04aaef5aa1331a1a7b3bcb6b618097b656d47e3bd983",
    "bytes": 48144,
    "dims": "768x429"
  },
  {
    "file": "r495-wpc-klop-linea-vrtno-pohistvo-1-768x488.jpg.webp",
    "sku": "ROK-VRT-KLOP-LINEA",
    "color": null,
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/05/wpc-klop-linea-vrtno-pohistvo-1-768x488.jpg.webp",
    "title": "WPC vrtno pohištvo — klop v senci pri travniku (stran Vrtno pohištvo)",
    "gallery": "roksal.com/woodcore-wpc-deske/vrtno-pohistvo/ (stran Vrtno pohištvo)",
    "furnitureCtx": false,
    "sha256": "2c328988efb801f101315b1034d1e02a85441283e996a223a60aa9218cf861f8",
    "bytes": 106452,
    "dims": "768x488"
  },
  {
    "file": "r495-wpc-klop-in-miza-model-X-1-scaled.jpg",
    "sku": "ROK-VRT-MIZA-X",
    "color": "Rustic oak",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/09/wpc-klop-in-miza-model-X-1-scaled.jpg",
    "title": "Deska 128 - RUSTIC OAK",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-klopi-mize/ (galerija Klopi in mize)",
    "furnitureCtx": false,
    "sha256": "4d4f537ad63eb8e96b4bcdc7d4e75ba7682b0ee7c225461b34fbe319aefa6804",
    "bytes": 1038533,
    "dims": "2550x1697"
  },
  {
    "file": "r495-wpc-klop-in-miza-model-X-1-scaled.jpg",
    "sku": "ROK-VRT-KLOP-X",
    "color": "Rustic oak",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/09/wpc-klop-in-miza-model-X-1-scaled.jpg",
    "title": "Deska 128 - RUSTIC OAK",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-klopi-mize/ (galerija Klopi in mize)",
    "furnitureCtx": false,
    "sha256": "4d4f537ad63eb8e96b4bcdc7d4e75ba7682b0ee7c225461b34fbe319aefa6804",
    "bytes": 1038533,
    "dims": "2550x1697"
  },
  {
    "file": "r495-wpc-klop-in-miza-model-R-1-scaled.jpg",
    "sku": "ROK-VRT-MIZA-R",
    "color": "Burma teak",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/09/wpc-klop-in-miza-model-R-1-scaled.jpg",
    "title": "Deska 128 - BURMA TEAK",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-klopi-mize/ (galerija Klopi in mize)",
    "furnitureCtx": false,
    "sha256": "bd515f79a77cfe91eab08ac3a9050c014962c056577d9c520f6871d039140d7f",
    "bytes": 1089309,
    "dims": "2550x1697"
  },
  {
    "file": "r495-wpc-klop-in-miza-model-R-1-scaled.jpg",
    "sku": "ROK-VRT-KLOP-R",
    "color": "Burma teak",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/09/wpc-klop-in-miza-model-R-1-scaled.jpg",
    "title": "Deska 128 - BURMA TEAK",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-klopi-mize/ (galerija Klopi in mize)",
    "furnitureCtx": false,
    "sha256": "bd515f79a77cfe91eab08ac3a9050c014962c056577d9c520f6871d039140d7f",
    "bytes": 1089309,
    "dims": "2550x1697"
  },
  {
    "file": "r495-klop_Roksal_romb_kovina.jpg",
    "sku": "ROK-VRT-KLOP-KUBO",
    "color": "Rustic walnut",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/05/klop_Roksal_romb_kovina.jpg",
    "title": "Kubo - RUSTIC WALNUT",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-klopi-mize/ (galerija Klopi in mize)",
    "furnitureCtx": false,
    "sha256": "adc92ab92977458239241b7a07c31596b7783f7c2d5effe67a513201298158a0",
    "bytes": 136432,
    "dims": "1600x893"
  },
  {
    "file": "r495-naslon_detajl-scaled.jpg",
    "sku": "ROK-VRT-KLOP-LINEA",
    "color": "Oak wood",
    "kind": "FOTO_IZDELEK",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2026/05/naslon_detajl-scaled.jpg",
    "title": "Deska 57-32 - OAK WOOD",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-klopi-mize/ (galerija Klopi in mize)",
    "furnitureCtx": false,
    "sha256": "21de8c07a178f73c048d6d50ec6df52390b7d629f0f7c702793171d8fc34d955",
    "bytes": 624528,
    "dims": "1920x2560"
  },
  {
    "file": "r495-burma-terasa.jpg",
    "sku": "ROK-TER-KLASIK",
    "color": "Burma teak",
    "kind": "DETAJL",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2021/03/burma-terasa.jpg",
    "title": "Terasa v odtenku Burma teak (galerija Detajli; ime datoteke potrjuje barvo)",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-detajli-terase-ograje-fasade/ (galerija Detajli)",
    "furnitureCtx": false,
    "sha256": "474dede6d37f4bc7435adfce607c2341f5af8f8b275b6915b7199da5b7ad04f6",
    "bytes": 519279,
    "dims": "1920x1080"
  },
  {
    "file": "r495-ash-wood-oreh-detajl.jpg",
    "sku": "ROK-TER-KLASIK",
    "color": "Ash wood",
    "kind": "DETAJL",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2021/03/ash-wood-oreh-detajl.jpg",
    "title": "Detajl terase — Ash wood (galerija Detajli; ime datoteke potrjuje barvo)",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-detajli-terase-ograje-fasade/ (galerija Detajli)",
    "furnitureCtx": false,
    "sha256": "ac406d8e06e1f5ced4b90a8289a8e1fde21f6f045903dec6272d89a994e55d54",
    "bytes": 502947,
    "dims": "1920x1080"
  },
  {
    "file": "r495-oak-ceb-detajl.jpg",
    "sku": "ROK-TER-KLASIK",
    "color": "Oak wood",
    "kind": "DETAJL",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2021/03/oak-ceb-detajl.jpg",
    "title": "Detajl terase — Oak wood (galerija Detajli; ime datoteke potrjuje barvo)",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-detajli-terase-ograje-fasade/ (galerija Detajli)",
    "furnitureCtx": false,
    "sha256": "41cd7a21ab8487740c8d68eb2d66a38abf2ae26ed26a68e2bf959b3dd285cbdd",
    "bytes": 163040,
    "dims": "720x1080"
  },
  {
    "file": "r495-woodcore-rustic-oak-zel-detajl.jpg",
    "sku": "ROK-TER-RUSTIC",
    "color": "Rustic oak",
    "kind": "DETAJL",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2021/03/woodcore-rustic-oak-zel-detajl.jpg",
    "title": "Detajl terase Rustic — Rustic oak (galerija Detajli; ime datoteke)",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-detajli-terase-ograje-fasade/ (galerija Detajli)",
    "furnitureCtx": false,
    "sha256": "c28ddd1abc361d034e42d6819b3ebea356d348cf52839a1a8cb5d9f98ea91d5b",
    "bytes": 400810,
    "dims": "1920x1080"
  },
  {
    "file": "r495-woodcore-rustic-walnut-de2.jpg",
    "sku": "ROK-TER-RUSTIC",
    "color": "Rustic walnut",
    "kind": "DETAJL",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2021/03/woodcore-rustic-walnut-de2.jpg",
    "title": "Detajl terase Rustic — Rustic walnut (galerija Detajli; ime datoteke)",
    "gallery": "roksal.com/galerija-wpc-deske/wpc-detajli-terase-ograje-fasade/ (galerija Detajli)",
    "furnitureCtx": false,
    "sha256": "d8dea419e1c3dc5e334ece51d7350e0a085059ef5b10bf31dc6ce6f251a9e783",
    "bytes": 293558,
    "dims": "1920x1080"
  },
  {
    "file": "r495-zakljucna-letev.jpg",
    "sku": "ROK-KOM-ZAKL-LETV",
    "color": null,
    "kind": "KOMPONENTA",
    "ori": "SPLOSNO",
    "sourceUrl": "https://roksal.com/wp-content/uploads/2020/03/zakljucna-letev.jpg",
    "title": "Zaključna letev za WPC teraso 45x55 mm",
    "gallery": "roksal.com/woodcore-wpc-deske/wpc-deske-za-teraso/ (stran Terase — razdelek Elementi)",
    "furnitureCtx": false,
    "sha256": "f91b05944f9594a9b480a2985bf393c3d40e3ede01a6889bad25ddd0b1e1e8ac",
    "bytes": 2564,
    "dims": "200x145"
  }
]

async function main () {
  console.log(`${MARKER} ── issue #6 (R495): galerijske fotografije profil×barva ──`)

  // ── A. POLNA 57/32: 3 variante (R523) + posodobljena opomba ──
  const p57 = await db.product.findUnique({ where: { sku: 'ROK-OGP-POLNA-57' } })
  if (!p57) throw new Error('manjka izdelek ROK-OGP-POLNA-57')
  let nVar = 0
  for (const barva of POLNA_57_BARVE) {
    const vSku = `ROK-OGP-POLNA-57-${KODA[barva]}`
    await db.productVariant.upsert({
      where: { sku: vSku },
      create: { productId: p57.id, sku: vSku, name: `POLNA 57/32 — ${barva}`, color: barva, ral: null },
      update: { name: `POLNA 57/32 — ${barva}`, color: barva, ral: null, active: true },
    })
    nVar++
  }
  console.log(`${MARKER} POLNA 57/32: ${nVar} variant (AMW, OKW, RWA — namenska lestvica, R523)`)
  const tech57 = typeof p57.tech === 'string' ? JSON.parse(p57.tech) : (p57.tech || {})
  tech57.barvOpomba = POLNA_57_OPOMBA
  tech57.barv = 3
  await db.product.update({ where: { id: p57.id }, data: { tech: JSON.stringify(tech57) } })

  // ── B. fotografije: ProductAsset zapisi z dokazljivo provenienco ──
  let nAssets = 0, nSkip = 0
  for (const ph of PHOTOS) {
    const fp = path.join(SRC_DIR, ph.file)
    if (!fs.existsSync(fp)) throw new Error(`manjka datoteka: ${fp}`)
    const prod = await db.product.findUnique({ where: { sku: ph.sku } })
    if (!prod) throw new Error(`manjka izdelek ${ph.sku}`)
    // varianta (če obstaja) — poveži tudi njo
    let vSku = null
    if (ph.color) {
      const cand = `${ph.sku}-${KODA[ph.color]}`
      const v = await db.productVariant.findUnique({ where: { sku: cand } })
      if (v) vSku = cand
    }
    const obst = await db.productAsset.findFirst({
      where: { productId: prod.id, sourceUrl: ph.sourceUrl, kind: ph.kind },
    })
    const note =
      `Roksalova galerija — naslov zapisu: »${ph.title}«. ${ph.gallery}. ` +
      (ph.furnitureCtx ? 'Kontekst: vrtno pohištvo (deska 128 v odtenku Ash wood na klopi/mizi model R). ' : '') +
      (ph.color
        ? `Barva ${ph.color} POTRJENA z nazivom v viru (ne VLM ocena). `
        : 'Naslov vira ne navaja barve (colorName prazno — pošteno). ') +
      `Prenos ${TODAY} prek brskalniške seje (fetch → base64), datoteka nespremenjena (${ph.dims}).`
    const data = {
      kind: ph.kind,
      orientation: ph.ori,
      view: ph.kind === 'DETAJL' ? 'DETAJL' : 'SPREDAJ',
      colorName: ph.color || null,
      colorApprox: null, // odstranimo morebitni približek — ime je potrjeno
      filePath: `public/assets/roksal/src/${ph.file}`,
      cdnUrl: null,
      sourceUrl: ph.sourceUrl,
      sha256: ph.sha256,
      bytes: ph.bytes,
      sourceName: SOURCE_NAME,
      capturedAt: new Date(),
      permission: PERMISSION,
      status: 'VERIFIED',
      variantSku: vSku,
      note,
    }
    if (obst) {
      await db.productAsset.update({ where: { id: obst.id }, data })
      nSkip++
    } else {
      await db.productAsset.create({ data: { ...data, productId: prod.id } })
      nAssets++
    }
  }
  console.log(`${MARKER} fotografije: ${nAssets} novih zapisov, ${nSkip} posodobljenih (${PHOTOS.length} povezav)`)

  // ── C. povzetek ──
  const prods = await db.product.count({ where: { sku: { startsWith: 'ROK-' } } })
  const vars = await db.productVariant.count({ where: { sku: { startsWith: 'ROK-' } } })
  const assets = await db.productAsset.count()
  const verified = await db.productAsset.count({ where: { status: 'VERIFIED' } })
  console.log(`${MARKER} KONEC: ${prods} ROK izdelkov / ${vars} variant / ${assets} gradiv (${verified} VERIFIED)`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
