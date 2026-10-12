'use client'

// ui-bits — deljeni gradniki Roksal modulov (PageHeader, StatCard, EmptyState, StatusBadge)

import { ComponentType, ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function PageHeader ({ title, desc, actions }: { title: string; desc?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 pb-1">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h1>
        {desc ? <p className="mt-1 text-sm text-muted-foreground">{desc}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function StatCard ({ label, value, hint, icon: Icon, tone = 'default' }: {
  label: string; value: ReactNode; hint?: string; icon?: ComponentType<{ className?: string }>; tone?: 'default' | 'amber' | 'green' | 'red'
}) {
  const tones = {
    default: 'text-foreground',
    amber: 'text-amber-600 dark:text-amber-400',
    green: 'text-emerald-600 dark:text-emerald-400',
    red: 'text-red-600 dark:text-red-400',
  }
  return (
    <Card className="min-w-0">
      <CardContent className="flex items-center gap-3 p-4">
        {Icon ? (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-roksal-amber">
            <Icon className="size-5" aria-hidden />
          </div>
        ) : null}
        <div className="min-w-0">
          <div className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className={cn('truncate text-lg font-bold leading-tight sm:text-xl', tones[tone])}>{value}</div>
          {hint ? <div className="truncate text-xs text-muted-foreground">{hint}</div> : null}
        </div>
      </CardContent>
    </Card>
  )
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  // projekti
  NACRT: { label: 'Načrt', cls: 'bg-secondary text-secondary-foreground' },
  AKTIVNI: { label: 'Aktivni', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  TEREN: { label: 'Na terenu', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  ZAKLJUCEN: { label: 'Zaključen', cls: 'bg-secondary text-secondary-foreground' },
  ARHIV: { label: 'Arhiv', cls: 'bg-muted text-muted-foreground' },
  // ponudbe
  OSNUTEK: { label: 'Osnutek', cls: 'bg-muted text-muted-foreground' },
  POSLAN: { label: 'Poslan', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  SPREJET: { label: 'Sprejet', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  ZAVRNJEN: { label: 'Zavrnjen', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
  ZAKLENJEN: { label: 'Zaklenjen', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  // računi
  IZDAN: { label: 'Izdan', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  DELNO_PLACAN: { label: 'Delno plačan', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  PLACAN: { label: 'Plačan', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  ZAPRT: { label: 'Zaprt', cls: 'bg-muted text-muted-foreground' },
  // nalogi (terenski tok)
  NAPROGRAMIRAN: { label: 'Naprogramiran', cls: 'bg-secondary text-secondary-foreground' },
  V_TEKU: { label: 'V teku', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  V_ZAJEMU: { label: 'V zajemu', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  V_PREVERI: { label: 'V preveri', cls: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300' },
  // proizvodnja
  NAVRTEN: { label: 'Načrtovan', cls: 'bg-secondary text-secondary-foreground' },
  V_IZDELAVI: { label: 'V izdelavi', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  DOKONCAN: { label: 'Dokončan', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  ODPOSLAN: { label: 'Odposlan', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  // prefab elementi (R465)
  REZANJE: { label: 'Rezanje', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  IZDELAVA: { label: 'Izdelava', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  POVRSINA: { label: 'Površina', cls: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300' },
  // CRM
  NOV: { label: 'Nov', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  KONTAKTIRAN: { label: 'Kontaktiran', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  KVALIFIKACIJAN: { label: 'Kvalificiran', cls: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300' },
  PRETVORJEN: { label: 'Pretvorjen', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  IZGUBLJEN: { label: 'Izgubljen', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
  KVALIFIKACIJA: { label: 'Kvalifikacija', cls: 'bg-secondary text-secondary-foreground' },
  PONUDBA: { label: 'Ponudba', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  POGAJANJA: { label: 'Pogajanja', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  ZMAGOVALNA: { label: 'Zmagovitna', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  IZGUBLJENA: { label: 'Izgubljena', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
  // projektni paketi (R442 — poslovni tok paketov)
  POVPRAŠEVANJE: { label: 'Povpraševanje', cls: 'bg-muted text-muted-foreground' },
  IZMERA: { label: 'Izmera', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  KONFIGURACIJA: { label: 'Konfiguracija', cls: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300' },
  POTRJENO: { label: 'Potrjeno', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  REZERVIRANO: { label: 'Rezervirano', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  DOSTAVLJENO: { label: 'Dostavljeno', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  MONTIRANO: { label: 'Montirano', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  PREDANO: { label: 'Predano', cls: 'bg-emerald-700 text-white' },
  // dostave (R445 — issue #7 §9: tok NAČRTOVANO → … → DOSTAVLJENO)
  NACRTOVANO: { label: 'Načrtovano', cls: 'bg-secondary text-secondary-foreground' },
  PRIPRAVLJENO: { label: 'Pripravljeno', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  NATOVARJENO: { label: 'Natovorjeno', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  NA_POTI: { label: 'Na poti', cls: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300' },
  PREKLICANA: { label: 'Preklicana', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
  // servis (R446 — issue #7 §10: reklamacije + servisni primeri)
  NOVA: { label: 'Nova', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  V_OBRAVNAVI: { label: 'V obravnavi', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  ZAKLJUCENA: { label: 'Zaključena', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  PREVERITEV: { label: 'Preveritev', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  ODOBRENA: { label: 'Odobrena', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  V_SERVISU: { label: 'V servisu', cls: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300' },
  // montaža QA (R489 — issue #12 §2B/§2C/§2D)
  NI_ZACETO: { label: 'Ni začeto', cls: 'bg-secondary text-secondary-foreground' },
  V_REDU: { label: 'V redu', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  NAPAKA: { label: 'Napaka', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
  NI_RELEVANTNO: { label: 'Ni relevantno', cls: 'bg-muted text-muted-foreground' },
  CAKA_PREVERJANJE: { label: 'Čaka na preverjanje', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  ODPRTO: { label: 'Odprto', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
  ODRAVLJENO: { label: 'Odravljeno', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  PREVERJENO: { label: 'Preverjeno', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  POGOJNA: { label: 'Pogojna', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  NEPOPOLNA: { label: 'Nepopolna', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
}

export function StatusBadge ({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, cls: 'bg-muted text-muted-foreground' }
  return <Badge variant="secondary" className={cn('border-transparent font-medium', s.cls)}>{s.label}</Badge>
}

export function EmptyState ({ title, desc, icon: Icon }: { title: string; desc?: string; icon?: ComponentType<{ className?: string }> }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-10 text-center">
      {Icon ? <Icon className="mb-3 size-10 text-muted-foreground/50" aria-hidden /> : null}
      <div className="font-medium text-foreground">{title}</div>
      {desc ? <div className="mt-1 max-w-sm text-sm text-muted-foreground">{desc}</div> : null}
    </div>
  )
}

export function LoadingRows ({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Nalaganje">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  )
}

export function ErrorBox ({ error }: { error: { message: string; detail?: string } | null }) {
  if (!error) return null
  return (
    <div role="alert" className="rounded-xl border border-destructive/30 bg-red-50 p-4 text-sm dark:bg-red-950/40">
      <div className="font-semibold text-red-700 dark:text-red-300">{error.message}</div>
      {error.detail ? <div className="mt-1 text-red-600/90 dark:text-red-400/90">{error.detail}</div> : null}
    </div>
  )
}
