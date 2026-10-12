// seed-test.cjs — TESTNI PODATKI za lažje testiranje (R490, uporabniška zahteva)
/* eslint-disable @typescript-eslint/no-require-imports */
//
// NAMEN: en ukaz za znano testno stanje — NE pobriše obstoječih demo podatkov
// (prisma/seed.cjs), temveč doda/obnovi SVOJE zapise z markerji:
//   - uporabniki  : upsert po e-pošti (5 vlog + 1 dodatni monter)
//   - stranka     : upsert po e-pošti test@stranka.si
//   - projekta    : P-TEST-001 (TEREN, aktiven nalog) in P-TEST-002 (ZAKLJUCEN, soglasje za galerijo)
//   - nalog       : N-TEST-001 (V_TEKU, dodeljen monter@roksal.si)
//   - slike       : prisma/test-slike/*.jpg → Measurement type FOTO (location '[TEST] …')
//   - QA točke    : MontazaCheck templateKey 'test:fixture' (6 točk, 1 NAPAKA s fotografijo)
//   - odstopanje  : MontazaDeviation s foto dokazilom (praskan premaz)
//   - checklist   : 4 točke InstallationChecklist na N-TEST-001
//
// Poganjanje:  bun run db:seed:test   (ali: node prisma/seed-test.cjs)
// Ponovni zagon je varen — svoje zapise najprej pobriše po markerjih in jih znova ustvari.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

// ── DATABASE_URL iz okolja ali env.sh (robustnost) ────────────────────────────
if (!process.env.DATABASE_URL) {
  const envSh = path.join(__dirname, '..', 'env.sh')
  if (fs.existsSync(envSh)) {
    const m = fs.readFileSync(envSh, 'utf8').match(/DATABASE_URL="([^"]+)"/)
    if (m) process.env.DATABASE_URL = m[1]
  }
}
if (!process.env.DATABASE_URL) {
  console.error('[seed-test] MANJKA DATABASE_URL (izvoz iz env.sh ali okolje)')
  process.exit(1)
}

const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

