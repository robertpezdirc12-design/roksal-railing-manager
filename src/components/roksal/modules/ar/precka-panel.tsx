'use client'

// precka-panel.tsx — R558 (raziskava R557, V1.4): VEČFOTOGRAFSKA VLM PREČKA
// (HOVER-style: 8 fotografij → AI primerja dimenzije med posnetki).
// Kartica v AR modulu poleg AI analize; nalaganje prek multiple file input
// (2–8), POST /api/ar/analyze-multi (backend VLM), prikaz dims/warnings/
// postsHint. Pomoč pri odločitvi — NE vir resnice (veljavne mere ostanejo
// izmera/kalibracija; issue §1).

import { useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Loader2, TriangleAlert, Upload, X } from '@/components/roksal/custom-icons'
import { useToast } from '@/hooks/use-toast'
import { apiPost } from '@/lib/api-client'
import type { PreckaAnalysis } from './tipi'

const MIN = 2
const MAX = 8

export function PreckaPanel (): React.ReactElement {
  const { toast } = useToast()
  const [photos, setPhotos] = useState<string[]>([])
  const [imena, setImena] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [rezultat, setRezultat] = useState<PreckaAnalysis | null>(null)
  const [hint, setHint] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function dodaj (datal: string[], novaImena: string[]): void {
    // skupaj največ MAX; odveč izpustimo in povedemo
    const prostor = MAX - photos.length
    if (prostor <= 0) {
      toast({ title: 'Doseženih je največ 8 fotografij.', description: 'Odstranite eno, če želite dodati drugo.' })
      return
    }
    setPhotos([...photos, ...datal.slice(0, prostor)])
    setImena([...imena, ...novaImena.slice(0, prostor)])
    if (datal.length > prostor) {
      toast({ title: `Dodanih ${prostor}, ostalih ${datal.length - prostor} izpuščenih.`, description: `Prečka sprejme največ ${MAX} fotografij.` })
    }
    setRezultat(null)
  }

  function odstrani (idx: number): void {
    setPhotos(photos.filter((_, i) => i !== idx))
    setImena(imena.filter((_, i) => i !== idx))
    setRezultat(null)
  }

  async function povezi (f: FileList | null): Promise<void> {
    if (f == null || f.length === 0) return
    const datal: string[] = []
    const novaImena: string[] = []
    for (const file of Array.from(f)) {
      if (!file.type.startsWith('image/')) continue
      const url = await new Promise<string>((res, rej) => {
        const fr = new FileReader()
        fr.onload = () => { res(String(fr.result ?? '')) }
        fr.onerror = () => { rej(new Error('branje')) }
        fr.readAsDataURL(file)
      }).catch(() => '')
      if (url.startsWith('data:image/')) { datal.push(url); novaImena.push(file.name) }
    }
    if (datal.length === 0) {
      toast({ title: 'Ni veljavnih slik.', description: 'Izberite slike (JPG/PNG).' })
      return
    }
    dodaj(datal, novaImena)
  }

  async function analiza (): Promise<void> {
    if (busy) return
    if (photos.length < MIN) {
      toast({ title: 'Prečka zahteva vsaj 2 fotografiji.', description: 'Isti objekt iz vsaj dveh kotov.' })
      return
    }
    setBusy(true)
    try {
      const res = await apiPost<{ data: PreckaAnalysis }>('/api/ar/analyze-multi', {
        photos,
        hint: hint.trim() || undefined,
      })
      setRezultat(res.data)
      toast({
        title: 'Prečka pripravljena.',
        description: res.data.warnings.length > 0
          ? `${res.data.warnings.length} opozoril o neskladjih — preverite v seznamu.`
          : res.data.dims.length > 0
            ? `${res.data.dims.length} ocen dimenzij; med posnetki ni vidnih neskladij.`
            : 'VLM ni videl uporabnih dimenzij — glejte opombo.',
      })
    } catch (e) {
      toast({ title: 'Prečka ni uspela.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="border-roksal-amber/30">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Prečka z več fotografijami (2–8)
          </h2>
          {rezultat ? (
            <Button variant="ghost" size="icon" className="size-8" aria-label="Zapri prečko" onClick={() => { setRezultat(null) }}>
              <X className="size-4" aria-hidden />
            </Button>
          ) : null}
        </div>

        {!rezultat ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Naložite 2–8 fotografij <span className="font-medium text-foreground">istega objekta iz različnih kotov</span> —
              AI prečka dimenzije med posnetki in opozori na neskladja (vzorec HOVER: 8 fotografij → 3D model).
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              aria-label="Izberi fotografije za prečko"
              onChange={(e) => { void povezi(e.target.files); e.target.value = '' }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => { fileRef.current?.click() }}>
                <Upload className="size-3.5" aria-hidden /> Naloži fotografije
              </Button>
              <span className="text-xs text-muted-foreground" role="status">{photos.length}/{MAX}</span>
            </div>
            {photos.length > 0 ? (
              <ul className="space-y-1">
                {photos.map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 rounded border bg-secondary/40 px-2 py-1 text-xs">
                    <span className="truncate">
                      <span className="font-semibold">Foto {i + 1}:</span> {imena[i] ?? 'slika'}
                    </span>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" aria-label={`Odstrani fotografijo ${i + 1}`} onClick={() => { odstrani(i) }}>
                      <X className="size-3" aria-hidden /> Odstrani
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="space-y-0.5">
              <Input
                value={hint}
                onChange={(e) => { setHint(e.target.value) }}
                placeholder="Namig (neobvezno): npr. »merjeno ob stopnišču, ploščice 40 cm«"
                className="h-8 text-xs"
                aria-label="Namig za prečko"
              />
            </div>
            <Button size="sm" disabled={busy || photos.length < MIN} onClick={() => { void analiza() }}>
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <TriangleAlert className="size-3.5" aria-hidden />}
              {busy ? 'Prečka poteka …' : 'Izvedi prečko'}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {rezultat.scene ? <p className="text-sm font-medium">{rezultat.scene}</p> : null}
            {rezultat.dims.length > 0 ? (
              <ul className="space-y-1.5">
                {rezultat.dims.map((d, i) => (
                  <li key={i} className="rounded-lg border bg-secondary/40 p-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">Foto {d.foto}</span>
                      <span className="text-muted-foreground">{d.kaj}</span>
                      {d.ocenaCm != null ? (
                        <Badge variant="outline" className="border-roksal-amber/40 text-roksal-amber-text">
                          ≈ {(d.ocenaCm / 100).toFixed(1).replace('.', ',')} m
                        </Badge>
                      ) : <span className="text-xs text-muted-foreground">ocena ni mogoča</span>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            {rezultat.warnings.length > 0 ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Neskladja med posnetki</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm">
                  {rezultat.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            ) : null}
            {rezultat.postsHint != null ? (
              <p className="text-sm">
                Predlog števila stebrov: <span className="font-bold">{rezultat.postsHint}</span> (preverite z izmero).
              </p>
            ) : null}
            {rezultat.note ? <p className="text-xs italic text-muted-foreground">{rezultat.note}</p> : null}
            <p className="text-xs text-muted-foreground">
              Prečka je pomoč pri odločitvi — veljavne mere vedno preverite z izmero ali kalibracijo.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
