'use client'

// FOTO — foto zajem na terenu (vrata measurements.write v nav-registry)
// Zajem s kamero/knalpožarjalnikom → pomanjšanje (max 900 px, JPEG 0.7) →
// shranitev kot meritev tipa FOTO (params.photo = data URL).
// Seznam zadnjih foto dokazov zahteva measurements.read, shranjevanje measurements.write.

import { useRef, useState } from 'react'
import { Camera, ImageIcon, Loader2, RefreshCcw, Save, Trash2, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPost, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

interface PhotoRow {
  id: string; type: string; location: string | null; params: Record<string, unknown> | null; note: string | null; createdAt: string
  author: { name: string } | null
  project: { code: string; title: string } | null
  workOrder: { code: string; title: string } | null
}

interface WorkOrderOption { id: string; code: string; title: string; status: string }

// ─── pomožne funkcije za sliko ───────────────────────────────────────────────

function readFileAsDataUrl (file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Branje datoteke ni uspelo.'))
    reader.readAsDataURL(file)
  })
}

function loadImage (src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Slike ni bilo mogoče odpreti.'))
    img.src = src
  })
}

/** Pomanjša sliko na max 900 px širine, JPEG quality 0.7 (data URL). */
async function shrinkImage (file: File): Promise<string> {
  const original = await readFileAsDataUrl(file)
  const img = await loadImage(original)
  const scale = Math.min(1, 900 / img.naturalWidth)
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas ni na voljo v tem brskalniku.')
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', 0.7)
}

// R542: params je jsonb objekt (API ga vrača razčlenjenega) — brez JSON.parse
function parsePhoto (row: PhotoRow): string | null {
  const p = row.params
  return typeof p?.photo === 'string' ? p.photo : null
}

// ─── modul ───────────────────────────────────────────────────────────────────

