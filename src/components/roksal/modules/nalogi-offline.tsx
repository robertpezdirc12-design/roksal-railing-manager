'use client'

// NALOGI — R439 (issue #6): OFFLINE DEJANJA — vrsta operacij (deluje tudi online)
// — R548 izvleček iz nalogi.tsx (razbitje po vzorcu R546/R547; BREZ spremembe obnašanja).
// Hitra meritev / opomba / sprememba statusa / zaključek terena. Vsako dejanje
// gre v IndexedDB vrsto (queueOp) → toast 'Shranjeno lokalno'; če je signal na
// voljo, se vrsta TAKOJ poskusi sinhronizirati (syncNow).

import { useState } from 'react'
import { CheckCheck, Loader2, MessageSquare, Play, Ruler, TriangleAlert, WifiOff } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { type OfflineOpKind, queueOp, syncNow } from '@/lib/offline'
import { TRANSITIONS } from './nalogi-shared'

// ─── R439 (issue #6): OFFLINE DEJANJA — vrsta operacij (deluje tudi online) ──
// Hitra meritev / opomba / sprememba statusa / zaključek terena. Vsako dejanje
// gre v IndexedDB vrsto (queueOp) → toast 'Shranjeno lokalno'; če je signal na
// voljo, se vrsta TAKOJ poskusi sinhronizirati (syncNow).

