import { describe, it, expect } from 'vitest'
// R580: SAMODEJNI ZAJEM — čisti deli: klasifikacija ostrine (ista skala/prag
// kot analyzeQuality) in spomin izbire (localStorage vtič, brez DOM).
import { oceniOstrino } from '../../src/components/roksal/modules/meritve-kamera/kakovost'
import { BLUR_THRESHOLD } from '../../src/components/roksal/modules/meritve-kamera/tipi'
import { nastaviAvtoZajem, preberiNastavitve, PRIVZETE_NASTAVITVE } from '../../src/lib/camera-prefs'

describe('oceniOstrino (R580)', () => {
  it('brez vzorca je NI_PODATKA, ne »ostro«', () => {
    expect(oceniOstrino(null)).toBe('NI_PODATKA')
    expect(oceniOstrino(Number.NaN)).toBe('NI_PODATKA')
  })

  it('pod pragom BLUR_THRESHOLD je MEHKO', () => {
    expect(oceniOstrino(0)).toBe('MEHKO')
    expect(oceniOstrino(BLUR_THRESHOLD - 0.01)).toBe('MEHKO')
  })

  it('nad pragom (vključno s pragom) je OSTRO', () => {
    expect(oceniOstrino(BLUR_THRESHOLD)).toBe('OSTRO')
    expect(oceniOstrino(10_000)).toBe('OSTRO')
  })
})

describe('camera-prefs: avtoZajem (R580)', () => {
  // DOM-free vtič iz pogodbe Shramba (getItem/setItem).
  const shrambaMock = (): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } => {
    const s = new Map<string, string>()
    return { getItem: (k) => s.get(k) ?? null, setItem: (k, v) => { s.set(k, v) } }
  }
  const vti = (m: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void }) => m

  it('privzeto je IZKLOPLJEN', () => {
    expect(PRIVZETE_NASTAVITVE.avtoZajem).toBe(false)
    expect(preberiNastavitve(null).avtoZajem).toBe(false)
  })

  it('vklop se zapomne in preživi ponovno branje', () => {
    const m = vti(shrambaMock())
    expect(nastaviAvtoZajem(m, true)).toBe(true)
    expect(preberiNastavitve(m).avtoZajem).toBe(true)
    expect(nastaviAvtoZajem(m, false)).toBe(true)
    expect(preberiNastavitve(m).avtoZajem).toBe(false)
  })

  it('starejši zapisi (brez polja) NE vklopijo zajema', () => {
    const m = vti(shrambaMock())
    m.setItem('roksal:kamera:nastavitve:v1', JSON.stringify({ smer: 'user', svetilkaNazadnje: false, vodila: true }))
    expect(preberiNastavitve(m).avtoZajem).toBe(false)
  })
})
