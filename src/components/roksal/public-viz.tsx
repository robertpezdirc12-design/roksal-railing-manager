'use client'

// JAVNI VIZUALIZATOR (R480 — issue #9 §10) — stran /v/[token]
// Stranka z žetonom povezave BREZ PRIJAVE: tabi variant A/B/C, PREJ/POTEM
// slider (brez zunanjih knjižnic), prijava izbire (PONUDBA/OGLED/IZMERA +
// opomba + kontakt + GDPR soglasje) → POST /api/public/viz-choice.
//
// Varnost (sledi /api/public/viz — varni podskup):
//  • tukaj NI internih opomb, cen, statusov pisarne ali drugih projektov;
//  • fotografije pridejo SAMO ob veljavnem soglasju (photosBlocked vrata) —
//    v tem primeru pokažemo razlago, izbira pa OSTANE dostopna;
//  • NOINDEX (metadata v page.tsx); žigon VIZUALIZACIJA ZA PREDSTAVITEV.
//
// Pisarna izbire NE spreminja (append-only) — „Vaš izbor" je zadnji zapis.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CalendarClock, Check, Clock3, ImageIcon, Loader2, Lock, MoveHorizontal,
  Ruler, Send, ShieldCheck,
} from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { RoksalMark } from '@/components/roksal/logo'
import {
  VIZ_REQUEST_TYPES, VIZ_REQUEST_TYPE_LABELS,
  type ChoiceSummary, type PublicVizVisualization, type VizRequestType,
} from '@/lib/viz-core'
import { VIZ_ZIG } from '@/lib/photo-replace-core'
import { cn } from '@/lib/utils'

// ─── Tipi (odgovor /api/public/viz) ──────────────────────────────────────────

interface VizData {
  project: { code: string; title: string; customerName: string | null }
  consent: string
  photosBlocked: string | null
  variants: PublicVizVisualization[]
  chosen: ChoiceSummary | null
  link: { expiresAt: string }
}

const fmtDate = (d: string): string =>
  new Intl.DateTimeFormat('sl-SI', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d))
const fmtDateTime = (d: string): string =>
  new Intl.DateTimeFormat('sl-SI', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d))

const TIP_LABELS: Record<string, string> = {
  POKOCNA: 'Pokončna polnila',
  PRECNA: 'Prečna polnila',
  STEKLO: 'Steklo',
}
const PRITRDITEV_LABELS: Record<string, string> = {
  TALNA: 'talna pritrditev',
  STEBRI_V_BETON: 'stebri v beton',
  BOCNA_NA_STENO: 'bočno na steno',
}

// ─── PREJ / POTEM slider (čista implementacija, brez knjižnic) ───────────────

function CompareSlider ({ before, after }: { before: string; after: string }) {
  const [pos, setPos] = useState(50)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const dragging = useRef(false)

  const move = useCallback((clientX: number): void => {
    const el = boxRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width <= 0) return
    setPos(Math.min(100, Math.max(0, Math.round(((clientX - r.left) / r.width) * 100))))
  }, [])

  return (
    <div
      ref={boxRef}
      className="relative select-none overflow-hidden rounded-xl border bg-muted"
      style={{ touchAction: 'pan-y', cursor: 'ew-resize' }}
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        move(e.clientX)
      }}
      onPointerMove={(e) => { if (dragging.current) move(e.clientX) }}
      onPointerUp={() => { dragging.current = false }}
      onPointerCancel={() => { dragging.current = false }}
    >
      <img src={before} alt="PREJ — obstoječe stanje" className="block w-full" draggable={false} />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }} aria-hidden>
        <img src={after} alt="POTEM — nova ograja" className="block h-full w-full object-cover" draggable={false} />
      </div>

      {/* ločilna črta + ročaj */}
      <div className="pointer-events-none absolute inset-y-0" style={{ left: `${pos}%` }} aria-hidden>
        <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_6px_rgba(0,0,0,0.45)]" />
        <div className="absolute top-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-roksal-amber text-roksal-amber-ink shadow-lg">
          <MoveHorizontal className="size-4" aria-hidden />
        </div>
      </div>
      <button
        type="button"
        role="slider"
        aria-label="Premik med PREJ in POTEM"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pos}
        className="absolute inset-y-0 w-10 -translate-x-1/2 cursor-ew-resize"
        style={{ left: `${pos}%` }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); setPos((p) => Math.max(0, p - 5)) }
          if (e.key === 'ArrowRight') { e.preventDefault(); setPos((p) => Math.min(100, p + 5)) }
        }}
        tabIndex={0}
      />

      <span className="pointer-events-none absolute left-2 top-2 rounded bg-background/90 px-2 py-0.5 text-[11px] font-bold">PREJ</span>
      <span className="pointer-events-none absolute right-2 top-2 rounded bg-background/90 px-2 py-0.5 text-[11px] font-bold">POTEM</span>
    </div>
  )
}

