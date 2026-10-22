// R579 sonda: sistematičen pregled vodoravnega preliva (scrollWidth > clientWidth)
// po VSEH sekcijah in pod-zavihkih admin vtičnika na iPhone 13 (390×844).
// Cilj: najti ostanek "9px preliva" iz R575 evidence in identificirati krivca.
// BASE privzeto lokalni dev.
const { chromium, devices } = await import('playwright')

const BASE = process.argv[2] ?? 'http://localhost:3000'
const EMAIL = process.argv[3] ?? 'admin@roksal.si'
const PASS = process.argv[4] ?? 'Admin123!'
const log = (...a) => console.log('[r579-sweep]', ...a)

const MEASURE = () => {
  const doc = document.documentElement
  const overflow = doc.scrollWidth - doc.clientWidth
  if (overflow <= 0) return { overflow }
  // poišči krivca: elemente, ki segajo čez desni rob viewporta
  const vw = doc.clientWidth
  const culprits = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.right > vw + 1) {
      const cls = String(el.className).split(' ').slice(0, 3).join('.')
      culprits.push(`${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}@${Math.round(r.right - vw)}px`)
      if (culprits.length >= 5) break
    }
  }
  return { overflow, culprits }
}

async function main () {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.getByRole('textbox', { name: 'E-pošta' }).fill(EMAIL)
  await page.getByRole('textbox', { name: 'Geslo' }).fill(PASS)
  await page.getByRole('button', { name: 'Prijava', exact: true }).click()
  await page.waitForTimeout(3000)

  const closeGuides = async () => {
    let n = 0
    while (await page.locator('[data-slot="sheet-content"]').count() && n < 5) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      n++
    }
  }
  // nextjs dev overlay portal (gumb spodaj desno) prestreže klike na mobilni navigaciji — odstrani
  const killOverlay = () => page.evaluate(() => {
    for (const p of document.querySelectorAll('nextjs-portal')) p.remove()
  }).catch(() => {})
  await killOverlay()
  await closeGuides()

  const results = []
  const nav = page.getByRole('navigation', { name: 'Navigacija sekcij' })
  const sectionNames = await nav.getByRole('button').allTextContents()

  for (const sec of sectionNames) {
    await nav.getByRole('button', { name: sec, exact: true }).click()
    await page.waitForTimeout(900)
    await killOverlay()
    await closeGuides()
    const m0 = await page.evaluate(MEASURE)
    results.push({ view: sec, ...m0 })
    log(`sek ${sec}: ${m0.overflow}px ${m0.culprits ? '← ' + m0.culprits.join(' | ') : ''}`)

    // pod-zavihki (podmoduli) znotraj sekcije
    const tabs = await page.getByRole('tab').allTextContents()
    for (const t of tabs) {
      const tab = page.getByRole('tab', { name: t, exact: true })
      if (!(await tab.count())) continue
      try {
        await tab.click({ timeout: 3000 })
        await page.waitForTimeout(700)
        await killOverlay()
        await closeGuides()
        const m = await page.evaluate(MEASURE)
        results.push({ view: `${sec} › ${t}`, ...m })
        if (m.overflow > 0) log(`  PRELIV ${sec} › ${t}: ${m.overflow}px ← ${m.culprits?.join(' | ')}`)
      } catch { /* zavihek morda izginil po interakciji */ }
    }
  }

  // zadnji klikani zavihek je lahko pustil odprt podmodul — povzetek
  const bad = results.filter(r => r.overflow > 0)
  log('─'.repeat(50))
  log(`pregledanih pogledov: ${results.length}, s prelivom: ${bad.length}`)
  for (const b of bad) log(`  ✗ ${b.view}: ${b.overflow}px — ${b.culprits?.join(' | ')}`)
  if (!bad.length) log('  ✓ nikjer ni vodoravnega preliva na 390px')
  log('napake strani:', errors.length ? errors.slice(0, 3).join(' | ') : 'nič')
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
