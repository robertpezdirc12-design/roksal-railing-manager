'use client'

// MOJ DAN — monterjev mobile-first delovni dan (R444, issue #7 §8 MONTER).
// Scope: SAMO dodeljeni nalogi — obseg vsiljuje API (/api/nalog monterju vrne le svoje).
// R429 (školjka nad NalogCenter) + R434 (vreme) ohranjena; R444 doda: navodila,
// kontrolni seznam, poraba materiala (IZDAJA prek skladiščnega jedra), težave
// (dogodek TEZAVA), povezave na meritve/foto in povzetek predaje.
// R548: razbitje po vzorcu R546/R547 — lupina drži statiko dneva in kartice,
// gradniki (shared/detail/sekcije/vreme) živijo v sosednjih datotekah.
// Faze: PRIHOD → PRED ZAČETKOM → ZAJEM → MONTAŽA → KONTROLA → ZAKLJUČEK → PREDAJA
// (preslikava v glavi danes-shared.tsx; model statusov se NE spreminja).

import { useState } from 'react'
import {
  CalendarCheck, CheckCheck, ChevronDown, ChevronRight, MapPin,
} from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { fmtDate, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { type WeatherDay, type WorkOrderRow } from './danes-shared'
import { WorkOrderDetail } from './danes-detail'
import { WeatherCard } from './danes-vreme'

export default function DanesModule () {
  const user = useAppStore((s) => s.user)
  const setTab = useAppStore((s) => s.setTab)
  const setSection = useAppStore((s) => s.setSection)
  const today = useApi<{ data: WorkOrderRow[] }>('/api/nalog?scope=today')
  const open = useApi<{ data: WorkOrderRow[] }>('/api/nalog?scope=open')
  const weather = useApi<{ data: { place: string; days: WeatherDay[]; updated: string } }>('/api/weather')

  const [expanded, setExpanded] = useState<string | null>(null)

  const todayList = today.data?.data ?? []
  const openList = (open.data?.data ?? []).filter((w) => w.status !== 'NAPROGRAMIRAN')
  // zaključeni danes (za poročilo o predaji) — iz celotnega obsega uporabnika,
  // brez podvajanja z dnevnim seznamom (nalogi z današnjim terminom so tam)
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const all = useApi<{ data: WorkOrderRow[] }>('/api/nalog?scope=all')
  const doneToday = (all.data?.data ?? []).filter((w) =>
    w.status === 'ZAKLJUCEN' && w.completedAt && new Date(w.completedAt) >= startOfToday &&
    !todayList.some((t) => t.id === w.id)
  )

  async function refreshLists () {
    await Promise.all([today.reload(), open.reload(), all.reload()])
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Moj dan"
        desc={`Operativni vhod — ${user?.name ?? 'monter'}, tvoj delovni dan na terenu (R444)`}
        actions={
          <Button variant="outline" size="sm" onClick={() => { setSection('operativa'); setTab('nalogi') }}>
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
              <WorkOrderCard
                key={wo.id} wo={wo}
                expanded={expanded === wo.id}
                onToggle={() => setExpanded(expanded === wo.id ? null : wo.id)}
                onTransitioned={refreshLists}
              />
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
              <WorkOrderCard
                key={wo.id} wo={wo}
                expanded={expanded === wo.id}
                onToggle={() => setExpanded(expanded === wo.id ? null : wo.id)}
                onTransitioned={refreshLists}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {/* zaključeni danes — poročilo o predaji (PREDAJA) ostane dostopno */}
      {doneToday.length > 0 ? (
        <section aria-label="Zaključeno danes">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            <CheckCheck className="size-4 text-roksal-green" aria-hidden /> Zaključeno danes — predaja
          </h2>
          <ul className="space-y-3">
            {doneToday.map((wo) => (
              <WorkOrderCard
                key={wo.id} wo={wo}
                expanded={expanded === wo.id}
                onToggle={() => setExpanded(expanded === wo.id ? null : wo.id)}
                onTransitioned={refreshLists}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

// ─── kartica naloga z razširljivo podrobnostjo (mobile-first) ─────────────────

// ─── kartica naloga z razširljivo podrobnostjo (mobile-first) ─────────────────

function WorkOrderCard ({ wo, expanded, onToggle, onTransitioned }: {
  wo: WorkOrderRow
  expanded: boolean
  onToggle: () => void
  onTransitioned: () => Promise<void>
}) {
  return (
    <Card className={cn(expanded && 'border-roksal-amber/50')}>
      <CardContent className="p-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={`wo-detail-${wo.id}`}
          className="flex w-full items-start justify-between gap-2 rounded-lg text-left transition hover:bg-secondary/40 focus-visible:outline-2 focus-visible:outline-ring"
        >
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
          <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
            <div className="text-xs text-muted-foreground">{fmtDate(wo.scheduledFor)}</div>
            <ChevronDown
              className={cn('size-5 text-muted-foreground transition-transform', expanded && 'rotate-180')}
              aria-hidden
            />
          </div>
        </button>

        {expanded ? (
          <div id={`wo-detail-${wo.id}`} className="mt-4 border-t pt-4">
            <WorkOrderDetail woId={wo.id} onTransitioned={onTransitioned} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
