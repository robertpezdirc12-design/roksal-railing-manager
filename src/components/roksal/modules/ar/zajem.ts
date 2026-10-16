// zajem.ts — pomočniki zajema kadra na canvas + prenos PNG (R537-b: iz ar.tsx,
// dobesedna selitev). Čisti TS — BREZ 'use client' (document/Canvas se
// uporabita šele ob klicu iz odjemalca).

import type { Mode } from './tipi'
import { OVERLAY_H, OVERLAY_W } from './ograja-overlay'

function loadImage (src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Slike ni bilo mogoče odpreti.'))
    img.src = src
  })
}

/** R465: prenos data URL kot PNG (a[download] — brez strežniškega kroga). */
export function downloadPng (dataUrl: string, name: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Zajem trenutnega kadra na canvas. withOverlay: true = s ograjo (posnetek),
 *  false = čist prizor (za VLM analizo — overlay bi motil prepoznavo). */
// (R537-b: v starem ar.tsx je bil to captureFrame znotraj ArModule — bral
//  je refse iz komponente; vhodi so zdaj argumenti, logika dobesedno ista.)
export async function zajemKadra (
  container: HTMLDivElement | null,
  video: HTMLVideoElement | null,
  svg: SVGSVGElement | null,
  mode: Mode,
  pos: { x: number; y: number },
  scale: number,
  opacity: number,
  withOverlay: boolean,
): Promise<string> {
  if (!container) throw new Error('Predogled ni na voljo.')
  const cw = container.clientWidth
  const ch = container.clientHeight
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas ni na voljo v tem brskalniku.')

  // ozadje: video (cover) ali demo gradient
  if (mode === 'on' && video && video.videoWidth > 0) {
    const vr = video.videoWidth / video.videoHeight
    const cr = cw / ch
    let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight
    if (vr > cr) { sh = video.videoHeight; sw = sh * cr; sx = (video.videoWidth - sw) / 2 }
    else { sw = video.videoWidth; sh = sw / cr; sy = (video.videoHeight - sh) / 2 }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch)
  } else {
    const grad = ctx.createLinearGradient(0, 0, cw * 0.4, ch)
    grad.addColorStop(0, '#e7e5e4')
    grad.addColorStop(0.55, '#a8a29e')
    grad.addColorStop(1, '#78716c')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, cw, ch)
  }

  if (withOverlay) {
    if (svg) {
      // overlay SVG na položaj (počakaj nalaganje slike!)
      const xml = new XMLSerializer().serializeToString(svg)
      const overlayUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
      const img = await loadImage(overlayUrl)
      const destX = cw / 2 + pos.x - (OVERLAY_W * scale) / 2
      const destY = ch / 2 + pos.y - (OVERLAY_H * scale) / 2
      ctx.globalAlpha = opacity
      ctx.drawImage(img, destX, destY, OVERLAY_W * scale, OVERLAY_H * scale)
      ctx.globalAlpha = 1
    }
  }
  return canvas.toDataURL('image/jpeg', 0.7)
}
