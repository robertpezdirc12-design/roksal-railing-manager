'use client'

// PROJEKTI — portal stranke (R435): povezave za javni pogled statusa + predogled.
// R546: izvlečeno iz projekti.tsx BREZ spremembe obnašanja.

import { useState } from 'react'
import { Copy, ExternalLink, Eye, Link2, MapPin, Plus, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { apiDelete, apiPost, fmtDate, useApi } from '@/lib/api-client'
import { ErrorBox, LoadingRows } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

/** Portal stranke (R435) — povezave za javni pogled statusa + predogled. */
interface PortalLinkRow {
  id: string; token: string; note: string | null; views: number
  lastViewedAt: string | null; createdAt: string; expiresAt: string; revokedAt: string | null; active: boolean
}

export function PortalSection ({ projectId, projectCode }: { projectId: string; projectCode: string }) {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  // R496: seznam žetonov portala je pod portal.manage (strežnik vrata tudi
  // preverja) — odjemalec jih ne sme nabračati z vlogami brez te pravice.
  const canManage = hasPerm(user?.perms, 'portal.manage')
  const links = useApi<{ data: PortalLinkRow[] }>(canManage ? `/api/portal?projectId=${projectId}` : null, [projectId, canManage])
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canWrite = hasPerm(user?.perms, 'projects.write')
  const rows = links.data?.data ?? []
  const activeCount = rows.filter((l) => l.active).length

  async function createLink () {
    setBusy(true)
    try {
      await apiPost('/api/portal', { projectId, days: 90 })
      toast({ title: 'Povezava ustvarjena.', description: 'Velja 90 dni — kopirajte jo stranki.' })
      await links.reload()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  async function revoke (id: string) {
    setBusy(true)
    try {
      await apiDelete(`/api/portal/${id}`)
      toast({ title: 'Povezava preklicana.', description: 'Javni dostop takoj preneha.' })
      await links.reload()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  async function copyUrl (token: string) {
    const url = `${location.origin}/api/public/portal?token=${token}`
    try {
      await navigator.clipboard.writeText(url)
      toast({ title: 'URL kopiran.', description: 'Varni javni pogled — brez internih podatkov.' })
    } catch {
      toast({ title: 'Kopiranje ni uspelo.', description: url, variant: 'destructive' })
    }
  }

  if (!canManage) return null

  return (
    <section aria-label="Portal stranke">
      <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Portal stranke</h3>
      <ErrorBox error={links.error} />
      {links.loading ? <LoadingRows rows={1} /> : !links.error ? (
        <div className="space-y-2 rounded-xl border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="inline-flex items-center gap-2 text-sm">
              <Link2 className="size-4 text-roksal-amber" aria-hidden />
              {activeCount > 0 ? `${activeCount} aktivna povezava` : 'Ni aktivnih povezav'}
              <span className="text-xs text-muted-foreground">— stranka vidi status, montažo in garancijo</span>
            </p>
            {canWrite ? (
              <Button size="sm" variant="outline" onClick={() => void createLink()} disabled={busy}>
                <Plus className="size-4" aria-hidden /> Nova povezava
              </Button>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {canWrite ? 'Ustvarite povezavo in jo pošljite stranki (e-pošta/SMS).' : 'Upravljanje zahteva pravico projects.write.'}
            </p>
          ) : (
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
                      <span className="inline-flex items-center gap-1"><Eye className="size-3" aria-hidden />{l.views}</span>
                      <span>do {fmtDate(l.expiresAt)}</span>
                    </span>
                  </div>
                  {l.note ? <p className="mt-1 truncate text-xs text-muted-foreground">{l.note}</p> : null}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => setPreview(l.token)} disabled={!l.active}>
                      <ExternalLink className="size-3.5" aria-hidden /> Predogled
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => void copyUrl(l.token)}>
                      <Copy className="size-3.5" aria-hidden /> Kopiraj URL
                    </Button>
                    {canWrite && l.active ? (
                      <Button
                        size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => void revoke(l.id)} disabled={busy}
                      >
                        Prekliči
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* predogled javnega pogleda — natanko to, kar vidi stranka */}
      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null) }}>
        <PortalPreviewDialog token={preview} code={projectCode} />
      </Dialog>
    </section>
  )
}

interface PortalPublicData {
  project: { code: string; title: string; statusLabel: string; address: string | null }
  customer: { name: string | null }
  timeline: { at: string; type: string; label: string }[]
  warranty: { endsAt: string; valid: boolean } | null
  photos: { location: string; photo: string; at: string }[]
  company: { name: string; phone: string; email: string; web: string }
  link: { expiresAt: string }
}

const PORTAL_TYPE_ICON: Record<string, string> = {
  ODPERTJE: '📂', PODPIS: '✍️', MONTAZA: '🔧', ZAKLJUCEK: '✅',
}

function PortalPreviewDialog ({ token, code }: { token: string | null; code: string }) { // R546: lokalen gradnik portala
  // javni endpoint — enak odgovor kot pri stranki (fetch brez avtorizacije je pravilen)
  const view = useApi<{ data: PortalPublicData }>(token ? `/api/public/portal?token=${token}` : null, [token])
  const d = view.data?.data

  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Predogled portala — {code}</DialogTitle>
        <DialogDescription>Javni pogled, ki ga vidi stranka (brez zneskov in internih podatkov).</DialogDescription>
      </DialogHeader>
      <ErrorBox error={view.error} />
      {view.loading ? <LoadingRows rows={4} /> : d ? (
        <div className="space-y-4">
          <div className="rounded-xl bg-gradient-to-br from-[#1d2b3e] to-[#2a3f5f] p-4 text-primary-foreground">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs opacity-80">{d.project.code}</span>
              <span className="rounded-full bg-roksal-amber px-2 py-0.5 text-[11px] font-bold text-roksal-ink">{d.project.statusLabel}</span>
            </div>
            <h4 className="mt-1.5 text-lg font-bold leading-snug">{d.project.title}</h4>
            {d.project.address ? <p className="mt-0.5 inline-flex items-center gap-1 text-xs opacity-90"><MapPin className="size-3" aria-hidden />{d.project.address}</p> : null}
            {d.customer.name ? <p className="mt-0.5 text-xs opacity-75">{d.customer.name}</p> : null}
          </div>

          <section aria-label="Zgodovina za stranko">
            <h5 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Potek dela</h5>
            <ol className="relative space-y-2 border-l pl-5">
              {d.timeline.map((e, i) => (
                <li key={`${e.at}-${i}`} className="relative">
                  <span className="absolute -left-[23px] top-1 size-2.5 rounded-full bg-roksal-amber" aria-hidden />
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span>{PORTAL_TYPE_ICON[e.type] ?? '•'} {e.label}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{fmtDate(e.at)}</span>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {d.warranty ? (
            <section aria-label="Garancija za stranko" className="rounded-lg border p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className={cn('size-4', d.warranty.valid ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')} aria-hidden />
                {d.warranty.valid ? 'Garancija velja' : 'Garancija je potekla'}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">Veljavnost do {fmtDate(d.warranty.endsAt)}.</p>
            </section>
          ) : null}

          {d.photos.length > 0 ? (
            <section aria-label="Fotografije del">
              <h5 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Zaključena dela</h5>
              <ul className="grid grid-cols-2 gap-2">
                {d.photos.map((p, i) => (
                  <li key={`${p.at}-${i}`} className="overflow-hidden rounded-lg border">
                    {/* stranki namenjena demonstracijska slika zaključenega dela (SVG) */}
                    <img src={p.photo} alt={p.location} className="aspect-video w-full object-cover" />
                    <p className="truncate px-2 py-1 text-[11px] text-muted-foreground">{p.location}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <footer className="rounded-lg bg-secondary/60 p-3 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{d.company.name}</span> · {d.company.phone} · {d.company.email} · {d.company.web}
            <p className="mt-1 text-[10px] opacity-70">Povezava velja do {fmtDate(d.link.expiresAt)}.</p>
          </footer>
        </div>
      ) : null}
    </DialogContent>
  )
}
