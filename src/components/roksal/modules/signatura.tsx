'use client'

// SIGNATURA — zajem podpisa stranke → zaklep posla (deal.lock)
// Canvas podpisna tablica (miška + dotik), izbira ponudbe (POSLAN/SPREJET),
// ime podpisnika, "Podpiši in zakleni posel" → status ZAKLENJEN + revizija DEAL_LOCK.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Eraser, Lock, LockKeyhole, PenLine, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPost, fmtEUR, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

interface SignableQuote {
  id: string
  code: string
  status: string
  total: number
  customer: { name: string } | null
  project: { title: string } | null
  _count: { lines: number }
}

export default function SignaturaModule () {
  const { toast } = useToast()
  const user = useAppStore((s) => s.user)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [quoteId, setQuoteId] = useState('')
  const [signedBy, setSignedBy] = useState('')
  const [hasInk, setHasInk] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [lastSigned, setLastSigned] = useState<{ code: string; signedBy: string; at: string } | null>(null)

  const quotes = useApi<{ data: SignableQuote[] }>('/api/quotes?limit=200')
  const eligible = useMemo(
    () => (quotes.data?.data ?? []).filter((qq) => qq.status === 'POSLAN' || qq.status === 'SPREJET'),
    [quotes.data]
  )
  const selected = eligible.find((qq) => qq.id === quoteId)

  const canLock = hasPerm(user?.perms, 'deal.lock')

  async function submit () {
    if (!selected) { toast({ title: 'Izberite ponudbo za podpis.', variant: 'destructive' }); return }
    if (!signedBy.trim()) { toast({ title: 'Vnesite ime podpisnika.', variant: 'destructive' }); return }
    if (!hasInk || !canvasRef.current) { toast({ title: 'Podpis je prazen.', description: 'Podpišite na podpisno tablico.', variant: 'destructive' }); return }

    const signature = canvasRef.current.toDataURL('image/png')
    setBusy(true)
    try {
      await apiPost(`/api/quotes/${selected.id}/sign`, { signature, signedBy: signedBy.trim() })
      setLastSigned({ code: selected.code, signedBy: signedBy.trim(), at: new Date().toISOString() })
      toast({ title: 'Posel zaklenjen.', description: `Ponudba ${selected.code} je podpisana in zaklenjena.` })
      setQuoteId('')
      setSignedBy('')
      setHasInk(false)
      setResetKey((k) => k + 1)
      await quotes.reload()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Signatura" desc="Podpis stranke → zaklep posla" />

      {lastSigned ? (
        <Card className="border-emerald-300/60 bg-emerald-50/50 dark:border-emerald-800/50 dark:bg-emerald-950/30" role="status">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
              <ShieldCheck className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-emerald-800 dark:text-emerald-300">Posel zaklenjen</div>
              <div className="text-sm text-muted-foreground">
                Ponudba <span className="font-mono font-semibold">{lastSigned.code}</span> · podpisal(a) {lastSigned.signedBy} · {fmtDateTime(lastSigned.at)}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <ErrorBox error={quotes.error} />
      {quotes.loading ? <LoadingRows rows={3} /> : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><PenLine className="size-4 text-roksal-amber" aria-hidden /> Podpisna tablica</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {eligible.length === 0 ? (
              <EmptyState
                title="Ni ponudb za podpis"
                desc="Podpisati je mogoče le ponudbe v statusu Poslan ali Sprejet."
                icon={LockKeyhole}
              />
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Ponudba *</Label>
                  <Select value={quoteId || undefined} onValueChange={setQuoteId}>
                    <SelectTrigger aria-label="Izberi ponudbo"><SelectValue placeholder="Izberite ponudbo …" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {eligible.map((qq) => (
                        <SelectItem key={qq.id} value={qq.id}>
                          {qq.code} · {qq.customer?.name ?? 'brez stranke'} · {fmtEUR(qq.total)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selected ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-secondary/60 p-2.5 text-sm">
                      <StatusBadge status={selected.status} />
                      <span className="min-w-0 truncate">{selected.project?.title ?? selected.customer?.name ?? ''}</span>
                      <span className="ml-auto font-semibold tabular-nums">{fmtEUR(selected.total)}</span>
                    </div>
                  ) : null}
                </div>

                <SignaturePad canvasRef={canvasRef} onChange={setHasInk} resetKey={resetKey} hasInk={hasInk} />

                <div className="space-y-2">
                  <Label htmlFor="sig-by">Ime podpisnika *</Label>
                  <Input id="sig-by" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="npr. Marko Novak" />
                </div>

                {canLock ? (
                  <Button className="w-full" size="lg" disabled={busy} onClick={() => void submit()}>
                    <Lock className="size-4" aria-hidden /> {busy ? 'Zaklepanje…' : 'Podpiši in zakleni posel'}
                  </Button>
                ) : (
                  <p className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground" role="note">
                    Za zaklep posla potrebujete pravico <span className="font-mono text-xs">deal.lock</span>.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  S podpisom se ponudba trajno zaklene (status Zaklenjen) in zapiše v revizijski dnevnik (DEAL_LOCK).
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function SignaturePad ({ canvasRef, onChange, resetKey, hasInk }: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  onChange: (hasInk: boolean) => void
  resetKey: number
  hasInk: boolean
}) {
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)

  function pos (e: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function start (e: ReactPointerEvent<HTMLCanvasElement>) {
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* sintetični dogodki / naprava brez zajeme */ }
    drawing.current = true
    last.current = pos(e)
  }

  function move (e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const p = pos(e)
    const from = last.current
    if (from) {
      ctx.strokeStyle = '#1d2b3e' // roksal navy
      ctx.lineWidth = 2.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      onChange(true)
    }
    last.current = p
  }

  function end () {
    drawing.current = false
    last.current = null
  }

  function clear () {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    onChange(false)
  }

  // inicializacija: DPR-skaliranje + belo ozadje (resetKey ponastavi po pošiljanju)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    onChange(false)
  }, [canvasRef, onChange, resetKey])

  return (
    <div className="space-y-2">
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="h-44 w-full cursor-crosshair touch-none rounded-xl border-2 border-dashed border-muted-foreground/40 bg-white"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
          role="img"
          aria-label="Podpisna tablica — podpišite s prstom ali miško"
        />
        {!hasInk ? <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground/60">Podpišite tukaj</span> : null}
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={clear}>
          <Eraser className="size-4" aria-hidden /> Počisti
        </Button>
      </div>
    </div>
  )
}
