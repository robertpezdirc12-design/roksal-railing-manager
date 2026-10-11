'use client'

// INTEGRACIJE — WEBHOOK NAROČNINE (R481 — issue #9 §9, frontend)
// Zavihek v sekciji Varnost (vrata: integrations.manage — ADMIN/VODJA,
// vzorec portal.manage iz R480). Strežniške rute so dokumentirane v
// docs/webhooks.md — tu jih LE uporabljamo (GET/POST/PATCH/DELETE/test/
// deliveries/retry).
//
// Poštenost UI (vzorec R480 foto-replace-links):
//  • skrivnost se NE vrača niti prikazuje — opozorilo ob ustvarjanju
//    ("shrani si jo takoj") je edina možnost;
//  • testni ping NE laže: prikaže delivered:false + napako, če je bilo tako;
//  • zgodovina dostav je read-only (outbox je revizijska sled).

import { useState } from 'react'
import {
  Ban, ChevronDown, ChevronRight, History, KeyRound, Loader2, ListRestart,
  Play, Plus, RotateCcw, Webhook,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiDelete, apiPatch, apiPost, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { notificationEventLabel } from '@/lib/notify-events'

// ── Tipi (odgovori rut — glej docs/webhooks.md §8) ──────────────────────────

interface SubRow {
  id: string
  url: string
  events: string[]
  active: boolean
  description: string | null
  createdAt: string
  revokedAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  deliveries: { total: number; sent: number; failed: number; dead: number; pending: number }
}

interface DeliveryRow {
  id: string
  subscriptionId: string
  eventKey: string
  eventType: string
  status: string
  attempts: number
  lastAttemptAt: string | null
  responseStatus: number | null
  nextAttemptAt: string | null
  deliveredAt: string | null
  error: string | null
  createdAt: string
}

interface PingResult { delivered: boolean; responseStatus: number | null; error?: string }

// ── Hitri predizbori dogodkov (proizvodnja / ponudbe) ───────────────────────

const PRESET_PRODUCTION = ['CAPTURE_PROCESSED', 'MODEL_CHANGED', 'MEASUREMENT_CONFIRMED', 'PRODUCTION_READY', 'ORDER_CONFIRMED']
const PRESET_QUOTES = ['SURVEY_NEW', 'VIZ_CHOICE', 'QUOTE_SIGNED', 'PROJECT_STATUS', 'PAYMENT_RECEIVED']

/** Skrajšan URL za prikaz (celoten v title/aria). */
function shortUrl (url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.length > 1 ? u.pathname : ''
    return `${u.host}${path}`
  } catch {
    return url
  }
}

/** Oznaka stanja naročnine. */
function SubStateBadge ({ sub }: { sub: SubRow }) {
  if (sub.revokedAt) return <Badge variant="secondary">preklicana</Badge>
  if (sub.active) return <Badge className="border-transparent bg-emerald-700 text-white">aktivna</Badge>
  return <Badge className="border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300">pavzirana</Badge>
}

/** Števci dostav (badge-i: poslano/spodletelo/mrtvo/čaka). */
function DeliveryCounters ({ d }: { d: SubRow['deliveries'] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" title="Uspešno dostavljenih dogodkov">✓ {d.sent}</Badge>
      {d.failed > 0
        ? <Badge className="border-transparent bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" title="Spodletelih (čakajo ponovitev)">✗ {d.failed}</Badge>
        : null}
      {d.dead > 0
        ? <Badge className="border-transparent bg-red-700 text-white" title="Mrtvo pismo — 5 poskusov je spodletelo">☠ {d.dead}</Badge>
        : null}
      {d.pending > 0
        ? <Badge className="border-transparent bg-secondary text-secondary-foreground" title="Čaka prvi poskus">· {d.pending}</Badge>
        : null}
      {d.total === 0 ? <span className="text-[11px] text-muted-foreground">ni dostav</span> : null}
    </span>
  )
}

