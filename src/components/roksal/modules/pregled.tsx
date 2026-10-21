'use client'

// PREGLED — ENOTNI PREGLEDOVALNIK (R479 — issue #9 §7)
// Model + fotografije + meritve + PRIPETI KOMENTARJI (pini) na enem mestu,
// brez skakanja po modulih. Pogledi: tloris / profil / 3D (izpeljava
// model-core prek /api/fence-run/[id]/review — skupna z modulom Model) in
// mreža fotografij zajema (POŠTENO: posnetki niso prostorsko registrirani).
// Pini so SAMO pripombe — NE spreminjajo meritev (za to je obstoječi
// verify/confirm tok z revizijo). Javna delitev: žetonska povezava z omejenim
// rokom + GDPR soglasje za fotografije (§10 osnova).
// R546: razbitje velikana — risbe v pregled-views.tsx, kartice/dialogi v
// pregled-cards.tsx, javna delitev v pregled-share.tsx, tipi/konstante v
// pregled-shared.ts. Tu ostanejo: izbire, stanje, tok in panel segmenta.

import { useMemo, useState } from 'react'
import { Box, Camera, Compass, Fence, FileWarning, Layers, Loader2, Map as MapIcon, MapPin, MessageSquare, Mountain, RotateCcw, Ruler, ScanLine } from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { fmtDate, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatCard } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { SEGMENT_STATUSES } from '@/lib/fence-run-engine'
import type { ModelNode, ModelSegment, PlanModel } from '@/lib/model-core'
import { ISOLATION_CATS, STROKE, fmtCm, fmtM, type ProjectOption, type ReviewPayload, type ReviewPhoto, type RunOption } from './pregled-shared'
import { PerspectiveViewP, PlanViewP, ProfileViewP } from './pregled-views'
import { PhotosCard, PinDialog, PinsCard, ReplayCard, ReplayDialog } from './pregled-cards'
import { ShareCard } from './pregled-share'

// ─── Modul ──────────────────────────────────────────────────────────────────

