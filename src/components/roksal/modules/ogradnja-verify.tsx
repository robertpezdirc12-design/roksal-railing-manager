'use client'

// OGRADNJA — faza PREVERI (§9/§10: statusi + laser) — R547 izvleček iz
// ogradnja.tsx (razbitje po vzorcu R546; BREZ spremembe obnašanja).

import { useState } from 'react'
import { BadgeCheck, Loader2, RefreshCw, Ruler } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { apiPost } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { SEGMENT_STATUSES } from '@/lib/fence-run-engine'
import { QualityDot, ValidationList, fmtM, gateLabel, num, type RunDetail, type SegmentRow } from './ogradnja-shared'

// ─── Faza PREVERI (§9/§10: statusi + laser) ─────────────────────────────────

export function VerifyPhase ({ runId, detail, onRefresh }: {
  runId: string | null
  detail: RunDetail | null
  onRefresh: () => Promise<void>
}) {
  const { toast } = useToast()
  const [verifyFor, setVerifyFor] = useState<SegmentRow | null>(null)
  const [busy, setBusy] = useState(false)

  if (!detail) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> Nalagam segmente …</div>
  }

  async function refresh (): Promise<void> {
    setBusy(true)
    try { await onRefresh() } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-muted/60 p-3 text-sm">
        <strong>PREVERITE KRITIČNE DIMENZIJE (§9):</strong> vsak segment ima status. Preveritev z
        laserjem (<em>Leica DISTO</em> ali podobno) dvigne status na <strong>VERIFIED</strong> in ostane
        vidna v zgodovini (§10).
      </p>
      <div className="flex justify-end">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>
          <RefreshCw className="size-4" aria-hidden /> Osveži
        </Button>
      </div>
      <div className="max-h-72 overflow-y-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background">
            <tr className="text-left text-muted-foreground">
              <th className="px-2 py-1.5">#</th>
              <th className="px-2 py-1.5">od → do</th>
              <th className="px-2 py-1.5">dolžina</th>
              <th className="px-2 py-1.5">padina</th>
              <th className="px-2 py-1.5">status</th>
              <th className="px-2 py-1.5">preverjeno</th>
              <th className="px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {detail.segments.map((s) => {
              const st = SEGMENT_STATUSES[s.status] ?? SEGMENT_STATUSES.ESTIMATED
              return (
                <tr key={s.id} className="border-t">
                  <td className="px-2 py-1.5">{s.order + 1}</td>
                  <td className="px-2 py-1.5">{fmtM(s.fromAtCm)} → {fmtM(s.toAtCm)}</td>
                  <td className="px-2 py-1.5 font-medium">{fmtM(s.lengthCm)}</td>
                  <td className="px-2 py-1.5">{s.slopeDeg.toFixed(1)}°</td>
                  <td className="px-2 py-1.5">
                    <Badge variant="secondary" className={cn('border-transparent', st.cls)}>{st.label}</Badge>
                  </td>
                  <td className="px-2 py-1.5">{s.verifiedCm != null ? `${fmtM(s.verifiedCm)} (${s.verifyMethod?.toLowerCase()})` : '—'}</td>
                  <td className="px-2 py-1.5 text-right">
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setVerifyFor(s)}>
                      <Ruler className="size-3.5" aria-hidden /> Preveri
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ValidationList validation={detail.analysis.validation} />
      <div className="flex items-center gap-2 text-sm">
        <QualityDot state={detail.analysis.quality.state} />
        <span className="font-medium">{gateLabel(detail.analysis.quality.state)}</span>
        <span className="text-xs text-muted-foreground">({detail.analysis.quality.score}/100)</span>
      </div>

      {verifyFor && (
        <VerifyDialog
          runId={runId ?? ''}
          segment={verifyFor}
          onClose={() => setVerifyFor(null)}
          onDone={() => { setVerifyFor(null); void refresh() }}
        />
      )}
    </div>
  )
}

function VerifyDialog ({ runId, segment, onClose, onDone }: {
  runId: string
  segment: SegmentRow
  onClose: () => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const [measured, setMeasured] = useState(String(Math.round(segment.lengthCm)))
  const [method, setMethod] = useState('LASER')
  const [device, setDevice] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit (): Promise<void> {
    const m = num(measured)
    if (m == null || m < 5) {
      toast({ title: 'Vnesite izmerjeno dolžino (cm)', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await apiPost<{ data: { deviationCm: number; toleranceCm: number; conflict: boolean } }>(
        `/api/fence-run/${runId}/verify`,
        { segmentId: segment.id, measuredCm: m, method, ...(device ? { device } : {}), ...(note ? { note } : {}) }
      )
      toast({
        title: res.data.conflict ? 'Preverjeno — ODSSTOPANJE!' : 'Segment preverjen',
        description: res.data.conflict
          ? `Izračun odstopa ${res.data.deviationCm} cm (toleranca ${res.data.toleranceCm} cm) — uskladite geometrijo.`
          : `Odstopanje ${res.data.deviationCm} cm (toleranca ${res.data.toleranceCm} cm).`,
        variant: res.data.conflict ? 'destructive' : 'default',
      })
      onDone()
    } catch (e) {
      toast({ title: 'Preverjanje ni uspelo', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ruler className="size-5" aria-hidden /> Preveri segment {segment.order + 1}
          </DialogTitle>
          <DialogDescription>
            Izračunano: {fmtM(segment.lengthCm)} — izmerite z zunanjim merilnikom in vnesite dejansko vrednost.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ver-measured">Izmerjeno (cm) *</Label>
            <Input id="ver-measured" inputMode="decimal" value={measured} onChange={(e) => setMeasured(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ver-method">Metoda</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="ver-method" aria-label="Metoda"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="LASER">Laser (npr. DISTO)</SelectItem>
                <SelectItem value="MICNIK">Merilni miknik</SelectItem>
                <SelectItem value="DRUGO">Drugo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ver-device">Naprava</Label>
            <Input id="ver-device" value={device} onChange={(e) => setDevice(e.target.value)} placeholder="npr. Leica DISTO D2" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ver-note">Opomba</Label>
            <Input id="ver-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="npr. merjeno po tiru" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Prekliči</Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <BadgeCheck className="size-4" aria-hidden />}
            Zapiši preveritev
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
