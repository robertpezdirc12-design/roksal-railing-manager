import { describe, it, expect } from 'vitest'
import { DEMO_PROD_KEY_FRAZA, demoVrata } from '../../src/lib/demo-access'

// R551/R576: demo prijava je javno znana (gesla so v javnem seedu), zato
// velja FAIL-CLOSED: odpre jo samo izrecno stikalo (+ v produkciji še druga
// vrata). Test pokriva vseh 8 kombinacij, ki so v praksi mogoče.
describe('demo-access — dvojna vrata', () => {
  it('brez DEMO_ACCESS je zaprto tudi v razvoju', () => {
    expect(demoVrata({})).toEqual({ odprt: false, stanje: 'izklopljeno' })
    expect(demoVrata({ NODE_ENV: 'development' })).toEqual({ odprt: false, stanje: 'izklopljeno' })
  })

  it('DEMO_ACCESS=off zapre povsod', () => {
    expect(demoVrata({ DEMO_ACCESS: 'off', NODE_ENV: 'development' }).odprt).toBe(false)
    expect(demoVrata({ DEMO_ACCESS: 'off', NODE_ENV: 'production', DEMO_PROD_KEY: DEMO_PROD_KEY_FRAZA }).odprt).toBe(false)
  })

  it('razvoj + DEMO_ACCESS=on odpre z enim vrati', () => {
    expect(demoVrata({ DEMO_ACCESS: 'on', NODE_ENV: 'development' })).toEqual({
      odprt: true,
      stanje: 'razvoj-odprto',
    })
  })

  it('produkcija + DEMO_ACCESS=on BREZ ključa je ZAPRTA', () => {
    expect(demoVrata({ DEMO_ACCESS: 'on', NODE_ENV: 'production' })).toEqual({
      odprt: false,
      stanje: 'produkcija-blokirano',
    })
  })

  it('produkcija + napačen ključ je ZAPRTA', () => {
    expect(
      demoVrata({ DEMO_ACCESS: 'on', NODE_ENV: 'production', DEMO_PROD_KEY: 'odpri' }).odprt
    ).toBe(false)
  })

  it('produkcija + obe vrati odpre zavedno', () => {
    expect(
      demoVrata({ DEMO_ACCESS: 'on', NODE_ENV: 'production', DEMO_PROD_KEY: DEMO_PROD_KEY_FRAZA })
    ).toEqual({ odprt: true, stanje: 'produkcija-odprto' })
  })

  it('ključ sam (brez stikala) ne odpre ničesar', () => {
    expect(
      demoVrata({ NODE_ENV: 'production', DEMO_PROD_KEY: DEMO_PROD_KEY_FRAZA }).odprt
    ).toBe(false)
  })
})