// ─── Obrazec izbire variante ─────────────────────────────────────────────────

function ChoiceForm ({ token, variant, onSubmitted }: {
  token: string
  variant: PublicVizVisualization
  onSubmitted: () => void
}) {
  const [requestType, setRequestType] = useState<VizRequestType>('PONUDBA')
  const [note, setNote] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<ChoiceSummary | null>(null)

  async function submit (): Promise<void> {
    if (busy) return
    if (!consent) {
      setError('Potrdite obvestilo o obdelavi podatkov (soglasje) — brez njega izbire ni mogoče poslati.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/viz-choice?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visualizationId: variant.id,
          variantLabel: variant.variantLabel,
          requestType,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(contactName.trim() ? { contactName: contactName.trim() } : {}),
          ...(contactPhone.trim() ? { contactPhone: contactPhone.trim() } : {}),
          ...(contactEmail.trim() ? { contactEmail: contactEmail.trim() } : {}),
          consentAccepted: true,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 429) throw new Error('Preveč zahtev — poskusite znova čez minuto.')
        if (res.status === 404) throw new Error('Povezava ne velja več (preklicana ali potekla).')
        throw new Error((body as { error?: string }).error ?? 'Pošiljanje izbire ni uspelo.')
      }
      setDone((body as { data: ChoiceSummary }).data)
      onSubmitted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pošiljanje izbire ni uspelo.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="space-y-2 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900" role="status">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Check className="size-4 shrink-0" aria-hidden /> Hvala! Vaša izbira je zabeležena.
        </p>
        <p className="text-sm">
          Izbrana varianta <span className="font-bold">{done.variantLabel}</span> · {done.requestTypeLabel} ·{' '}
          <span className="whitespace-nowrap">{fmtDateTime(done.chosenAt)}</span>.
        </p>
        {done.note ? <p className="text-xs">Vaša opomba: {done.note}</p> : null}
        <p className="text-xs text-emerald-800">
          Izbor je viden pisarni ROKSAL. Če ste pustili kontakt, se oglavimo pri pripravi ponudbe oz. dogovoru termina.
        </p>
        <Button type="button" variant="outline" size="sm" className="h-9 border-emerald-300 text-emerald-900 hover:bg-emerald-100" onClick={() => setDone(null)}>
          Zapri
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-xl border bg-muted/40 p-4">
      <div className="space-y-2">
        <p className="text-sm font-semibold">Izberem varianto {variant.variantLabel} — moja zahteva:</p>
        <RadioGroup
          value={requestType}
          onValueChange={(v) => { if (v) setRequestType(v as VizRequestType) }}
          className="gap-2"
          aria-label="Vrsta zahteve"
        >
          {VIZ_REQUEST_TYPES.map((rt) => (
            <Label
              key={rt}
              htmlFor={`rt-${rt}`}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-sm font-normal transition-colors hover:border-roksal-amber [&:has([data-state=checked])]:border-roksal-amber"
            >
              <RadioGroupItem id={`rt-${rt}`} value={rt} />
              <span className="font-medium">{VIZ_REQUEST_TYPE_LABELS[rt]}</span>
            </Label>
          ))}
        </RadioGroup>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="vc-note" className="text-sm">Opomba (neobvezno)</Label>
        <Textarea
          id="vc-note" rows={3} maxLength={500} value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="npr. Želim isti videz tudi na stranski terasi."
          aria-describedby="vc-note-hint"
        />
        <p id="vc-note-hint" className="text-right text-[11px] text-muted-foreground">{note.length}/500</p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">
          Kontakt <span className="font-normal text-muted-foreground">(neobvezen{requestType === 'PONUDBA' ? ', priporočen za pripravo ponudbe' : ''})</span>
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="vc-ime" className="text-xs text-muted-foreground">Ime in priimek</Label>
            <Input id="vc-ime" autoComplete="name" maxLength={200} value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="vc-tel" className="text-xs text-muted-foreground">Telefon</Label>
            <Input id="vc-tel" type="tel" autoComplete="tel" maxLength={40} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="vc-email" className="text-xs text-muted-foreground">E-pošta</Label>
            <Input id="vc-email" type="email" autoComplete="email" maxLength={200} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
          </div>
        </div>
      </div>

      <Label htmlFor="vc-consent" className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-xs leading-relaxed">
        <Checkbox id="vc-consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
        <span>
          Strinjam se, da ROKSAL shrani mojo izbiro in kontakt za namen priprave ponudbe.
          <span className="mt-0.5 block text-muted-foreground">Podatki se uporabljajo izključno za odgovor na to zahtevo.</span>
        </span>
      </Label>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive" role="alert">{error}</p>
      ) : null}

      <Button type="button" className="h-11 w-full sm:w-auto" disabled={busy || !consent} onClick={() => { void submit() }}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
        Pošlji izbiro — varianta {variant.variantLabel}
      </Button>
    </div>
  )
}

