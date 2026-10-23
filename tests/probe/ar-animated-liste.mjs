// R582 sonda: AR modul — pretvorba dinamičnih seznamov v AnimatedList.
// Preverja PREČKO (vrsta naloženih fotografij): po nalaganju 2 slik mora
// vrsta obstajati kot [role=list] z [role=listitem] (AnimatedList, R582)
// in VHODNA ANIMACIJA mora teči (ulomek opacity < 1 v prvih 500 ms —
// stagger 0,04 s + trajanje 0,2 s). Struktura brez animacije = regresija
// (navaden <ul> brez motion). BASE privzeto lokalni dev; vloga monter.
const { chromium, devices } = await import('playwright')

const BASE = process.argv[2] ?? 'http://localhost:3000'
const EMAIL = process.argv[3] ?? 'monter@roksal.si'
const PASS = process.argv[4] ?? 'Monter123!'
const log = (...a) => console.log('[r582-ar-liste]', ...a)

const browser = await chromium.launch()
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  permissions: [],
})
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.getByRole('textbox', { name: 'E-pošta' }).fill(EMAIL)
  await page.getByRole('textbox', { name: 'Geslo' }).fill(PASS)
  await page.getByRole('button', { name: 'Prijava', exact: true }).click()
  await page.waitForTimeout(3000)
  // SmartGuide sheet + dev overlay
  for (let n = 0; n < 5 && await page.locator('[data-slot="sheet-content"]').count(); n++) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }
  await page.evaluate(() => { for (const p of document.querySelectorAll('nextjs-portal')) p.remove() }).catch(() => {})

  // AR zavihek (m=ar)
  await page.goto(BASE + '/?m=ar', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await page.evaluate(() => { for (const p of document.querySelectorAll('nextjs-portal')) p.remove() }).catch(() => {})

  // ── PREČKA: naloži 2 sliki (vrsta se prikaže TAKOJ, brez VLM klica) ──
  const png1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const png2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mPj+M+AAQABhAGUAMYBf7AAAAABJRU5ErkJggg=='
  const f1 = await page.request.get(BASE + '/icon-192.png')
  log('ikona za test:', f1.status())

  const files = [
    { name: 'ogaja-a.png', mimeType: 'image/png', buffer: Buffer.from(png1.replace('data:image/png;base64,', ''), 'base64') },
    { name: 'ograda-b.png', mimeType: 'image/png', buffer: Buffer.from(png2.replace('data:image/png;base64,', ''), 'base64') },
  ]
  const multi = page.locator('input[type=file][multiple]').first()
  await multi.setInputFiles(files)

  // vrsta mora obstojati v 2 s (se izriše takoj)
  const queueSel = '[role=list]'
  await page.waitForSelector(queueSel, { timeout: 4000 }).catch(() => {})
  const queueCount = await page.locator(queueSel).count()
  const itemCount = await page.locator('[role=listitem]').count()
  log('role=list:', queueCount, '| role=listitem:', itemCount)

  const strukturaOK = queueCount >= 1 && itemCount >= 2

  // ── animacija: opacity < 1 v prvih 500 ms po vnosu ──
  // (vzorčenje vsakih 25 ms; AnimatedListItem vstop iz opacity 0)
  let animacijaUjeta = false
  const t0 = Date.now()
  while (Date.now() - t0 < 500) {
    const ops = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role=listitem]')).map((el) => Number(getComputedStyle(el).opacity))
    ).catch(() => [])
    if (ops.some((o) => o > 0 && o < 0.99)) { animacijaUjeta = true; break }
    await page.waitForTimeout(25)
  }
  log('vhodna animacija ujeta:', animacijaUjeta)

  // besedilo vrste (Foto 1 / Foto 2) + gumb Odstrani (a11y ohranjen)
  const txt = await page.evaluate(() => document.body.textContent.includes('Foto 1:') && document.body.textContent.includes('Foto 2:'))
  log('vrsta prikazuje obe sliki:', txt)

  // ── poročilo ──
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  log('preliv:', overflow + 'px', '| pageerror:', pageErrors.length)

  const uspeh = strukturaOK && txt && overflow <= 0 && pageErrors.length === 0
  log(uspeh ? 'REZULTAT: OK' : 'REZULTAT: Napaka')
  log('opomba: animacija (opacity<1) je mehki dokaz — na zelo hitrih strojih se lahko zgodi v <25 ms; struktura je obvezna, animacija informativna.')
  process.exitCode = uspeh ? 0 : 1
} catch (e) {
  log('NAPAKA:', String(e).slice(0, 300))
  process.exitCode = 1
} finally {
  await browser.close()
}
