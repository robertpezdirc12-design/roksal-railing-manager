'use client'

// JAVNA POVEZAVA VIZUALIZATORJA + ZGODOVINA IZBOROV STRANKE (R480 — issue #9 §10)
// Pisarniški del foto-viz modula:
//  • ustvarjanje/preklic javne povezave /v/<token> (portal.manage — ADMIN/VODJA);
//  • zgodovina strankinih izborov (projects.read) — časi, varianta, zahteva,
//    kontakt, opomba, vod (lead) — append-only: izbire NI mogoče urejati.
// Seznami so omejeni na max-h-96 + overflow (pravila UI).

import { useState } from 'react'
import { Copy, ExternalLink, Eye, History, Link2, Loader2, Plus, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
// R527 (issue #14 §5): izrecna oznaka generičnih demo izdelkov tudi v javnem pregledu
import { jeGenericniIzdelek } from '@/lib/katalog-original'
import { useAppStore } from '@/lib/store'
import { apiDelete, apiPost, fmtDate, fmtDateTime, useApi } from '@/lib/api-client'
import { ErrorBox, LoadingRows } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { VIZ_REQUEST_TYPE_LABELS, VIZ_LINK_DEFAULT_DAYS, VIZ_LINK_MAX_DAYS, type VizRequestType } from '@/lib/viz-core'

interface VizLinkRow {
  id: string
  token: string
  url: string
  projectId: string
  note: string | null
  viewCount: number
  lastViewAt: string | null
  revokedAt: string | null
  createdAt: string
  expiresAt: string
  active: boolean
}

interface VizChoiceRow {
  id: string
  projectId: string
  visualizationId: string | null
  variantLabel: string
  chosenAt: string
  chosenVia: string
  requestType: string
  note: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  consentAcceptedAt: string
  createdAt: string
  visualization: { id: string; variantLabel: string; status: string; product: { sku: string; name: string } | null; variant: { sku: string; name: string; ral: string | null } | null } | null
  lead: { id: string; name: string; email: string | null; phone: string | null; status: string; source: string } | null
  link: { id: string; revokedAt: string | null; expiresAt: string } | null
}

const rtLabel = (rt: string): string =>
  (VIZ_REQUEST_TYPE_LABELS as Record<string, string>)[rt] ?? rt

/** Obarvana oznaka statusa voda. */
function leadBadge (lead: VizChoiceRow['lead']): React.ReactNode {
  if (!lead) return <span className="text-muted-foreground">—</span>
  return (
    <Badge
      className={
        lead.status === 'PRETVORJEN' ? 'border-transparent bg-emerald-700 text-white'
          : lead.status === 'IZGUBLJEN' ? 'border-transparent bg-muted text-muted-foreground'
            : 'border-transparent bg-amber-100 text-amber-900'
      }
    >
      {lead.status}
    </Badge>
  )
}

export function VizLinksPanel ({ projectId, projectCode }: { projectId: string; projectCode?: string | null }) {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const canLinks = hasPerm(user?.perms, 'portal.manage')

  const links = useApi<{ data: VizLinkRow[] }>(canLinks ? `/api/projects/${projectId}/viz-link` : null, [projectId, canLinks])
  const choices = useApi<{ data: VizChoiceRow[] }>(`/api/projects/${projectId}/viz-choices`, [projectId])
  const [days, setDays] = useState(String(VIZ_LINK_DEFAULT_DAYS))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const linkRows = links.data?.data ?? []
  const choiceRows = choices.data?.data ?? []

  async function createLink (): Promise<void> {
    const d = Math.trunc(Number(days))
    if (!Number.isFinite(d) || d < 1 || d > VIZ_LINK_MAX_DAYS) {
      toast({ title: 'Neveljaven rok.', description: `Dovoljenih je 1–${VIZ_LINK_MAX_DAYS} dni.`, variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await apiPost<{ data: { url: string } }>(`/api/projects/${projectId}/viz-link`, { days: d, note: note.trim() || undefined })
      toast({
        title: 'Javna povezava vizualizatorja ustvarjena.',
        description: `Velja ${d} dni — kopirajte URL in ga pošljite stranki (${projectCode ?? 'projekt'}).`,
      })
      setNote('')
      await links.reload()
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
      toast({ title: 'URL kopiran.', description: 'Javna stran /v/… — stranka se ne prijavlja.' })
    } catch {
      toast({ title: 'Kopiranje ni uspelo.', description: url, variant: 'destructive' })
    }
  }

  async function revoke (id: string): Promise<void> {
    setBusy(true)
    try {
      await apiDelete(`/api/projects/${projectId}/viz-link?id=${id}`)
      toast({ title: 'Povezava preklicana.', description: 'Javni dostop takoj preneha (404).' })
      await links.reload()
    } catch (e) {
      toast({ title: 'Preklic ni uspel.', description: e instanceof Error ? e.message : 'Neznana napaka.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4 text-sm sm:p-6">
        {/* ── Javna povezava (portal.manage) ── */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-medium"><Link2 className="size-4 text-roksal-amber" aria-hidden /> Javna povezava vizualizatorja</div>
          <Badge variant="secondary">/v/&lt;žeton&gt;</Badge>
        </div>

        {canLinks ? (
          <>
            <div className="grid gap-2 sm:grid-cols-[110px_1fr_auto] sm:items-end">
              <div className="space-y-1">
                <Label htmlFor="vl-days">Rok (dni)</Label>
                <Input id="vl-days" type="number" min={1} max={VIZ_LINK_MAX_DAYS} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Veljavnost povezave v dnevih" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="vl-note">Opomba (interna)</Label>
                <Input id="vl-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="npr. poslano na e-pošto" maxLength={200} />
              </div>
              <Button size="sm" className="h-10" onClick={() => void createLink()} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />} Ustvari (1–90 dni)
              </Button>
            </div>

            <ErrorBox error={links.error} />
            {links.loading ? <LoadingRows rows={1} /> : !links.error && linkRows.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">Ta projekt še nima javne povezave vizualizatorja.</p>
            ) : !links.error ? (
              <ul className="max-h-96 space-y-1.5 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                {linkRows.map((l) => (
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
                      <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => { window.open(l.url, '_blank', 'noopener') }} disabled={!l.active}>
                        <ExternalLink className="size-3.5" aria-hidden /> Odpri javno stran
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
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Javna stran pokaže variante A/B/C (PREJ/POTEM) in sprejme izbor stranke — brez internih opomb in cen.
              Fotografije so vidne samo ob veljavnem soglasju stranke (upravlja se v modulu Pregled).
            </p>
          </>
        ) : (
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            Upravljanje javnih povezav zahteva pravico portal.manage (pisarna).
          </p>
        )}

        {/* ── Zgodovina izborov stranke (append-only) ── */}
        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center gap-1.5 font-medium"><History className="size-4 text-roksal-amber" aria-hidden /> Zgodovina izborov stranke</div>
          <ErrorBox error={choices.error} />
          {choices.loading ? <LoadingRows rows={2} /> : !choices.error && choiceRows.length === 0 ? (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              Stranka še ni prijavila izbire prek javne povezave. Izbire se beležijo samodejno (append-only) in jih pisarna ne ureja.
            </p>
          ) : !choices.error ? (
            <div className="max-h-96 overflow-y-auto rounded-lg border" style={{ scrollbarWidth: 'thin' }}>
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead className="h-9 text-[11px]">Čas</TableHead>
                    <TableHead className="h-9 text-[11px]">Varianta</TableHead>
                    <TableHead className="h-9 text-[11px]">Zahteva</TableHead>
                    <TableHead className="h-9 text-[11px]">Kontakt</TableHead>
                    <TableHead className="h-9 text-[11px]">Opomba</TableHead>
                    <TableHead className="h-9 text-[11px]">Vod</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {choiceRows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="whitespace-nowrap p-2 text-[11px] text-muted-foreground">{fmtDateTime(c.chosenAt)}</TableCell>
                      <TableCell className="p-2 text-xs">
                        <span className="font-semibold">Varianta {c.variantLabel}</span>
                        {c.visualization?.product ? (
                          <span className="block max-w-44 truncate text-[11px] text-muted-foreground">
                            {c.visualization.product.name}{jeGenericniIzdelek(c.visualization.product.sku) ? ' (generični)' : ''}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="p-2 text-xs">{rtLabel(c.requestType)}</TableCell>
                      <TableCell className="p-2 text-xs">
                        {c.contactName || c.contactPhone || c.contactEmail ? (
                          <>
                            {c.contactName ? <span className="block font-medium">{c.contactName}</span> : null}
                            {c.contactPhone ? <span className="block text-[11px] text-muted-foreground">{c.contactPhone}</span> : null}
                            {c.contactEmail ? <span className="block max-w-40 truncate text-[11px] text-muted-foreground">{c.contactEmail}</span> : null}
                          </>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">brez kontakta</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-44 p-2 text-[11px] text-muted-foreground">
                        {c.note ? <span className="line-clamp-2">{c.note}</span> : '—'}
                      </TableCell>
                      <TableCell className="p-2 text-xs">
                        {c.lead ? (
                          <span className="flex flex-col gap-0.5">
                            {leadBadge(c.lead)}
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Users className="size-3" aria-hidden />{c.lead.name}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
          {choiceRows.length > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              Zadnji zapis na vrhu = trenutni izbor stranke. Zgodovina je dnevnik (append-only) — izbire se dodajajo s stranko, pisarna jih ne spreminja.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
