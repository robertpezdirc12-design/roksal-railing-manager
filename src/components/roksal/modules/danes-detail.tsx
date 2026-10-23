'use client'

// DANES — podrobnost naloga: R486 ZAČNI MERITEV tok + playbook strip + stepper
// — R548 izvleček iz danes.tsx (razbitje po vzorcu R546/R547; BREZ spremembe obnašanja).
// Sestavlja sekcije (checklist/material/težave/predaja), kamera dialog in
// montažno QA/primopredajo (montaza-qa).

import { useEffect, useState } from 'react'
import {
  ArrowRight, Camera, CheckCheck, CheckCircle2, ChevronRight, Circle, HardHat,
  Loader2, Ruler, Workflow,
} from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { apiPost, fmtDateTime, useApi } from '@/lib/api-client'
import { ErrorBox, LoadingRows } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { loadDraft } from '@/lib/measure-draft'
import { KameraMeritevDialog } from '@/components/roksal/modules/meritve-kamera'
import { HandoverSection, MontazaQaSection } from '@/components/roksal/modules/montaza-qa'
import {
  type ChecklistRow, type UsageRow, type WorkOrderDetailRow, type WorkOrderRow,
  FAZE, NEXT_ACTION, phaseIndex,
} from './danes-shared'
import { ChecklistSection, MaterialSection, PredajaReport, TroubleSection } from './danes-sekcije'

// ─── R458 (issue #13 §12): vodeni postopek na nalogu — MOJ DAN → NADALJUJ ────

export interface PlaybookRunRow {
  id: string; key: string; version: number; naziv: string; status: string
  startedAt: string; completedAt: string | null
  napredek: { trenutni: number; skupaj: number; koncanih: number; izjem: number; odstotek: number } | null
}

