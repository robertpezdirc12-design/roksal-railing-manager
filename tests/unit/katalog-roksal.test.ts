import { describe, it, expect } from 'vitest'
import katalog from '../../prisma/katalog-roksal.json'

// R579: katalog-roksal.json je edini vir za dopolnitev produkcijske baze.
// Test varuje pred napakami izvoza (podvojene šifre, manjkajoča družina,
// gradivo brez datoteke), ki bi se sicer pokazale šele na produkciji.
describe('katalog-roksal.json — celovitost izvoza', () => {
  const codes = new Set(katalog.families.map((f) => f.code))
  const skus = katalog.products.map((p) => p.sku)

  it('ima družine in izdelke', () => {
    expect(katalog.families.length).toBeGreaterThan(0)
    expect(katalog.products.length).toBeGreaterThan(0)
  })

  it('kode družin so unikatne', () => {
    expect(codes.size).toBe(katalog.families.length)
  })

  it('SKU izdelkov so unikatni', () => {
    expect(new Set(skus).size).toBe(skus.length)
  })

  it('vsak izdelek ima obstoječo družino', () => {
    const brez = katalog.products.filter((p) => !codes.has(p.familyCode)).map((p) => p.sku)
    expect(brez).toEqual([])
  })

  it('SKU variant so unikatni med vsemi izdelki', () => {
    const vsi = katalog.products.flatMap((p) => p.variants.map((v) => v.sku))
    expect(new Set(vsi).size).toBe(vsi.length)
  })

  it('gradiva imajo veljavno pot ali so brez datoteke', () => {
    const slaba = katalog.products.flatMap((p) =>
      p.assets
        .filter((a) => a.filePath != null && !a.filePath.startsWith('public/assets/'))
        .map((a) => `${p.sku}: ${a.filePath}`)
    )
    expect(slaba).toEqual([])
  })

  it('vsaj en izdelek ima variante in gradiva', () => {
    expect(katalog.products.some((p) => p.variants.length > 0)).toBe(true)
    expect(katalog.products.some((p) => p.assets.length > 0)).toBe(true)
  })
})
