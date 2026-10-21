'use client'

// GALERIJA — zaključena in arhivirana dela s terenskimi fotografijami (gallery.read)
// FOTO meritve na projektih ZAKLJUCEN/ARHIV; filter po projektu; lightbox s podatki.

import { useState } from 'react'
import { Camera, ImageIcon, MapPin, ShieldAlert, User } from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { fmtDate, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'

interface GalleryItem {
  id: string
  location: string | null
  note: string | null
  createdAt: string
  photo: string | null
  project: { id: string; code: string; title: string; status: string; consentStatus: string } | null
  author: { name: string } | null
}

interface ProjectRow { id: string; code: string; title: string; status: string }

// R479 (issue #9 §10 — GDPR): če projekt nima veljavnega soglasja za objavo
// fotografij, galerija pokaže opozorilo (rumeno) — interno vse ostane vidno,
// javne poti (portal, javna povezava pregleda) pa fotografije zamaknejo.
const consentBadge = (it: GalleryItem): string | null => {
  if (!it.project) return null
  if (it.project.consentStatus === 'VELJAVNO') return null
  return it.project.consentStatus === 'POTEKLO' ? 'Soglasje za javne fotografije je poteklo' : 'Manjka soglasje za javne fotografije'
}

export default function GalerijaModule () {
  const [projectId, setProjectId] = useState('all')
  const [lightbox, setLightbox] = useState<GalleryItem | null>(null)

  const gallery = useApi<{ data: GalleryItem[] }>(`/api/gallery${projectId !== 'all' ? `?projectId=${projectId}` : ''}`, [projectId])
  const projects = useApi<{ data: ProjectRow[] }>('/api/projects?limit=200', [])

  const items = gallery.data?.data ?? []
  const photos = items.filter((it) => !!it.photo)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Galerija zaključenih del"
        desc="Fotografije s terena — projekti v statusu Zaključen ali Arhiv"
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 text-sm text-muted-foreground" aria-live="polite">
          {gallery.loading ? 'Nalagam fotografije …' : `${photos.length} ${photos.length === 1 ? 'fotografija' : photos.length === 2 ? 'fotografiji' : 'fotografij'}${projectId !== 'all' ? ' na izbranem projektu' : ''}`}
        </div>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-full sm:w-72" aria-label="Filter po projektu"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vsi projekti</SelectItem>
            {(projects.data?.data ?? [])
              .filter((p) => p.status === 'ZAKLJUCEN' || p.status === 'ARHIV')
              .map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.code} · {p.title}</SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <ErrorBox error={gallery.error} />
      {gallery.loading ? <LoadingRows /> : !gallery.error && photos.length === 0 ? (
        <EmptyState
          title="Še ni zaključenih del s fotografijami"
          desc="Fotografije, posnete v modulu Foto na terenu, se tu pojavijo, ko je projekt zaključen ali arhiviran."
          icon={Camera}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((it) => (
            <Card key={it.id} className="min-w-0 group overflow-hidden pt-0 transition-shadow hover:shadow-md">
              <button
                type="button"
                className="block w-full cursor-zoom-in text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setLightbox(it)}
                aria-label={`Povečaj fotografijo — ${it.location ?? it.project?.title ?? 'brez naslova'}`}
              >
                <div className="relative aspect-video w-full overflow-hidden bg-secondary">
                  <img
                    src={it.photo ?? undefined}
                    alt={`Fotografija dela — ${it.location ?? it.project?.title ?? 'terenska fotografija'}`}
                    loading="lazy"
                    className="size-full rounded-t-lg object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  {it.project ? (
                    <span className="absolute left-2 top-2 rounded-lg bg-background/85 px-2 py-1 font-mono text-[10px] font-bold text-roksal-amber backdrop-blur-sm">
                      {it.project.code}
                    </span>
                  ) : null}
                </div>
                <CardContent className="space-y-1.5 p-4">
                  <p className="truncate font-medium text-foreground">{it.location ?? it.project?.title ?? 'Brez naslova'}</p>
                  {it.project ? <p className="truncate text-xs text-muted-foreground">{it.project.title}</p> : null}
                  {consentBadge(it) ? (
                    <p className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200" role="note">
                      <ShieldAlert className="size-3 shrink-0" aria-hidden />
                      <span className="truncate">{consentBadge(it)}</span>
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {it.author ? (
                      <span className="inline-flex items-center gap-1"><User className="size-3" aria-hidden />{it.author.name}</span>
                    ) : null}
                    <span>{fmtDate(it.createdAt)}</span>
                    {it.project ? <Badge variant="secondary" className="ml-auto border-transparent px-1.5 py-0 text-[10px]">{it.project.status === 'ZAKLJUCEN' ? 'Zaključen' : 'Arhiv'}</Badge> : null}
                  </div>
                  {it.note ? <p className="line-clamp-2 text-xs italic text-muted-foreground">{it.note}</p> : null}
                </CardContent>
              </button>
            </Card>
          ))}
        </div>
      )}

      {/* lightbox */}
      <Dialog open={!!lightbox} onOpenChange={(o) => { if (!o) setLightbox(null) }}>
        {lightbox ? (
          <DialogContent aria-describedby={undefined} className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{lightbox.location ?? lightbox.project?.title ?? 'Fotografija zaključenega dela'}</DialogTitle>
              <DialogDescription>
                {lightbox.project ? `${lightbox.project.code} · ${lightbox.project.title}` : 'Brez projekta'}
                {lightbox.author ? ` · posnel ${lightbox.author.name}` : ''}
                {` · ${fmtDate(lightbox.createdAt)}`}
              </DialogDescription>
            </DialogHeader>
            <img
              src={lightbox.photo ?? undefined}
              alt={`Fotografija dela (povečava) — ${lightbox.location ?? lightbox.project?.title ?? 'terenska fotografija'}`}
              className="w-full rounded-xl border object-contain"
            />
            {lightbox.note ? (
              <p className="rounded-lg bg-secondary/60 p-3 text-sm italic text-muted-foreground">{lightbox.note}</p>
            ) : null}
            <div className="grid gap-2 rounded-lg bg-secondary/60 p-3 text-sm sm:grid-cols-2">
              {lightbox.location ? (
                <span className="inline-flex items-center gap-2"><MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />{lightbox.location}</span>
              ) : null}
              {lightbox.author ? (
                <span className="inline-flex items-center gap-2"><User className="size-4 shrink-0 text-muted-foreground" aria-hidden />Posnel: {lightbox.author.name}</span>
              ) : null}
              <span className="inline-flex items-center gap-2"><ImageIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />Datum: {fmtDate(lightbox.createdAt)}</span>
            </div>
          </DialogContent>
        ) : (
          <DialogHeader><DialogTitle className="sr-only">Nalaganje fotografije</DialogTitle></DialogHeader>
        )}
      </Dialog>
    </div>
  )
}