export default function FotoModule () {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()

  const canRead = hasPerm(user?.perms, 'measurements.read')
  const canWrite = hasPerm(user?.perms, 'measurements.write')

  const fileRef = useRef<HTMLInputElement>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [desc, setDesc] = useState('')
  const [workOrderId, setWorkOrderId] = useState('none')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<PhotoRow | null>(null)

  const orders = useApi<{ data: WorkOrderOption[] }>(canWrite ? '/api/nalog?scope=all' : null, [])
  const photos = useApi<{ data: PhotoRow[] }>(canRead ? '/api/measurements?type=FOTO' : null, [canRead])

  async function onFile (file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Nedovoljena datoteka.', description: 'Izberite slikovno datoteko (JPG, PNG …).', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const dataUrl = await shrinkImage(file)
      setPhoto(dataUrl)
      toast({ title: 'Foto pripravljen.', description: 'Pomanjšano na max 900 px (JPEG 0.7).' })
    } catch (e) {
      toast({ title: 'Obdelava slike ni uspela.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function save () {
    if (!photo) {
      toast({ title: 'Najprej zajemite fotografijo.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      await apiPost('/api/measurements', {
        type: 'FOTO',
        workOrderId: workOrderId !== 'none' ? workOrderId : null,
        note: desc.trim() || null,
        // R542: params je jsonb objekt (zod sprejema samo objekt)
        params: { photo },
      })
      toast({ title: 'Foto dokaz shranjen.', description: desc.trim() || 'Shranjeno med meritve tipa FOTO.' })
      setPhoto(null); setDesc(''); setWorkOrderId('none')
      await photos.reload()
    } catch (e) {
      toast({ title: 'Napaka pri shranjevanju foto dokaza', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const photoRows = (photos.data?.data ?? []).filter((r) => parsePhoto(r) !== null)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Foto zajem"
        desc="Foto dokazi s terena — povezani na delovni nalog"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* zajem */}
        {canWrite ? (
          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                <Camera className="size-4 text-roksal-amber" aria-hidden /> Nov foto dokaz
              </h2>

              {/* hidden input: kamera (mobile) / knalpožarjalnik */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => void onFile(e.target.files?.[0])}
              />

              {photo ? (
                <figure className="space-y-2">
                  <img
                    src={photo}
                    alt="Predogled foto dokaza"
                    className="max-h-64 w-full rounded-xl border object-contain"
                  />
                  <figcaption className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
                      <RefreshCcw className="size-4" aria-hidden /> Zamenjaj
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setPhoto(null)} disabled={busy}>
                      <Trash2 className="size-4" aria-hidden /> Odstrani
                    </Button>
                  </figcaption>
                </figure>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-muted-foreground transition hover:border-roksal-amber/60 hover:text-foreground"
                  aria-label="Zajemi ali izberi fotografijo"
                >
                  {busy ? <Loader2 className="size-8 animate-spin" aria-hidden /> : <Upload className="size-8" aria-hidden />}
                  <span className="text-sm font-medium">{busy ? 'Obdelava …' : 'Zajemi ali izberi fotografijo'}</span>
                  <span className="text-xs">kamera (mobilni) ali knalpožarjalnik — pomanjša na max 900 px</span>
                </button>
              )}

              <div className="space-y-2">
                <Label htmlFor="fo-desc">Opis</Label>
                <Input
                  id="fo-desc" value={desc} onChange={(e) => setDesc(e.target.value)}
                  placeholder="npr. Stanje sidra — severozahodni vogal"
                />
              </div>

              <div className="space-y-2">
                <Label>Nalog</Label>
                <Select value={workOrderId} onValueChange={setWorkOrderId}>
                  <SelectTrigger aria-label="Povezava na nalog"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-48">
                    <SelectItem value="none">Brez naloga</SelectItem>
                    {(orders.data?.data ?? []).map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.code} — {w.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ErrorBox error={orders.error} />
              </div>

              <Button className="w-full" onClick={() => void save()} disabled={busy || !photo}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                Shrani foto dokaz
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4">
              <EmptyState
                title="Zajem ni na voljo"
                desc="Za shranjevanje foto dokazov je potrebna pravica measurements.write."
                icon={Camera}
              />
            </CardContent>
          </Card>
        )}

        {/* zadnji foto dokazi */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <ImageIcon className="size-4 text-roksal-amber" aria-hidden /> Zadnji foto dokazi
            </h2>

            {!canRead ? (
              <EmptyState title="Seznam ni na voljo" desc="Zahtevana pravica measurements.read." icon={ImageIcon} />
            ) : (
              <>
                <ErrorBox error={photos.error} />
                {photos.loading ? <LoadingRows rows={3} /> : !photos.error && photoRows.length === 0 ? (
                  <EmptyState title="Ni foto dokazov" desc="Zajemite prvo fotografijo s terena." icon={Camera} />
                ) : (
                  <div className="max-h-96 grid grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3" aria-label="Seznam foto dokazov">
                    {photoRows.map((r) => {
                      const src = parsePhoto(r)
                      return (
                        <button
                          key={r.id}
                          type="button"
                          className="group relative overflow-hidden rounded-lg border"
                          onClick={() => setPreview(r)}
                          aria-label={`Odpri foto dokaz ${r.note ?? r.id}`}
                        >
                          <img src={src ?? undefined} alt={r.note ?? 'Foto dokaz'} className="aspect-square w-full object-cover transition group-hover:scale-105" />
                          <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent p-1.5 text-left text-[10px] font-medium text-white">
                            {r.workOrder?.code ?? r.project?.code ?? fmtDateTime(r.createdAt)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* velika slika */}
      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null) }}>
        <DialogContent className="sm:max-w-xl">
          {preview ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
                  <Badge variant="secondary" className="border-transparent bg-violet-100 font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-300">Foto</Badge>
                  <span className="truncate">{preview.note ?? 'Foto dokaz'}</span>
                </DialogTitle>
                <DialogDescription>
                  {preview.workOrder ? `${preview.workOrder.code} — ${preview.workOrder.title}` : 'Brez naloga'}
                  {preview.author ? ` · ${preview.author.name}` : ''} · {fmtDateTime(preview.createdAt)}
                </DialogDescription>
              </DialogHeader>
              <img
                src={parsePhoto(preview) ?? undefined}
                alt={preview.note ?? 'Foto dokaz'}
                className="max-h-[70vh] w-full rounded-xl border object-contain"
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
