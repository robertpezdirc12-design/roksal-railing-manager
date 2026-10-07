'use client'

// MOJ DAN — monterjev mobile-first delovni dan (R444, issue #7 §8 MONTER).
// Scope: SAMO dodeljeni nalogi — obseg vsiljuje API (/api/nalog monterju vrne le svoje).
//
// 7-fazni delovni tok (issue #7 §8): PRIHOD → PRED ZAČETKOM → ZAJEM → MONTAŽA →
// KONTROLA → ZAKLJUČEK → PREDAJA. Faze so UI PLAST nad obstoječimi statusi
// WorkOrder — model statusov se NE spreminja. Preslikava:
//   PRIHOD         = NAPROGRAMIRAN (odprt nalog)
//   PRED ZAČETKOM  = V_TEKU (dogodek ZACETEK — "ZAČNI DELO")
//   ZAJEM          = V_ZAJEMU (meritve + foto — povezava na zajem)
//   MONTAŽA        = implicitna faza po zajemu (opravljena, ko nalog preide v V_PREVERI)
//   KONTROLA       = V_PREVERI ("PREVERI")
//   ZAKLJUČEK      = ZAKLJUCEN ("ZAKLJUČI TEREN")
//   PREDAJA        = poročilo/povzetek (ZAKLJUCEN + completedAt → Poročilo o predaji)
//
// R429 (školjka nad NalogCenter) + R434 (vreme) ohranjena; R444 doda: navodila,
// kontrolni seznam, poraba materiala (IZDAJA prek skladiščnega jedra), težave
// (dogodek TEZAVA), povezave na meritve/foto in povzetek predaje.

