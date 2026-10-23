'use client'

// Roksal logotip — značka ograje (trije stebri + dve ročaji), navy + amber

export function RoksalMark ({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <rect x="4" y="6" width="24" height="3.2" rx="1.6" fill="#f59e0b" />
      <rect x="4" y="14" width="24" height="3.2" rx="1.6" fill="#f59e0b" />
      <rect x="5.5" y="6" width="3.4" height="22" rx="1.7" fill="currentColor" />
      <rect x="14.3" y="6" width="3.4" height="22" rx="1.7" fill="currentColor" />
      <rect x="23.1" y="6" width="3.4" height="22" rx="1.7" fill="currentColor" />
    </svg>
  )
}

export function RoksalLogo ({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <RoksalMark className="size-8 shrink-0 text-roksal-ink" />
      <div className="leading-tight">
        <div className="font-bold tracking-tight text-roksal-ink dark:text-foreground">Roksal</div>
        {!compact ? <div className="text-[11px] font-medium uppercase tracking-widest text-roksal-amber-text">Railing Manager</div> : null}
      </div>
    </div>
  )
}
