// izvoz.ts — slikovni in izvozni pomožniki modula Foto vizualizacija: priprava
// JPEG (naložena datoteka / projektna fotografija), izris v JPEG data URL
// (rendered ob shranjevanju), PNG izvoz (celoten POTEM ali PREJ/POTEM), PDF
// dokument in prenos bloba. R537-c: čisto razbitje foto-replace.tsx (brez
// sprememb obnašanja) — akcije so bile notranje funkcije vstopa in so sedaj
// funkcije z EXPLICITNIMI argumenti (vstop sestavi kontekst iz svojega stanja
// ob vsakem klicu). Čisti TS brez komponent/hookov — BREZ 'use client'.
// semeIzrisa/prazenSlot prihajata iz ./stanje (R536-c logika semena,
// dobesedno enaka — oba klica drawPotem tukaj kličeta semeIzrisa).

import type { Dispatch, SetStateAction } from 'react'
import { apiPost } from '@/lib/api-client'
import type { RenderParams } from '@/lib/photo-replace-core'
import { prazenSlot, semeIzrisa } from './stanje'
import type {
  DokazVeriga, DrawPotemFn, FotoMeasurement, ProjectRow, SlotState, ToastFn, VariantLabel,
} from './tipi'

/** Blob → JPEG data URL (max rob maxPx, kakovost q) — original ostane vir. */
function blobToJpeg (blob: Blob, maxPx: number, q: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Branje datoteke ni uspelo.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Slike ni bilo mogoče odpreti.'))
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) { reject(new Error('Canvas ni na voljo.')); return }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(c.toDataURL('image/jpeg', q))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(blob)
  })
}

/** Data URL slike → JPEG data URL (normalizacija velikosti/formata). */
async function dataUrlToJpeg (dataUrl: string, maxPx: number, q: number): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('Slike ni bilo mogoče odpreti.'))
    i.src = dataUrl
  })
  const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas ni na voljo.')
  ctx.drawImage(img, 0, 0, w, h)
  return c.toDataURL('image/jpeg', q)
}

