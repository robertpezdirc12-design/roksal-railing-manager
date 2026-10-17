'use client'

// PREGLED — javna delitev: javne povezave pregleda + GDPR soglasje za fotografije
// + predogled javnega pogleda (natanko to, kar vidi stranka).
// R546: izvlečeno iz pregled.tsx BREZ spremembe obnašanja; skupni tipi in
// konstante so v pregled-shared.ts, javni tloris v pregled-views.tsx.

import { useState } from 'react'
import { Copy, Eye, Link2, Lock, Plus, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiDelete, apiPost, fmtDate, useApi } from '@/lib/api-client'
import { ErrorBox, LoadingRows } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { PIN_TONE, type PinMarker, type ReviewLinkRow } from './pregled-shared'
import type { PlanModel } from '@/lib/model-core'
import { PublicPlanView } from './pregled-views'

// ─── Javna delitev + GDPR soglasje ───────────────────────────────────────────

interface PublicReviewData {
  run: { name: string; status: string }
  project: { code: string; title: string; customerName: string | null } | null
  model: PlanModel
  photos: { id: string; zoneLabel: string; atCm: number | null; thumb: string | null; capturedAt: string }[]
  photosBlocked: string | null
  pins: { id: string; targetKey: string; targetType: string; note: string; status: string; x: number | null; y: number | null; authorName: string | null; createdAt: string }[]
  consent: string
  link: { expiresAt: string }
}