import { useState } from 'react'
import {
  CalendarCheck, Camera, CheckCircle2, CheckCheck, ChevronDown, ChevronRight, Circle,
  ClipboardList, CloudRain, CloudSnow, Cloudy, HardHat, Loader2, MapPin, Package,
  Play, Plus, Ruler, Sun, Thermometer, TriangleAlert, Umbrella, Wind,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { apiPatch, apiPost, fmtDate, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

interface WorkOrderRow {
  id: string; code: string; title: string; status: string
  scheduledFor: string | null; startedAt: string | null; completedAt: string | null; summary: string | null
  instructions: string | null
  project: { code: string; title: string; address: string | null; customer: { name: string } | null } | null
  assignee: { name: string } | null
  _count: { measurements: number; events: number }
}

interface WorkOrderDetailRow extends WorkOrderRow {
  instructions: string | null
  assignee: { id: string; name: string } | null
  events: { id: string; type: string; note: string | null; createdAt: string; user: { name: string } | null }[]
  measurements: { id: string; type: string; familyCode: string | null; lengthCm: number | null; createdAt: string }[]
}

interface ChecklistRow {
  id: string; label: string; done: boolean; doneAt: string | null
  doneBy: { name: string } | null; sortOrder: number
}

interface UsageRow {
  id: string; qty: number; note: string | null; createdAt: string
  item: { sku: string; name: string; unit: string; qty: number }
  user: { name: string } | null
}

interface StockRow {
  id: string; sku: string; name: string; unit: string
  physical: number; reserved: number; available: number
}

interface WeatherDay {
  date: string; tmin: number; tmax: number; precip: number; precipHours: number
  windMax: number; code: number; label: string; icon: string; score: number
}

// ─── 7-fazni delovni tok (UI plast nad statusi — glej preslikavo v glavi) ────

const FAZE = [
  { key: 'PRIHOD', label: 'Prihod' },
  { key: 'PRED_ZACETKOM', label: 'Pred začetkom' },
  { key: 'ZAJEM', label: 'Zajem' },
  { key: 'MONTAZA', label: 'Montaža' },
  { key: 'KONTROLA', label: 'Kontrola' },
  { key: 'ZAKLJUCEK', label: 'Zaključek' },
  { key: 'PREDAJA', label: 'Predaja' },
] as const

/** Indeks trenutne faze iz statusa naloga (MONTAŽA[3] je implicitno opravljena ob prehodu v V_PREVERI). */
function phaseIndex (status: string): number {
  switch (status) {
    case 'NAPROGRAMIRAN': return 0 // PRIHOD
    case 'V_TEKU': return 1 // PRED ZAČETKOM
    case 'V_ZAJEMU': return 2 // ZAJEM
    case 'V_PREVERI': return 4 // KONTROLA (montaža za nami)
    case 'ZAKLJUCEN': return 6 // PREDAJA (zaključek za nami)
    default: return 0
  }
}

// prehodi terenskega toka (nespremenjen backend model)
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

// ─── podrobnost naloga: stepper, navodila, checklist, material, težave ───────

function WorkOrderDetail ({ woId, onTransitioned }: {
  woId: string
  onTransitioned: () => Promise<void>
}) {
  const user = useAppStore((s) => s.user)
  const setTab = useAppStore((s) => s.setTab)
  const setSection = useAppStore((s) => s.setSection)
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [finalNote, setFinalNote] = useState('')
  const [showFinal, setShowFinal] = useState(false)

  const detail = useApi<{ data: WorkOrderDetailRow }>(`/api/nalog/${woId}`)
  const checklist = useApi<{ data: ChecklistRow[] }>(`/api/nalog/${woId}/checklist`)
  const material = useApi<{ data: UsageRow[] }>(`/api/nalog/${woId}/material`)

  const wo = detail.data?.data ?? null
  const canTransition = hasPerm(user?.perms, 'nalog.transition')
  const canChecklist = hasPerm(user?.perms, 'nalog.write')
  // poraba: SAMO dodeljeni monter ali inventory.write (enako kot API)
  const canUseMaterial = hasPerm(user?.perms, 'inventory.write') || (!!wo && !!user && wo.assignee?.id === user.id)

  const troubles = (wo?.events ?? []).filter((e) => e.type === 'TEZAVA')

  async function transition (to: string, label: string, note?: string) {
    setBusy(true)
    try {
      await apiPost(`/api/nalog/${woId}/transition`, { to, note: note ?? label })
      toast({ title: `${label} — ${wo?.code ?? ''}`, description: 'Prehod delovnega toka uspešno izveden.' })
      setShowFinal(false); setFinalNote('')
      await Promise.all([detail.reload(), checklist.reload(), material.reload(), onTransitioned()])
    } catch (e) {
      toast({ title: 'Prehod zavrnjen', description: e instanceof Error ? e.message : 'Napaka', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  if (detail.loading && !wo) return <LoadingRows rows={2} />
  if (detail.error) return <ErrorBox error={detail.error} />
  if (!wo) return null

  const phase = phaseIndex(wo.status)
  const action = NEXT_ACTION[wo.status]
  const clRows = checklist.data?.data ?? []
  const clDone = clRows.filter((c) => c.done).length
  const usageRows = material.data?.data ?? []
  const usageTotal = usageRows.length

  return (
    <div className="space-y-4">
      {/* lepljivi 7-fazni stepper (mobilno vodoravno drsenje) */}
      <Stepper7 phase={phase} code={wo.code} />

      <PhaseHint status={wo.status} startedAt={wo.startedAt} completedAt={wo.completedAt} />

      {/* navodila pisarne */}
      <section aria-label="Navodila" className="rounded-xl border bg-secondary/30 p-3">
        <h3 className="mb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Navodila</h3>
        {wo.instructions ? (
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{wo.instructions}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Za ta nalog ni posebnih navodil.</p>
        )}
      </section>

      {/* kontrolni seznam (R444) */}
      <ChecklistSection
        woId={woId} rows={clRows} loading={checklist.loading} error={checklist.error}
        done={clDone} canWrite={canChecklist}
        onReload={() => void checklist.reload()}
      />

      {/* poraba materiala (R444) */}
      <MaterialSection
        woId={woId} rows={usageRows} loading={material.loading} error={material.error}
        canUse={canUseMaterial}
        onReload={() => void material.reload()}
      />

      {/* težave na terenu (R444 — dogodek TEZAVA) */}
      <TroubleSection woId={woId} troubles={troubles} canWrite={canChecklist} onReload={() => void detail.reload()} />

      {/* meritve + foto — povezava na zajem */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline" className="h-11 justify-start gap-2"
          onClick={() => { setSection('zajem'); setTab('meritve') }}
        >
          <Ruler className="size-4 text-roksal-amber" aria-hidden />
          <span className="flex min-w-0 flex-col items-start">
            <span className="text-sm font-medium leading-tight">Meritve</span>
            <span className="text-[11px] text-muted-foreground">{wo.measurements.length} na tem nalogu</span>
          </span>
        </Button>
        <Button
          variant="outline" className="h-11 justify-start gap-2"
          onClick={() => { setSection('zajem'); setTab('foto') }}
        >
          <Camera className="size-4 text-roksal-amber" aria-hidden />
          <span className="flex min-w-0 flex-col items-start">
            <span className="text-sm font-medium leading-tight">Foto zajem</span>
            <span className="text-[11px] text-muted-foreground">dokumentacija terena</span>
          </span>
        </Button>
      </div>

      {/* PREDAJA — poročilo o predaji (R444) */}
      {wo.status === 'ZAKLJUCEN' ? <PredajaReport wo={wo} clDone={clDone} clTotal={clRows.length} usageCount={usageTotal} /> : null}

      {/* akcija terenskega toka */}
      {action && canTransition ? (
        <div className="space-y-2 rounded-xl border bg-card p-3">
          {wo.status === 'V_PREVERI' && showFinal ? (
            <>
              <Label htmlFor={`fin-${woId}`}>Povzetek zaključka (viden v poročilu o predaji)</Label>
              <Textarea
                id={`fin-${woId}`} rows={3} value={finalNote}
                onChange={(e) => setFinalNote(e.target.value)}
                placeholder="Kaj je bilo narejeno, posebnosti, dogovori s stranko …"
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  className="h-11 flex-1" disabled={busy}
                  onClick={() => void transition(action.to, action.label, finalNote.trim() || undefined)}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CheckCheck className="size-4" aria-hidden />}
                  Potrdi zaključek terena
                </Button>
                <Button variant="outline" className="h-11" disabled={busy} onClick={() => setShowFinal(false)}>Prekliči</Button>
              </div>
            </>
          ) : wo.status === 'V_PREVERI' ? (
            <Button className="h-11 w-full" disabled={busy} onClick={() => setShowFinal(true)}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CheckCheck className="size-4" aria-hidden />}
              {action.label} — zapiši povzetek
            </Button>
          ) : (
            <Button
              className="h-11 w-full sm:w-auto sm:min-w-56" disabled={busy}
              onClick={() => void transition(action.to, action.label)}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <action.icon className="size-4" aria-hidden />}
              {action.label}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}

// ─── lepljivi stepper 7 faz ──────────────────────────────────────────────────

function Stepper7 ({ phase, code }: { phase: number; code: string }) {
  return (
    <div
      className="sticky top-14 z-20 -mx-1 rounded-xl border bg-background/95 px-2 py-2 backdrop-blur"
      role="group"
      aria-label={`Delovni tok naloga ${code} — faza ${FAZE[phase].label}`}
    >
      {/* relative: sr-only (abspos) vsebina kovčkov mora ostati znotraj drsečega
          območja ol — sicer bi se prelila čez lepljivi (positioned) prednik na stran */}
      <ol className="relative flex items-stretch gap-1 overflow-x-auto pb-1" aria-label="Sedem faz delovnega toka">
        {FAZE.map((f, i) => {
          const done = i < phase
          const current = i === phase
          return (
            <li key={f.key} className="flex shrink-0 items-center gap-1" aria-current={current ? 'step' : undefined}>
              <div
                className={cn(
                  'flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold uppercase tracking-wide',
                  done && 'bg-roksal-green/15 text-roksal-green',
                  current && 'bg-roksal-amber/20 text-roksal-amber ring-1 ring-roksal-amber/50',
                  !done && !current && 'bg-secondary/60 text-muted-foreground',
                )}
                title={`${f.label} — ${done ? 'opravljeno' : current ? 'trenutna faza' : 'pred nami'}`}
              >
                {done ? <CheckCircle2 className="size-4 shrink-0" aria-hidden /> : current ? <HardHat className="size-4 shrink-0" aria-hidden /> : <Circle className="size-3.5 shrink-0" aria-hidden />}
                <span className="whitespace-nowrap">{f.label}</span>
                <span className="sr-only"> — {done ? 'opravljeno' : current ? 'trenutna faza' : 'pred nami'}</span>
              </div>
              {i < FAZE.length - 1 ? <span aria-hidden className="text-muted-foreground/60">›</span> : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Utripajoče vodilo trenutne faze (kaj zdaj). */
function PhaseHint ({ status, startedAt, completedAt }: { status: string; startedAt: string | null; completedAt: string | null }) {
  const hints: Record<string, string> = {
    NAPROGRAMIRAN: 'Nalog je odprt — na terenu potrdi prihod in začni delo.',
    V_TEKU: 'Delo je začeto. Pred montažo opravi zajem (meritve + foto).',
    V_ZAJEMU: 'Zajem v teku — izmeri in fotografiraj teren, nato nadaljuj z montažo.',
    V_PREVERI: 'Montaža je za nami — opravi kontrolo in zaključi teren.',
    ZAKLJUCEN: 'Teren je zaključen. Poročilo o predaji je spodaj.',
  }
  const stamp = status === 'ZAKLJUCEN' ? completedAt : startedAt
  return (
    <p className="rounded-lg bg-secondary/50 px-3 py-2 text-sm text-muted-foreground" role="status">
      {hints[status] ?? status}
      {stamp ? <span className="ml-1 text-xs">({fmtDateTime(stamp)})</span> : null}
    </p>
  )
}

// ─── kontrolni seznam ────────────────────────────────────────────────────────

function ChecklistSection ({ woId, rows, loading, error, done, canWrite, onReload }: {
  woId: string
  rows: ChecklistRow[]
  loading: boolean
  error: { message: string; detail?: string } | null
  done: number
  canWrite: boolean
  onReload: () => void
}) {
  const { toast } = useToast()
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  async function addItem () {
    const l = label.trim()
    if (!l) { toast({ title: 'Zapiši besedilo točke.', variant: 'destructive' }); return }
    setBusy('add')
    try {
      await apiPost(`/api/nalog/${woId}/checklist`, { label: l })
      toast({ title: 'Točka dodana.', description: l })
      setLabel('')
      onReload()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  async function toggle (row: ChecklistRow) {
    setBusy(row.id)
    try {
      await apiPatch(`/api/nalog/${woId}/checklist`, { id: row.id, done: !row.done })
      onReload()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const total = rows.length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <section aria-label="Kontrolni seznam" className="rounded-xl border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <ClipboardList className="size-4 text-roksal-amber" aria-hidden /> Kontrolni seznam
        </h3>
        {total > 0 ? (
          <span className={cn('text-xs font-semibold', done === total ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
            {done}/{total} opravljeno
          </span>
        ) : null}
      </div>
      {total > 0 ? <Progress value={pct} aria-label={`Napredek kontrolnega seznama ${pct} odstotkov`} className="mb-3 h-2" /> : null}

      <ErrorBox error={error} />
      {loading ? <LoadingRows rows={2} /> : !error && total === 0 ? (
        <p className="text-sm text-muted-foreground">Ni točk — dodaj prvo (npr. »Preverjena vodovodna instalacija«).</p>
      ) : !error ? (
        <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={row.done}
                aria-label={`${row.label} — ${row.done ? 'opravljeno' : 'neopravljeno'}`}
                disabled={!!busy || !canWrite}
                onClick={() => void toggle(row)}
                className={cn(
                  'flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition',
                  row.done ? 'text-muted-foreground' : 'text-foreground',
                  'hover:bg-secondary/50 focus-visible:outline-2 focus-visible:outline-ring',
                  (busy === row.id || !canWrite) && 'opacity-60',
                )}
              >
                {busy === row.id ? (
                  <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                ) : (
                  <Checkbox checked={row.done} aria-hidden tabIndex={-1} className="pointer-events-none size-5" />
                )}
                <span className={cn('flex-1 text-sm leading-snug', row.done && 'line-through decoration-muted-foreground/60')}>
                  {row.label}
                </span>
                {row.done && row.doneBy ? (
                  <span className="shrink-0 text-[10px] text-muted-foreground">{row.doneBy.name}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {canWrite ? (
        <div className="mt-3 flex gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addItem() }}
            placeholder="Nova točka kontrolnega seznama …"
            aria-label="Nova točka kontrolnega seznama"
            className="h-11"
            maxLength={300}
          />
          <Button className="h-11 shrink-0 px-3" disabled={busy === 'add' || !label.trim()} onClick={() => void addItem()} aria-label="Dodaj točko">
            {busy === 'add' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

// ─── poraba materiala ────────────────────────────────────────────────────────

function MaterialSection ({ woId, rows, loading, error, canUse, onReload }: {
  woId: string
  rows: UsageRow[]
  loading: boolean
  error: { message: string; detail?: string } | null
  canUse: boolean
  onReload: () => void
}) {
  const { toast } = useToast()
  const [formOpen, setFormOpen] = useState(false)
  const [itemId, setItemId] = useState('none')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // katalog artiklov za izbiro (monter vidi samo inventory.read podatke)
  const stock = useApi<{ data: StockRow[] }>(formOpen ? '/api/stock' : null, [formOpen])
  const items = stock.data?.data ?? []
  const selected = items.find((it) => it.id === itemId)

  async function submit () {
    if (itemId === 'none') { toast({ title: 'Izberi artikel.', variant: 'destructive' }); return }
    const q = Number(qty)
    if (!Number.isFinite(q) || q <= 0) { toast({ title: 'Količina mora biti pozitivno število.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      const res = await apiPost<{ data: UsageRow }>(`/api/nalog/${woId}/material`, {
        itemId, qty: q, note: note.trim() || null,
      })
      toast({
        title: 'Poraba zabeležena.',
        description: `${res.data.item.sku}: fizična zaloga je sedaj ${res.data.item.qty} ${res.data.item.unit} (gibanje IZDAJA).`,
      })
      setItemId('none'); setQty(''); setNote('')
      onReload()
      setFormOpen(false)
    } catch (e) {
      toast({ title: 'Napaka pri zapisu porabe', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Poraba materiala" className="rounded-xl border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <Package className="size-4 text-roksal-amber" aria-hidden /> Poraba materiala
        </h3>
        {rows.length > 0 ? <span className="text-xs font-semibold text-muted-foreground">{rows.length} zapisov</span> : null}
      </div>

      <ErrorBox error={error} />
      {loading ? <LoadingRows rows={2} /> : !error && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Na tem nalogu še ni porabe materiala.</p>
      ) : !error ? (
        <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {rows.map((r) => (
            <li key={r.id} className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-secondary/40 px-3 py-1.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  <span className="font-mono text-xs text-muted-foreground">{r.item.sku}</span> · {r.item.name}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {fmtDateTime(r.createdAt)} · {r.user?.name ?? '—'}
                  {r.note ? ` · ${r.note}` : ''}
                </div>
              </div>
              <span className="shrink-0 font-mono text-sm font-bold text-foreground">−{r.qty} {r.item.unit}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {canUse ? (
        formOpen ? (
          <div className="mt-3 space-y-2 rounded-lg border bg-secondary/30 p-3">
            <div className="space-y-1.5">
              <Label>Artikel</Label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger className="h-11" aria-label="Artikel porabe">
                  <SelectValue placeholder={stock.loading ? 'Nalagam …' : 'Izberi artikel'} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {items.map((it) => (
                    <SelectItem key={it.id} value={it.id} className="py-2">
                      {it.sku} — {it.name} (razpoložljivo {it.available} {it.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected ? (
                <p className="text-xs text-muted-foreground">
                  Fizična: {selected.physical} {selected.unit} · rezervirana: {selected.reserved} · razpoložljiva: {selected.available}
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor={`mat-qty-${woId}`}>Količina</Label>
                <Input
                  id={`mat-qty-${woId}`} type="number" min="0" step="any" className="h-11"
                  value={qty} onChange={(e) => setQty(e.target.value)} placeholder="npr. 4.5"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`mat-note-${woId}`}>Opomba</Label>
                <Input
                  id={`mat-note-${woId}`} className="h-11"
                  value={note} onChange={(e) => setNote(e.target.value)} placeholder="neobvezno"
                />
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="h-11 flex-1" disabled={busy} onClick={() => void submit()}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Package className="size-4" aria-hidden />}
                Zabeleži porabo
              </Button>
              <Button variant="outline" className="h-11" disabled={busy} onClick={() => setFormOpen(false)}>Prekliči</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="mt-3 h-11 w-full" onClick={() => setFormOpen(true)}>
            <Plus className="size-4" aria-hidden /> Zabeleži porabo materiala
          </Button>
        )
      ) : null}
    </section>
  )
}

// ─── težave na terenu (dogodek TEZAVA) ───────────────────────────────────────

function TroubleSection ({ woId, troubles, canWrite, onReload }: {
  woId: string
  troubles: { id: string; note: string | null; createdAt: string; user: { name: string } | null }[]
  canWrite: boolean
  onReload: () => void
}) {
  const { toast } = useToast()
  const [formOpen, setFormOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit () {
    const n = note.trim()
    if (!n) { toast({ title: 'Opiši težavo.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      await apiPost(`/api/nalog/${woId}/events`, { type: 'TEZAVA', note: n })
      toast({ title: 'Težava zabeležena.', description: 'Pisarna jo vidi v dogodkih naloga.' })
      setNote(''); setFormOpen(false)
      onReload()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Težave na terenu" className="rounded-xl border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <TriangleAlert className="size-4 text-roksal-amber" aria-hidden /> Težave
        </h3>
        {troubles.length > 0 ? (
          <span className="text-xs font-semibold text-red-600 dark:text-red-400">{troubles.length}</span>
        ) : null}
      </div>

      {troubles.length > 0 ? (
        <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {troubles.map((t) => (
            <li key={t.id} className="min-h-11 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 dark:bg-amber-500/15">
              <p className="text-sm font-medium leading-snug text-foreground">{t.note}</p>
              <p className="text-[11px] text-muted-foreground">{fmtDateTime(t.createdAt)} · {t.user?.name ?? '—'}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Brez zabeleženih težav.</p>
      )}

      {canWrite ? (
        formOpen ? (
          <div className="mt-3 space-y-2">
            <Label htmlFor={`trz-${woId}`}>Opiši težavo</Label>
            <Textarea
              id={`trz-${woId}`} rows={3} value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Kaj je šlo narobe, kaj manjka, kaj blokira montažo …"
              maxLength={1000}
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="destructive" className="h-11 flex-1" disabled={busy} onClick={() => void submit()}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <TriangleAlert className="size-4" aria-hidden />}
                Zabeleži težavo
              </Button>
              <Button variant="outline" className="h-11" disabled={busy} onClick={() => setFormOpen(false)}>Prekliči</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="mt-3 h-11 w-full" onClick={() => setFormOpen(true)}>
            <TriangleAlert className="size-4" aria-hidden /> Zabeleži težavo
          </Button>
        )
      ) : null}
    </section>
  )
}

// ─── PREDAJA — poročilo o predaji ────────────────────────────────────────────

function PredajaReport ({ wo, clDone, clTotal, usageCount }: {
  wo: WorkOrderDetailRow
  clDone: number
  clTotal: number
  usageCount: number
}) {
  return (
    <section aria-label="Poročilo o predaji" className="rounded-xl border border-roksal-green/40 bg-roksal-green/5 p-3">
      <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        <CheckCheck className="size-4 text-roksal-green" aria-hidden /> Poročilo o predaji
      </h3>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-[11px] uppercase text-muted-foreground">Zaključek</dt>
          <dd className="font-semibold">{fmtDateTime(wo.completedAt)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase text-muted-foreground">Meritve</dt>
          <dd className="font-semibold">{wo.measurements.length}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase text-muted-foreground">Checklist</dt>
          <dd className="font-semibold">{clTotal > 0 ? `${clDone}/${clTotal}` : '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase text-muted-foreground">Poraba materiala</dt>
          <dd className="font-semibold">{usageCount} zapisov</dd>
        </div>
      </dl>
      {wo.summary ? (
        <p className="mt-2 whitespace-pre-line rounded-lg bg-background/60 p-2 text-sm leading-relaxed">{wo.summary}</p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Nalog je zaključen brez povzetka.</p>
      )}
    </section>
  )
}

// ─── vreme (R434 — nespremenjeno) ────────────────────────────────────────────

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
