'use client'

// MONTAŽA QA PRIMOPREDAJA (R549): verzionirano primopredajno poročilo —
// primerjava načrtovano/izvedeno (seg-N), fotografije pred/med/po, potrditev
// monterja + podpis stranke (ZABELEŽENA potrditev — ne kvalificiran e-podpis),
// izvoz PDF in podpisna tablica na canvasu (izvlečeno bajtno-identično iz
// montaza-qa.tsx).

import { useEffect, useRef, useState } from 'react'
import { CalendarClock, CheckCheck, FileText, Loader2, PenLine, TriangleAlert } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, apiPost, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, StatusBadge } from '@/components/roksal/ui-bits'
import type { HandoverRow } from './montaza-qa-shared'

// ── Primopredaja ─────────────────────────────────────────────────────────────

interface DiffData {
  primerjava?: { key: string; nacrtCm: number | null; izvedenoCm: number | null; ujema: boolean | null }[]
  nacrtovano?: { source: string }[]
  izvedeno?: { source: string }[]
}
type PhotosData = { id: string; stage: string }[]

export function HandoverSection ({ woId, canWrite, onTransitioned }: {
  woId: string
  canWrite: boolean
  onTransitioned: () => Promise<void> | void
}) {
  const token = useAppStore((s) => s.token)
  const { toast } = useToast()
  const ho = useApi<{ data: { latest: HandoverRow | null; versions: { id: string; version: number; status: string; createdAt: string }[] } }>(`/api/nalog/${woId}/handover`)
  const [busy, setBusy] = useState<string | null>(null)
  const [summary, setSummary] = useState('')
  const [signedBy, setSignedBy] = useState('')
  const [remark, setRemark] = useState('')
  const [showSign, setShowSign] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hasInk, setHasInk] = useState(false)
  const [resetKey, setResetKey] = useState(0)

  const latest = ho.data?.data.latest ?? null
  const versions = ho.data?.data.versions ?? []
  // R542: diffJson/photosJson sta jsonb — API vrača razčlenjeno (objekt/tabela); obramba za neobjektno ostane
  const diff: DiffData = (latest?.diffJson != null && typeof latest.diffJson === 'object' && !Array.isArray(latest.diffJson)) ? latest.diffJson as DiffData : {}
  const photos: PhotosData = Array.isArray(latest?.photosJson) ? latest.photosJson as PhotosData : []
  const photosBy = (stage: string) => photos.filter((p) => p.stage === stage).length

  async function zgradi (): Promise<void> {
    setBusy('build')
    try {
      await apiPost(`/api/nalog/${woId}/handover`, summary.trim() ? { summary: summary.trim() } : {})
      toast({ title: 'Primopredajno poročilo zgrajeno.', description: 'Primerjava, fotografije in kontrole so vzete iz istih podatkov naloga.' })
      setSummary('')
      await Promise.all([ho.reload(), onTransitioned()])
    } catch (e) {
      toast({ title: 'Izgradnja ni uspela', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  async function patch (action: string, body: Record<string, unknown>, title: string): Promise<void> {
    setBusy(action)
    try {
      await apiPatch(`/api/nalog/${woId}/handover`, { action, ...body })
      toast({ title })
      await Promise.all([ho.reload(), onTransitioned()])
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  async function podpisi (): Promise<void> {
    if (!canvasRef.current || !hasInk) {
      toast({ title: 'Stranka naj podpiše na zaslonu.', variant: 'destructive' }); return
    }
    if (signedBy.trim().length < 3) {
      toast({ title: 'Zapiši ime/identiteto podpisnika.', variant: 'destructive' }); return
    }
    const signatureDataUrl = canvasRef.current.toDataURL('image/jpeg', 0.85)
    await patch('sign', { signatureDataUrl, signedBy: signedBy.trim(), ...(remark.trim() ? { remark: remark.trim() } : {}) }, 'Potrditev stranke zabeležena.')
    setHasInk(false); setResetKey((k) => k + 1); setSignedBy(''); setRemark(''); setShowSign(false)
  }

  async function izvoziPdf (): Promise<void> {
    if (!latest || !token) return
    setBusy('pdf')
    try {
      const res = await fetch(`/api/pdf/handover/${latest.id}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error ?? `Napaka strežnika (${res.status}).`)
      }
      const blob = await res.blob()
      if (!blob.type.includes('pdf')) throw new Error('Odgovor ni veljaven PDF.')
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (e) {
      toast({ title: 'Izvoz PDF ni uspel.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  if (ho.loading && !latest && versions.length === 0) return <LoadingRows rows={1} />
  if (ho.error) return <ErrorBox error={ho.error} />

  return (
    <section aria-label="Primopredaja" className="rounded-xl border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <FileText className="size-4 text-roksal-amber" aria-hidden /> Primopredaja
        </h3>
        {latest ? <StatusBadge status={latest.status} /> : null}
      </div>

      {!latest ? (
        canWrite ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Zgradi poročilo iz istih podatkov: kontrolne točke, odstopanja, primerjava načrtovano/izvedeno (seg-N) in fotografije pred/med/po.</p>
            <Textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Povzetek izvedbe (kaj je bilo narejeno, dogovori …)" aria-label="Povzetek izvedbe" />
            <Button className="h-11 w-full sm:w-auto" disabled={busy === 'build'} onClick={() => void zgradi()}>
              {busy === 'build' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileText className="size-4" aria-hidden />}
              Zgradi primopredajno poročilo
            </Button>
          </div>
        ) : (
          <EmptyState icon={FileText} title="Poročilo še ni zgrajeno" desc="Zgradi ga monter ali pisarna ob predaji." />
        )
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Verzija {latest.version} · zgrajeno {fmtDateTime(latest.createdAt)}
            {versions.length > 1 ? ` · zgodovina: ${versions.length} verzij` : ''}
          </p>

          {latest.status === 'NEPOPOLNA' ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              <TriangleAlert className="mr-1 inline size-3.5" aria-hidden />
              {latest.monterConfirmedAt && latest.customerSignedAt
                ? 'Poročilo je NEPOPOLNO: obstajajo kritične nerešene zadeve (zaključek je blokiran).'
                : 'Poročilo je NEPOPOLNO: manjka potrditev monterja ali stranke, ali obstajajo kritične nerešene zadeve.'}
            </p>
          ) : null}
          {latest.status === 'POGOJNA' ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              <TriangleAlert className="mr-1 inline size-3.5" aria-hidden />
              Primopredaja je POGOJNA: odprte zadeve so izpisane v poročilu.
            </p>
          ) : null}

          {(diff.primerjava?.length ?? 0) > 0 ? (
            <div>
              <h4 className="mb-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Načrtovano / izvedeno (seg-N)</h4>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-1.5 font-medium">Segment</th>
                      <th className="px-2 py-1.5 font-medium">Načrt</th>
                      <th className="px-2 py-1.5 font-medium">Izvedeno</th>
                      <th className="px-2 py-1.5 font-medium">Ujema</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(diff.primerjava ?? []).map((p) => (
                      <tr key={p.key} className="border-b last:border-0">
                        <td className="px-2 py-1.5 font-medium">{p.key}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{p.nacrtCm != null ? `${Math.round(p.nacrtCm)} cm` : '—'}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{p.izvedenoCm != null ? `${Math.round(p.izvedenoCm)} cm` : '—'}</td>
                        <td className="px-2 py-1.5">
                          {p.ujema == null ? <span className="text-muted-foreground">—</span>
                            : p.ujema ? <span className="font-semibold text-emerald-700 dark:text-emerald-400">DA</span>
                              : <span className="font-semibold text-red-600">NE</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Viri: {diff.nacrtovano?.[0]?.source ?? '—'} / {diff.izvedeno?.[0]?.source ?? 'brez AS-INSTALLED dvojčka'}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">— brez primerjave segmentov (ni potrjenega tekača/dvojčka) —</p>
          )}

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded bg-muted px-2 py-1 text-muted-foreground">📷 pred: {photosBy('PRED')}</span>
            <span className="rounded bg-muted px-2 py-1 text-muted-foreground">📷 med: {photosBy('MED')}</span>
            <span className="rounded bg-muted px-2 py-1 text-muted-foreground">📷 po: {photosBy('PO')}</span>
          </div>

          {latest.summary ? <p className="whitespace-pre-line rounded-lg bg-muted/40 px-2.5 py-2 text-xs">{latest.summary}</p> : null}

          {/* potrditvi */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border p-2.5">
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Potrditev monterja</h4>
              {latest.monterConfirmedAt ? (
                <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
                  <CheckCheck className="mr-1 inline size-3.5" aria-hidden />
                  {latest.monterConfirmedBy?.name ?? '—'} · {fmtDateTime(latest.monterConfirmedAt)}
                </p>
              ) : canWrite ? (
                <Button size="sm" className="mt-1.5 h-8 w-full text-[11px]" disabled={busy === 'monter-confirm'} onClick={() => void patch('monter-confirm', {}, 'Potrditev monterja zabeležena.')}>
                  {busy === 'monter-confirm' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CheckCheck className="size-3.5" aria-hidden />} Potrdi izvedbo
                </Button>
              ) : <p className="mt-1 text-xs text-muted-foreground">— ni potrjeno —</p>}
            </div>
            <div className="rounded-lg border p-2.5">
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Potrditev stranke</h4>
              {latest.customerSignedAt ? (
                <div className="mt-1 space-y-1">
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">
                    <PenLine className="mr-1 inline size-3.5" aria-hidden />
                    {latest.customerSignedBy ?? '—'} · {fmtDateTime(latest.customerSignedAt)}
                  </p>
                  {latest.customerRemark ? <p className="rounded bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">Pripomba: {latest.customerRemark}</p> : null}
                </div>
              ) : canWrite ? (
                showSign ? (
                  <div className="mt-1.5 space-y-1.5">
                    <SignaturePad canvasRef={canvasRef} onChange={setHasInk} resetKey={resetKey} hasInk={hasInk} />
                    <Input className="h-8 text-xs" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="Ime/identiteta podpisnika" aria-label="Ime podpisnika" />
                    <Textarea rows={2} className="text-xs" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Pripomba stranke (neobvezno — postane sledljiv zapis)" aria-label="Pripomba stranke" />
                    <div className="flex gap-1.5">
                      <Button size="sm" className="h-8 flex-1 text-[11px]" disabled={busy === 'sign'} onClick={() => void podpisi()}>
                        {busy === 'sign' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <PenLine className="size-3.5" aria-hidden />} Podpiši primopredajo
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 text-[11px]" onClick={() => { setShowSign(false); setHasInk(false); setResetKey((k) => k + 1) }}>Prekliči</Button>
                    </div>
                    <p className="text-[10px] leading-snug text-muted-foreground">Podpis na zaslonu je zabeležena potrditev v sistemu — ni kvalificiran elektronski podpis.</p>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" className="mt-1.5 h-8 w-full text-[11px]" onClick={() => setShowSign(true)}>
                    <PenLine className="size-3.5" aria-hidden /> Podpis stranke
                  </Button>
                )
              ) : <p className="mt-1 text-xs text-muted-foreground">— ni podpisano —</p>}
            </div>
          </div>

          {latest.customerSignedAt && !latest.customerRemark && canWrite ? (
            <div className="flex gap-1.5">
              <Input className="h-8 flex-1 text-xs" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Dodaj pripombo stranke …" aria-label="Pripomba stranke" />
              <Button size="sm" variant="outline" className="h-8 text-[11px]" disabled={!remark.trim() || busy === 'remark'}
                onClick={() => { void patch('remark', { remark: remark.trim() }, 'Pripomba stranke zabeležena.'); setRemark('') }}>
                Zabeleži
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="h-8 text-[11px]" disabled={busy === 'pdf'} onClick={() => void izvoziPdf()}>
              {busy === 'pdf' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileText className="size-3.5" aria-hidden />} Izvozi PDF
            </Button>
            {canWrite ? (
              <Button size="sm" variant="outline" className="h-8 text-[11px]" disabled={busy === 'build'} onClick={() => void zgradi()}>
                {busy === 'build' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CalendarClock className="size-3.5" aria-hidden />}
                Zgradi novo verzijo
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}

// ── podpis na zaslonu (canvas → dataURL; vzorec signatura.tsx R459) ─────────

function SignaturePad ({ canvasRef, onChange, resetKey, hasInk }: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  onChange: (hasInk: boolean) => void
  resetKey: number
  hasInk: boolean
}) {
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)

  function pos (e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  function start (e: React.PointerEvent<HTMLCanvasElement>) {
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* sintetični dogodki */ }
    drawing.current = true
    last.current = pos(e)
  }
  function move (e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const p = pos(e)
    const from = last.current
    if (from) {
      ctx.strokeStyle = '#1d2b3e'
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctx.scale(dpr, dpr)
    onChange(false)
  }, [resetKey])

  return (
    <div className="space-y-1">
      <canvas
        ref={canvasRef}
        className="h-24 w-full touch-none rounded-lg border bg-white"
        aria-label="Podpis stranke na zaslonu"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <div className="flex justify-between">
        <span className="text-[10px] text-muted-foreground">Podpis s prstom ali miško</span>
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={clear} disabled={!hasInk}>Počisti</Button>
      </div>
    </div>
  )
}
