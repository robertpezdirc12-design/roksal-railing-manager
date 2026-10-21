'use client'

// LOGISTIKA — razpored terminov po dnevih (vrata production.manage; brez lastnega API-ja —
// bere /api/nalog?scope=all in /api/production)

import { useMemo } from 'react'
import { CalendarClock, Factory, HardHat, Inbox, Users } from '@/components/roksal/custom-icons'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { cn } from '@/lib/utils'

interface NalogRow {
  id: string; code: string; title: string; status: string; scheduledFor: string | null
  assignee: { name: string } | null
  project: { code: string; title: string } | null
  crew: { name: string; type: string } | null // R445: ekipa/podizvajalec na nalogu
}

interface ProductionRow {
  id: string; code: string; title: string; status: string; dueAt: string | null
  project: { code: string; title: string } | null
}

interface ScheduleCard {
  key: string
  kind: 'nalog' | 'proizvodnja'
  time: string | null
  code: string
  title: string
  who: string | null
  status: string
  overdue: boolean
  crew: { name: string; type: string } | null // R445: ekipa na nalogu (prikaz pri terminu)
}

interface DayColumn {
  key: string
  label: string
  tone: 'today' | 'tomorrow' | 'future' | 'overdue' | 'none'
  cards: ScheduleCard[]
}

const FAR_FUTURE_DAYS = 14

function startOfDay (d: Date): number {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime()
}