export default function PregledModule () {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const [projectId, setProjectId] = useState<string>('')
  const [runId, setRunId] = useState<string>('')
  const [view, setView] = useState<'plan' | 'profile' | '3d' | 'photos'>('plan')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [turns, setTurns] = useState<string>('')
  const [yaw, setYaw] = useState(-30)
  const [pitch, setPitch] = useState(25)
  const [iso, setIso] = useState<string[]>([]) // izolacija komponent (kategorije)
  const [pinTarget, setPinTarget] = useState<{ targetType: string; targetKey: string; x?: number; y?: number } | null>(null)
  const [lightbox, setLightbox] = useState<ReviewPhoto | null>(null)
  const [replayId, setReplayId] = useState<string | null>(null)

  const canPin = hasPerm(user?.perms, 'measurements.write')

  const projects = useApi<{ data: ProjectOption[] }>(user ? '/api/projects?limit=500' : null)
  const runs = useApi<{ data: RunOption[] }>(projectId ? `/api/fence-run?projectId=${projectId}` : null)
  const review = useApi<{ data: ReviewPayload }>(
    runId ? `/api/fence-run/${runId}/review${turns ? `?turns=${encodeURIComponent(turns)}` : ''}` : null
  )

  function onProject (v: string): void {
    setProjectId(v); setRunId(''); setSelectedKey(null); setTurns(''); setIso([])
  }
  function onRun (v: string): void {
    setRunId(v); setSelectedKey(null); setTurns(''); setIso([])
  }

  const d = review.data?.data
  const m = d?.model
  const pins = d?.pins ?? []
  const photos = d?.photos ?? []

  const selected = m?.segments.find((s) => s.key === selectedKey) ?? null
  const corners = useMemo(
    () => m?.nodes.filter((n) => n.kind === 'VOGAL' && n.interiorDeg != null) ?? [],
    [m]
  )

  function setTurn (idx: number, v: 'L' | 'D'): void {
    const arr = (turns || 'L'.repeat(corners.length)).split('')
    arr[idx] = v
    setTurns(arr.join(''))
  }
  function mirrorTurns (): void {
    if (!corners.length) return
    const cur = turns || 'L'.repeat(corners.length)
    setTurns(cur.split('').map((c) => (c === 'D' ? 'L' : 'D')).join(''))
  }

  /** klik na segment v tlorisu → dialog za nov pin (x/y iz klika) */
  function openPinForSegment (key: string, world?: { x: number; y: number }): void {
    setSelectedKey(key)
    setPinTarget({
      targetType: 'SEGMENT', targetKey: key,
      ...(world ? { x: Math.round(world.x * 10) / 10, y: Math.round(world.y * 10) / 10 } : {}),
    })
  }

  // izolacija: kategorija → ali je segment/vozlišče v izbiri
  const isoActive = iso.length > 0
  const segInIso = (seg: ModelSegment): boolean => {
    if (!isoActive) return true
    const nodeA = m?.nodes.find((n) => n.key === seg.fromKey)
    const nodeB = m?.nodes.find((n) => n.key === seg.toKey)
    if (iso.includes('odseki')) return true
    if (iso.includes('vrata') && (nodeA?.kind === 'VRATA' || nodeB?.kind === 'VRATA')) return true
    if (iso.includes('opozorila') && pins.some((p) => p.status === 'ODPRTO' && p.targetKey === seg.key)) return true
    if (iso.includes('nepreverjene') && !['VERIFIED', 'CONFIRMED', 'CALIBRATED'].includes(seg.status)) return true
    return false
  }
  const nodeInIso = (n: ModelNode): boolean => {
    if (!isoActive) return true
    if (n.kind === 'VRATA') return iso.includes('vrata')
    if (n.kind === 'VOGAL') return iso.includes('vogali')
    if (iso.includes('stebri')) return true // ZACETEK/STEBER/KONEC/STOPNISCE
    return false
  }

  const projOpts = projects.data?.data ?? []
  const runOpts = runs.data?.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Enotni pregled"
        desc="Model, fotografije, meritve in pripombe na enem mestu (issue #9 §7, R479)"
        actions={m ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1 font-normal">
              <ScanLine className="size-3" aria-hidden /> {m.engineVersion}
            </Badge>
            <Badge variant="outline" className="gap-1 font-normal">
              <MessageSquare className="size-3" aria-hidden /> {pins.filter((p) => p.status === 'ODPRTO').length} odprtih pripomb
            </Badge>
          </div>
        ) : null}
      />

      {/* izbire */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pregled-proj">Projekt</Label>
          <Select value={projectId} onValueChange={onProject}>
            <SelectTrigger id="pregled-proj" aria-label="Projekt">
              <SelectValue placeholder="Izberite projekt" />
            </SelectTrigger>
            <SelectContent>
              <ScrollArea className="max-h-64">
                {projOpts.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>
                ))}
              </ScrollArea>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pregled-run">Ograjni tekač</Label>
          <Select value={runId} onValueChange={onRun} disabled={!projectId}>
            <SelectTrigger id="pregled-run" aria-label="Ograjni tekač">
              <SelectValue placeholder={projectId ? 'Izberite tekač' : 'Najprej projekt'} />
            </SelectTrigger>
            <SelectContent>
              <ScrollArea className="max-h-64">
                {runOpts.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name} · {fmtM(r.totalLengthCm)}
                  </SelectItem>
                ))}
              </ScrollArea>
            </SelectContent>
          </Select>
        </div>
      </div>

      <ErrorBox error={projects.error} />
      <ErrorBox error={runs.error} />
      {projects.loading && <LoadingRows />}

      {!projects.loading && !projectId && projOpts.length > 0 && (
        <EmptyState icon={MapIcon} title="Izberite projekt" desc="Enotni pregled združi model, fotografije zajema, meritve in pripombe tekača projekta." />
      )}
      {projectId && runs.loading && <LoadingRows />}
      {projectId && !runs.loading && runOpts.length === 0 && (
        <EmptyState icon={Fence} title="Projekt nima ograjnega tekača" desc="Ustvarite ga v modulu Ogradnja — pregled se izpelje samodejno." />
      )}

      <ErrorBox error={review.error} />
      {review.loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> Nalagam enotni pregled…</div>
      )}

      {d && m && (
        <>
          {/* glavne številke */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Tekač"
              value={d.run.name}
              hint={`${d.project ? `${d.project.code} · ` : ''}status ${d.run.status} · posodobljeno ${fmtDate(d.run.updatedAt)}`}
              icon={Fence}
            />
            <StatCard
              label="Segmenti"
              value={`${m.segments.length}`}
              hint={`skupna dolžina ${fmtM(m.totalLengthCm)}${m.closureGapCm != null ? ` · odprtina ${fmtCm(m.closureGapCm)}` : ''}`}
              icon={Ruler}
            />
            <StatCard
              label="Pripombe (pini)"
              value={`${pins.length}`}
              hint={`${pins.filter((p) => p.status === 'ODPRTO').length} odprtih · ${pins.filter((p) => p.status === 'RESENO').length} rešenih · ${pins.filter((p) => p.status === 'ZAPRT').length} zaprtih`}
              icon={MessageSquare}
              tone={pins.some((p) => p.status === 'ODPRTO') ? 'amber' : 'green'}
            />
            <StatCard
              label="Fotografije zajema"
              value={`${photos.length}`}
              hint={`${d.replay.length} zajem${d.replay.length === 1 ? '' : 'i'} · slike niso prostorsko registrirane`}
              icon={Camera}
            />
          </div>

          {/* preverjanja (isto presojo kot izvozi R477) */}
          {d.checks.length > 0 && (
            <Card>
              <CardContent className="space-y-1.5 text-sm">
                <div className="flex items-center gap-1.5 font-medium"><FileWarning className="size-4 text-muted-foreground" aria-hidden /> Preverjanja</div>
                {d.checks.map((c) => (
                  <div key={c.code} className="flex items-start gap-2">
                    <Badge variant="outline" className={c.severity === 'OPOZORILO' ? 'border-amber-400 text-amber-700 dark:text-amber-300' : ''}>{c.severity}</Badge>
                    <span className="text-muted-foreground">{c.message}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* smeri zavojev */}
          {corners.length > 0 && (
            <Card>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-medium"><Compass className="size-4 text-muted-foreground" aria-hidden /> Smeri zavojev ({corners.length})</div>
                  <Button size="sm" variant="outline" onClick={mirrorTurns}>
                    <RotateCcw className="size-4" aria-hidden /> Zrcali
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {corners.map((c, i) => (
                    <div key={c.key} className="flex items-center gap-1 rounded-lg border px-2 py-1">
                      <span className="text-xs text-muted-foreground">{c.key} · {fmtM(c.atCm)} · {c.interiorDeg}°</span>
                      <div className="flex">
                        <Button
                          size="sm" variant={(turns[i] ?? 'L') === 'L' ? 'default' : 'outline'} className="h-7 px-2 text-xs"
                          onClick={() => setTurn(i, 'L')} aria-label={`Zavoj ${i + 1} levo`}
                        >LEVO</Button>
                        <Button
                          size="sm" variant={turns[i] === 'D' ? 'default' : 'outline'} className="h-7 px-2 text-xs"
                          onClick={() => setTurn(i, 'D')} aria-label={`Zavoj ${i + 1} desno`}
                        >DESNO</Button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Tekač ne beleži smeri zavojev — izbira je predpostavka; mere segmentov so od nje neodvisne.</p>
              </CardContent>
            </Card>
          )}

          {/* preklop pogledov */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={view === 'plan' ? 'default' : 'outline'} onClick={() => setView('plan')}><MapIcon className="size-4" aria-hidden /> Tloris</Button>
            <Button size="sm" variant={view === 'profile' ? 'default' : 'outline'} onClick={() => setView('profile')}><Mountain className="size-4" aria-hidden /> Profil</Button>
            <Button size="sm" variant={view === '3d' ? 'default' : 'outline'} onClick={() => setView('3d')}><Box className="size-4" aria-hidden /> 3D</Button>
            <Button size="sm" variant={view === 'photos' ? 'default' : 'outline'} onClick={() => setView('photos')}><Camera className="size-4" aria-hidden /> Fotografije</Button>
            <span className="ml-auto text-xs text-muted-foreground">
              {view === 'photos' ? 'Mreža fotografij zajema — po conah' : 'Kliknite segment za podrobnosti ali novo pripombo'}
            </span>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <div className="min-w-0 space-y-4">
              {view !== 'photos' && (
                <Card>
                  <CardContent className="p-2 sm:p-4">
                    {view === 'plan' && (
                      <PlanViewP
                        m={m} selectedKey={selectedKey}
                        onSegmentClick={canPin ? openPinForSegment : setSelectedKey}
                        pins={pins}
                        segDim={(k) => {
                          const seg = m.segments.find((s) => s.key === k)
                          return seg ? !segInIso(seg) : false
                        }}
                        nodeDim={(k) => {
                          const n = m.nodes.find((x) => x.key === k)
                          return n ? !nodeInIso(n) : false
                        }}
                      />
                    )}
                    {view === 'profile' && <ProfileViewP m={m} selectedKey={selectedKey} onSelect={setSelectedKey} segDim={(k) => { const s = m.segments.find((x) => x.key === k); return s ? !segInIso(s) : false }} />}
                    {view === '3d' && (
                      <PerspectiveViewP
                        m={m} selectedKey={selectedKey} onSelect={setSelectedKey}
                        yaw={yaw} pitch={pitch} setYaw={setYaw} setPitch={setPitch}
                        segDim={(k) => { const s = m.segments.find((x) => x.key === k); return s ? !segInIso(s) : false }}
                      />
                    )}
                  </CardContent>
                </Card>
              )}

              {view === 'photos' && (
                <PhotosCard photos={photos} onOpen={setLightbox} onPin={canPin ? (photo) => setPinTarget({ targetType: 'FOTOGRAFIJA', targetKey: photo.id }) : undefined} />
              )}

              {/* izolacija komponent */}
              {view !== 'photos' && (
                <Card>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center gap-1.5 font-medium"><Layers className="size-4 text-muted-foreground" aria-hidden /> Izolacija komponent</div>
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                      {ISOLATION_CATS.map((c) => (
                        <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs">
                          <Checkbox
                            checked={iso.includes(c.key)}
                            onCheckedChange={(v) => {
                              setIso((cur) => v === true ? [...cur, c.key] : cur.filter((x) => x !== c.key))
                            }}
                            aria-label={c.label}
                          />
                          {c.label}
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {isoActive ? 'Izbrani ostanejo poudarjeni, ostalo je zamaknjeno (izolacija ne spreminja podatkov).' : 'Izberite kategorije za izolacijo — brez izbire je vse vidno.'}
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-3">
              {view !== 'photos' && (selected
                ? <SegmentPanelP seg={selected} m={m} onPin={canPin ? () => openPinForSegment(selected.key) : undefined} />
                : (
                  <Card><CardContent className="text-sm text-muted-foreground">
                    <div className="mb-1 font-medium text-foreground">Segment</div>
                    Izberite segment na risbi (ali spodaj na seznamu) za mere in vir.
                  </CardContent></Card>
                )
              )}

              {view !== 'photos' && (
                <Card>
                  <CardContent className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-sm font-medium"><Layers className="size-4 text-muted-foreground" aria-hidden /> Segmenti</div>
                    <div className="flex flex-wrap gap-1.5">
                      {m.segments.map((s) => (
                        <button
                          key={s.key} type="button"
                          onClick={() => setSelectedKey(s.key)}
                          className={`rounded-md border px-2 py-1 text-xs ${s.key === selectedKey ? 'border-red-400 bg-red-50 dark:bg-red-950' : 'hover:bg-muted'}`}
                          aria-pressed={s.key === selectedKey}
                        >
                          <span className="inline-block size-2 rounded-full align-middle" style={{ background: STROKE[s.status] ?? STROKE.ESTIMATED }} aria-hidden /> {s.key}
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <PinsCard
                pins={pins} user={user} canPin={canPin}
                onNew={() => setPinTarget({ targetType: 'SEGMENT', targetKey: m.segments[0]?.key ?? 'seg-1' })}
                onReload={() => { void review.reload() }}
              />

              <ReplayCard replay={d.replay} onOpen={setReplayId} />

              <ShareCard
                runId={runId}
                projectId={d.run.projectId}
                projectCode={d.project?.code ?? ''}
                consent={d.consent}
                onConsentChange={() => { void review.reload() }}
              />
            </div>
          </div>
        </>
      )}

      {/* dialog: nov pin */}
      <Dialog open={!!pinTarget} onOpenChange={(o) => { if (!o) setPinTarget(null) }}>
        {pinTarget && (
          <PinDialog
            target={pinTarget}
            runId={runId}
            onClose={() => setPinTarget(null)}
            onCreated={() => { setPinTarget(null); void review.reload() }}
          />
        )}
      </Dialog>

      {/* dialog: fotografija (povečava) */}
      <Dialog open={!!lightbox} onOpenChange={(o) => { if (!o) setLightbox(null) }}>
        {lightbox && (
          <DialogContent aria-describedby={undefined} className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Fotografija — {lightbox.zoneLabel}</DialogTitle>
              <DialogDescription>
                {lightbox.sessionName}
                {lightbox.atCm != null ? ` · cona pri ~${fmtM(lightbox.atCm)} ob teku` : ''}
                {` · ${fmtDateTime(lightbox.capturedAt)}`}
              </DialogDescription>
            </DialogHeader>
            {lightbox.thumb ? (
              <img
                src={lightbox.thumb}
                alt={`Posnetek zajema — cona ${lightbox.zoneLabel}`}
                className="w-full rounded-xl border object-contain"
              />
            ) : (
              <div className="flex h-48 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">brez sličice</div>
            )}
            <p className="text-xs text-muted-foreground">
              Posnetek zajema ima samo cono pokritosti — NI prostorsko registriran (ni XY vezave na model).
              {lightbox.offsetCm != null ? ` Odmik registra: ${fmtCm(lightbox.offsetCm)}.` : ''}
            </p>
            {canPin && (
              <DialogFooter>
                <Button
                  size="sm"
                  onClick={() => {
                    const photo = lightbox
                    setLightbox(null)
                    setPinTarget({ targetType: 'FOTOGRAFIJA', targetKey: photo.id })
                  }}
                >
                  <MapPin className="size-4" aria-hidden /> Pripni pripombo na fotografijo
                </Button>
              </DialogFooter>
            )}
          </DialogContent>
        )}
      </Dialog>

      {/* dialog: replay zajema (obstoječi motor R465 — NE podvojen) */}
      <Dialog open={!!replayId} onOpenChange={(o) => { if (!o) setReplayId(null) }}>
        {replayId && <ReplayDialog sessionId={replayId} onClose={() => setReplayId(null)} />}
      </Dialog>
    </div>
  )
}

// ─── Podatki izbranega segmenta ─────────────────────────────────────────────

function SegmentPanelP ({ seg, m, onPin }: { seg: ModelSegment; m: PlanModel; onPin: (() => void) | undefined }) {
  const st = SEGMENT_STATUSES[seg.status] ?? SEGMENT_STATUSES.ESTIMATED
  const nodeA = m.nodes.find((n) => n.key === seg.fromKey)
  const nodeB = m.nodes.find((n) => n.key === seg.toKey)
  return (
    <Card>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="font-medium">Segment {seg.key}</div>
          <Badge className={st.cls}>{st.label}</Badge>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          <RowP k="Dolžina (po padini)" v={fmtCm(seg.lengthCm)} />
          <RowP k="Tlorisna dolžina" v={fmtCm(seg.planCm)} />
          <RowP k="Višina polnila" v={seg.heightCm != null ? fmtCm(seg.heightCm) : 'ni izmerjena'} />
          <RowP k="Padina" v={`${seg.slopeDeg.toFixed(1)}°`} />
          <RowP k="Vmesni stebri" v={`${seg.posts}`} />
          <RowP k="σ položaja" v={seg.sigmaCm != null ? `± ${fmtCm(seg.sigmaCm)}` : 'ni podatka'} />
        </dl>
        <div className="space-y-1 border-t pt-2">
          <div className="text-xs text-muted-foreground">
            {seg.verifiedCm != null
              ? `Preverjeno z zunanjim merilnikom: ${fmtCm(seg.verifiedCm)}${seg.verifyMethod ? ` (${seg.verifyMethod})` : ''}`
              : 'Brez zunanje verifikacije — vir: tekač (vnos/kalibracija).'}
          </div>
          <div className="text-xs text-muted-foreground">
            Vozlišči: {nodeA?.key ?? '—'} ({nodeA?.kind ?? '—'}) → {nodeB?.key ?? '—'} ({nodeB?.kind ?? '—'})
          </div>
        </div>
        {onPin && (
          <Button size="sm" variant="outline" className="w-full" onClick={onPin}>
            <MapPin className="size-4" aria-hidden /> Dodaj pripombo na {seg.key}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function RowP ({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium tabular-nums">{v}</dd>
    </div>
  )
}