/** Napredek zagonov playbooka na nalogu (npr. 7/9 korakov) + NADALJUJ. */
export function PlaybookStrip ({ woId }: { woId: string }) {
  const setSection = useAppStore((s) => s.setSection)
  const setTab = useAppStore((s) => s.setTab)
  const setPlaybookRunId = useAppStore((s) => s.setPlaybookRunId)
  const runs = useApi<{ data: PlaybookRunRow[] }>(`/api/playbook/runs?workOrderId=${woId}`)
  const list = runs.data?.data ?? []

  // playbook je dopolnilo Danes, ne ovira — napake tiho skrijemo
  if (runs.loading || runs.error) return null

  function odpri (runId: string) {
    setPlaybookRunId(runId)
    setSection('danes')
    setTab('playbook')
  }

  if (list.length === 0) {
    return (
      <button
        type="button"
        onClick={() => { setSection('danes'); setTab('playbook') }}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed p-3 text-left transition hover:bg-secondary/40 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Workflow className="size-5 shrink-0 text-roksal-amber" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">Vodeni postopek ni zagnan</span>
          <span className="block text-xs text-muted-foreground">Playbook te popelje skozi izmero ali montažo korak za korakom.</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border bg-secondary/30 p-3">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        <Workflow className="size-3.5 text-roksal-amber" aria-hidden /> Vodeni postopek
      </h3>
      {list.slice(0, 3).map((r) => (
        <div key={r.id} className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{r.naziv}</div>
            <div className="mt-1 flex items-center gap-2">
              <Progress value={r.napredek?.odstotek ?? 0} className="h-1.5 flex-1" aria-label={`Napredek ${r.napredek?.odstotek ?? 0} %`} />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {r.status === 'ZAKLJUCEN'
                  ? `zaključen (${r.napredek?.koncanih ?? 0}/${r.napredek?.skupaj ?? 0})`
                  : `${r.napredek?.koncanih ?? 0}/${r.napredek?.skupaj ?? 0} korakov`}
              </span>
            </div>
          </div>
          {r.status === 'V_TEKU' ? (
            <Button size="sm" className="h-9 shrink-0" onClick={() => odpri(r.id)}>
              Nadaljuj <ArrowRight className="size-4" aria-hidden />
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={() => odpri(r.id)}>
              Pregled
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── podrobnost naloga: stepper, navodila, checklist, material, težave ───────

export function WorkOrderDetail ({ woId, onTransitioned }: {
  woId: string
  onTransitioned: () => Promise<void>
}) {
  const user = useAppStore((s) => s.user)
  const setTab = useAppStore((s) => s.setTab)
  const setSection = useAppStore((s) => s.setSection)
  const setMeasureCtx = useAppStore((s) => s.setMeasureCtx)
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [finalNote, setFinalNote] = useState('')
  const [showFinal, setShowFinal] = useState(false)

  // ── R486 (issue #7 §3): ZAČNI MERITEV — kamera dialog z avtomatskim kontekstom ──
  const [kameraOpen, setKameraOpen] = useState(false)
  const [autoResume, setAutoResume] = useState(false)
  const [draftAt, setDraftAt] = useState<string | null>(null)

  const detail = useApi<{ data: WorkOrderDetailRow }>(`/api/nalog/${woId}`)
  const checklist = useApi<{ data: ChecklistRow[] }>(`/api/nalog/${woId}/checklist`)
  const material = useApi<{ data: UsageRow[] }>(`/api/nalog/${woId}/material`)

  const wo = detail.data?.data ?? null
  const canTransition = hasPerm(user?.perms, 'nalog.transition')
  const canChecklist = hasPerm(user?.perms, 'nalog.write')
  // poraba: SAMO dodeljeni monter ali inventory.write (enako kot API)
  const canUseMaterial = hasPerm(user?.perms, 'inventory.write') || (!!wo && !!user && wo.assignee?.id === user.id)

  const troubles = (wo?.events ?? []).filter((e) => e.type === 'TEZAVA')

  const canMeasure = hasPerm(user?.perms, 'measurements.write')

  // R486 (issue #7 §3): nedokončana meritev (IndexedDB osnutek) → Nadaljuj nedokončano
  useEffect(() => {
    if (kameraOpen) return
    setDraftAt(null)
    const uid = user?.id
    if (!uid) return
    let cancelled = false
    void loadDraft(uid).then((d) => {
      if (!cancelled && d && Array.isArray(d.views) && d.views.length > 0) setDraftAt(d.savedAt)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [user?.id, kameraOpen])

  function odpriKamero (resume: boolean): void {
    setAutoResume(resume)
    // merilni kontekst za module (vzorec playbookRunId R458) — kamera prejme predpolnite
    setMeasureCtx({ projectId: wo?.project?.id ?? '', workOrderId: woId })
    setKameraOpen(true)
  }

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

      {/* R458 (issue #13 §12): vodeni postopek — napredek + NADALJUJ,
          da monter ne išče modula po menijih (sistem ga vodi) */}
      <PlaybookStrip woId={woId} />

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

      {/* R489 (issue #12): KONTROLA KAKOVOSTI MONTAŽE — statusne točke iz virov,
          odstopanja in korektivni ukrepi (vzporedno preprostemu seznamu R444) */}
      <MontazaQaSection
        woId={woId}
        canWrite={canChecklist && wo.status !== 'ZAKLJUCEN'}
        fotoOptions={(wo.measurements ?? []).filter((m) => m.type === 'FOTO').map((m) => ({ id: m.id, label: `Foto ${new Date(m.createdAt).toLocaleDateString('sl-SI')} (${m.id.slice(-6)})` }))}
        onTransitioned={() => void detail.reload()}
      />

      {/* R489 (issue #12 §2D): PRIMOPREDAJA — poročilo, primerjava, podpisa, PDF */}
      {wo.status === 'V_PREVERI' || wo.status === 'ZAKLJUCEN' ? (
        <HandoverSection
          woId={woId}
          canWrite={canChecklist}
          onTransitioned={() => void detail.reload()}
        />
      ) : null}

      {/* meritve + foto — povezava na zajem */}
      {/* R486 (issue #7 §3): ZAČNI MERITEV — en velik primarni gumb z avtomatskim
          kontekstom naloga (projekt/nalog NE izbira ročno) + sekundarno
          Nadaljuj nedokončano (osnutek) in Dodaj fotografijo */}
      {canMeasure && (wo.status === 'V_TEKU' || wo.status === 'V_ZAJEMU') ? (
        <div className="space-y-2">
          <Button
            size="lg" className="h-12 w-full text-base"
            onClick={() => odpriKamero(false)}
          >
            <Ruler className="size-5" aria-hidden /> ZAČNI MERITEV
          </Button>
          {draftAt ? (
            <Button
              size="lg" variant="outline" className="h-11 w-full"
              onClick={() => odpriKamero(true)}
            >
              <Camera className="size-4 text-roksal-amber" aria-hidden />
              Nadaljuj nedokončano{draftAt ? ` (shranjeno ${new Date(draftAt).toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' })})` : ''}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline" className="h-11 justify-start gap-2"
          onClick={() => { setSection('projekti'); setTab('meritve') }}
        >
          <Ruler className="size-4 text-roksal-amber" aria-hidden />
          <span className="flex min-w-0 flex-col items-start">
            <span className="text-sm font-medium leading-tight">Meritve</span>
            <span className="text-[11px] text-muted-foreground">{wo.measurements.length} na tem nalogu</span>
          </span>
        </Button>
        <Button
          variant="outline" className="h-11 justify-start gap-2"
          onClick={() => { setSection('projekti'); setTab('foto') }}
        >
          <Camera className="size-4 text-roksal-amber" aria-hidden />
          <span className="flex min-w-0 flex-col items-start">
            <span className="text-sm font-medium leading-tight">Dodaj fotografijo</span>
            <span className="text-[11px] text-muted-foreground">dokumentacija terena</span>
          </span>
        </Button>
      </div>

      {/* R486: kamera meritev — odprta z avtomatskim kontekstom iz tega naloga */}
      <KameraMeritevDialog
        open={kameraOpen}
        onClose={() => { setKameraOpen(false) }}
        onSaved={async () => { await Promise.all([detail.reload(), onTransitioned()]) }}
        initialProjectId={wo.project?.id}
        initialWorkOrderId={wo.id}
        autoResumeDraft={autoResume}
      />

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

export function Stepper7 ({ phase, code }: { phase: number; code: string }) {
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
                  done && 'bg-roksal-green/15 text-emerald-700 dark:text-roksal-green',
                  current && 'bg-roksal-amber/20 text-roksal-amber-text ring-1 ring-roksal-amber/50',
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
export function PhaseHint ({ status, startedAt, completedAt }: { status: string; startedAt: string | null; completedAt: string | null }) {
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