export function ShareCard ({
  runId, projectId, projectCode, consent, onConsentChange,
}: {
  runId: string
  projectId: string
  projectCode: string
  consent: { status: 'MANJKA' | 'VELJAVNO' | 'POTEKLO'; photosBlocked: string | null }
  onConsentChange: () => void
}) {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const canLinks = hasPerm(user?.perms, 'portal.manage')
  const canConsent = hasPerm(user?.perms, 'customers.write')

  const links = useApi<{ data: ReviewLinkRow[] }>(canLinks && runId ? `/api/fence-run/${runId}/review-link` : null, [runId, canLinks])
  const [days, setDays] = useState('14')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)

  const rows = links.data?.data ?? []
  const activeCount = rows.filter((l) => l.active).length

  async function setConsent (action: 'SET' | 'CLEAR', validDays?: number): Promise<void> {
    setBusy(true)
    try {
      await apiPost(`/api/projects/${projectId}/consent`, { action, ...(action === 'SET' && validDays != null ? { validDays } : {}) })
      toast({
        title: action === 'SET' ? 'Soglasje za fotografije zapisano.' : 'Soglasje umaknjeno.',
        description: action === 'SET'
          ? 'Fotografije bodo javno vidne (portal, javna povezava pregleda).'
          : 'Fotografije javnih povezav so takoj zamaknjene.',
      })
      onConsentChange()
    } catch (e) {
      toast({ title: 'Sprememba soglasja ni uspela.', description: e instanceof Error ? e.message : 'Neznana napaka.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function createLink (): Promise<void> {
    const d = Math.trunc(Number(days))
    if (!Number.isFinite(d) || d < 1 || d > 90) {
      toast({ title: 'Neveljaven rok.', description: 'Dovoljenih je 1–90 dni.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await apiPost<{ data: ReviewLinkRow }>(`/api/fence-run/${runId}/review-link`, { days: d, note: note.trim() || undefined })
      toast({
        title: 'Javna povezava ustvarjena.',
        description: `Velja ${d} dni — kopirajte URL in ga pošljite stranki.`,
      })
      setNote('')
      await links.reload()
      // samodejno ponudi kopiranje sveže povezave
      void copyUrl(res.data.url)
    } catch (e) {
      toast({ title: 'Ustvarjanje povezave ni uspelo.', description: e instanceof Error ? e.message : 'Neznana napaka.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function copyUrl (relUrl: string): Promise<void> {
    const url = `${location.origin}${relUrl}`
    try {
      await navigator.clipboard.writeText(url)
      toast({ title: 'URL kopiran.', description: 'Javni pogled brez prijave — brez internih opomb.' })
    } catch {
      toast({ title: 'Kopiranje ni uspelo.', description: url, variant: 'destructive' })
    }
  }

  async function revoke (id: string): Promise<void> {
    setBusy(true)
    try {
      await apiDelete(`/api/fence-run/${runId}/review-link?id=${id}`)
      toast({ title: 'Povezava preklicana.', description: 'Javni dostop takoj preneha (404).' })
      await links.reload()
    } catch (e) {
      toast({ title: 'Preklic ni uspel.', description: e instanceof Error ? e.message : 'Neznana napaka.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const consentBadge = consent.status === 'VELJAVNO'
    ? <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">soglasje veljavno</Badge>
    : consent.status === 'POTEKLO'
      ? <Badge className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">soglasje poteklo</Badge>
      : <Badge className="border-transparent bg-muted text-muted-foreground">soglasje manjka</Badge>

  return (
    <Card>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-medium"><Link2 className="size-4 text-roksal-amber" aria-hidden /> Javna delitev pregleda</div>
          {consentBadge}
        </div>

        {/* GDPR opozorilo pred izdajo povezave */}
        {consent.status !== 'VELJAVNO' && (
          <div className="space-y-1.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200" role="alert">
            <span className="inline-flex items-center gap-1.5 font-medium"><ShieldCheck className="size-3.5" aria-hidden /> Fotografije ne bodo javno vidne brez soglasja.</span>
            {' '}Javna povezava bo pokazala model in pripombe, fotografije pa ostanejo zamaknjene, dokler stranka ne da soglasja za objavo.
            {canConsent && (
              <Button size="sm" variant="outline" className="mt-1.5 h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => void setConsent('SET', 365)}>
                <ShieldCheck className="size-3.5" aria-hidden /> Zapiši soglasje (1 leto)
              </Button>
            )}
          </div>
        )}

        {canLinks ? (
          <>
            <div className="grid gap-2 sm:grid-cols-[100px_1fr]">
              <div className="space-y-1">
                <Label htmlFor="rl-days">Rok (dni)</Label>
                <Input id="rl-days" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Veljavnost povezave v dnevih" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rl-note">Opomba (interna)</Label>
                <Input id="rl-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="npr. poslano na e-pošto" maxLength={200} />
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => void createLink()} disabled={busy}>
              <Plus className="size-4" aria-hidden /> Ustvari povezavo (1–90 dni)
            </Button>

            <ErrorBox error={links.error} />
            {links.loading ? <LoadingRows rows={1} /> : !links.error && rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Ni še javnih povezav tega tekača.</p>
            ) : !links.error ? (
              <ul className="space-y-1.5">
                {rows.map((l) => (
                  <li key={l.id} className="rounded-lg border p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">…{l.token.slice(-10)}</code>
                      {l.active ? (
                        <Badge className="border-transparent bg-emerald-700 text-white">velja</Badge>
                      ) : (
                        <Badge variant="secondary">{l.revokedAt ? 'preklicana' : 'potekla'}</Badge>
                      )}
                      <span className="ml-auto inline-flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Eye className="size-3" aria-hidden />{l.viewCount}</span>
                        <span>do {fmtDate(l.expiresAt)}</span>
                      </span>
                    </div>
                    {l.note ? <p className="mt-1 truncate text-xs text-muted-foreground">{l.note}</p> : null}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => setPreview(l.token)} disabled={!l.active}>
                        <Eye className="size-3.5" aria-hidden /> Predogled
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => void copyUrl(l.url)}>
                        <Copy className="size-3.5" aria-hidden /> Kopiraj URL
                      </Button>
                      {l.active ? (
                        <Button
                          size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                          disabled={busy} onClick={() => void revoke(l.id)}
                        >
                          Prekliči
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              Javni pogled: model, pripombe (brez internih opomb) in fotografije samo ob veljavnem soglasju. Žeton je omejen, preklicljiv, s tempomatom.
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Upravljanje javnih povezav zahteva pravico portal.manage (pisarna).</p>
        )}

        {/* soglasje — polje pisarne */}
        {canConsent && (
          <div className="space-y-1.5 border-t pt-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium"><Lock className="size-3.5 text-muted-foreground" aria-hidden /> Soglasje za fotografije ({projectCode || 'projekt'})</div>
            <p className="text-[11px] text-muted-foreground">
              {consent.status === 'VELJAVNO'
                ? 'Fotografije so javno vidne na portalu in javni povezavi pregleda.'
                : consent.status === 'POTEKLO'
                  ? 'Soglasje je poteklo — javne fotografije so zamaknjene.'
                  : 'Soglasje ni zapisano — javne fotografije so zamaknjene (interno ostanejo vidne).'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => void setConsent('SET')}>
                <ShieldCheck className="size-3.5" aria-hidden /> Zapiši (brez roka)
              </Button>
              <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => void setConsent('SET', 1825)}>
                <ShieldCheck className="size-3.5" aria-hidden /> Zapiši (5 let)
              </Button>
              <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive" disabled={busy || consent.status === 'MANJKA'} onClick={() => void setConsent('CLEAR')}>
                Umakni
              </Button>
            </div>
          </div>
        )}

        {/* predogled javnega pogleda — natanko to, kar vidi stranka */}
        <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null) }}>
          {preview && <PublicPreviewDialog token={preview} code={projectCode} />}
        </Dialog>
      </CardContent>
    </Card>
  )
}

export function PublicPreviewDialog ({ token, code }: { token: string; code: string }) {
  // javni endpoint — enak odgovor kot pri stranki (fetch brez overitve)
  const view = useApi<{ data: PublicReviewData }>(`/api/public/review?token=${token}`, [token])
  const d = view.data?.data
  const m = d?.model

  return (
    <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Predogled javnega pregleda — {code}</DialogTitle>
        <DialogDescription>
          Točno to vidi prejemnik povezave (brez prijave): risba, pripombe brez internih opomb{d?.photosBlocked ? ', fotografije zamaknjene' : ', fotografije ob soglasju'}.
          {d?.link ? ` Povezava velja do ${fmtDate(d.link.expiresAt)}.` : ''}
        </DialogDescription>
      </DialogHeader>
      <ErrorBox error={view.error} />
      {view.loading ? <LoadingRows rows={4} /> : d && m ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{d.run.name}</span>
            <Badge variant="outline">{d.run.status}</Badge>
            {d.project?.customerName ? <span className="text-xs text-muted-foreground">{d.project.customerName}</span> : null}
          </div>
          {/* risba iz javnega modela (brez klikov, brez internih podatkov) */}
          <PublicPlanView m={m} pins={d.pins.map((p) => ({ id: p.id, targetType: p.targetType, x: p.x, y: p.y, targetKey: p.targetKey, status: p.status, note: p.note }))} />
          {d.photosBlocked ? (
            <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
              Fotografije niso javno prikazane — {d.photosBlocked === 'SOGLASJE_POTEKLO' ? 'soglasje je poteklo' : 'manjka soglasje za objavo'}.
            </p>
          ) : d.photos.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {d.photos.map((ph) => (
                ph.thumb ? (
                  <img
                    key={ph.id} src={ph.thumb}
                    alt={`Posnetek — cona ${ph.zoneLabel}`}
                    className="aspect-video w-full rounded-lg border object-cover"
                  />
                ) : null
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Brez fotografij.</p>
          )}
          {d.pins.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pripombe (javno)</div>
              <ul className="space-y-1.5">
                {d.pins.map((p) => {
                  const tone = PIN_TONE[p.status] ?? PIN_TONE.ZAPRT
                  return (
                    <li key={p.id} className="rounded-lg border p-2 text-sm">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className={tone.cls}>{tone.label}</Badge>
                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">{p.targetKey}</code>
                        <span className="ml-auto text-[10px] text-muted-foreground">{p.authorName ?? '—'}</span>
                      </div>
                      <p className="mt-1">{p.note}</p>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Brez pripomb.</p>
          )}
        </div>
      ) : null}
    </DialogContent>
  )
}
