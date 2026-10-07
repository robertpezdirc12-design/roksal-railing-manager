'use client'

// DANES — operativni vhod (R429 §7: ŠKOLJKA nad NalogCenter)
// Terenski tok: DANES → MOJI NALOGI → ODPRI NALOG → ZAČNI DELO → ZAJEM → PREVERI → ZAKLJUČI TEREN
// R434: vremenska napoved za terenska dela (/api/weather — Open-Meteo).

import { useState } from 'react'
import { CalendarCheck, ChevronRight, CloudRain, CloudSnow, Cloudy, MapPin, Play, Camera, CheckCircle2, CheckCheck, Loader2, Sun, Thermometer, TriangleAlert, Umbrella, Wind } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { apiPost, fmtDate, fmtDateTime, useApi } from '@/lib/api-client'
import { ErrorBox, LoadingRows, PageHeader, StatusBadge, EmptyState } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

interface WorkOrderRow {
  id: string; code: string; title: string; status: string
  scheduledFor: string | null; startedAt: string | null; completedAt: string | null; summary: string | null
  project: { code: string; title: string; address: string | null; customer: { name: string } | null } | null
  assignee: { name: string } | null
  _count: { measurements: number; events: number }
}

interface WeatherDay {
  date: string; tmin: number; tmax: number; precip: number; precipHours: number
  windMax: number; code: number; label: string; icon: string; score: number
}

// koraki terenskega toka (VERBATIM R429)
const TOK_STEPS = ['NAPROGRAMIRAN', 'V_TEKU', 'V_ZAJEMU', 'V_PREVERI', 'ZAKLJUCEN']
const TOK_LABELS: Record<string, string> = {
  NAPROGRAMIRAN: 'Naprogramiran', V_TEKU: 'V teku', V_ZAJEMU: 'V zajemu', V_PREVERI: 'V preveri', ZAKLJUCEN: 'Zaključen',
}
const NEXT_ACTION: Record<string, { to: string; label: string; icon: typeof Play }> = {
  NAPROGRAMIRAN: { to: 'V_TEKU', label: 'ZAČNI DELO', icon: Play },
  V_TEKU: { to: 'V_ZAJEMU', label: 'ZAJEM', icon: Camera },
  V_ZAJEMU: { to: 'V_PREVERI', label: 'PREVERI', icon: CheckCircle2 },
  V_PREVERI: { to: 'ZAKLJUCEN', label: 'ZAKLJUČI TEREN', icon: CheckCheck },
}

