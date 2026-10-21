// illustrations — SVG ilustracije za prazna stanja (empty states)
// Brez zunanji odvisnosti, inline SVG.

'use client'

import { cn } from '@/lib/utils'

export function IllustrationEmpty ({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 160" className={cn('mx-auto', className)} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="40" y="60" width="120" height="80" rx="8" fill="currentColor" opacity="0.08" />
      <rect x="55" y="75" width="90" height="8" rx="4" fill="currentColor" opacity="0.15" />
      <rect x="55" y="90" width="70" height="8" rx="4" fill="currentColor" opacity="0.15" />
      <rect x="55" y="105" width="80" height="8" rx="4" fill="currentColor" opacity="0.15" />
      <circle cx="100" cy="35" r="22" fill="currentColor" opacity="0.1" />
      <path d="M92 35 L98 41 L110 29" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
    </svg>
  )
}

export function IllustrationCamera ({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 160" className={cn('mx-auto', className)} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="50" y="40" width="100" height="75" rx="12" fill="currentColor" opacity="0.08" />
      <circle cx="100" cy="77" r="22" fill="currentColor" opacity="0.12" />
      <circle cx="100" cy="77" r="14" fill="currentColor" opacity="0.2" />
      <circle cx="100" cy="77" r="6" fill="currentColor" opacity="0.4" />
      <rect x="75" y="30" width="50" height="15" rx="4" fill="currentColor" opacity="0.15" />
      <circle cx="135" cy="50" r="4" fill="currentColor" opacity="0.3" />
    </svg>
  )
}

export function IllustrationSearch ({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 160" className={cn('mx-auto', className)} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="85" cy="70" r="30" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <line x1="108" y1="93" x2="135" y2="120" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.2" />
      <circle cx="85" cy="70" r="15" fill="currentColor" opacity="0.06" />
      <rect x="60" y="125" width="80" height="6" rx="3" fill="currentColor" opacity="0.1" />
      <rect x="70" y="138" width="60" height="6" rx="3" fill="currentColor" opacity="0.1" />
    </svg>
  )
}

export function IllustrationFolder ({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 160" className={cn('mx-auto', className)} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M40 50 L40 130 Q40 140 50 140 L150 140 Q160 140 160 130 L160 65 Q160 55 150 55 L110 55 L100 45 L50 45 Q40 45 40 55 Z" fill="currentColor" opacity="0.08" />
      <path d="M40 50 L40 130 Q40 140 50 140 L150 140 Q160 140 160 130 L160 65 Q160 55 150 55 L110 55 L100 45 L50 45 Q40 45 40 55 Z" stroke="currentColor" strokeWidth="2" opacity="0.2" />
      <rect x="60" y="75" width="80" height="6" rx="3" fill="currentColor" opacity="0.15" />
      <rect x="60" y="88" width="60" height="6" rx="3" fill="currentColor" opacity="0.15" />
    </svg>
  )
}
