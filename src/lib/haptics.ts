// haptics — Web Vibration API za mobilne naprave
// Fallback: tiho (brez napake) na napravah brez podpore.

export function haptic (pattern: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning' = 'light'): void {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return
  const patterns: Record<string, number | number[]> = {
    light: 10,
    medium: 25,
    heavy: 50,
    success: [10, 50, 10],
    error: [50, 100, 50],
    warning: [30, 50, 30],
  }
  try {
    navigator.vibrate(patterns[pattern] ?? 10)
  } catch {
    // tiho — nekateri brskalniki blokirajo vibrate
  }
}

export function isHapticSupported (): boolean {
  return typeof navigator !== 'undefined' && !!navigator.vibrate
}
