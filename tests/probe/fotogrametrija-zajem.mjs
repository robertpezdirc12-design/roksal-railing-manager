// Razvojni sonda (ni del relejnega pasu): kako zajemski parametri vplivajo na odločitev.
// Zagon iz korena repozitorija:
//   node --import=./tests/ts-resolve-register.mjs tests/probe/fotogrametrija-zajem.mjs
// Številke so zapisane v docs/PHOTOGRAMMETRY-3D.md §6 b. Scenariji so tu samo za meritev —
// v pasu ostane sedem priznanih pogojev iz definicijeScenarijev().
const P = await import('../../src/lib/photogrammetry-proof.ts')

const vrste = [
  { ime: '200x150 / f=50 / B=8 cm', scena: { sirina: 200, visina: 150, zark: 50, globina: 50, premik: [8, 0.5, 0.6], gostota: 2.56 } },
  { ime: '400x300 / f=260 / B=15 cm', scena: { sirina: 400, visina: 300, zark: 260, globina: 90, premik: [15, 0.9, 1.2], gostota: 4 } },
  { ime: '600x450 / f=520 / B=25 cm (privzeto)', scena: {} },
  { ime: '1200x900 / f=1040 / B=25 cm', scena: { sirina: 1200, visina: 900, zark: 1040, gostota: 12 } },
]
for (const v of vrste) {
  const r = P.zazeniScenarij({ ime: v.ime, pogoj: v.ime, scena: v.scena, referenca: { namnozek: 1 }, cakovanje: 'SPREJET' })
  console.log(JSON.stringify({
    ime: v.ime, od: r.odlozitev, kornjiA: r.kornjiA, uj: r.ujemanja, delezPravilnih: r.delezPravilnih,
    rot: r.rotacijaNapakaDeg, premik: r.translacijaNapakaDeg, ep: r.medianaEpipolarnePx, pj: r.medianaProjekcijskePx,
    par: r.paralaksaDeg, skalna: r.skalnaNapakaPct, glob: r.globinskaNapakaPct, razlogi: r.razlogi,
  }))
}
