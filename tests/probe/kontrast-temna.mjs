// R580 sonda: kontrastni pregled temne teme — WCAG AA za vsako vidno besedilo.
// Za vsak tekstovni element izračuna dejansko barvo ozadjа (prek vseh plasteh)
// in razmerje kontrasta; poroča kršitve (4.5:1 normalno, 3:1 veliko besedilo).
// BASE privzeto lokalni dev.
const { chromium, devices } = await import('playwright')

const BASE = process.argv[2] ?? 'http://localhost:3000'
const log = (...a) => console.log('[r580-kontrast]', ...a)

// v glavnem kontekstu: izračun kontrasta za vsa besedila
const AUDIT = () => {
  const parse = (s) => {
    const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
    if (!m) return null
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }
  }
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 })
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
  const bgOf = (el) => {
    let node = el
    const stack = []
    while (node && node !== document.documentElement) {
      const c = parse(getComputedStyle(node).backgroundColor)
      if (c && c.a > 0) stack.push(c)
      if (c && c.a >= 1) break
      node = node.parentElement
    }
    // korensko ozadje
    const root = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }
    let bg = root
    for (let i = stack.length - 1; i >= 0; i--) bg = blend(stack[i], bg)
    return bg
  }
  const out = []
  const seen = new Set()
  for (const el of document.querySelectorAll('body *')) {
    if (!el.childNodes.length) continue
    let text = ''
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.textContent
    text = text.trim()
    if (!text) continue
    const st = getComputedStyle(el)
    if (st.visibility === 'hidden' || st.display === 'none') continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const fg = parse(st.color)
    if (!fg) continue
    const bg = bgOf(el)
    const fgB = fg.a < 1 ? blend(fg, bg) : fg
    const cr = ratio(fgB, bg)
    const size = parseFloat(st.fontSize)
    const weight = parseInt(st.fontWeight)
    const large = size >= 24 || (size >= 18.66 && weight >= 700)
    const need = large ? 3 : 4.5
    if (cr < need) {
      const key = `${st.color}|${Math.round(size)}|${text.slice(0, 30)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        text: text.slice(0, 40),
        color: st.color, size: Math.round(size * 10) / 10, weight,
        cr: Math.round(cr * 100) / 100, need,
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).split(' ').slice(0, 3).join('.').slice(0, 60),
      })
    }
  }
  return out
}

async function main () {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.getByRole('textbox', { name: 'E-pošta' }).fill('admin@roksal.si')
  await page.getByRole('textbox', { name: 'Geslo' }).fill('Admin123!')
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
  const killOverlay = () => page.evaluate(() => {
    for (const p of document.querySelectorAll('nextjs-portal')) p.remove()
  }).catch(() => {})
  await killOverlay()
  await closeGuides()

  // preklopi v TEMNO temo
  await page.getByRole('button', { name: 'Preklopi temo' }).click()
  await page.waitForTimeout(800)
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  log('tema po preklopu:', isDark ? 'TEMNA ✓' : 'SVETLA ✗ (preklop ni uspel)')
  if (!isDark) { await browser.close(); process.exit(1) }

  const all = []
  const views = []
  const nav = page.getByRole('navigation', { name: 'Navigacija sekcij' })
  const sectionNames = await nav.getByRole('button').allTextContents()

  for (const sec of sectionNames) {
    await nav.getByRole('button', { name: sec, exact: true }).click()
    await page.waitForTimeout(900)
    await killOverlay()
    await closeGuides()
    const r = await page.evaluate(AUDIT)
    views.push({ view: sec, fails: r.length })
    all.push(...r.map(x => ({ ...x, view: sec })))
    log(`sek ${sec}: ${r.length} kršitev`)

    const tabs = await page.getByRole('tab').allTextContents()
    for (const t of tabs) {
      const tab = page.getByRole('tab', { name: t, exact: true })
      if (!(await tab.count())) continue
      try {
        await tab.click({ timeout: 3000 })
        await page.waitForTimeout(600)
        await killOverlay()
        await closeGuides()
        const rr = await page.evaluate(AUDIT)
        if (rr.length) {
          views.push({ view: `${sec} › ${t}`, fails: rr.length })
          all.push(...rr.map(x => ({ ...x, view: `${sec} › ${t}` })))
          log(`  ${sec} › ${t}: ${rr.length} kršitev`)
        }
      } catch { /* zavihek izginil */ }
    }
  }

  log('─'.repeat(60))
  log(`skupaj kršitev WCAG AA v temni temi: ${all.length}`)
  // združi po vzorcu (barva+velikost+razred) — najpogostejši vzorci
  const byPattern = {}
  for (const f of all) {
    const k = `${f.color} ${f.cls}`
    byPattern[k] = byPattern[k] || { count: 0, minCr: 99, sample: f.text, views: new Set(), tag: f.tag, size: f.size }
    byPattern[k].count++
    byPattern[k].minCr = Math.min(byPattern[k].minCr, f.cr)
    byPattern[k].views.add(f.view)
  }
  const sorted = Object.entries(byPattern).sort((a, b) => b[1].count - a[1].count)
  for (const [k, v] of sorted.slice(0, 25)) {
    log(`  ${v.count}× [${v.minCr}:1] <${v.tag} ${v.size}px> "${v.sample}" | ${k} | pogledi: ${[...v.views].slice(0, 4).join(', ')}`)
  }
  log('napake strani:', errors.length ? errors.slice(0, 3).join(' | ') : 'nič')
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
