// MERITVE S KAMERO — priprava in analiza kakovosti fotografije (canvas,
// EXIF orientacija, Laplaceova ostrost). Čisti .ts brez Reacta.
// R537-a: selitev iz meritve-kamera.tsx (izhodiščne glave ostajajo ob kodi).

import { normalizedSize, orientationMatrix, type OrientationCheck, type RawSize } from '@/lib/exif-orientation'
import { BLUR_THRESHOLD, MAX_IMG_W, type Quality } from './tipi'

/**
 * R553: meji svetlobe sta EN vir za analyzeQuality (po zajemu) in za ŽIVI
 * vzorec predogleda (oceniSvetlobo). Vrednosti 45/225 ostajajo iz prakse
 * R455 — namerno nespremenjene, da obnašanje obstoječe analize ostane
 * bajtno enako (nazajzdružljivost).
 */
export const TEMNA_MEJA = 45
export const SVETLA_MEJA = 225

/**
 * Zmanjša sliko na max širino in vrne JPEG dataUrl.
 *
 * issue #15 faza 4 (H8): canvas upošteva EXIF orientacijo SAMO, če jo upošteva
 * tudi brskalnik pri `drawImage`. Kadar `samiObrni` nosi orientacijo (modul
 * `exif-orientation` je dokazal, da brskalnik obrata NI uporabil), ga
 * izvedemo sami — sicer nastane slika, ki je zasukana glede na to, kar
 * monter vidi, in vsaka mera je sistematicno napačna.
 */
export async function shrinkToDataUrl (dataUrl: string, samiObrni?: OrientationCheck | null): Promise<string> {
  return await new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const natural = { w: img.naturalWidth, h: img.naturalHeight }
      const obrni = samiObrni?.popraviRočno === true && samiObrni.exif !== null
      const cilj = obrni ? normalizedSize(natural, samiObrni.exif) : natural
      if (cilj.w <= 0 || cilj.h <= 0) { resolve(dataUrl); return }
      const scale = Math.min(1, MAX_IMG_W / cilj.w)
      const w = Math.max(1, Math.round(cilj.w * scale))
      const h = Math.max(1, Math.round(cilj.h * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(dataUrl); return }
      if (obrni && samiObrni.exif !== null) {
        // Zaporedje je POMEMNO: najprej merilo, nato obrat okoli izvirnih
        // dimenzij — obratno bi sliko potisnilo iz platna.
        ctx.scale(scale, scale)
        const m = orientationMatrix(samiObrni.exif, natural.w, natural.h)
        ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5])
        ctx.drawImage(img, 0, 0, natural.w, natural.h)
      } else {
        ctx.drawImage(img, 0, 0, w, h)
      }
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => resolve(dataUrl) // če gre kaj narobe, pošljemo izvirnik
    img.src = dataUrl
  })
}

/**
 * issue #15 faza 4 (H8): dimenzije, kot jih UPORABLJA brskalnik (natural*),
 * za primerjavo z izvirnim JPEG okvirom.
 */
export async function imageSize (dataUrl: string): Promise<RawSize | null> {
  return await new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

/**
 * R455: analiza kakovosti kadra (§2/§4) — svetlost (povprečna luma) in ostrost
 * (variacija Laplace-ovega jedra na pomanjšani sliki). Čisto odjemalčeva,
 * advisory ocena: opozori na temo/presočje/mehkost, ne blokira toka.
 */
export async function analyzeQuality (dataUrl: string): Promise<Quality | null> {
  return await new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const w = 240
        const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w)) || 1
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, w, h)
        const d = ctx.getImageData(0, 0, w, h).data
        const gray = new Float32Array(w * h)
        let sum = 0
        for (let i = 0; i < w * h; i++) {
          const g = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
          gray[i] = g; sum += g
        }
        const brightness = sum / (w * h)
        // Laplace (4-sosed) variacija — standardna hevristika za ostrost
        let lapSum = 0; let lapSq = 0; let n = 0
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const i = y * w + x
            const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]
            lapSum += lap; lapSq += lap * lap; n++
          }
        }
        const variance = n > 0 ? lapSq / n - (lapSum / n) ** 2 : 0
        const blurScore = Math.max(0, Math.min(10000, Math.round(variance)))
        const dark = brightness < TEMNA_MEJA
        const bright = brightness > SVETLA_MEJA
        const blurry = blurScore < BLUR_THRESHOLD
        resolve({ brightness: Math.round(brightness), blurScore, dark, bright, blurry, ok: !dark && !bright && !blurry })
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

/** R542: params je jsonb objekt — vrne data URL fotografije meritve FOTO (ali null);
 *  niz ostaja le kot obramba za starejše oblike. */
export function parsePhoto (params: Record<string, unknown> | string | null): string | null {
  if (!params) return null
  const p: unknown = typeof params === 'string' ? (() => { try { return JSON.parse(params) as unknown } catch { return null } })() : params
  if (!p || typeof p !== 'object') return null
  const photo = (p as { photo?: unknown }).photo
  return typeof photo === 'string' && photo.startsWith('data:image/') ? photo : null
}

/** R553: ocena svetlobe ŽIVEGA predogleda — iste meje kot analyzeQuality. */
export type OcenaSvetlobe = 'PRETEMNO' | 'PRESVETLO' | 'V_REDU' | 'NI_PODATKA'

/**
 * R553: čista klasifikacija svetlosti (0..255) za ŽIVI predogled. Namerno
 * poštena: `NI_PODATKA` ni »v redu« — vzorec se lahko ni izšel (kamera se
 * še prižiga, video brez okvirja); UI takrat NE pokaže ničesar.
 */
export function oceniSvetlobo (b: number | null): OcenaSvetlobe {
  if (b === null || !Number.isFinite(b)) return 'NI_PODATKA'
  if (b < TEMNA_MEJA) return 'PRETEMNO'
  if (b > SVETLA_MEJA) return 'PRESVETLO'
  return 'V_REDU'
}

/**
 * R553: vzorec svetlosti ŽIVEGA predogleda (povprečna luma na 48 px širogem
 * canvasu — enaka formula kot analyzeQuality, le brez Laplacea, ker ostrina
 * v živo ni zanesljiva). Vrne `null`, kadar vzorca ni mogoče vzeti (video se
 * še prižiga / brez okvirja / canvas zavrne) — klicatelj NE laže z vrednostjo.
 */
export async function vzorecSvetlobe (video: HTMLVideoElement | null): Promise<number | null> {
  if (!video || !video.videoWidth || !video.videoHeight) return null
  try {
    const w = 48
    const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w)) || 1
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, w, h)
    const d = ctx.getImageData(0, 0, w, h).data
    let sum = 0
    for (let i = 0; i < w * h; i++) {
      sum += 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
    }
    const b = sum / (w * h)
    return Number.isFinite(b) ? b : null
  } catch {
    return null
  }
}
