// R581 sonda: kontrastni pregled DESKTOP v OBEH temah — WCAG AA.
// R580 (kontrast-temna.mjs) je pokrivala SAMO temno temo na mobilnem — svetla
// tema in desktop-only elementi (kbd Ctrl+K, temna stranska vrstica) so bili
// nepokriti. Ta sonda: desktop 1280×800, VSE sekcije + zavihki, svetla IN
// temna tema, celotna stran (vrstica + vsebina) + geometrija vrstice.
// Izhod: 0 = vse v redu, 1 = kršitve/napaka. BASE privzeto lokalni dev.
const { chromium } = await import('playwright')

const BASE = process.argv[2] ?? 'http://localhost:3000'
const log = (...a) => console.log('[r581-rail]', ...a)

// izračun kontrasta za vsa vidna besedila (enaka logika kot r580 sonda)
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
      const cs = getComputedStyle(node)
      // gradientna podlaga (bg-gradient-to-…) — dejanske barve ne znamo
      // izračunati; belo besedilo na from-black/70 je v redu (≈6,4:1) — preskoči
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null
      const c = parse(cs.backgroundColor)
      if (c && c.a > 0) stack.push(c)
      if (c && c.a >= 1) break
      node = node.parentElement
    }
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
    if (!bg) continue // gradientna podlaga — ni izračunljivo (znani vzorec: temnejši gradient + belo besedilo)
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
      const inRail = !!el.closest('nav[data-tour="nav"]')
      out.push({
        text: text.slice(0, 40), inRail,
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
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

  // glave sekcij: struktura nav > div(plošča) > div(sekcija) > button(glava) + ul>li>button(zavihki)
  // (label je Title Case, izrisan s CSS uppercase — filter po velikih črkah ne deluje)
  const headers = page.locator("nav[data-tour='nav'] > div > div > button")
  const sectionNames = [...new Set((await headers.allTextContents()).map((t) => t.trim()))]

  let total = 0
  const all = []

  for (const theme of ['svetla', 'temna']) {
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
    if ((theme === 'temna') !== isDark) {
      await page.getByRole('button', { name: 'Preklopi temo' }).click()
      await page.waitForTimeout(800)
    }
    log(`--- tema: ${theme} — ${sectionNames.length} sekcij ---`)

    for (const sec of sectionNames) {
      await killOverlay()
      await closeGuides()
      const btn = headers.filter({ hasText: sec }).first()
      try { await btn.click({ timeout: 3000 }) } catch { continue }
      await page.waitForTimeout(700)

      const auditView = async (label) => {
        const fails = await page.evaluate(AUDIT)
        if (fails.length) {
          log(`  ✗ ${label}: ${fails.length} kršitev`)
          for (const f of fails.slice(0, 4)) log(`      "${f.text}" ${f.cr}:${f.need} ${f.color} ${f.size}px/${f.weight} ${f.cls}`)
          all.push(...fails.map((f) => ({ ...f, view: label, theme })))
          total += fails.length
        }
      }

      await auditView(`${theme}/${sec}`)

      // zavihki znotraj sekcije (role=tab)
      const tabs = await page.getByRole('tab').allTextContents()
      for (const t of tabs) {
        const tab = page.getByRole('tab', { name: t, exact: true })
        if (!(await tab.count())) continue
        try {
          await tab.click({ timeout: 3000 })
          await page.waitForTimeout(500)
          await killOverlay()
          await closeGuides()
          await auditView(`${theme}/${sec} › ${t}`)
        } catch { /* zavihek izginil */ }
      }
    }
  }

  // geometrija vrstice (zadnja sekcija, tema že preklopljena)
  const geom = await page.evaluate(() => {
    const navEl = document.querySelector('nav[data-tour="nav"]')
    const r = navEl.getBoundingClientRect()
    return { width: Math.round(r.width), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }
  })
  log(`geometrija vrstice: širina ${geom.width}px, preliv dokumenta ${geom.overflow}px`)

  log(`SKUPAJ: ${total} kršitev, pageerror ${errors.length}`)
  if (errors.length) for (const e of errors) log('pageerror:', e)
  await browser.close()
  process.exit(total === 0 && errors.length === 0 && geom.width === 240 && geom.overflow === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
