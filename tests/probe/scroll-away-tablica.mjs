// R575 sonda: scroll-away scenarij na tablici — ko monter scrolla dialog navzdol
// (do comboboxov "Metoda kalibracije" / "1. točka", ki so NIZKO pod sliko),
// ali slika uide iz vidnega polja in ali tap nanjo še vedno doda točko?
// BASE privzeto produkcija.
const { chromium, devices } = await import('playwright')
const { writeFileSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')

const BASE = process.argv[2] ?? 'https://roksal-railing-manager.vercel.app'
const log = (...a) => console.log('[r575-scroll]', ...a)

// Povzeta testna slika iz r574 sonde (majhna veljavna JPEG)
const src = await import('node:fs').then(fs => fs.readFileSync('tests/probe/oznacevanje-touch.mjs', 'utf8'))
const m = src.match(/const TEST_JPG_B64 = '([^']+)'/)
if (!m) { console.error('ni TEST_JPG_B64'); process.exit(1) }
const imgPath = join(tmpdir(), 'r575-scroll-test.jpg')
writeFileSync(imgPath, Buffer.from(m[1], 'base64'))

async function main () {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'], permissions: ['camera'] })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.getByRole('textbox', { name: 'E-pošta' }).fill('monter@roksal.si')
  await page.getByRole('textbox', { name: 'Geslo' }).fill('Monter123!')
  await page.getByRole('button', { name: 'Prijava', exact: true }).click()
  await page.waitForTimeout(2800)
  const closeGuides = async () => { let n = 0; while (await page.locator('[data-slot="sheet-content"]').count() && n < 5) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); n++ } }
  await closeGuides()
  await page.getByRole('navigation', { name: 'Navigacija sekcij' }).getByRole('button', { name: /Projekti/ }).click()
  await page.waitForTimeout(800); await closeGuides()
  await page.getByRole('tab', { name: 'Meritve', exact: true }).click()
  await page.waitForTimeout(1200); await closeGuides()
  await page.getByRole('button', { name: 'Meritve s kamero' }).click()
  await page.waitForTimeout(1000)
  await page.locator('input[type=file]').first().setInputFiles(imgPath)
  await page.waitForTimeout(2600)

  const kalib = page.locator('div[role=application][aria-label*="Fotografija za kalibracijo"]')
  await kalib.waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(800)

  const measure = async () => await page.evaluate(() => {
    const k = document.querySelector('div[role=application][aria-label*="Fotografija za kalibracijo"]')
    if (!k) return null
    const dlg = document.querySelector('[data-slot="dialog-content"]')
    const kb = k.getBoundingClientRect(); const db = dlg.getBoundingClientRect()
    const vh = innerHeight
    const visiblePx = Math.max(0, Math.min(kb.bottom, Math.min(db.bottom, vh)) - Math.max(kb.y, db.y))
    return { vpH: vh, imgY: Math.round(kb.y), imgH: Math.round(kb.height), dlgY: Math.round(db.y), dlgH: Math.round(db.height), pct: Math.round(visiblePx / kb.height * 100), atCenter: (() => { const el = document.elementFromPoint(kb.x + kb.width / 2, Math.min(Math.max(kb.y + kb.height / 2, 5), vh - 5)); return el ? el.tagName + '.' + String(el.className).split(' ').slice(0, 3).join('.') : 'none' })() }
  })

  const g0 = await measure()
  log('0) ob vstopu: slika', g0.pct + '%', 'vidna, imgY=', g0.imgY, ', na sredini slike je element:', g0.atCenter)

  // SCENARIJ: monter scrolla dialog navzdol do kalibracijskega obrazca (combobox "Metoda kalibracije" je pod sliko)
  await page.evaluate(() => {
    const dlg = document.querySelector('[data-slot="dialog-content"]')
    const sel = dlg?.querySelector('[aria-label="Metoda kalibracije"]') || dlg
    sel?.scrollIntoView({ block: 'center' })
  })
  await page.waitForTimeout(900)
  const g1 = await measure()
  log('1) po scrollu do "Metoda kalibracije": slika', g1.pct + '%', 'vidna, imgY=', g1.imgY, ', na sredini slike je element:', g1.atCenter)

  // Monter tapne tam, kjer je slika (njen center, če je še delno vidna, sicer kjer je bila)
  const ptsBefore = await kalib.locator('span[title^="Točka"]').count()
  const tapY = Math.min(Math.max(g1.imgY + g1.imgH / 2, 10), g1.vpH - 10)
  const tapX = 320
  const hit = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el ? el.tagName + '.' + String(el.className).split(' ').slice(0, 2).join('.') : 'none' }, [tapX, tapY])
  await page.touchscreen.tap(tapX, Math.round(tapY))
  await page.waitForTimeout(900)
  const ptsAfter = await kalib.locator('span[title^="Točka"]').count()
  const dlgOpen = (await page.locator('[data-slot="dialog-content"]').count()) === 1
  log('2) tap na center slike @(' + tapX + ',' + Math.round(tapY) + ') zadene element:', hit, '→ točke:', ptsBefore, '→', ptsAfter, ptsAfter > ptsBefore ? '✓ DODANO' : '✗ NI DODANO (monter: "ne deluje")', '| dialog odprt:', dlgOpen)

  // ali je slika sploh šedosegljiva z scrollom nazaj?
  await page.evaluate(() => { document.querySelector('div[role=application][aria-label*="Fotografija za kalibracijo"]')?.scrollIntoView({ block: 'center' }) })
  await page.waitForTimeout(700)
  const g2 = await measure()
  log('3) po scrollIntoView nazaj: slika', g2.pct + '%', 'vidna, na sredini:', g2.atCenter)
  await page.touchscreen.tap(300, Math.round(Math.min(Math.max(g2.imgY + g2.imgH / 2, 10), g2.vpH - 10)))
  await page.waitForTimeout(800)
  const ptsFinal = await kalib.locator('span[title^="Točka"]').count()
  log('4) tap po vrnitvi slike v center: točke:', ptsFinal, ptsFinal > ptsAfter ? '✓ deluje' : '✗')

  log('napake strani:', errors.length ? errors.join(' | ') : 'nič')
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
