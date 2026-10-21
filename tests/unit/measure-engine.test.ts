import { describe, it, expect } from 'vitest'
import { MEASURE_MODES, CALIB_METHODS, CALIB_METHOD_IDS } from '../../src/lib/measure-engine'

describe('measure-engine', () => {
  it('has 7 measurement modes', () => {
    expect(MEASURE_MODES).toHaveLength(7)
  })

  it('includes OGRAJA mode', () => {
    expect(MEASURE_MODES).toContain('OGRAJA')
  })

  it('has 6 calibration methods', () => {
    expect(CALIB_METHODS).toHaveLength(6)
  })

  it('ZUNANJA_NAPRAVA has base confidence 88', () => {
    const m = CALIB_METHODS.find((c) => c.id === 'ZUNANJA_NAPRAVA')
    expect(m).toBeDefined()
    expect(m!.base).toBe(88)
  })

  it('LIDAR has highest base confidence', () => {
    const lidar = CALIB_METHODS.find((c) => c.id === 'LIDAR')
    const max = Math.max(...CALIB_METHODS.map((c) => c.base))
    expect(lidar!.base).toBe(max)
  })

  it('CALIB_METHOD_IDS matches CALIB_METHODS', () => {
    expect(CALIB_METHOD_IDS).toHaveLength(CALIB_METHODS.length)
    for (const m of CALIB_METHODS) {
      expect(CALIB_METHOD_IDS).toContain(m.id)
    }
  })
})