export default function LogistikaModule () {
  const nalog = useApi<{ data: NalogRow[] }>('/api/nalog?scope=all')
  const production = useApi<{ data: ProductionRow[] }>('/api/production')

  const columns = useMemo<DayColumn[]>(() => {
    const nalogRows = nalog.data?.data ?? []
    const prodRows = production.data?.data ?? []

    const today = startOfDay(new Date())
    const tomorrow = today + 86400000
    const farLimit = today + 86400000 * (FAR_FUTURE_DAYS + 1)

    const cards: ScheduleCard[] = []
    for (const n of nalogRows) {
      const t = n.scheduledFor ? new Date(n.scheduledFor).getTime() : null
      // zaključeni nalogi z terminom v preteklosti so zgodovina, ne razpored
      if (n.status === 'ZAKLJUCEN' && t !== null && t < today) continue
      cards.push({
        key: `n-${n.id}`, kind: 'nalog', time: n.scheduledFor,
        code: n.code, title: n.title, who: n.assignee?.name ?? null,
        status: n.status, overdue: t !== null && t < today && n.status !== 'ZAKLJUCEN',
        crew: n.crew ?? null,
      })
    }
    for (const p of prodRows) {
      const t = p.dueAt ? new Date(p.dueAt).getTime() : null
      // odposlana proizvodnja z rokom v preteklosti je zgodovina, ne razpored
      if (p.status === 'ODPOSLAN' && t !== null && t < today) continue
      cards.push({
        key: `p-${p.id}`, kind: 'proizvodnja', time: p.dueAt,
        code: p.code, title: p.title, who: p.project ? `${p.project.code}` : null,
        status: p.status, overdue: t !== null && t < today && p.status !== 'ODPOSLAN',
        crew: null,
      })
    }

    // grupiranje: zamudeni | danes | jutri | konkretni dnevi (≤14 dni) | kasneje | brez termina
    const byKey = new Map<string, ScheduleCard[]>()
    const push = (k: string, c: ScheduleCard) => {
      const arr = byKey.get(k) ?? []; arr.push(c); byKey.set(k, arr)
    }
    for (const c of cards) {
      if (!c.time) { push('none', c); continue }
      const day = startOfDay(new Date(c.time))
      if (day < today) push('overdue', c)
      else if (day === today) push('today', c)
      else if (day === tomorrow) push('tomorrow', c)
      else if (day < farLimit) push(`d-${day}`, c)
      else push('later', c)
    }

    const cols: DayColumn[] = []
    if (byKey.has('overdue')) cols.push({ key: 'overdue', label: 'Zamujeni', tone: 'overdue', cards: byKey.get('overdue')! })
    if (byKey.has('today')) cols.push({ key: 'today', label: 'Danes', tone: 'today', cards: byKey.get('today')! })
    if (byKey.has('tomorrow')) cols.push({ key: 'tomorrow', label: 'Jutri', tone: 'tomorrow', cards: byKey.get('tomorrow')! })
    const futureDays = [...byKey.keys()].filter((k) => k.startsWith('d-')).sort()
    for (const k of futureDays) {
      cols.push({
        key: k, tone: 'future',
        label: new Intl.DateTimeFormat('sl-SI', { weekday: 'short', day: 'numeric', month: 'long' }).format(new Date(Number(k.slice(2)))),
        cards: byKey.get(k)!,
      })
    }
    if (byKey.has('later')) cols.push({ key: 'later', label: `Čez ${FAR_FUTURE_DAYS}+ dni`, tone: 'future', cards: byKey.get('later')! })
    if (byKey.has('none')) cols.push({ key: 'none', label: 'Brez termina', tone: 'none', cards: byKey.get('none')! })
    return cols
  }, [nalog.data, production.data])

  const totalCards = columns.reduce((s, c) => s + c.cards.length, 0)
  const overdueCount = columns.find((c) => c.key === 'overdue')?.cards.length ?? 0
  const anyError = nalog.error ?? production.error

  return (
    <div className="space-y-4">
      <PageHeader
        title="Logistika"
        desc="Razpored terminov nalogov in proizvodnih rokov po dnevih"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{totalCards} terminov</Badge>
            {overdueCount > 0 ? <Badge variant="secondary" className="border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">{overdueCount} zamujenih</Badge> : null}
          </div>
        }
      />

      <ErrorBox error={nalog.error} />
      <ErrorBox error={production.error} />

      {nalog.loading || production.loading ? <LoadingRows /> : anyError ? null : totalCards === 0 ? (
        <EmptyState title="Ni terminov" desc="Nalogi z dodeljenim terminom in proizvodni roki se prikažejo tukaj." icon={CalendarClock} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {columns.map((col) => (
            <section key={col.key} aria-label={col.label} className="flex min-w-0 flex-col rounded-xl border bg-secondary/30">
              <div className={cn(
                'flex items-center justify-between gap-2 border-b px-3 py-2',
                col.tone === 'today' && 'border-roksal-amber/40 bg-roksal-amber/10',
                col.tone === 'overdue' && 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
              )}>
                <span className={cn(
                  'text-sm font-bold',
                  col.tone === 'today' && 'text-roksal-amber dark:text-amber-400',
                  col.tone === 'overdue' && 'text-red-700 dark:text-red-300'
                )}>
                  {col.label}
                </span>
                <span className="text-xs text-muted-foreground">{col.cards.length}</span>
              </div>
              <ul className="flex-1 space-y-2 p-2">
                {col.cards.map((c) => (
                  <li key={c.key}>
                    <Card className={cn('border-border/70 py-0 shadow-none', c.overdue && 'border-red-300 dark:border-red-800')}>
                      <CardContent className="space-y-1 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] font-semibold text-roksal-amber">{c.code}</span>
                          {c.kind === 'proizvodnja' ? (
                            <Badge variant="secondary" className="border-transparent bg-secondary text-[10px] text-secondary-foreground">
                              <Factory className="mr-1 size-3" aria-hidden /> proizvodnja
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="border-transparent bg-secondary text-[10px] text-secondary-foreground">
                              <HardHat className="mr-1 size-3" aria-hidden /> nalog
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm font-semibold leading-snug">{c.title}</div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          <span>{c.time ? fmtDateTime(c.time) : 'brez termina'}</span>
                          {c.who ? <span>· {c.who}</span> : null}
                          {c.crew ? (
                            <span className="inline-flex items-center gap-1">· <Users className="size-3" aria-hidden />
                              <span className={c.crew.type === 'PODIZVAJALEC' ? 'font-semibold text-amber-600 dark:text-amber-400' : 'font-semibold'}>{c.crew.name}</span>
                              <span className="text-muted-foreground/70">({c.crew.type === 'PODIZVAJALEC' ? 'podizvajalec' : 'interna'})</span>
                            </span>
                          ) : null}
                        </div>
                        <div className="pt-0.5"><StatusBadge status={c.status} /></div>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Inbox className="size-3.5" aria-hidden />
        Viri: delovni nalogi (scope=all) in proizvodni nalogi — razpored je samo za branje, urejanje poteka v modulih Nalogi in Proizvodnja.
        Ekipe in podizvajalci se urejajo v modulu Dostave (R445), dostave pa tam dostavljajo material na termin.
      </p>
    </div>
  )
}
