'use client'

// nastavitve.tsx — kartica „Nastavitve“ (levi stolpec): vir geometrije
// (ročno/tekač), velikost/prosojnost, projekt, zaklep, opomba, AI analiza,
// zajem in zadnji zajem (R537-b: dobesedna selitev iz ar.tsx; vhodi prek
// propsov — stanje ostaja v vstopni komponenti, ker ga bere predogled/zajem).

import type { Dispatch, SetStateAction } from 'react'

import { Download, ImageIcon, Loader2, Lock, LockOpen, Save, ScanLine, Sparkles } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ErrorBox } from '@/components/roksal/ui-bits'
import { useApi } from '@/lib/api-client'

import { downloadPng } from './zajem'
import type { Mode, ProjectRow, RunOption, RunSegmentRow } from './tipi'

export function Nastavitve ({
  vir, setVir, runId, setRunId, postsS, setPostsS, heightS, setHeightS,
  runs, runLoading, runSegs, projectId, setProjectId, projects,
  scale, setScale, opacity, setOpacity, locked, setLocked, canWrite,
  note, setNote, mode, analyzing, analyze, busy, capture, lastShot,
}: {
  vir: 'rocno' | 'tekac'
  setVir: Dispatch<SetStateAction<'rocno' | 'tekac'>>
  runId: string
  setRunId: Dispatch<SetStateAction<string>>
  postsS: string
  setPostsS: Dispatch<SetStateAction<string>>
  heightS: string
  setHeightS: Dispatch<SetStateAction<string>>
  runs: ReturnType<typeof useApi<{ data: RunOption[] }>>
  runLoading: boolean
  runSegs: RunSegmentRow[] | null
  projectId: string
  setProjectId: Dispatch<SetStateAction<string>>
  projects: ReturnType<typeof useApi<{ data: ProjectRow[] }>>
  scale: number
  setScale: Dispatch<SetStateAction<number>>
  opacity: number
  setOpacity: Dispatch<SetStateAction<number>>
  locked: boolean
  setLocked: Dispatch<SetStateAction<boolean>>
  canWrite: boolean
  note: string
  setNote: Dispatch<SetStateAction<string>>
  mode: Mode
  analyzing: boolean
  analyze: () => Promise<void>
  busy: boolean
  capture: () => Promise<void>
  lastShot: string | null
}): React.ReactElement {
  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
          <ScanLine className="size-4 text-roksal-amber" aria-hidden /> Nastavitve
        </h2>

        {/* R465: vir geometrije overlayja */}
        <div className="space-y-2">
          <Label htmlFor="ar-vir">Vir geometrije</Label>
          <Select value={vir} onValueChange={(v) => { setVir(v as 'rocno' | 'tekac'); setRunId('none') }}>
            <SelectTrigger id="ar-vir" aria-label="Vir geometrije ograje">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rocno">Ročno (stebri + višina)</SelectItem>
              <SelectItem value="tekac">Iz tekača projekta (segmenti)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {vir === 'rocno' ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ar-posts">Št. stebrov</Label>
              <Input id="ar-posts" type="number" min="2" max="20" inputMode="numeric"
                value={postsS} onChange={(e) => setPostsS(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ar-height">Višina (cm)</Label>
              <Input id="ar-height" type="number" min="40" max="250" inputMode="numeric"
                value={heightS} onChange={(e) => setHeightS(e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="ar-run">Tekač projekta</Label>
            <Select value={runId} onValueChange={setRunId} disabled={projectId === 'none'}>
              <SelectTrigger id="ar-run" aria-label="Izberi ograjnega tekača">
                <SelectValue placeholder={projectId === 'none' ? 'Najprej izberite projekt' : runs.loading ? 'Nalagam …' : 'Izberite tekača'} />
              </SelectTrigger>
              <SelectContent className="max-h-48">
                <SelectItem value="none">Brez tekača</SelectItem>
                {(runs.data?.data ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name} — {r.segmentCount} seg. · {(r.totalLengthCm / 100).toFixed(1).replace('.', ',')} m
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {projectId === 'none' ? (
              <p className="text-xs text-muted-foreground">Izberite projekt zgoraj — tekači so vezani na projekt.</p>
            ) : runLoading ? (
              <p className="text-xs text-muted-foreground">Nalagam segmente tekača …</p>
            ) : runSegs ? (
              <p className="text-xs text-muted-foreground">
                Vir: {runSegs.length} segmentov · {(runSegs.reduce((a, s) => a + s.lengthCm, 0) / 100).toFixed(1).replace('.', ',')} m ·
                {' '}{runSegs.filter((s) => s.toKind === 'VRATA').length} vrat · stebrov {runSegs.reduce((a, s) => a + s.posts, 0) + runSegs.length + 1}
              </p>
            ) : (
              <ErrorBox error={runs.error} />
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="ar-scale">Velikost ({scale.toFixed(2).replace('.', ',')}×)</Label>
          <Slider id="ar-scale" min={0.4} max={2} step={0.05} value={[scale]} onValueChange={(v) => setScale(v[0] ?? 1)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ar-opacity">Prosojnost ({Math.round(opacity * 100)} %)</Label>
          <Slider id="ar-opacity" min={0.3} max={1} step={0.05} value={[opacity]} onValueChange={(v) => setOpacity(v[0] ?? 1)} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ar-project">Projekt (za zajem)</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger id="ar-project" aria-label="Poveži s projektom">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-48">
              <SelectItem value="none">Brez projekta</SelectItem>
              {(projects.data?.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ErrorBox error={projects.error} />
        </div>

        <div className="space-y-2 border-t pt-4">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="ar-lock">Zaklep položaja (stabilizacija)</Label>
            <Button
              id="ar-lock"
              size="sm"
              variant={locked ? 'default' : 'outline'}
              aria-pressed={locked}
              onClick={() => setLocked((l) => !l)}
            >
              {locked ? <Lock className="size-3.5" aria-hidden /> : <LockOpen className="size-3.5" aria-hidden />}
              {locked ? 'Zaklenjeno' : 'Odklenjeno'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {locked
              ? 'Položaj ograje je zaklenjen — povlek je izklopljen (varno zajemanje).'
              : 'Povlek je glajen (nizkofrekvenčno) — pred zajemom položaj zaklenite.'}
          </p>
        </div>

        {canWrite ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="ar-note">Opomba</Label>
              <Input id="ar-note" value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="npr. predogled pred sprednjo teraso" />
            </div>

            {/* R454: AI analiza prizora */}
            <div className="space-y-2 border-t pt-4">
              <Button variant="outline" className="h-11 w-full" onClick={() => void analyze()} disabled={analyzing || mode === 'off'}>
                {analyzing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4 text-roksal-amber" aria-hidden />}
                Analiziraj prizor (AI)
              </Button>
              <p className="text-xs text-muted-foreground">
                Umetna inteligenca opisuje prizor in predlaga mesta za ograjo — rezultat je pomoč pri odločitvi, ne meritev.
              </p>
            </div>

            <Button className="h-11 w-full" onClick={() => void capture()} disabled={busy || mode === 'off'}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
              Zajemi posnetek
            </Button>
          </>
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            Za zajem AR posnetka je potrebna pravica measurements.write.
          </p>
        )}

        {lastShot ? (
          <figure className="space-y-1.5 border-t pt-3">
            <figcaption className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ImageIcon className="size-3.5 text-roksal-amber" aria-hidden /> Zadnji zajem
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 px-2 text-xs"
                onClick={() => downloadPng(lastShot, `ar-zajem-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`)}
              >
                <Download className="size-3.5" aria-hidden /> PNG
              </Button>
            </figcaption>
            <img src={lastShot} alt="Zadnji AR zajem z ograjo" className="w-full rounded-lg border" />
          </figure>
        ) : null}
      </CardContent>
    </Card>
  )
}
