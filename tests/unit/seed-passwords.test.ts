import { describe, it, expect } from 'vitest'
import {
  DOVOLI_JAVNA_GESLA_FRAZA,
  JAVNA_SEED_GESLA,
  javnaGeslaDovoljena,
  jeJavnoSeedGeslo,
} from '../../src/lib/seed-passwords'

// R578: gesla iz javnega demo seeda so javno znana — v produkciji ne smejo
// delovati, razen z izrecno frazo lastnika.
describe('seed-passwords — javna demo gesla', () => {
  it('prepozna vsa seed gesla (tudi z velikimi črkami e-pošte in presledki)', () => {
    for (const [email, geslo] of JAVNA_SEED_GESLA) {
      expect(jeJavnoSeedGeslo(email, geslo)).toBe(true)
      expect(jeJavnoSeedGeslo(`  ${email.toUpperCase()}  `, geslo)).toBe(true)
    }
  })

  it('ne prepozna drugega gesla ali drugega računa', () => {
    expect(jeJavnoSeedGeslo('admin@roksal.si', 'Admin123')).toBe(false)
    expect(jeJavnoSeedGeslo('admin@roksal.si', 'admin123!')).toBe(false)
    expect(jeJavnoSeedGeslo('nekdo@drug.si', 'Admin123!')).toBe(false)
  })

  it('brez fraze javna gesla niso dovoljena', () => {
    expect(javnaGeslaDovoljena({})).toBe(false)
    expect(javnaGeslaDovoljena({ ALLOW_PUBLIC_SEED_PASSWORDS: 'da' })).toBe(false)
    expect(javnaGeslaDovoljena({ ALLOW_PUBLIC_SEED_PASSWORDS: 'TRUE' })).toBe(false)
  })

  it('z dobesedno frazo so dovoljena (zavedna odločitev)', () => {
    expect(javnaGeslaDovoljena({ ALLOW_PUBLIC_SEED_PASSWORDS: DOVOLI_JAVNA_GESLA_FRAZA })).toBe(true)
  })
})