// ─── Karta variante ──────────────────────────────────────────────────────────

function VariantCard ({ data, variant, token, onSubmitted }: {
  data: VizData
  variant: PublicVizVisualization
  token: string
  onSubmitted: () => void
}) {
  const [choosing, setChoosing] = useState(false)
  const cfg = variant.configSummary

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-base font-bold sm:text-lg">Varianta {variant.variantLabel}</h2>
            <p className="text-sm text-muted-foreground">
              {variant.product ? variant.product.name : 'Ograja ROKSAL'}
              {variant.variant ? ` · ${variant.variant.name}${variant.variant.ral && !/RAL/i.test(variant.variant.name) ? ` (RAL ${variant.variant.ral})` : ''}` : ''}
            </p>
          </div>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock3 className="size-3" aria-hidden /> posodobljeno {fmtDate(variant.updatedAt)}
          </p>
        </div>

        {cfg ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Povzetek konfiguracije">
            <li><Badge variant="outline" className="gap-1"><Ruler className="size-3" aria-hidden /> {TIP_LABELS[cfg.tip] ?? cfg.tip}</Badge></li>
            <li><Badge variant="outline">{Math.round(cfg.lengthCm)} × {Math.round(cfg.heightCm)} cm</Badge></li>
            {cfg.posts > 0 ? <li><Badge variant="outline">{cfg.posts} stebrov</Badge></li> : null}
            {cfg.handrail ? <li><Badge variant="outline">ročaj</Badge></li> : null}
            {cfg.pritrditev ? <li><Badge variant="outline">{PRITRDITEV_LABELS[cfg.pritrditev] ?? cfg.pritrditev}</Badge></li> : null}
            {cfg.lamelaMm ? <li><Badge variant="outline">lamela {cfg.lamelaMm} mm</Badge></li> : null}
          </ul>
        ) : null}

        {/* PREJ / POTEM — samo ob veljavnem soglasju (GDPR vrata) */}
        {data.photosBlocked ? (
          <div className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/40 p-6 text-center" role="note">
            <Lock className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">Fotografije niso prikazane</p>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              {data.photosBlocked === 'SOGLASJE_POTEKLO'
                ? 'Soglasje za objavo fotografij je poteklo.'
                : 'Za ta projekt še ni soglasja za objavo fotografij.'}{' '}
              Opisi variant in prijava izbire ostajajo na voljo — za ogled fotografij se obrnite na ROKSAL.
            </p>
          </div>
        ) : variant.sourcePhoto && variant.rendered ? (
          <CompareSlider before={variant.sourcePhoto} after={variant.rendered} />
        ) : variant.sourcePhoto ? (
          <figure className="space-y-1.5">
            <img src={variant.sourcePhoto} alt="PREJ — obstoječe stanje" className="w-full rounded-xl border" />
            <figcaption className="text-xs text-muted-foreground">PREJ — izris nove ograje za to varianto še ni na voljo.</figcaption>
          </figure>
        ) : (
          <div className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/40 p-6 text-center">
            <ImageIcon className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-xs text-muted-foreground">Za to varianto ni fotografije — podatki o izdelku so zgoraj.</p>
          </div>
        )}

        {choosing ? (
          <ChoiceForm token={token} variant={variant} onSubmitted={onSubmitted} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" className="h-11" onClick={() => setChoosing(true)}>
              <Check className="size-4" aria-hidden /> Izberi to varianto
            </Button>
            <p className="text-xs text-muted-foreground">Izbira ni vezava — pisarni ROKSAL samo sporočite, kaj vam je všeč.</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Glavna stran ────────────────────────────────────────────────────────────

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: VizData }
  | { kind: 'err'; status: number; message: string }

export function PublicViz ({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [reloadTick, setReloadTick] = useState(0)
  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/public/viz?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          if (res.status === 429) {
            setState({ kind: 'err', status: 429, message: 'Preveč zahtev — poskusite znova čez minuto.' })
          } else if (res.status === 404) {
            setState({ kind: 'err', status: 404, message: 'Ta povezava je bila preklicana, je potekla ali ne obstaja.' })
          } else {
            setState({ kind: 'err', status: res.status, message: (body as { error?: string }).error ?? 'Strani ni bilo mogoče naložiti.' })
          }
          return
        }
        setState({ kind: 'ok', data: (body as { data: VizData }).data })
        setActiveIdx(0)
      })
      .catch(() => { if (!cancelled) setState({ kind: 'err', status: 0, message: 'Povezave s strežnikom ni bilo mogoče vzpostaviti.' }) })
    return () => { cancelled = true }
    // namerno BREZ setState('loading') ob ponovnem nalaganju — ob oddaji izbire
    // stran ostane stabilna; začetno nalaganje pokrije začetno stanje.
  }, [token, reloadTick])

  const reload = useCallback(() => setReloadTick((t) => t + 1), [])

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* glava */}
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <RoksalMark className="size-8 shrink-0 text-roksal-ink dark:text-foreground" />
            <div className="leading-tight">
              <p className="text-sm font-bold tracking-tight">ROKSAL</p>
              <p className="text-[10px] font-medium uppercase tracking-widest text-roksal-amber-text">ograde in ograje</p>
            </div>
          </div>
          {state.kind === 'ok' ? (
            <p className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
              <CalendarClock className="size-3.5" aria-hidden /> povezava velja do {fmtDate(state.data.link.expiresAt)}
            </p>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-6">
        {state.kind === 'loading' ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24" role="status" aria-live="polite">
            <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Nalagam vizualizacije …</p>
          </div>
        ) : state.kind === 'err' ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <RoksalMark className="size-12 text-muted-foreground" aria-hidden />
            <div className="space-y-1.5">
              <h1 className="text-lg font-bold">
                {state.status === 429 ? 'Preveč zahtev' : 'Povezava ni na voljo'}
              </h1>
              <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
                {state.message}{' '}
                {state.status !== 429 ? 'Prosimo, prosite ROKSAL za novo povezavo do vizualizacij.' : null}
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* naslov projekta */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-roksal-amber-text">Javni vizualizator</p>
              <h1 className="text-xl font-bold leading-snug sm:text-2xl">Prijava izbire za {state.data.project.title}</h1>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{state.data.project.code}</Badge>
                {state.data.project.customerName ? <Badge variant="secondary">stranka: {state.data.project.customerName}</Badge> : null}
                <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground sm:hidden">
                  <CalendarClock className="size-3" aria-hidden /> do {fmtDate(state.data.link.expiresAt)}
                </span>
              </div>
            </div>

            {/* Vaš izbor (zadnji) */}
            {state.data.chosen ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-sm text-emerald-900">
                <p className="flex items-center gap-2 font-semibold">
                  <ShieldCheck className="size-4 shrink-0" aria-hidden /> Vaš izbor
                </p>
                <p>
                  Varianta <span className="font-bold">{state.data.chosen.variantLabel}</span> · {state.data.chosen.requestTypeLabel} ·{' '}
                  <span className="whitespace-nowrap">{fmtDateTime(state.data.chosen.chosenAt)}</span>
                </p>
                <p className="w-full text-xs text-emerald-800">Lahko izberete znova — pisarna vidi vse vaše posodobitve.</p>
              </div>
            ) : (
              <p className="rounded-xl border bg-card p-3.5 text-sm text-muted-foreground">
                Preglejte variante in nam sporočite, katera vam je všeč. Izbira ni vezava.
              </p>
            )}

            {/* GDPR opozorilo zamika fotografij */}
            {state.data.photosBlocked ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs leading-relaxed text-amber-900" role="note">
                <span className="font-semibold">Fotografije trenutno niso prikazane.</span>{' '}
                {state.data.photosBlocked === 'SOGLASJE_POTEKLO'
                  ? 'Soglasje za objavo fotografij je poteklo.'
                  : 'Za ta projekt manjka soglasje za objavo fotografij.'}{' '}
                Opisi variant in prijava izbire so vseeno na voljo.
              </div>
            ) : null}

            {/* tabi variant */}
            {state.data.variants.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
                  <ImageIcon className="size-8 text-muted-foreground" aria-hidden />
                  <p className="text-sm font-medium">Za ta projekt trenutno ni pripravljenih variant.</p>
                  <p className="text-xs text-muted-foreground">ROKSAL jih bo dodal — poskusite kasneje.</p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div role="tablist" aria-label="Variante vizualizacije" className="flex flex-wrap gap-2">
                  {state.data.variants.map((v, i) => {
                    const isChosen = state.data.chosen?.variantLabel === v.variantLabel
                    return (
                      <button
                        key={v.id} type="button" role="tab" aria-selected={i === activeIdx}
                        onClick={() => setActiveIdx(i)}
                        className={cn(
                          'flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors',
                          i === activeIdx
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-card hover:border-foreground/30',
                        )}
                      >
                        Varianta {v.variantLabel}
                        {isChosen ? <Check className="size-3.5" aria-label="vaša izbira" /> : null}
                      </button>
                    )
                  })}
                </div>

                {state.data.variants[activeIdx] ? (
                  <VariantCard
                    data={state.data}
                    variant={state.data.variants[activeIdx]}
                    token={token}
                    onSubmitted={reload}
                  />
                ) : null}
              </>
            )}

            {/* diskretno: rok povezave */}
            <p className="text-center text-[11px] text-muted-foreground">
              Povezava je osebna in časovno omejena (velja do {fmtDate(state.data.link.expiresAt)}).
            </p>
          </>
        )}
      </main>

      {/* minimalen sticky footer */}
      <footer className="border-t bg-card">
        <div className="mx-auto w-full max-w-3xl px-4 py-3">
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            © {new Date().getFullYear()} ROKSAL · {VIZ_ZIG} — ni proizvodna mera.
          </p>
        </div>
      </footer>
    </div>
  )
}
