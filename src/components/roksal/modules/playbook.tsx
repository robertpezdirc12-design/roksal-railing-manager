'use client'

// VODENI POSTOPEK — R458 (GitLab issue #13: SCRIPT-FIRST FIELD WORKFLOW)
// Monterjeva glavna izkušnja (§12): MOJ DAN → izberi nalog → NADALJUJ →
// sistem vodi skozi korake. En zaslon = en glavni cilj (§3): velika primarna
// akcija, malo sekundarnih, vedno viden napredek KORAK X/N.
// BREZ runtime AI — naslednji korak izračuna deterministični engine (§2).
//
// Struktura:
//  • PlaybookModule — izbira naloga + playbooka, seznam zagonov
//  • RunView — runner: trenutni korak, dokazila, pogoji, izjeme, handoff
//  • AdminDefs — §15 admin upravljanje definicij (verzije, statusi, urejanje)

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Ban, BookOpen, Camera, Check, CheckCircle2, ChevronRight,
  Circle, ClipboardCheck, Compass, FileEdit, GitBranch, Laptop, Loader2, MapPin,
  NotebookPen, Pencil, Play, Plus, RefreshCcw, RotateCcw, Ruler, Save, Settings2,
  ShieldAlert, SkipForward, Smartphone, Workflow,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiGet, apiPatch, apiPost } from '@/lib/api-client'
import { hasPerm } from '@/lib/permissions-core'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import {
  jeVVerigi, NAPRAVA_TEHNIKA, type NapravaTier,
  type PlaybookDefinition, type RunContext,
} from '@/lib/playbook-core'
import type { RunState } from '@/lib/playbook-engine'

// ─── tipi (odgovori API) ─────────────────────────────────────────────────────

interface NalogRow {
  id: string; code: string; title: string; status: string
  assignee?: { id: string } | null
}

interface DefRow {
  id: string; key: string; name: string; version: number; status: string
  effectiveFrom: string; updatedAt: string; author: string | null
  zagonov: number; korakov: number
}

interface RunPovzetek {
  id: string; key: string; version: number; naziv: string; status: string
  startedAt: string; completedAt: string | null
  workOrderId?: string | null
  napredek: { trenutni: number; skupaj: number; koncanih: number; izjem: number; odstotek: number } | null
}

const KATEGORIJA_IKONA: Record<string, typeof Camera> = {
  PRIHOD: MapPin, FOTO: Camera, MERITEV: Ruler, ODLOCITEV: GitBranch,
  KONTROLA: ClipboardCheck, AKCIJA: NotebookPen, PREDAJA: CheckCircle2,
}

const KATEGORIJA_BARVA: Record<string, string> = {
  PRIHOD: 'text-sky-600 dark:text-sky-400',
  FOTO: 'text-roksal-amber',
  MERITEV: 'text-emerald-600 dark:text-emerald-400',
  ODLOCITEV: 'text-violet-600 dark:text-violet-400',
  KONTROLA: 'text-orange-600 dark:text-orange-400',
  AKCIJA: 'text-foreground',
  PREDAJA: 'text-teal-600 dark:text-teal-400',
}

const STATUS_OZNaka: Record<string, string> = {
  PENDING: 'čaka', IN_PROGRESS: 'v teku', COMPLETED: 'zaključen',
  NI_PRIMERNO: 'ni primerno', BLOKIRANO: 'blokirano', NEUSPESNO: 'neuspešno',
}

// ─── detekcija zmogljivosti naprave (§9 — BREZ runtime AI) ─────────────────

async function preveriNapravo (): Promise<{ tier: NapravaTier; opis: string }> {
  const nav = navigator as Navigator & {
    xr?: { isSessionSupported?: (m: string) => Promise<boolean> }
    mediaDevices?: MediaDevices
    maxTouchPoints?: number
  }
  const imaKamero = !!nav.mediaDevices?.getUserMedia
  let imaAr = false
  try { imaAr = !!(await nav.xr?.isSessionSupported?.('immersive-ar')) } catch { imaAr = false }
  // depth/LiDAR v brskalniku ni izpostavljen — pošteno poročamo AR/kamero
  if (imaAr) return { tier: 'AR', opis: 'WebXR AR — ravnine in raycast' }
  if (imaKamero) return { tier: 'KAMERA', opis: 'kamera + žiroskop + referenca' }
  return { tier: 'OGRANICENO', opis: 'omejena naprava — ročni vnos' }
}

// ═══ GLAVNI MODUL ═════════════════════════════════════════════════════════