function hashPassword (password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

// testna slika → dataURL (enak format kot foto modul: params.photo)
function imageDataUrl (file) {
  const p = path.join(__dirname, 'test-slike', file)
  if (!fs.existsSync(p)) throw new Error(`Manjka testna slika: ${p} (poženi prisma/test-slike/gen.sh)`)
  return 'data:image/jpeg;base64,' + fs.readFileSync(p).toString('base64')
}

const LOC = (s) => `[TEST] ${s}` // marker location na vseh testnih FOTO meritvah
const TEMPLATE_KEY = 'test:fixture' // marker QA točk (vir: testni kompleti)
const NOW = new Date()

async function main () {
  console.log('[seed-test] … testni uporabniki')
  // ── 1. UPORABNIKI (upsert po e-pošti) ────────────────────────────────────────
  const USERS = [
    { email: 'admin@roksal.si', password: 'Admin123!', name: 'Robert Pezdirc', role: 'ADMIN' },
    { email: 'vodja@roksal.si', password: 'Vodja123!', name: 'Matej Kovač', role: 'VODJA' },
    { email: 'monter@roksal.si', password: 'Monter123!', name: 'Luka Novak', role: 'MONTER' },
    { email: 'monter2@roksal.si', password: 'Monter123!', name: 'Marko Horvat', role: 'MONTER' },
    { email: 'skladisce@roksal.si', password: 'Skladisce123!', name: 'Tomaž Zupan', role: 'SKLADISCE' },
    { email: 'proizvodnja@roksal.si', password: 'Proizvodnja123!', name: 'Ana Kos', role: 'PROIZVODNJA' }
  ]
  const users = {}
  for (const u of USERS) {
    users[u.email.split('@')[0]] = await db.user.upsert({
      where: { email: u.email },
      create: { email: u.email, passwordHash: hashPassword(u.password), name: u.name, role: u.role },
      update: { name: u.name, role: u.role, active: true } // geslo NE prepišemo obstoječemu uporabniku
    })
  }
  const { admin, vodja, monter, monter2, skladisce, proizvodnja } = users

  console.log('[seed-test] … testna stranka')
  // ── 2. STRANKA ───────────────────────────────────────────────────────────────
  let stranka = await db.customer.findFirst({ where: { email: 'test@stranka.si' } })
  if (!stranka) {
    stranka = await db.customer.create({
      data: { name: 'Testna stranka d.o.o.', email: 'test@stranka.si', phone: '040 000 000', address: 'Testna ulica 1', city: 'Ljubljana', taxId: 'SI00000000', note: 'TEST podatki — za razvoj in preizkušanje' }
    })
  }

  console.log('[seed-test] … testna projekta (P-TEST-001 TEREN, P-TEST-002 ZAKLJUCEN)')
  // ── 3. PROJEKTA ──────────────────────────────────────────────────────────────
  const pAktiven = await db.project.upsert({
    where: { code: 'P-TEST-001' },
    create: {
      code: 'P-TEST-001', title: 'TEST — Terasna ograja, Testna ulica 1', status: 'TEREN',
      customerId: stranka.id, address: 'Testna ulica 1, Ljubljana',
      note: 'Testni projekt za razvoj in preizkušanje (montaža v teku).'
    },
    update: {}
  })
  const pZakljucen = await db.project.upsert({
    where: { code: 'P-TEST-002' },
    create: {
      code: 'P-TEST-002', title: 'TEST — Balkon in stopnišče, zaključeno', status: 'ZAKLJUCEN',
      customerId: stranka.id, address: 'Testna ulica 2, Ljubljana',
      note: 'Testni projekt za galerijo (veljavno soglasje za objavo fotografij).',
      photoConsentAt: NOW, photoConsentById: admin.id
    },
    update: { status: 'ZAKLJUCEN', photoConsentAt: NOW, photoConsentById: admin.id }
  })

  console.log('[seed-test] … testni nalog N-TEST-001 (V_TEKU)')
  // ── 4. NALOG ─────────────────────────────────────────────────────────────────
  const nalog = await db.workOrder.upsert({
    where: { code: 'N-TEST-001' },
    create: {
      code: 'N-TEST-001', title: 'TEST — Montaža terasne ograje (5 stebrov + ročnik)',
      projectId: pAktiven.id, status: 'V_TEKU', assigneeId: monter.id,
      scheduledFor: NOW, startedAt: NOW,
      instructions: 'Testni nalog: montaža antracitne aluminijaste ograje na betonski parapet. Preveri pritrditve, vertikalnost in premaz.'
    },
    update: { status: 'V_TEKU', assigneeId: monter.id, projectId: pAktiven.id }
  })

  console.log('[seed-test] … brisanje prejšnjih testnih slik/točk (markerji)')
  // ── 5. POBRIŠI SVOJE ZAPISE (idempotenca) ────────────────────────────────────
  await db.montazaDeviation.deleteMany({ where: { workOrder: { code: 'N-TEST-001' } } })
  await db.montazaCheck.deleteMany({ where: { workOrderId: nalog.id } })
  await db.installationChecklist.deleteMany({ where: { workOrderId: nalog.id } })
  await db.measurement.deleteMany({
    where: { location: { startsWith: '[TEST] ' }, project: { code: { startsWith: 'P-TEST' } } }
  })

  console.log('[seed-test] … 9 realnih testnih slik → FOTO meritve')
  // ── 6. SLIKE → Measurement type FOTO ────────────────────────────────────────
  const foto = async (file, opts) => {
    return db.measurement.create({
      data: {
        type: 'FOTO',
        projectId: opts.projectId,
        workOrderId: opts.workOrderId ?? null,
        authorId: opts.authorId,
        location: LOC(opts.location),
        note: opts.note ?? null,
        params: JSON.stringify({ photo: imageDataUrl(file) })
      }
    })
  }

  // a) tekač montaže na P-TEST-001 (PRED → MED → PO) + meritve + dokazilo napake
  const fPred = await foto('montaza-pred.jpg', { projectId: pAktiven.id, workOrderId: nalog.id, authorId: monter.id, location: 'PRED montažo — prazna terasa', note: 'Izhodišče: betonski parapet brez ograje (PRED).' })
  const fMed = await foto('montaza-med.jpg', { projectId: pAktiven.id, workOrderId: nalog.id, authorId: monter.id, location: 'MED montažo — vijačenje stebrov', note: 'Potek dela: stebri se vijačijo na podlogo, kontrola nivoja (MED).' })
  const fPo = await foto('montaza-po.jpg', { projectId: pAktiven.id, workOrderId: nalog.id, authorId: monter.id, location: 'PO montaži — zaključena ograja', note: 'Zaključeno stanje: antracitna ograja, pogled iz kota terase (PO).' })
  const fMeritev = await foto('meritev.jpg', { projectId: pAktiven.id, workOrderId: nalog.id, authorId: monter.id, location: 'Zajem izmere — rob terase', note: 'Merjenje roba terase z merilnim trakom in svinčnikom (dokumentacija zajema).' })
  const fNapaka = await foto('napaka-praskana.jpg', { projectId: pAktiven.id, workOrderId: nalog.id, authorId: monter.id, location: 'Dokazilo napake — praskan premaz seg-2', note: 'Praskan pražni premaz na stebru seg-2 (transport). Služi kot dokazilo odstopanja.' })

  // b) zaključena dela na P-TEST-002 (galerija + consent)
  await foto('balkon-steklo.jpg', { projectId: pZakljucen.id, authorId: vodja.id, location: 'Steklena balkonska ograja', note: 'Zaključeno delo: steklena panelna ograja s srebrnimi stebri.' })
  await foto('terasna-ograja.jpg', { projectId: pZakljucen.id, authorId: vodja.id, location: 'Terasna ograja — vertikalni lameli', note: 'Zaključeno delo: antracitna ograja iz vertikalnih lamel na leseni terasi.' })
  await foto('stopniska.jpg', { projectId: pZakljucen.id, authorId: monter.id, location: 'Notranja stopniščna ograja', note: 'Zaključeno delo: aluminijast ročnik s steklom na notranjem stopnišču.' })
  await foto('kovana-ograja.jpg', { projectId: pZakljucen.id, authorId: vodja.id, location: 'Kovana vrtna ograja', note: 'Zaključeno delo: kovana ograja z okrasnim kovanjem na vhodu.' })

  console.log('[seed-test] … QA kontrolne točke na N-TEST-001 (1 NAPAKA s fotografijo)')
  // ── 7. MONTAŽA QA TOČKE ─────────────────────────────────────────────────────
  const CHECKS = [
    { label: 'Pritrditev stebrov na podlogo (vijaki/anker)', critical: true, status: 'V_REDU', photo: fPo, stepId: 'pritrditev', instr: 'Preveri vse vijake z momentnim ključem po specifikaciji.' },
    { label: 'Vertikalnost stebrov (nivo ±2 mm/m)', critical: true, status: 'V_REDU', photo: fPo, stepId: 'varnost', instr: 'Stebre preveri z nivojem na dveh straneh.' },
    { label: 'Zunanji pregled premaza (praske, odrgnine)', critical: false, status: 'NAPAKA', photo: fNapaka, stepId: 'kvaliteta', instr: 'Površino pregledaj po celotni dolžini; poškodbe dokumentiraj s fotografijo.', note: 'Praskan premaz na stebru seg-2 — globoka praska do kovine (glej odstopanje).' },
    { label: 'Pritrditev in ravnost ročnika', critical: false, status: 'V_REDU', stepId: 'kvaliteta', instr: 'Ročnik ne sme se premikati; površina brez sledi orodja.' },
    { label: 'Zaščita podloge pri vrtanju', critical: false, status: 'NI_RELEVANTNO', stepId: 'varnost', instr: 'Pod drsenje podloge zaščiti pred prahom.', note: 'Vrtanje v predvrtane luknje — zaščita ni potrebna.' },
    { label: 'Čistost mesta dela in odvoz odpadkov', critical: false, status: 'NI_ZACETO', stepId: 'kvaliteta', instr: 'Mesto dela pusti čisto; embalažo odvozi.' }
  ]
  const checks = []
  for (let i = 0; i < CHECKS.length; i++) {
    const c = CHECKS[i]
    checks.push(await db.montazaCheck.create({
      data: {
        workOrderId: nalog.id,
        templateKey: TEMPLATE_KEY, templateVersion: 1,
        stepId: c.stepId ?? null,
        label: c.label, instruction: c.instr,
        critical: c.critical,
        status: c.status,
        photoId: c.photo ? c.photo.id : null,
        note: c.note ?? null,
        checkedById: c.status === 'NI_ZACETO' ? null : monter.id,
        checkedAt: c.status === 'NI_ZACETO' ? null : NOW,
        sortOrder: i
      }
    }))
  }

  console.log('[seed-test] … odstopanje s foto dokazilom (seg-2)')
  // ── 8. ODSTOPANJE ────────────────────────────────────────────────────────────
  await db.montazaDeviation.create({
    data: {
      workOrderId: nalog.id,
      checkId: checks[2].id, // NAPAKA — premaz
      reason: 'Praskan pražni premaz na stebru seg-2 (poškodba pri transportu)',
      location: 'Terasa — drugi steber od vhoda',
      targetKey: 'seg-2',
      photoId: fNapaka.id,
      impactMaterial: true,
      impactPrice: false,
      impactSafety: false,
      note: 'Potrebna retuša premaza (popravilo lak v barvi RAL 7016).',
      createdById: monter.id
    }
  })

  console.log('[seed-test] … kontrolni seznam na N-TEST-001')
  // ── 9. INSTALLATION CHECKLIST ────────────────────────────────────────────────
  const CHECKLIST = [
    { label: 'Pregled delovnega mesta in materiala', done: true },
    { label: 'Izmera in označba položajev stebrov', done: true },
    { label: 'Montaža stebrov in panelov', done: false },
    { label: 'Končni pregled in čiščenje', done: false }
  ]
  for (let i = 0; i < CHECKLIST.length; i++) {
    await db.installationChecklist.create({
      data: {
        workOrderId: nalog.id,
        label: CHECKLIST[i].label,
        done: CHECKLIST[i].done,
        doneAt: CHECKLIST[i].done ? NOW : null,
        doneById: CHECKLIST[i].done ? monter.id : null,
        sortOrder: i
      }
    })
  }

  // ── 10. PREGLED ──────────────────────────────────────────────────────────────
  const count = {
    uporabniki: await db.user.count(),
    fotoTest: await db.measurement.count({ where: { type: 'FOTO', location: { startsWith: '[TEST] ' } } }),
    qa: await db.montazaCheck.count({ where: { workOrderId: nalog.id } }),
    odkloni: await db.montazaDeviation.count({ where: { workOrderId: nalog.id } })
  }

  console.log('\n════════════════════════════════════════════════════════════')
  console.log('  TESTNI PODATKI PRIPRAVLJENI (R490)')
  console.log('════════════════════════════════════════════════════════════')
  console.log('  Uporabniki (skupaj %d) — prijava z geslom v oklepaju:', count.uporabniki)
  USERS.forEach(u => console.log('    ' + u.email.padEnd(24) + u.role.padEnd(12) + u.name + '  (geslo: ' + u.password + ')'))
  console.log('\n  Testna slika: %d FOTO meritev z markerjem [TEST]', count.fotoTest)
  console.log('    P-TEST-001 (TEREN)  → N-TEST-001: PRED/MED/PO + izmera + dokazilo napake')
  console.log('    P-TEST-002 (ZAKLJ.) → 4 zaključena dela (galerija, soglasje veljavno)')
  console.log('  QA točke na N-TEST-001: %d (1× NAPAKA s foto) · odstopanja: %d', count.qa, count.odkloni)
  console.log('════════════════════════════════════════════════════════════\n')
}

main()
  .catch((e) => { console.error('[seed-test] NAPAKA:', e); process.exit(1) })
  .finally(() => db.$disconnect())
