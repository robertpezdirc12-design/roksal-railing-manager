import { describe, it, expect } from 'vitest'
import { getPlatform, getAREnhancementLevel, isWebXRSupported } from '../../src/lib/webxr-ar'

describe('webxr-ar', () => {
  it('isWebXRSupported returns false in node', () => {
    expect(isWebXRSupported()).toBe(false)
  })

  it('getPlatform returns unknown in node', () => {
    expect(getPlatform()).toBe('unknown')
  })

  it('getAREnhancementLevel returns none for unknown platform', () => {
    expect(getAREnhancementLevel()).toBe('none')
  })
})
