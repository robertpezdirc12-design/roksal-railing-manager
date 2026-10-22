// R579 sonda: kamera rAF dirka — črni predogled ob prvem zagonu.
// Reprodukcija: ponarejen getUserMedia (canvas captureStream) + SINHRONI
// requestAnimationFrame (povratni klic izpel TAKOJ, pred Reactovim commitom —
// najslabši možni vrstni red iz produkcijske evidence). Preveri, da <video>
// kljub temu dobi srcObject in predvaja (videoWidth > 0).
// Poleg tega: cikel ustavi/zaženi (preklop smeri) mora priklopiti TOK.
// BASE privzeto lokalni dev; preverja se vloga monter.
const { chromium, devices } = await import('playwright')

const BASE = process.argv[2] ?? 'http://localhost:3000'
const log = (...a) => console.log('[r579-kamera]', ...a)

// injekcija: ponarejena kamera + sinhroni rAF (vsak povratni klic izvede
// nemudoma — to je hladen prvi zagon v najslabšem primeru)
const INIT = `
  (function () {
    // ponarejeni video tok: canvas 640×480, nov okvir vsakih 100 ms
    const c = document.createElement('canvas')
    c.width = 640; c.height = 480
    const g = c.getContext('2d')
    let n = 0
    setInterval(() => {
      if (!g) return
      g.fillStyle = n % 2 ? '#2f6b3a' : '#3a7d4a'
      g.fillRect(0, 0, 640, 480)
      g.fillStyle = '#fff'
      g.font = '48px sans-serif'
      g.fillText('ROKSAL ' + (++n), 40, 240)
    }, 100)
    const stream = c.captureStream(10)
    if (!navigator.mediaDevices) navigator.mediaDevices = {}
    navigator.mediaDevices.getUserMedia = async () => {
      const s = c.captureStream(10)
      return s
    }
    navigator.mediaDevices.enumerateDevices = async () => [
      { deviceId: 'fake-cam-back', kind: 'videoinput', label: 'Fake Roksal kamera (zadnja)' },
      { deviceId: 'fake-cam-front', kind: 'videoinput', label: 'Fake Roksal kamera (sprednja)' },
    ]
    // SINHRONI rAF: povratni klic izvede pred Reactovim izrisom — ponovi
    // produkcijsko dirko (hladen zagon: ref še null → priklop izpuščen)
    window.requestAnimationFrame = (cb) => { cb(performance.now()); return 0 }
    window.__fakeStreamActive = true
  })()
`

async function main () {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'], permissions: ['camera'] })
  await ctx.addInitScript(INIT)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.getByRole('textbox', { name: 'E-pošta' }).fill('monter@roksal.si')
  await page.getByRole('textbox', { name: 'Geslo' }).fill('Monter123!')
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
  await closeGuides()

  await page.getByRole('navigation', { name: 'Navigacija sekcij' }).getByRole('button', { name: /Projekti/ }).click()
  await page.waitForTimeout(900); await closeGuides()
  await page.getByRole('tab', { name: 'Meritve', exact: true }).click()
  await page.waitForTimeout(1200); await closeGuides()
  await page.getByRole('button', { name: 'Meritve s kamero' }).click()
  await page.waitForTimeout(1500); await closeGuides()

  // stanje <video> pred zagonom (elementa še ne sme biti)
  const pred = await page.evaluate(() => document.querySelector('video[aria-label="Predogled kamere"]') !== null)
  log('0) pred zagonom: <video> v DOM:', pred, '(pričakovano: false)')

  // PRVI ZAGON — hladen, z vsiljenim sinhornim rAF
  await page.getByRole('button', { name: 'Zajemi s kamero' }).click()
  await page.waitForTimeout(2500)

  const prvi = await page.evaluate(() => {
    const v = document.querySelector('video[aria-label="Predogled kamere"]')
    if (!v) return { obstaja: false }
    return {
      obstaja: true,
      priklopljen: v.srcObject !== null,
      tokovi: v.srcObject ? v.srcObject.getVideoTracks().length : 0,
      videoWidth: v.videoWidth,
      readyState: v.readyState,
      paused: v.paused,
    }
  })
  log('1) prvi zagon:', JSON.stringify(prvi))
  const prviOk = prvi.obstaja && prvi.priklopljen && prvi.videoWidth > 0

  // PREKLOP SMERI (stop → start): tok mora biti priklopljen tudi po njem
  await page.getByRole('button', { name: 'Preklopi kamero', exact: true }).click().catch(async () => {
    await page.getByRole('button', { name: /Preklop/ }).first().click()
  })
  await page.waitForTimeout(2500)
  const poPreklopu = await page.evaluate(() => {
    const v = document.querySelector('video[aria-label="Predogled kamere"]')
    if (!v) return { obstaja: false }
    return {
      obstaja: true,
      priklopljen: v.srcObject !== null,
      videoWidth: v.videoWidth,
      readyState: v.readyState,
    }
  })
  log('2) po preklopu smeri:', JSON.stringify(poPreklopu))
  const preklopOk = poPreklopu.obstaja && poPreklopu.priklopljen && poPreklopu.videoWidth > 0

  log('─'.repeat(50))
  log('prvi zagon (sinhroni rAF):', prviOk ? '✓ PRIKLOPLJEN in predvaja' : '✗ ČRNO (priklop izpuščen)')
  log('po preklopu smeri:', preklopOk ? '✓ PRIKLOPLJEN in predvaja' : '✗ ČRNO')
  log('napake strani:', errors.length ? errors.slice(0, 3).join(' | ') : 'nič')
  await browser.close()
  process.exit(prviOk && preklopOk ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