export default function PlaybookModule () {
  const user = useAppStore((s) => s.user)
  const playbookRunId = useAppStore((s) => s.playbookRunId)
  const setPlaybookRunId = useAppStore((s) => s.setPlaybookRunId)
  const [aktivniRun, setAktivniRun] = useState<string | null>(playbookRunId)
  // ob preklopu iz Danes → Vodeni postopek: uskladi brez efekta
  // (uradni vzorec »adjust state during render« — react.dev)
  const [videnRunId, setVidenRunId] = useState<string | null>(playbookRunId)
  if (videnRunId !== playbookRunId) {
    setVidenRunId(playbookRunId)
    if (playbookRunId) setAktivniRun(playbookRunId)
  }

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'VODJA'
  const [adminView, setAdminView] = useState(false)

  if (aktivniRun) {
    return (
      <RunView
        runId={aktivniRun}
        onNazaj={() => { setAktivniRun(null); setPlaybookRunId(null) }}
      />
    )
  }

  if (adminView && isAdmin) {
    return <AdminDefs onNazaj={() => setAdminView(false)} />
  }

  return (
    <PlaybookHome
      onOdpriRun={(id) => setAktivniRun(id)}
      onAdmin={() => setAdminView(true)}
      isAdmin={isAdmin}
    />
  )
}

// ─── domov: izbira naloga + playbooka + seznam zagonov (§12) ────────────────

