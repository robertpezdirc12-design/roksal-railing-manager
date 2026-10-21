import { describe, it, expect } from 'vitest'
import { isBluetoothSupported, detectDevice, formatDistance } from '../../src/lib/laser-meter'

describe('laser-meter', () => {
  it('detectDevice identifies Leica', () => {
    expect(detectDevice('Leica DISTO X4')).toBe('leica')
    expect(detectDevice('DISTO D2')).toBe('leica')
  })

  it('detectDevice identifies Bosch', () => {
    expect(detectDevice('Bosch GLM 50')).toBe('bosch')
    expect(detectDevice('GLM 120')).toBe('bosch')
  })

  it('detectDevice returns unknown for null', () => {
    expect(detectDevice(null)).toBe('unknown')
  })

  it('formatDistance formats meters', () => {
    expect(formatDistance(1.5)).toBe('1.500 m')
    expect(formatDistance(0.5)).toBe('50.0 cm')
  })

  it('isBluetoothSupported checks navigator', () => {
    // In node (no navigator), should be false
    expect(isBluetoothSupported()).toBe(false)
  })
})