/** Oznaka statusa dostave (outbox). */
function DeliveryStatusBadge ({ status }: { status: string }) {
  if (status === 'SENT') return <Badge className="border-transparent bg-emerald-700 text-white">poslano</Badge>
  if (status === 'FAILED') return <Badge className="border-transparent bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">spodletelo</Badge>
  if (status === 'DEAD') return <Badge className="border-transparent bg-red-700 text-white">mrtvo pismo</Badge>
  return <Badge className="border-transparent bg-roksal-amber text-roksal-ink">čaka</Badge>
}

// ── Modul ────────────────────────────────────────────────────────────────────

export default function IntegracijeModule () {
  const user = useAppStore((s) => s.user)
  const canManage = hasPerm(user?.perms, 'integrations.manage')
  const { toast } = useToast()

  const subs = useApi<{ data: SubRow[]; events: string[] }>(canManage ? '/api/webhooks' : null, [canManage])

  // ── ročna ponovitev dostav (POST /api/webhooks/retry) ────────────────────
  const [retrying, setRetrying] = useState(false)
  const [retryResult, setRetryResult] = useState<{ processed: number; sent: number; failed: number; dead: number } | null>(null)

  async function retryDeliveries (): Promise<void> {
    setRetrying(true)
    try {
      const res = await apiPost<{ data: { processed: number; sent: number; failed: number; dead: number } }>('/api/webhooks/retry')
      setRetryResult(res.data)
      toast({
        title: 'Ponovitev dostav zaključena.',
        description: `Obdelane: ${res.data.processed} · poslane: ${res.data.sent} · spodletele: ${res.data.failed} · mrtve: ${res.data.dead}.`,
      })
      await subs.reload()
    } catch (e) {
      toast({ title: 'Ponovitev ni uspela.', description: e instanceof Error ? e.message : 'Neznana napaka.', variant: 'destructive' })
    } finally {
      setRetrying(false)
    }
  }

  if (!canManage) {
    return (
      <div className="space-y-4">
        <PageHeader title="Integracije" desc="Webhook naročnine za partnerje (issue #9 §9)." />
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          Upravljanje integracij zahteva pravico integrations.manage (pisarna — ADMIN/VODJA).
        </p>
      </div>
    )
  }

  const rows = subs.data?.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Integracije — webhook naročnine"
        desc="Poslovno-dogodkovni izhod za partnerje (issue #9 §9): ob pomembnih prehodih ROKSAL POST-a podpisan JSON na HTTPS naslov partnerja."
        actions={
          <>
            <Button
              size="sm" variant="outline" className="gap-1.5" onClick={() => void retryDeliveries()} disabled={retrying}
              title="Ponovi zaravnane dostave (PENDING/FAILED z potekom nextAttemptAt)"
            >
              {retrying ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ListRestart className="size-3.5" aria-hidden />}
              {retrying ? 'Ponavljam…' : 'Ponovi dostave'}
            </Button>
            <HelpButton />
          </>
        }
      />

      {/* zadnji izid ročne ponovitve */}
      {retryResult ? (
        <p className="rounded-lg border bg-secondary/50 p-2 text-xs text-muted-foreground">
          Zadnja ponovitev: obdelane <strong>{retryResult.processed}</strong> · poslane <strong className="text-emerald-700 dark:text-emerald-400">{retryResult.sent}</strong> · spodletele <strong className="text-red-700 dark:text-red-400">{retryResult.failed}</strong> · mrtve <strong className="text-red-700 dark:text-red-400">{retryResult.dead}</strong>.
        </p>
      ) : null}

      <NewSubscriptionCard events={subs.data?.events ?? []} onCreated={() => void subs.reload()} />

      <ErrorBox error={subs.error} />
      {/* nalaganje SAMO ob prvem prikazu — ob osvežitvi (ping/pavza/preklic) kartice
          ostanejo prikazane, da se stanja (rezultat pinga) NE izgubijo z odmoniranjem */}
      {subs.loading && rows.length === 0 ? <LoadingRows rows={3} /> : !subs.error && rows.length === 0 ? (
        <EmptyState
          title="Ni webhook naročnin"
          desc="Ustvarite prvo naročnino zgoraj — partnerju bomo ob poslušanih dogodkih dostavili podpisan JSON."
          icon={Webhook}
        />
      ) : !subs.error ? (
        <ul className="space-y-2">
          {rows.map((sub) => (
            <li key={sub.id}>
              <SubscriptionCard sub={sub} onChanged={() => void subs.reload()} />
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Celotna dokumentacija za partnerje (glave, podpis, backoff, idempotenca, katalog dogodkov):
        <code className="mx-1 rounded bg-secondary px-1 py-0.5 font-mono text-[10px]">docs/webhooks.md</code>
        v repozitoriju. Retry zamuda: cron teče dnevno ob 03:30 — prvi poskus vsake dostave je vedno takojšen.
      </p>
    </div>
  )
}

// ── Pomoč (bistvo podpisa — brez skoka na /docs, ki ga app nima) ────────────

function HelpButton () {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <KeyRound className="size-3.5" aria-hidden /> Kako se preveri podpis
      </Button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center"
          role="dialog" aria-modal="true" aria-label="Preverjanje podpisa webhook dostave"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-card p-4 text-sm shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center gap-1.5 font-semibold"><Webhook className="size-4 text-roksal-amber" aria-hidden /> Preverjanje podpisa dostave</div>
            <p className="text-xs text-muted-foreground">Vsaka dostava nosi glavi <code className="rounded bg-secondary px-1 font-mono text-[10px]">X-ROKSAL-Timestamp</code> (epoch s) in <code className="rounded bg-secondary px-1 font-mono text-[10px]">X-ROKSAL-Signature</code>. Podpisano sporočilo je »timestamp.dobesedno telo«:</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-secondary/60 p-2 font-mono text-[11px] leading-relaxed" aria-label="Formula podpisa">{`key      = sha256_hex(secret)   # skrivnost, ki si jo izbere partner
expected = HMAC-SHA256(key, timestamp + "." + rawBody)
veljavno ⇔ X-ROKSAL-Signature === "sha256=" + expected`}</pre>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Preverjajte nad dobesednim telesom (bytes po žici) in zavrzite dogodke, starejše od 5 minut (replay okno) ter že viden <code className="rounded bg-secondary px-1 font-mono text-[10px]">id</code> (idempotenčni ključ dogodka).
              Celoten priklad v Pythonu/Node: <code className="rounded bg-secondary px-1 font-mono text-[10px]">docs/webhooks.md</code> v repozitoriju.
            </p>
            <Button size="sm" className="mt-3 w-full" onClick={() => setOpen(false)}>Zapri</Button>
          </div>
        </div>
      ) : null}
    </>
  )
}

// ── Nova naročnina ──────────────────────────────────────────────────────────

function NewSubscriptionCard ({ events, onCreated }: { events: string[]; onCreated: () => void }) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [description, setDescription] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  function toggleEvent (t: string, on: boolean): void {
    setPicked((p) => on ? [...new Set([...p, t])] : p.filter((x) => x !== t))
  }

  function applyPreset (preset: string[]): void {
    setPicked((p) => [...new Set([...p, ...preset])])
  }

  async function create (): Promise<void> {
    if (!picked.length) {
      toast({ title: 'Izberite vsaj en dogodek.', variant: 'destructive' })
      return
    }
    if (secret.length < 16 || secret.length > 200) {
      toast({ title: 'Neveljavna skrivnost.', description: '16–200 znakov — partner si jo izbere sam.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await apiPost<{ data: { id: string; secretInfo: string } }>('/api/webhooks', {
        url: url.trim(), events: picked, secret, description: description.trim() || undefined,
      })
      toast({
        title: 'Naročnina ustvarjena.',
        description: `${res.data.secretInfo} · dogodki: ${picked.length}.`,
      })
      setUrl(''); setSecret(''); setDescription(''); setPicked([])
      setOpen(false)
      onCreated()
    } catch (e) {
      toast({ title: 'Ustvarjanje ni uspelo.', description: e instanceof Error ? e.message : 'Neznana napaka.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer transition hover:bg-secondary/40">
            <CardTitle className="flex items-center gap-2 text-base">
              {open ? <ChevronDown className="size-4 text-roksal-amber" aria-hidden /> : <ChevronRight className="size-4 text-roksal-amber" aria-hidden />}
              <Plus className="size-4 text-roksal-amber" aria-hidden /> Nova naročnina
            </CardTitle>
            <CardDescription>URL (https) · izbor dogodkov · skrivnost partnerja · opomba. Naročnina začne dostavljati takoj (aktivna).</CardDescription>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="wh-url">Ciljni URL (https)</Label>
                <Input
                  id="wh-url" value={url} onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://partner.si/hooks/roksal" className="font-mono text-xs"
                  aria-label="Ciljni URL webhook naročnine (https)"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="wh-desc">Opomba (interna, ≤ 200)</Label>
                <Input
                  id="wh-desc" value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder="npr. ERP sinhronizacija" maxLength={200}
                  aria-label="Opomba naročnine"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Label>Skrivnost (16–200 znakov)</Label>
                <Badge variant="outline" className="gap-1 font-mono text-[10px]"><KeyRound className="size-3" aria-hidden /> nikoli več prikazana</Badge>
              </div>
              <Input
                value={secret} onChange={(e) => setSecret(e.target.value)}
                placeholder="moja-skrivnost-16+znakov" className="font-mono text-xs"
                aria-label="Skrivnost naročnine (izbere si jo partner)"
                autoComplete="off"
              />
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Skrivnost si izbere partner. ROKSAL shrani SAMO njen SHA-256 has — skrivnost se ne vrne, ne prikaže več in je ni mogoče obnoviti.
                <strong> Shrani si jo TAKOJ</strong> (npr. v upravitelja gesel) — sicer podpisa ne bo mogoče preveriti.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Label>Dogodki ({picked.length}/{events.length})</Label>
                <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => applyPreset(PRESET_PRODUCTION)}>
                  Vsi proizvodnji
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => applyPreset(PRESET_QUOTES)}>
                  Vse ponudbe
                </Button>
                {picked.length > 0 ? (
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setPicked([])}>
                    Počisti
                  </Button>
                ) : null}
              </div>
              {events.length === 0 ? (
                <p className="text-xs text-muted-foreground">Katalog se nalaga …</p>
              ) : (
                <div className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2" style={{ scrollbarWidth: 'thin' }}>
                  {events.map((t) => (
                    <label key={t} className="flex min-w-0 items-center gap-2 rounded p-1 text-xs hover:bg-secondary/50">
                      <Checkbox checked={picked.includes(t)} onCheckedChange={(v) => toggleEvent(t, v === true)} aria-label={`Dogodek ${notificationEventLabel(t)}`} />
                      <span className="min-w-0 truncate">{notificationEventLabel(t)}</span>
                      <code className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground/70">{t}</code>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button size="sm" onClick={() => void create()} disabled={busy || !url.trim() || !secret || picked.length === 0}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
                {busy ? 'Ustvarjam…' : 'Ustvari naročnino'}
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}

// ── Naročnina (kartica + dejanja + zgodovina dostav) ────────────────────────

function SubscriptionCard ({ sub, onChanged }: { sub: SubRow; onChanged: () => void }) {
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [ping, setPing] = useState<PingResult | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  async function run (kind: string, fn: () => Promise<void>): Promise<void> {
    setBusy(kind)
    try {
      await fn()
    } catch (e) {
      toast({ title: 'Dejanje ni uspelo.', description: e instanceof Error ? e.message : 'Neznana napaka.', variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  async function testPing (): Promise<void> {
    setPing(null)
    const res = await apiPost<{ data: PingResult }>(`/api/webhooks/${sub.id}/test`)
    setPing(res.data) // pošteno: delivered:false se pokaže z napako
    onChanged()
  }

  async function setActive (active: boolean): Promise<void> {
    await apiPatch(`/api/webhooks/${sub.id}`, { active })
    toast({ title: active ? 'Naročnina ponovno omogočena.' : 'Naročnina pavzirana.', description: active ? 'Dogodke spet dostavlja.' : 'Dostavljanje je ustavljeno (dokler je pavzirana).' })
    onChanged()
  }

  async function revoke (): Promise<void> {
    if (!window.confirm(`Prekličem naročnino na ${shortUrl(sub.url)}? Zgodovina dostav ostane; preklica NI mogoče razveljaviti.`)) return
    await apiDelete(`/api/webhooks/${sub.id}`)
    toast({ title: 'Naročnina preklicana.', description: 'Novih dogodkov ne prejema; čakajoče dostave postanejo mrtvo pismo.' })
    onChanged()
  }

  const revoked = sub.revokedAt != null

  return (
    <Card>
      <CardContent className="space-y-2 p-3 sm:p-4">
        {/* glava: URL + stanje */}
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 max-w-full truncate font-mono text-xs font-medium" title={sub.url}>{shortUrl(sub.url)}</code>
          <SubStateBadge sub={sub} />
          <span className="ml-auto text-[11px] text-muted-foreground">ustvarjena {fmtDateTime(sub.createdAt)}</span>
        </div>

        {/* dogodki (čipi) */}
        <div className="flex flex-wrap gap-1">
          {sub.events.map((t) => (
            <Badge key={t} variant="outline" className="max-w-full truncate font-mono text-[10px]" title={t}>{notificationEventLabel(t)}</Badge>
          ))}
        </div>

        {/* števci dostav + zadnji uspeh/neuspeh */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <DeliveryCounters d={sub.deliveries} />
          <span className="text-[11px] text-muted-foreground">
            {sub.lastSuccessAt ? <span className="mr-2" title="Zadnja uspešna dostava">✓ {fmtDateTime(sub.lastSuccessAt)}</span> : null}
            {sub.lastFailureAt ? <span className="text-red-700 dark:text-red-400" title="Zadnja spodletela dostava">✗ {fmtDateTime(sub.lastFailureAt)}</span> : null}
            {!sub.lastSuccessAt && !sub.lastFailureAt ? 'še ni dostav' : null}
          </span>
        </div>

        {sub.description ? <p className="text-xs text-muted-foreground" title={sub.description}>{sub.description}</p> : null}

        {/* rezultat testnega pinga (pošteno — tudi napaka) */}
        {ping ? (
          <div className="rounded-lg border p-2 text-xs">
            {ping.delivered ? (
              <p className="text-emerald-700 dark:text-emerald-400"><strong>Testni ping uspel.</strong> Odgovor partnerja: HTTP {ping.responseStatus ?? '—'}.</p>
            ) : (
              <p className="text-red-700 dark:text-red-400"><strong>Testni ping NI uspel.</strong> {ping.error ?? (ping.responseStatus != null ? `HTTP ${ping.responseStatus}` : 'brez podrobnosti')}</p>
            )}
            <p className="mt-0.5 text-[11px] text-muted-foreground">Vsak ping je sveža vrstica v zgodovini dostav (WEBHOOK_TEST) — preverite tudi podpis na sprejemniku.</p>
          </div>
        ) : null}

        {/* dejanja */}
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs"
            disabled={revoked || !sub.active || busy !== null}
            onClick={() => { setPing(null); void run('ping', testPing) }}
            title="Pošlje enkraten WEBHOOK_TEST dogodev z enakim podpisom kot prava dostava (10/min)"
          >
            {busy === 'ping' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />} Testni ping
          </Button>
          {!revoked && sub.active ? (
            <Button
              size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs"
              disabled={busy !== null} onClick={() => void run('pause', () => setActive(false))}
            >
              <Ban className="size-3.5" aria-hidden /> Pavziraj
            </Button>
          ) : null}
          {!revoked && !sub.active ? (
            <Button
              size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs"
              disabled={busy !== null} onClick={() => void run('resume', () => setActive(true))}
            >
              <RotateCcw className="size-3.5" aria-hidden /> Ponovno omogoči
            </Button>
          ) : null}
          {!revoked ? (
            <Button
              size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
              disabled={busy !== null} onClick={() => void run('revoke', revoke)}
            >
              Prekliči
            </Button>
          ) : null}
        </div>

        {/* zgodovina dostav (razširljivo) */}
        <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
          <CollapsibleTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs">
              {historyOpen ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
              <History className="size-3.5" aria-hidden /> Zgodovina dostav
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="pt-2">
              <DeliveriesPanel subscriptionId={sub.id} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  )
}

// ── Zgodovina dostav ene naročnine (GET /api/webhooks/deliveries) ───────────

const DELIVERY_LIMIT_STEP = 20
const DELIVERY_LIMIT_MAX = 100

function DeliveriesPanel ({ subscriptionId }: { subscriptionId: string }) {
  const [status, setStatus] = useState('all')
  const [limit, setLimit] = useState(DELIVERY_LIMIT_STEP)
  const path = `/api/webhooks/deliveries?subscriptionId=${subscriptionId}&limit=${limit}${status !== 'all' ? `&status=${status}` : ''}`
  const log = useApi<{ data: DeliveryRow[] }>(path, [path])

  const rows = log.data?.data ?? []

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-7 w-40 text-xs" aria-label="Filter statusa dostave"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vsi statusi</SelectItem>
            <SelectItem value="SENT">Poslano</SelectItem>
            <SelectItem value="FAILED">Spodletelo</SelectItem>
            <SelectItem value="PENDING">Čaka</SelectItem>
            <SelectItem value="DEAD">Mrtvo pismo</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-[11px] text-muted-foreground">najnovejših {rows.length}</span>
      </div>

      <ErrorBox error={log.error} />
      {log.loading ? <LoadingRows rows={2} /> : !log.error && rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          Ni dostav (za izbrane pogoje) — naročnina še ni poslušala dogodka ali zgodovina čaka na prvi testni ping.
        </p>
      ) : !log.error ? (
        <div className="max-h-96 overflow-y-auto rounded-lg border" style={{ scrollbarWidth: 'thin' }}>
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead className="h-9 text-[11px]">Dogodek</TableHead>
                <TableHead className="h-9 text-[11px]">Status</TableHead>
                <TableHead className="h-9 text-[11px] text-right">Poskusi</TableHead>
                <TableHead className="h-9 text-[11px] text-right">Odgovor</TableHead>
                <TableHead className="h-9 text-[11px]">Naslednji poskus</TableHead>
                <TableHead className="h-9 text-[11px] text-right">Čas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="max-w-40 p-2 text-xs">
                    <span className="font-medium">{notificationEventLabel(d.eventType)}</span>
                    <code className="block truncate font-mono text-[9px] text-muted-foreground/70" title={d.eventKey}>{d.eventKey}</code>
                    {d.error ? <span className="block text-[10px] text-red-700 dark:text-red-400" title={d.error}>{d.error}</span> : null}
                  </TableCell>
                  <TableCell className="p-2"><DeliveryStatusBadge status={d.status} /></TableCell>
                  <TableCell className="p-2 text-right text-xs tabular-nums">{d.attempts}</TableCell>
                  <TableCell className="p-2 text-right font-mono text-[11px]">{d.responseStatus ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap p-2 text-[11px] text-muted-foreground">
                    {d.status === 'DEAD' ? '—' : d.nextAttemptAt ? fmtDateTime(d.nextAttemptAt) : 'takoj'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap p-2 text-right text-[11px] text-muted-foreground">
                    {fmtDateTime(d.deliveredAt ?? d.lastAttemptAt ?? d.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {rows.length >= limit && limit < DELIVERY_LIMIT_MAX ? (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setLimit((l) => Math.min(l + DELIVERY_LIMIT_STEP, DELIVERY_LIMIT_MAX))}>
          Prikaži več (do {DELIVERY_LIMIT_MAX})
        </Button>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        Backoff ponovitev: 1 → 5 → 30 → 30 min; po 5. poskusu je vrstica mrtvo pismo (DEAD). Ponovitve poganja job webhook-retry (dnevno 03:30) ali gumb »Ponovi dostave« zgoraj.
      </p>
    </div>
  )
}