function PlaybookHome ({ onOdpriRun, onAdmin, isAdmin }: {
  onOdpriRun: (id: string) => void
  onAdmin: () => void
  isAdmin: boolean
}) {
  const { toast } = useToast()
  const [nalogi, setNalogi] = useState<NalogRow[] | null>(null)
  const [defs, setDefs] = useState<DefRow[] | null>(null)
  const [runs, setRuns] = useState<RunPovzetek[] | null>(null)
  const [napaka, setNapaka] = useState<string | null>(null)
  const [izbranNalog, setIzbranNalog] = useState<string>('')
  const [izbranKey, setIzbranKey] = useState<string>('OGRAJA')
  const [busy, setBusy] = useState(false)

  async function nalozi () {
    try {
      const [n, d, r] = await Promise.all([
        apiGet<{ data: NalogRow[] }>('/api/nalog?scope=open'),
        apiGet<{ data: DefRow[] }>('/api/playbook/defs'),
        apiGet<{ data: RunPovzetek[] }>('/api/playbook/runs'),
      ])
      setNalogi(n.data); setDefs(d.data); setRuns(r.data)
    } catch (e) {
      setNapaka(e instanceof Error ? e.message : 'Napaka nalaganja')
    }
  }
  useEffect(() => { void nalozi() }, [])

  async function zagoni () {
    if (!izbranNalog) {
      toast({ title: 'Izberi nalog', description: 'Vodeni postopek se izvaja na delovnem nalogu.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const rez = await apiPost<{ data: { runId: string; nov: boolean } }>('/api/playbook/runs', {
        workOrderId: izbranNalog, key: izbranKey,
      })
      toast({
        title: rez.data.nov ? 'Vodeni postopek zagnan' : 'Nadaljevanje obstoječega',
        description: `${izbranKey} — sistem te vodi po korakih.`,
      })
      onOdpriRun(rez.data.runId)
    } catch (e) {
      toast({ title: 'Zagon ni uspel', description: e instanceof Error ? e.message : 'Napaka', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vodeni postopek"
        desc="Deterministični playbooki vodijo monterja skozi celoten postopek brez runtime AI (R458)"
        actions={isAdmin ? (
          <Button variant="outline" size="sm" onClick={onAdmin}>
            <Settings2 className="size-4" aria-hidden /> Upravljanje
          </Button>
        ) : undefined}
      />

      {napaka ? <ErrorBox error={{ message: napaka }} /> : null}

      {/* nov zagon: nalog + playbook */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            <Play className="size-4 text-roksal-amber" aria-hidden /> Zaženi postopek
          </h2>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="pb-nalog">Nalog</Label>
              <Select value={izbranNalog} onValueChange={setIzbranNalog}>
                <SelectTrigger id="pb-nalog" className="h-11 w-full">
                  <SelectValue placeholder="Izberi nalog …" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {(nalogi ?? []).map((n) => (
                    <SelectItem key={n.id} value={n.id}>{n.code} — {n.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pb-key">Playbook</Label>
              <Select value={izbranKey} onValueChange={setIzbranKey}>
                <SelectTrigger id="pb-key" className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(defs ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.key}>
                      {d.key} · v{d.version} · {d.korakov} korakov
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button className="h-11 w-full sm:w-auto" disabled={busy || !nalogi} onClick={() => void zagoni()}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
                NADALJUJ
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Edinstvena pot na nalogu: obstoječi zagon se nadaljuje, brez podvajanja.
          </p>
        </CardContent>
      </Card>

      {/* moji zagoni */}
      <section aria-label="Zagoni">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">Zagoni</h2>
        {runs === null ? <LoadingRows rows={2} /> : runs.length === 0 ? (
          <EmptyState
            title="Ni še zagonov"
            desc="Zaženi prvi vodeni postopek na nalogu zgoraj."
            icon={Workflow}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {runs.map((r) => (
              <Card key={r.id} className="transition-shadow hover:shadow-md">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-foreground">{r.naziv}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.key} v{r.version} · {new Date(r.startedAt).toLocaleString('sl-SI')}
                        {r.status !== 'V_TEKU' ? ` · ${r.status === 'ZAKLJUCEN' ? 'zaključen' : 'prekinjen'}` : ''}
                      </div>
                    </div>
                    {r.napredek ? (
                      <span className="whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold">
                        {r.napredek.koncanih}/{r.napredek.skupaj}
                      </span>
                    ) : null}
                  </div>
                  {r.napredek ? <Progress value={r.napredek.odstotek} aria-label={`Napredek ${r.napredek.odstotek} %`} /> : null}
                  <Button
                    variant={r.status === 'V_TEKU' ? 'default' : 'outline'}
                    className="h-10 w-full"
                    onClick={() => onOdpriRun(r.id)}
                  >
                    {r.status === 'V_TEKU' ? 'NADALJUJ' : 'Odpri'}
                    <ChevronRight className="size-4" aria-hidden />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// ═══ RUNNER — en zaslon = en glavni cilj (§3/§12) ═════════════════════════

function RunView ({ runId, onNazaj }: { runId: string; onNazaj: () => void }) {
  const { toast } = useToast()
  const user = useAppStore((s) => s.user)
  const setSection = useAppStore((s) => s.setSection)
  const setTab = useAppStore((s) => s.setTab)
  const [stanje, setStanje] = useState<RunState | null>(null)
  const [napaka, setNapaka] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [naprava, setNaprava] = useState<{ tier: NapravaTier; opis: string } | null>(null)

  useEffect(() => { void preveriNapravo().then(setNaprava) }, [])

  async function nalozi () {
    try {
      const r = await apiGet<{ data: RunState }>(`/api/playbook/runs/${runId}`)
      setStanje(r.data)
    } catch (e) {
      setNapaka(e instanceof Error ? e.message : 'Napaka nalaganja')
    }
  }
  useEffect(() => { void nalozi() }, [runId])

  async function akcija (stepId: string, telo: Record<string, unknown>, opis: string) {
    setBusy(true)
    try {
      const r = await apiPost<{ data: RunState }>(`/api/playbook/runs/${runId}/action`, { stepId, ...telo })
      setStanje(r.data)
      toast({ title: opis, description: 'Stanje korakov posodobljeno.' })
    } catch (e) {
      toast({ title: 'Akcija zavrnjena', description: e instanceof Error ? e.message : 'Napaka', variant: 'destructive' })
      await nalozi()
    } finally {
      setBusy(false)
    }
  }

  if (napaka) return <ErrorBox error={{ message: napaka }} />
  if (!stanje) return <LoadingRows rows={4} />

  const trenutni = stanje.def.steps.find((s) => s.id === stanje.naslednji) ?? null
  const veriga = stanje.def.steps.filter((s) => jeVVerigi(s, stanje.context.odgovori))
  const zakljucen = stanje.run.status === 'ZAKLJUCEN'
  const tehnika = naprava ? NAPRAVA_TEHNIKA[naprava.tier] : null

  return (
    <div className="space-y-4">
      {/* glava zagona + napredek */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="size-9" onClick={onNazaj} aria-label="Nazaj na seznam">
            <ArrowLeft className="size-4" aria-hidden />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-foreground">{stanje.def.naziv}</h1>
            <p className="text-xs text-muted-foreground">
              {stanje.def.key} v{stanje.def.version}
              {zakljucen ? ' · ZAKLJUČEN' : ` · KORAK ${Math.min(stanje.napredek.trenutni, stanje.napredek.skupaj)}/${stanje.napredek.skupaj}`}
              {stanje.napredek.izjem > 0 ? ` · ${stanje.napredek.izjem} izjem` : ''}
            </p>
          </div>
        </div>
        <Progress value={stanje.napredek.odstotek} aria-label={`Napredek ${stanje.napredek.odstotek} %`} />
      </div>

      {/* naprava (§9) */}
      {naprava && tehnika ? (
        <div className="flex items-center gap-2 rounded-lg border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          <Smartphone className="size-3.5 shrink-0" aria-hidden />
          <span><strong className="text-foreground">{tehnika.naziv}</strong> — meritev: {tehnika.meritev}</span>
        </div>
      ) : null}

      {/* handoff po zaključku (§11) */}
      {zakljucen && stanje.handoff.length > 0 ? (
        <Card className="border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-950/30">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-4" aria-hidden /> Postopek zaključen
            </div>
            {stanje.handoff.map((h, i) => (
              <p key={i} className="text-sm text-foreground">{h.opis}</p>
            ))}
            {stanje.handoff.some((h) => h.do === 'KONFIGURATOR') ? (
              <Button
                className="h-11 w-full sm:w-auto"
                onClick={() => { setSection('projekti'); setTab('konfigurator') }}
              >
                Odpri konfigurator <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : null}
            {stanje.handoff.some((h) => h.do === 'NALOG_ZAKLJUCEK') ? (
              <Button
                className="h-11 w-full sm:w-auto"
                onClick={() => { setSection('danes'); setTab('danes') }}
              >
                Zaključi teren v Danes <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* trenutni korak — EN ZASLON = EN GLAVNI CILJ (§3) */}
      {trenutni && !zakljucen ? (
        <TrenutniKorak
          key={trenutni.id} // remount ob preklopu koraka → lokalni vnosi se ponastavijo
          stanje={stanje}
          korak={trenutni}
          busy={busy}
          napravaTier={naprava?.tier ?? null}
          onAkcija={akcija}
        />
      ) : !zakljucen ? (
        <ErrorBox error={{ message: 'Naslednji korak ni znan — osveži stanje.' }} />
      ) : null}

      {/* seznam korakov verige (✓ / → / ○, §12) */}
      <Card>
        <CardContent className="p-4">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Koraki ({stanje.napredek.koncanih}/{stanje.napredek.skupaj})
          </h2>
          <ul className="space-y-1.5">
            {veriga.map((s) => {
              const st = stanje.koraki.find((k) => k.stepId === s.id)
              const jeTrenutni = trenutni?.id === s.id
              const Ikona = KATEGORIJA_IKONA[s.kategorija] ?? NotebookPen
              return (
                <li
                  key={s.id}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                    jeTrenutni ? 'bg-secondary font-medium' : ''
                  }`}
                >
                  {st?.status === 'COMPLETED' ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Zaključen" />
                  ) : st?.status === 'NI_PRIMERNO' || st?.status === 'BLOKIRANO' ? (
                    <Ban className="size-4 shrink-0 text-orange-500" aria-label={st.status === 'NI_PRIMERNO' ? 'Ni primerno' : 'Blokirano'} />
                  ) : jeTrenutni ? (
                    <Play className="size-4 shrink-0 text-roksal-amber" aria-label="Trenutni" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-muted-foreground/40" aria-label="Čaka" />
                  )}
                  <Ikona className={`size-3.5 shrink-0 ${KATEGORIJA_BARVA[s.kategorija] ?? ''}`} aria-hidden />
                  <span className={st?.status === 'COMPLETED' ? 'text-muted-foreground line-through' : 'text-foreground'}>
                    {s.naziv}
                  </span>
                  {st?.status === 'NI_PRIMERNO' || st?.status === 'BLOKIRANO' ? (
                    <span className="ml-auto truncate text-[11px] text-muted-foreground" title={st.exceptionReason ?? ''}>
                      {st.status === 'NI_PRIMERNO' ? 'ni primerno' : 'blokirano'}
                    </span>
                  ) : st?.attempts && st.attempts > 1 ? (
                    <span className="ml-auto text-[11px] text-muted-foreground">{st.attempts}× poskus</span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>

      {/* vodeni koraki povezani na obstoječe module (§7 kamera = vodeni korak) */}
      {!zakljucen ? (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline" className="h-11 justify-start gap-2"
            onClick={() => { setSection('projekti'); setTab('foto') }}
          >
            <Camera className="size-4 text-roksal-amber" aria-hidden /> Foto zajem
          </Button>
          <Button
            variant="outline" className="h-11 justify-start gap-2"
            onClick={() => { setSection('projekti'); setTab('meritve') }}
          >
            <Ruler className="size-4 text-roksal-amber" aria-hidden /> Meritve
          </Button>
        </div>
      ) : null}
    </div>
  )
}

// ─── trenutni korak: dokazila, validacija, pogoji, izjeme ───────────────────

function TrenutniKorak ({ stanje, korak, busy, napravaTier, onAkcija }: {
  stanje: RunState
  korak: PlaybookDefinition['steps'][number]
  busy: boolean
  napravaTier: NapravaTier | null
  onAkcija: (stepId: string, telo: Record<string, unknown>, opis: string) => Promise<void>
}) {
  const st = stanje.koraki.find((k) => k.stepId === korak.id)
  const [besedilo, setBesedilo] = useState('')
  const [fotoId, setFotoId] = useState('')
  const [measurementId, setMeasurementId] = useState('')
  const [podpisId, setPodpisId] = useState('')
  const [naslov, setNaslov] = useState('')
  const [odgovor, setOdgovor] = useState<string | null>(null)
  const [tocke, setTocke] = useState<Record<string, boolean>>({})
  const [vrednosti, setVrednosti] = useState<Record<string, string>>({})
  const [izjemaOdprta, setIzjemaOdprta] = useState(false)
  const [izjemaVrsta, setIzjemaVrsta] = useState<'NI_PRIMERNO' | 'BLOKIRANO'>('NI_PRIMERNO')
  const [razlog, setRazlog] = useState('')
  // opomba: lokalni vnosi se ponastavijo samodejno — komponenta ima
  // key={korak.id} v RunView (remount ob preklopu koraka)

  const vTehu = st?.status === 'IN_PROGRESS' || st?.status === 'NEUSPESNO'
  const tehnika = napravaTier ? NAPRAVA_TEHNIKA[napravaTier] : null

  function zberiEvidence (): Record<string, unknown> {
    const ev: Record<string, unknown> = {}
    if (fotoId.trim()) ev.fotoId = fotoId.trim()
    if (measurementId.trim()) ev.measurementId = measurementId.trim()
    if (podpisId.trim()) ev.podpisId = podpisId.trim()
    if (besedilo.trim()) ev.besedilo = besedilo.trim()
    if (naslov.trim() || korak.evidence.some((e) => e.vrsta === 'LOKACIJA')) {
      ev.lokacija = { naslov: naslov.trim() || undefined }
    }
    if (odgovor !== null) ev.odgovor = korak.moznosti ? odgovor : odgovor === 'DA'
    if (Object.keys(tocke).length > 0) {
      ev.tocke = Object.entries(tocke).map(([id, odkljukano]) => ({ id, odkljukano }))
    }
    const stevilke: Record<string, number | string> = {}
    for (const [k, v] of Object.entries(vrednosti)) {
      const n = Number(v.replace(',', '.'))
      stevilke[k] = Number.isFinite(n) && v.trim() !== '' ? n : v.trim()
    }
    if (Object.keys(stevilke).length > 0) ev.vrednosti = stevilke
    return ev
  }

  // ── ODLOČITEV: veliki DA/NE oz. radio možnosti (§5) ──
  if (korak.kategorija === 'ODLOCITEV') {
    return (
      <Card className="border-roksal-amber/40">
        <CardContent className="space-y-4 p-4 sm:p-6">
          <KorakGlava korak={korak} rezultatText={korak.rezultat} />
          {korak.moznosti ? (
            <RadioGroup value={odgovor ?? ''} onValueChange={setOdgovor} className="gap-2">
              {korak.moznosti.map((m) => (
                <label
                  key={m}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary"
                >
                  <RadioGroupItem value={m} /> {m}
                </label>
              ))}
            </RadioGroup>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOdgovor('DA')}
                className={`min-h-14 rounded-xl border-2 text-base font-bold transition-colors ${
                  odgovor === 'DA' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-border hover:bg-secondary'
                }`}
              >
                DA
              </button>
              <button
                type="button"
                onClick={() => setOdgovor('NE')}
                className={`min-h-14 rounded-xl border-2 text-base font-bold transition-colors ${
                  odgovor === 'NE' ? 'border-orange-600 bg-orange-600 text-white' : 'border-border hover:bg-secondary'
                }`}
              >
                NE
              </button>
            </div>
          )}
          <Button
            className="h-12 w-full text-base font-bold"
            disabled={busy || odgovor === null}
            onClick={() => void onAkcija(korak.id, { akcija: 'ZAKLJUCI', evidence: zberiEvidence() }, 'Odločitev zabeležena')}
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-5" aria-hidden />}
            POTRDI ODLOČITEV
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ── vsemi ostalimi kategorijami: navodilo + dokazila + glavna akcija ──
  return (
    <Card className="border-roksal-amber/40">
      <CardContent className="space-y-4 p-4 sm:p-6">
        <KorakGlava korak={korak} rezultatText={korak.rezultat} />

        {/* namig po odgovoru (npr. čelna/bočna pritrditev §5) */}
        {korak.namigOdgovorov && stanje.context.odgovori['pritrditev-odlocba'] !== undefined ? (
          <p className="rounded-lg bg-secondary/60 px-3 py-2 text-sm text-foreground">
            {korak.namigOdgovorov[String(stanje.context.odgovori['pritrditev-odlocba'])] ?? ''}
          </p>
        ) : null}

        {/* tehnika zajema za merilne korake (§9 — prilagodi napravi) */}
        {korak.kategorija === 'MERITEV' && tehnika ? (
          <p className="flex items-center gap-2 rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            <Compass className="size-3.5 shrink-0" aria-hidden /> Tehnika za tvojo napravo: {tehnika.meritev}
          </p>
        ) : null}

        {/* offline zmožnost koraka (§13) */}
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {korak.offline ? (
            <><Laptop className="size-3.5" aria-hidden /> Ta korak deluje tudi brez povezave.</>
          ) : (
            <><ShieldAlert className="size-3.5 text-orange-500" aria-hidden /> Ta korak zahteva povezavo.</>
          )}
        </p>

        {/* dokazila (§10) */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Dokazila</h3>

          {korak.evidence.some((e) => e.vrsta === 'LOKACIJA') ? (
            <div className="space-y-1.5">
              <Label htmlFor="ev-naslov">Lokacija (naslov ali opis)</Label>
              <Input
                id="ev-naslov" className="h-11" value={naslov}
                onChange={(e) => setNaslov(e.target.value)}
                placeholder="npr. Terase 12, Ljubljana"
              />
            </div>
          ) : null}

          {korak.evidence.some((e) => e.vrsta === 'OPOMBA') ? (
            <div className="space-y-1.5">
              <Label htmlFor="ev-besedilo">Opomba {korak.evidence.find((e) => e.vrsta === 'OPOMBA')?.obvezno ? '(obvezna)' : '(neobvezna)'}</Label>
              <Textarea
                id="ev-besedilo" rows={3} value={besedilo}
                onChange={(e) => setBesedilo(e.target.value)}
                placeholder="Zapiši opažanja, referenco, posebnosti …"
              />
            </div>
          ) : null}

          {korak.evidence.some((e) => e.vrsta === 'FOTO') ? (
            <div className="space-y-1.5">
              <Label htmlFor="ev-foto">Fotografija — ID iz Foto zajema</Label>
              <Input
                id="ev-foto" className="h-11" value={fotoId}
                onChange={(e) => setFotoId(e.target.value)}
                placeholder="ID obstoječe fotografije (po zajemu prek Foto)"
              />
              <p className="text-xs text-muted-foreground">
                Najprej zajemi fotografijo v Foto zajemu (gumb spodaj), nato prilepi ID.
              </p>
            </div>
          ) : null}

          {korak.evidence.some((e) => e.vrsta === 'MERITEV') ? (
            <div className="space-y-1.5">
              <Label htmlFor="ev-mer">Meritev — ID iz Meritev</Label>
              <Input
                id="ev-mer" className="h-11" value={measurementId}
                onChange={(e) => setMeasurementId(e.target.value)}
                placeholder="ID obstoječe meritve (ali izpolni vrednosti)"
              />
            </div>
          ) : null}

          {korak.evidence.some((e) => e.vrsta === 'PODPIS') ? (
            <div className="space-y-1.5">
              <Label htmlFor="ev-podpis">Podpis — ID iz Signatura</Label>
              <Input
                id="ev-podpis" className="h-11" value={podpisId}
                onChange={(e) => setPodpisId(e.target.value)}
                placeholder="ID zajetega podpisa"
              />
            </div>
          ) : null}

          {korak.checklist ? (
            <div className="space-y-1.5">
              <Label>Kontrolni seznam (vse točke so obvezne)</Label>
              <ul className="space-y-1">
                {korak.checklist.map((t) => (
                  <li key={t}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 transition-colors hover:bg-secondary">
                      <Checkbox
                        checked={!!tocke[t]}
                        onCheckedChange={(v) => setTocke((s) => ({ ...s, [t]: v === true }))}
                      />
                      <span className="text-sm">{t}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* validacijska polja (npr. segmenti, višina, referenca) */}
          {(korak.validacija ?? []).length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {(korak.validacija ?? []).map((pr) => (
                <div key={pr.polje} className="space-y-1">
                  <Label htmlFor={`ev-v-${pr.polje}`}>{pr.polje}</Label>
                  <Input
                    id={`ev-v-${pr.polje}`} inputMode="decimal" className="h-11"
                    value={vrednosti[pr.polje] ?? ''}
                    onChange={(e) => setVrednosti((s) => ({ ...s, [pr.polje]: e.target.value }))}
                    placeholder="vrednost"
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* neuspešna validacija — viden razlog (§1 retry/failure) */}
        {st?.status === 'NEUSPESNO' ? (
          <p className="rounded-lg border border-orange-500/40 bg-orange-50 px-3 py-2 text-sm text-orange-700 dark:bg-orange-950/40 dark:text-orange-400">
            Zadnji poskus ni bil veljaven — preveri dokazila in ponovi.
          </p>
        ) : null}

        {/* GLAVNA AKCIJA (§3: velika primarna, malo sekundarnih) */}
        {vTehu ? (
          <Button
            className="h-14 w-full text-base font-bold"
            disabled={busy}
            onClick={() => void onAkcija(korak.id, { akcija: 'ZAKLJUCI', evidence: zberiEvidence() }, `„${korak.naziv}" zaključen`)}
          >
            {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <CheckCircle2 className="size-5" aria-hidden />}
            ZAKLJUČI: {korak.naziv.toUpperCase()}
          </Button>
        ) : (
          <Button
            variant="default" className="h-14 w-full text-base font-bold"
            disabled={busy}
            onClick={() => void onAkcija(korak.id, { akcija: 'ZACNI' }, `„${korak.naziv}" v teku`)}
          >
            {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Play className="size-5" aria-hidden />}
            ZAČNI: {korak.naziv.toUpperCase()}
          </Button>
        )}

        {/* sekundarne akcije: izjema (§6) + ponovitev zaključenih (§16) */}
        <div className="flex flex-wrap gap-2">
          {!vTehu ? null : (
            <>
              <Button
                variant="outline" size="sm" disabled={busy}
                onClick={() => { setIzjemaVrsta('NI_PRIMERNO'); setIzjemaOdprta(true) }}
              >
                <SkipForward className="size-4" aria-hidden /> Ni primerno
              </Button>
              <Button
                variant="outline" size="sm" disabled={busy}
                onClick={() => { setIzjemaVrsta('BLOKIRANO'); setIzjemaOdprta(true) }}
              >
                <Ban className="size-4" aria-hidden /> Blokirano
              </Button>
            </>
          )}
        </div>

        {/* izjema — obvezen razlog (§6) */}
        <Dialog open={izjemaOdprta} onOpenChange={setIzjemaOdprta}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{izjemaVrsta === 'NI_PRIMERNO' ? 'Označi kot ni primerno' : 'Označi kot blokirano'}</DialogTitle>
              <DialogDescription>
                Kritičnih mer ni mogoče tiho preskočiti — izjema zahteva razlog, ki se zapiše v revizijski dnevnik.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="izjema-razlog">Razlog (obvezen, vsaj 5 znakov)</Label>
              <Textarea
                id="izjema-razlog" rows={3} value={razlog}
                onChange={(e) => setRazlog(e.target.value)}
                placeholder="npr. Stopnišča ni — ravna terasa brez stopnic."
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIzjemaOdprta(false)}>Prekliči</Button>
              <Button
                disabled={busy || razlog.trim().length < 5}
                onClick={() => {
                  setIzjemaOdprta(false)
                  void onAkcija(korak.id, { akcija: izjemaVrsta, razlog: razlog.trim() }, 'Izjema zabeležena')
                }}
              >
                Potrdi izjemo
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

/** glava koraka: naziv + navodilo/kje/rezultat (§3) */
function KorakGlava ({ korak, rezultatText }: { korak: PlaybookDefinition['steps'][number]; rezultatText: string }) {
  const Ikona = KATEGORIJA_IKONA[korak.kategorija] ?? NotebookPen
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`flex size-9 items-center justify-center rounded-lg bg-secondary ${KATEGORIJA_BARVA[korak.kategorija] ?? ''}`}>
          <Ikona className="size-5" aria-hidden />
        </span>
        <h2 className="text-lg font-bold leading-tight text-foreground">{korak.naziv}</h2>
      </div>
      <p className="text-sm leading-relaxed text-foreground">{korak.navodilo}</p>
      <dl className="space-y-1 rounded-lg bg-secondary/40 p-3 text-xs">
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-muted-foreground">Kje:</dt>
          <dd className="text-foreground">{korak.kje}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-muted-foreground">Pričakovan rezultat:</dt>
          <dd className="text-foreground">{rezultatText}</dd>
        </div>
      </dl>
    </div>
  )
}

// ═══ ADMIN (§15): upravljanje definicij playbookov ════════════════════════

function AdminDefs ({ onNazaj }: { onNazaj: () => void }) {
  const { toast } = useToast()
  const [defs, setDefs] = useState<DefRow[] | null>(null)
  const [napaka, setNapaka] = useState<string | null>(null)
  const [urejanje, setUrejanje] = useState<string | null>(null)
  const [draft, setDraft] = useState<string>('')
  const [busy, setBusy] = useState(false)

  async function nalozi () {
    try {
      const r = await apiGet<{ data: DefRow[] }>('/api/playbook/defs?vse=1')
      setDefs(r.data)
    } catch (e) {
      setNapaka(e instanceof Error ? e.message : 'Napaka')
    }
  }
  useEffect(() => { void nalozi() }, [])

  async function status (id: string, nov: string) {
    setBusy(true)
    try {
      await apiPatch('/api/playbook/defs', { id, status: nov })
      toast({ title: `Status → ${nov}` })
      await nalozi()
    } catch (e) {
      toast({ title: 'Sprememba zavrnjena', description: e instanceof Error ? e.message : 'Napaka', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function shraniNovoVerzijo (key: string) {
    setBusy(true)
    try {
      const def = JSON.parse(draft) as PlaybookDefinition
      await apiPost<{ data: { version: number } }>('/api/playbook/defs', { key, def })
      toast({ title: `Nova verzija playbooka ${key} shranjena`, description: 'Prejšnje verzije ostanejo vezane na zaključene zagone.' })
      setUrejanje(null)
      await nalozi()
    } catch (e) {
      toast({ title: 'Shranjevanje zavrnjeno', description: e instanceof Error ? e.message : 'Neveljaven JSON', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const poKljucih = useMemo(() => {
    const m = new Map<string, DefRow[]>()
    for (const d of defs ?? []) {
      const list = m.get(d.key) ?? []
      list.push(d)
      m.set(d.key, list)
    }
    return [...m.entries()]
  }, [defs])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Upravljanje playbookov"
        desc="Verzije, statusi in urejanje korakov brez poseganja v poslovno logiko (§15)"
        actions={
          <Button variant="outline" size="sm" onClick={onNazaj}>
            <ArrowLeft className="size-4" aria-hidden /> Nazaj
          </Button>
        }
      />

      {napaka ? <ErrorBox error={{ message: napaka }} /> : null}
      {defs === null ? <LoadingRows rows={3} /> : poKljucih.map(([key, verzije]) => (
        <Card key={key}>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="font-bold text-foreground">{key}</h2>
                <p className="text-xs text-muted-foreground">{verzije[0]?.name} · {verzije.length} verzij</p>
              </div>
              <Button
                variant="outline" size="sm"
                onClick={() => {
                  setUrejanje(urejanje === key ? null : key)
                  setDraft(JSON.stringify({
                    key, naziv: verzije[0]?.name ?? key, opis: 'Urejena definicija', scenarij: '',
                    version: verzije[0]?.version ?? 1,
                    steps: [{ id: 'prihod', naziv: 'Prihod', navodilo: '…', kje: '…', rezultat: '…', kategorija: 'PRIHOD', offline: true, evidence: [{ vrsta: 'LOKACIJA', obvezno: true, opis: 'lokacija' }] }],
                  }, null, 2))
                }}
              >
                <Pencil className="size-4" aria-hidden /> Nova verzija
              </Button>
            </div>

            <ul className="divide-y rounded-lg border">
              {verzije.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <BookOpen className="size-4 text-muted-foreground" aria-hidden />
                  <span className="font-mono text-xs">v{v.version}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    v.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : v.status === 'RETIRED' ? 'bg-secondary text-muted-foreground'
                        : 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300'
                  }`}>
                    {v.status}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {v.korakov} korakov · {v.zagonov} zagonov · {(v.author ?? 'sistem')}
                  </span>
                  <span className="ml-auto flex gap-1">
                    {v.status !== 'ACTIVE' ? (
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => void status(v.id, 'ACTIVE')}>
                        <Play className="size-3.5" aria-hidden /> Aktiviraj
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => void status(v.id, 'RETIRED')}>
                        <Ban className="size-3.5" aria-hidden /> Upokoji
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            {urejanje === key ? (
              <div className="space-y-2 rounded-lg border bg-secondary/20 p-3">
                <Label htmlFor={`draft-${key}`}>Definicija (JSON — koraki, dokazila, validacije, pogoji)</Label>
                <Textarea
                  id={`draft-${key}`} rows={12} className="font-mono text-xs"
                  value={draft} onChange={(e) => setDraft(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void shraniNovoVerzijo(key)}>
                    {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                    Shrani kot novo verzijo
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setUrejanje(null)}>Prekliči</Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Nova verzija postane ACTIVE za nove zagone; zaključeni zagoni ostanejo vezani na svojo verzijo (§14).
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
