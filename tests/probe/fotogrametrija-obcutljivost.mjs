// Razvojni sonda (ni del relejnega pasu): občutljivost verige na šum ujemanja.
// Zagon iz korena repozitorija:
//   node --import=./tests/ts-resolve-register.mjs tests/probe/fotogrametrija-obcutljivost.mjs
// Številke so zapisane v docs/PHOTOGRAMMETRY-3D.md §6 a. Korespondence so ANALITIČNO
// pravilne (znana homografija) in jim je dodan samo Gausov šum — sicer ne bi bilo mogoče
// ločiti napake ujemanja od napake geometrije.
const C = await import('../../src/lib/photogrammetry-core.ts')
const P = await import('../../src/lib/photogrammetry-proof.ts')

const IDENTITETA = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const scena = P.ustvariSceno({})
const a = P.izrisPogled(scena, IDENTITETA, [0, 0, 0], scena.intrinseki)
const kornji = C.detektirajKornje(a, 90)
const m = C.matrikaProjekcije(scena.intrinseki, scena.R, scena.t)
const pare = []
for (const k of kornji) {
  const X = P.istinaTocka(scena, { x: k.x, y: k.y })
  if (!X) continue
  const sx = m[0][0] * X[0] + m[0][1] * X[1] + m[0][2] * X[2] + m[0][3]
  const sy = m[1][0] * X[0] + m[1][1] * X[1] + m[1][2] * X[2] + m[1][3]
  const sz = m[2][0] * X[0] + m[2][1] * X[1] + m[2][2] * X[2] + m[2][3]
  if (!(sz > 0)) continue
  pare.push({ p1: { x: k.x, y: k.y }, p2: { x: sx / sz, y: sy / sz } })
}
console.log('parov (analitičnih korespondenc):', pare.length, 'kornjev v A:', kornji.length)
const nakljucje = C.ustvariNakljucje(20261013)
const gaus = (sigma) => {
  let u1 = nakljucje(); let u2 = nakljucje()
  if (u1 < 1e-12) u1 = 1e-12
  return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}
console.log('σ-poras (panel scena, čiste korespondence + Gausov šum σ px na obeh pogledih):')
for (const sigma of [0, 0.25, 0.5, 1.0]) {
  const p1 = pare.map((pr) => ({ x: pr.p1.x + gaus(sigma), y: pr.p1.y + gaus(sigma) }))
  const p2 = pare.map((pr) => ({ x: pr.p2.x + gaus(sigma), y: pr.p2.y + gaus(sigma) }))
  const rs = C.ransacOsnovnaMatrika(p1, p2, { pragPik: 1.0, poskusi: 300 })
  if (!rs.F) { console.log(JSON.stringify({ sigma, napomena: 'F ni modela' })); continue }
  const E = C.esencialnaIzF(rs.F, scena.intrinseki, scena.intrinseki)
  const v1 = rs.veliki.map((i) => p1[i])
  const v2 = rs.veliki.map((i) => p2[i])
  const razcep = C.razcepEsencialne(E, v1, v2, scena.intrinseki, scena.intrinseki)
  const izbrani = razcep.izbrani
  const ep = rs.veliki.map((i) => Math.sqrt(C.epipolarnaNapaka(rs.F, p1[i], p2[i])))
  console.log(JSON.stringify({
    sigma,
    veliki: rs.veliki.length,
    od: p1.length,
    medianaEp: C.median(ep),
    rot: C.kotR(izbrani.R, scena.R),
    premikSmer: C.kotV(izbrani.t, scena.t),
  }))
}