export default function DanesModule () {
  const user = useAppStore((s) => s.user)
  const setTab = useAppStore((s) => s.setTab)
  const setSection = useAppStore((s) => s.setSection)
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const today = useApi<{ data: WorkOrderRow[] }>('/api/nalog?scope=today')
  const open = useApi<{ data: WorkOrderRow[] }>('/api/nalog?scope=open')
  const weather = useApi<{ data: { place: string; days: WeatherDay[]; updated: string } }>('/api/weather')

  const canTransition = hasPerm(user?.perms, 'nalog.transition')

  async function transition (wo: WorkOrderRow, to: string, label: string) {
    setBusy(wo.id)
    try {
      await apiPost(`/api/nalog/${wo.id}/transition`, { to, note: label })
      toast({ title: `${label} — ${wo.code}`, description: 'Prehod terenskega toka uspešno izveden.' })
      await Promise.all([today.reload(), open.reload()])
    } catch (e) {
      toast({
        title: 'Prehod zavrnjen',
        description: e instanceof Error ? e.message : 'Napaka',
        variant: 'destructive',
      })
    } finally {
      setBusy(null)
    }
  }

  const todayList = today.data?.data ?? []
  const openList = (open.data?.data ?? []).filter((w) => w.status !== 'NAPROGRAMIRAN')

  return (
    <div className="space-y-5">
      <PageHeader
        title="Danes"
        desc="Operativni vhod — terenski tok dneva (R429 §7)"
        actions={
          <Button variant="outline" size="sm" onClick={() => { setSection('projekti'); setTab('nalogi') }}>
            Vsi nalogi <ChevronRight className="size-4" aria-hidden />
          </Button>
        }
      />

      {/* statika dneva */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Danes</div>
          <div className="text-2xl font-bold text-roksal-amber">{todayList.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Odprtih</div>
          <div className="text-2xl font-bold">{(open.data?.data ?? []).length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">V teku</div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{openList.filter((w) => w.status === 'V_TEKU' || w.status === 'V_ZAJEMU').length}</div>
        </CardContent></Card>
      </div>

      {/* vreme za terenska dela — R434 */}
      <section aria-label="Vremenska napoved">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">Vreme — {weather.data?.data.place ?? 'teren'}</h2>
        <ErrorBox error={weather.error} />
        {weather.loading ? <LoadingRows rows={1} /> : !weather.error && weather.data ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {weather.data.data.days.map((d, i) => (
              <WeatherCard key={d.date} day={d} isToday={i === 0} />
            ))}
          </div>
        ) : (
          !weather.error ? <p className="text-sm text-muted-foreground">Napoved trenutno ni na voljo.</p> : null
        )}
      </section>

      {/* MOJI NALOGI — današnji */}
      <section aria-label="Današnji nalogi">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
          <CalendarCheck className="size-4 text-roksal-amber" aria-hidden /> Današnji nalogi
        </h2>
        <ErrorBox error={today.error} />
        {today.loading ? <LoadingRows /> : !today.error && todayList.length === 0 ? (
          <EmptyState title="Danes ni nalog" desc="Koledar je prazen — uživaj v mirnem dnevu." icon={CalendarCheck} />
        ) : (
          <ul className="space-y-3">
            {todayList.map((wo) => (
              <WorkOrderCard key={wo.id} wo={wo} busy={busy === wo.id} canTransition={canTransition} onTransition={transition} />
            ))}
          </ul>
        )}
      </section>

      {/* odprti (v teku / zajem / preveri) */}
      {openList.length > 0 ? (
        <section aria-label="Nalogi v teku">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">V teku (odprti)</h2>
          <ul className="space-y-3">
            {openList.map((wo) => (
              <WorkOrderCard key={wo.id} wo={wo} busy={busy === wo.id} canTransition={canTransition} onTransition={transition} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function WorkOrderCard ({ wo, busy, canTransition, onTransition }: {
  wo: WorkOrderRow
  busy: boolean
  canTransition: boolean
  onTransition: (wo: WorkOrderRow, to: string, label: string) => Promise<void>
}) {
  const action = NEXT_ACTION[wo.status]
  const stepIdx = TOK_STEPS.indexOf(wo.status)
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-roksal-amber">{wo.code}</span>
              <StatusBadge status={wo.status} />
            </div>
            <div className="mt-1 font-semibold leading-snug text-foreground">{wo.title}</div>
            {wo.project ? (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span>{wo.project.customer?.name ?? '—'}</span>
                {wo.project.address ? <span className="inline-flex items-center gap-1"><MapPin className="size-3" aria-hidden />{wo.project.address}</span> : null}
                <span className="font-mono">{wo.project.code}</span>
              </div>
            ) : null}
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div>{fmtDate(wo.scheduledFor)}</div>
            {wo.assignee ? <div className="mt-0.5">{wo.assignee.name}</div> : null}
          </div>
        </div>

        {/* vizualizacija terenskega toka */}
        <ol className="mt-3 flex items-center gap-1" aria-label="Terenski tok">
          {TOK_STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-1">
              <div
                className={
                  'h-1.5 flex-1 rounded-full ' +
                  (i < stepIdx ? 'bg-roksal-green' : i === stepIdx ? 'bg-roksal-amber' : 'bg-secondary')
                }
                title={TOK_LABELS[s]}
              />
            </li>
          ))}
        </ol>
        <div className="mt-1 flex justify-between text-[10px] font-medium text-muted-foreground">
          {TOK_STEPS.map((s) => <span key={s} className={wo.status === s ? 'text-roksal-amber' : ''}>{TOK_LABELS[s].split(' ')[0]}</span>)}
        </div>

        {wo.summary ? <p className="mt-2 text-xs text-muted-foreground">{wo.summary}</p> : null}

        {action && canTransition ? (
          <Button
            size="sm" className="mt-3 w-full sm:w-auto" disabled={busy}
            onClick={() => void onTransition(wo, action.to, action.label)}
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <action.icon className="size-4" aria-hidden />}
            {action.label}
          </Button>
        ) : null}
        {wo.status === 'ZAKLJUCEN' && wo.completedAt ? (
          <div className="mt-2 text-xs text-muted-foreground">Zaključeno {fmtDateTime(wo.completedAt)}</div>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ─── vreme (R434) ────────────────────────────────────────────────────────────

const W_ICONS: Record<string, typeof Sun> = {
  sun: Sun, cloud: Cloudy, rain: CloudRain, snow: CloudSnow, storm: TriangleAlert, fog: Cloudy,
}

const DAY_NAMES = ['ned', 'pon', 'tor', 'sre', 'čet', 'pet', 'sob']

function scoreLabel (score: number): { text: string; cls: string } {
  if (score >= 75) return { text: 'primerno za montažo', cls: 'text-emerald-600 dark:text-emerald-400' }
  if (score >= 45) return { text: 'previdno — preveri termin', cls: 'text-amber-600 dark:text-amber-400' }
  return { text: 'neprimerno za teren', cls: 'text-red-600 dark:text-red-400' }
}

function WeatherCard ({ day, isToday }: { day: WeatherDay; isToday: boolean }) {
  const Icon = W_ICONS[day.icon] ?? Cloudy
  const sl = scoreLabel(day.score)
  const dt = new Date(day.date)
  const dayName = isToday ? 'danes' : DAY_NAMES[dt.getDay()]
  return (
    <Card className={cn(isToday && 'border-roksal-amber/60')}>
      <CardContent className="space-y-1.5 p-3">
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{dayName}</span>
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </div>
        <div className="flex items-baseline gap-1.5">
          <Thermometer className="size-3.5 shrink-0 self-center text-muted-foreground" aria-hidden />
          <span className="text-lg font-bold leading-none">{day.tmax}°</span>
          <span className="text-xs text-muted-foreground">{day.tmin}°</span>
        </div>
        <div className="space-y-0.5 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <Umbrella className="size-3 shrink-0" aria-hidden />
            {day.precip > 0 ? `${day.precip.toFixed(1)} mm · ${day.precipHours} h` : 'brez padavin'}
          </div>
          <div className="flex items-center gap-1">
            <Wind className="size-3 shrink-0" aria-hidden />
            {day.windMax} km/h
          </div>
        </div>
        <p className={cn('text-[11px] font-semibold leading-tight', sl.cls)}>{sl.text}</p>
        <p className="sr-only">
          {dayName}: {day.label}, {day.tmin} do {day.tmax} stopinj,
          {day.precip > 0 ? ` padavine ${day.precip.toFixed(1)} milimetrov` : ' brez padavin'},
          veter do {day.windMax} kilometrov na uro. {sl.text}.
        </p>
      </CardContent>
    </Card>
  )
}