/** Prenese blob in ga shrani kot datoteko. */
function prenesiBlob (blob: Blob, ime: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = ime
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

// ── render v JPEG data URL (za `rendered` ob shranjevanju/izvozu) ──

export async function renderJpegDataUrl ({ photoImg, params, photoW, photoH, slot, active, drawPotem }: {
  photoImg: HTMLImageElement | null
  params: RenderParams | null
  photoW: number
  photoH: number
  slot: SlotState
  active: VariantLabel
  drawPotem: DrawPotemFn
}, maxPx: number, zig: boolean, meja?: number): Promise<string> {
  if (!photoImg || !params) throw new Error('Ni podatkov za izris.')
  const W = Math.min(maxPx, photoW)
  const H = Math.round(W * (photoH / photoW))
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas ni na voljo.')
  drawPotem(ctx, W, H, params, { ...(meja !== undefined ? { meja } : {}), zig, ghostAlpha: 1, seme: semeIzrisa(params, slot.savedId, active) })
  return c.toDataURL('image/jpeg', 0.85)
}

/** PNG izvoz (celoten POTEM ali PREJ/POTEM primerjava). */
export async function izvoziFormat ({ photoImg, params, photoW, photoH, comparePos, slot, active, project, drawPotem, setExportBusy, setSavedVersion, toast }: {
  photoImg: HTMLImageElement | null
  params: RenderParams | null
  photoW: number
  photoH: number
  comparePos: number
  slot: SlotState
  active: VariantLabel
  project: ProjectRow | null
  drawPotem: DrawPotemFn
  setExportBusy: Dispatch<SetStateAction<'png' | 'primerjava' | 'pdf' | null>>
  setSavedVersion: Dispatch<SetStateAction<number>>
  toast: ToastFn
}, format: 'png' | 'primerjava'): Promise<void> {
  if (!photoImg || !params) return
  setExportBusy(format)
  try {
    const W = Math.min(1600, photoW)
    const H = Math.round(W * (photoH / photoW))
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('Canvas ni na voljo.')
    drawPotem(ctx, W, H, params, {
      ...(format === 'primerjava' ? { meja: comparePos / 100 } : {}),
      zig: true, ghostAlpha: 1, seme: semeIzrisa(params, slot.savedId, active),
    })
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
    if (!blob) throw new Error('Izdelava PNG ni uspela.')
    prenesiBlob(blob, `${project?.code ?? 'vizualizacija'}-varianta-${active}${format === 'primerjava' ? '-prej-potem' : '-potem'}.png`)
    // če je varianta shranjena → zabeleži izvoz + posodobi rendered (za PDF)
    if (slot.savedId) {
      const rendered = await renderJpegDataUrl({ photoImg, params, photoW, photoH, slot, active, drawPotem }, 1280, true, format === 'primerjava' ? comparePos / 100 : undefined)
      await apiPost(`/api/photo-visualization/${slot.savedId}/export`, { format, rendered })
      setSavedVersion((v) => v + 1)
    }
    toast({ title: format === 'primerjava' ? 'Izvožena primerjava PREJ/POTEM.' : 'Izvožena POTEM fotografija.', description: 'PNG vsebuje žig VIZUALIZACIJA ZA PREDSTAVITEV.' })
  } catch (e) {
    toast({ title: 'Izvoz ni uspel.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
  } finally {
    setExportBusy(null)
  }
}

/** PDF dokument (fetch z žetonom → blob → prenos). */
export async function izvoziPdfDokument ({ slot, active, project, token, toast, setExportBusy }: {
  slot: SlotState
  active: VariantLabel
  project: ProjectRow | null
  token: string | null
  toast: ToastFn
  setExportBusy: Dispatch<SetStateAction<'png' | 'primerjava' | 'pdf' | null>>
}): Promise<void> {
  if (!slot.savedId || !token) return
  setExportBusy('pdf')
  try {
    const res = await fetch(`/api/pdf/photoviz/${slot.savedId}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(j?.error ?? `HTTP ${res.status}`)
    }
    const blob = await res.blob()
    if (!blob.type.includes('pdf')) throw new Error('Odgovor ni veljaven PDF.')
    prenesiBlob(blob, `${project?.code ?? 'vizualizacija'}-varianta-${active}.pdf`)
    toast({ title: 'PDF dokument vizualizacije izvožen.' })
  } catch (e) {
    toast({ title: 'PDF izvoz ni uspel.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
  } finally {
    setExportBusy(null)
  }
}

// ── upload fotografije (2. korak; priprava JPEG prek zgorajšnjih pomočnikov) ──

export async function naloziDatoteko ({ toast, setBusy, setPhoto, setPhotoName, setSlots, setDokaz }: {
  toast: ToastFn
  setBusy: Dispatch<SetStateAction<boolean>>
  setPhoto: Dispatch<SetStateAction<string | null>>
  setPhotoName: Dispatch<SetStateAction<string>>
  setSlots: Dispatch<SetStateAction<Record<VariantLabel, SlotState>>>
  setDokaz: Dispatch<SetStateAction<DokazVeriga | null>>
}, file: File | undefined): Promise<void> {
  if (!file) return
  if (!file.type.startsWith('image/')) {
    toast({ title: 'Izberite slikovno datoteko.', variant: 'destructive' })
    return
  }
  setBusy(true)
  try {
    const dataUrl = await blobToJpeg(file, 1600, 0.85)
    setPhoto(dataUrl)
    setPhotoName(file.name)
    // ponastavi točke in vezave shranjenih variant ob novi fotografiji
    // (R510: zveza na izvirnik je null — datoteka zunaj projekta ga nima)
    setSlots(() => ({ A: prazenSlot(), B: prazenSlot(), C: prazenSlot() }))
    setDokaz(null)
    toast({ title: 'Fotografija pripravljena.', description: 'Original se pretvori v JPEG (max 1600 px) — ostaja vir slike.' })
  } catch (e) {
    toast({ title: 'Priprava fotografije ni uspela.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
  } finally {
    setBusy(false)
  }
}

/** Obstoječa projektna fotografija (meritev FOTO) → vir. */
export async function uporabiProjektno ({ fotoMeasurements, toast, setBusy, setPhoto, setPhotoName, setSlots }: {
  fotoMeasurements: FotoMeasurement[]
  toast: ToastFn
  setBusy: Dispatch<SetStateAction<boolean>>
  setPhoto: Dispatch<SetStateAction<string | null>>
  setPhotoName: Dispatch<SetStateAction<string>>
  setSlots: Dispatch<SetStateAction<Record<VariantLabel, SlotState>>>
}, mid: string): Promise<void> {
  const row = fotoMeasurements.find((x) => x.m.id === mid)
  if (!row?.foto) return
  setBusy(true)
  try {
    const dataUrl = await dataUrlToJpeg(row.foto, 1600, 0.85)
    setPhoto(dataUrl)
    setPhotoName(`projektna fotografija ${row.m.location ? `— ${row.m.location}` : ''}`)
    // R510: projektna fotografija IMA izvirnik — povezavo nosi vsaka varianta
    // (meritev, ki je bila umaknjena, na strežniku pomeni zavrnjeno ustvarjanje).
    setSlots(() => {
      const z = (): SlotState => ({ ...prazenSlot(), photoSourceId: mid })
      return { A: z(), B: z(), C: z() }
    })
    toast({ title: 'Projektna fotografija prevzeta.', description: 'Izvirnik fotografije je povezan — dokaz gre ob shranjevanju v dokument.' })
  } catch (e) {
    toast({ title: 'Prevzem fotografije ni uspel.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
  } finally {
    setBusy(false)
  }
}