export function OfflineActionsSection ({ wo }: { wo: { id: string; code: string; status: string } }) {
  const { toast } = useToast()
  const [mType, setMType] = useState('OGRAJA')
  const [mLen, setMLen] = useState('')
  const [mHeight, setMHeight] = useState('')
  const [mNote, setMNote] = useState('')
  const [opomba, setOpomba] = useState('')
  const [statusTo, setStatusTo] = useState('')
  // R439: števec remounta izbire statusa — Radix Select po ponastavitvi (value='')
  // še vedno prikaže prejšnjo izbiro IN ne znova sproži onValueChange ob ponovnem
  // kliku iste vrednosti; key-remount vrne svež prikaz (placeholder) in delujočo izbiro
  const [statusKey, setStatusKey] = useState(0)
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)

  const nextStatuses = TRANSITIONS.filter((t) => t.from.includes(wo.status))
  const canFinish = wo.status !== 'ZAKLJUCEN'

  async function enqueue (kind: OfflineOpKind, payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true)
    try {
      await queueOp(kind, payload)
      toast({
        title: 'Shranjeno lokalno',
        description: 'Sinhroniziralo se bo samodejno — takoj, ko bo povezava na voljo.',
      })
      // gumbi delujejo TUDI online: vrsto takoj pošljimo na strežnik
      if (navigator.onLine) void syncNow()
      return true
    } catch (e) {
      toast({
        title: 'Shranjevanje v vrsto ni uspelo',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function quickMeasurement (): Promise<void> {
    const len = Number(mLen.replace(',', '.'))
    if (!(len > 0)) {
      toast({ title: 'Vnesite dolžino meritve (cm).', variant: 'destructive' })
      return
    }
    const h = Number(mHeight.replace(',', '.'))
    const ok = await enqueue('meritev', {
      workOrderId: wo.id,
      type: mType,
      lengthCm: len,
      heightCm: h > 0 ? h : null,
      note: mNote.trim() || null,
    })
    if (ok) { setMLen(''); setMHeight(''); setMNote('') }
  }

  async function addOpomba (): Promise<void> {
    if (!opomba.trim()) {
      toast({ title: 'Vnesite besedilo opombe.', variant: 'destructive' })
      return
    }
    const ok = await enqueue('nalog-opomba', { workOrderId: wo.id, note: opomba.trim() })
    if (ok) setOpomba('')
  }

  async function changeStatus (): Promise<void> {
    if (!statusTo) {
      toast({ title: 'Izberite nov status.', variant: 'destructive' })
      return
    }
    const ok = await enqueue('nalog-status', { workOrderId: wo.id, to: statusTo })
    if (ok) { setStatusTo(''); setStatusKey((k) => k + 1) }
  }

  async function finishWo (): Promise<void> {
    if (!summary.trim()) {
      toast({ title: 'Vnesite povzetek zaključka terena.', variant: 'destructive' })
      return
    }
    const ok = await enqueue('nalog-zakljucek', { workOrderId: wo.id, summary: summary.trim() })
    if (ok) setSummary('')
  }

  return (
    <section aria-label="Offline dejanja" className="space-y-3 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-amber-800 dark:text-amber-300">Offline dejanja</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Dejanja se shranijo lokalno in se samodejno sinhronizirajo — tudi takoj, če je signal na voljo.
        </p>
      </div>

      {/* hitra meritev */}
      <div className="space-y-2 rounded-lg border bg-card p-2.5">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><Ruler className="size-4 text-roksal-amber" aria-hidden /> Hitra meritev</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor={`oa-tip-${wo.id}`} className="text-xs text-muted-foreground">Tip</Label>
            <Select value={mType} onValueChange={setMType}>
              <SelectTrigger id={`oa-tip-${wo.id}`} className="h-9" aria-label="Tip meritve"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="OGRAJA">Ograja</SelectItem>
                <SelectItem value="BALUSTRADA">Balustrada</SelectItem>
                <SelectItem value="NAGIB">Nagib</SelectItem>
                <SelectItem value="OSTANEO">Ostalo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`oa-len-${wo.id}`} className="text-xs text-muted-foreground">Dolžina (cm)</Label>
            <Input
              id={`oa-len-${wo.id}`} type="number" min="1" inputMode="numeric" value={mLen}
              onChange={(e) => setMLen(e.target.value)} placeholder="npr. 350" className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`oa-h-${wo.id}`} className="text-xs text-muted-foreground">Višina (cm)</Label>
            <Input
              id={`oa-h-${wo.id}`} type="number" min="0" inputMode="numeric" value={mHeight}
              onChange={(e) => setMHeight(e.target.value)} placeholder="npr. 100" className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`oa-note-${wo.id}`} className="text-xs text-muted-foreground">Opomba</Label>
            <Input
              id={`oa-note-${wo.id}`} value={mNote} onChange={(e) => setMNote(e.target.value)}
              placeholder="opomba …" className="h-9"
            />
          </div>
        </div>
        <Button size="sm" disabled={busy} onClick={() => void quickMeasurement()}>
          <Ruler className="size-4" aria-hidden /> Shrani meritev v vrsto
        </Button>
      </div>

      {/* opomba */}
      <div className="space-y-2 rounded-lg border bg-card p-2.5">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><MessageSquare className="size-4 text-roksal-amber" aria-hidden /> Opomba naloga</p>
        <Textarea
          value={opomba} onChange={(e) => setOpomba(e.target.value)}
          placeholder="Opomba za pisarno / vodjo …" aria-label="Opomba naloga" className="min-h-14"
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void addOpomba()}>
          <MessageSquare className="size-4" aria-hidden /> Dodaj opombo v vrsto
        </Button>
      </div>

      {/* sprememba statusa */}
      {nextStatuses.length > 0 ? (
        <div className="space-y-2 rounded-lg border bg-card p-2.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><Play className="size-4 text-roksal-amber" aria-hidden /> Sprememba statusa</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid flex-1 gap-1 sm:max-w-64">
              <Label htmlFor={`oa-status-${wo.id}`} className="text-xs text-muted-foreground">Nov status</Label>
              {/* R439: VEDNO kontroliran value (ne `|| undefined` — Radix prehaja
                  med nekontroliran/kontroliran in ob ponastitvi obdrži staro izbiro);
                  key-remount ob ponastavitvi dodatno zagotovi svež prikaz */}
              <Select key={statusKey} value={statusTo} onValueChange={setStatusTo}>
                <SelectTrigger id={`oa-status-${wo.id}`} className="h-9" aria-label="Nov status naloga">
                  <SelectValue placeholder="izberi …" />
                </SelectTrigger>
                <SelectContent>
                  {nextStatuses.map((s) => <SelectItem key={s.to} value={s.to}>{s.label} → {s.to}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" className="h-9" disabled={busy || !statusTo} onClick={() => void changeStatus()}>
              <Play className="size-4" aria-hidden /> Shrani prehod v vrsto
            </Button>
          </div>
        </div>
      ) : null}

      {/* zaključek terena */}
      {canFinish ? (
        <div className="space-y-2 rounded-lg border bg-card p-2.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><CheckCheck className="size-4 text-roksal-amber" aria-hidden /> Zaključek terena</p>
          <Textarea
            value={summary} onChange={(e) => setSummary(e.target.value)}
            placeholder="Povzetek opravljenih del …" aria-label="Povzetek zaključka terena" className="min-h-14"
          />
          <p className="text-[11px] text-muted-foreground">
            Veljaven prehod iz statusa V preveri — če je nalog niže v toku, uvrstite prehode v vrsto po vrsti.
          </p>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void finishWo()}>
            <CheckCheck className="size-4" aria-hidden /> Zaključi teren (v vrsto)
          </Button>
        </div>
      ) : null}
    </section>
  )
}
