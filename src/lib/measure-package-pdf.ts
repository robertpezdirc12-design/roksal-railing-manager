// measure-package-pdf — R477 (issue #9 §6 HOVER PARITY — Faza 4): MERILNI
// PAKET PDF. En dokument za pisarno, monterja in proizvodnjo:
//   1) naslov/meta (tekač, projekt, izdelek, kalibracija, σ, gate)
//   2) TLORIS — risba XY modela (R473) z dimenzijami po segmentih
//   3) MONTAŽNA SKICA — odvita elevacija: teren, stebri, pritrditve, vrata
//   4) TABELA SEGMENTOV (mere, stebri, statusi, preveritve)
//   5) TABELA VOZLIŠČ (vrste, višine, pritrditve, podlage, opombe)
//   6) ODREZNI SEZNAM — komponente × segmenti (segment-bom matematika)
//   7) FOTOGRAFIJE — sličice zajema (dokazila pokritosti)
//   8) KAKOVOST — predpostavke, σ, preverjanja pravil (vidna poštenost)
//
// NAČELO POŠTENOSTI: risba je vedno označena z merilom in virom; nezajeto
// in nepreverjeno je vidno (statusi, σ, opozorila); tloris z privzetimi
// smermi zavojev je IZRECNO označen kot orientacijski. Vmesni stebri so
// narisani enakomerno — približek je zapisan pod skico.
//
// ČIST modul: prejme PRIPRAVLJENE podatke (nalagal jih je API route) —
// brez db uvozov, uporaben tudi za testne dokaze.

import {
  jpegSize, pdfDoc, PAGE_W, AMBER, GRAY, LIGHT, NAVY, type Rgb,
} from '@/lib/pdf-mini'
import type { PlanModel, ModelNode, ModelSegment } from '@/lib/model-core'
import type { ExportCheck } from '@/lib/export-core'

export const MEASURE_PACKAGE_VERSION = 'measure-package-pdf/1.1'

// ─── Vrste (vhod — pripravi API route) ───────────────────────────────────────

export interface CutListRow {
  sku: string
  name: string
  segmentKey: string
  group: string
  qty: number
  unit: string
  wastePct: number | null
  note: string
}

export interface PackagePhoto { zone: string; label: string; thumb: string | null }

export interface MeasurePackageInput {
  run: { id: string; name: string; status: string; createdAt: string; note: string | null }
  project: { code: string; title: string; customer: string | null } | null
  product: { sku: string; name: string } | null
  variant: { sku: string; name: string; ral: string | null } | null
  calibration: { method: string; refValueCm: number } | null
  model: PlanModel
  rules: {
    sigmaCm: number | null
    sigmaSource: string
    tolDolzinaCm: number | null
    maxRazdaljaStebrovCm: number | null
    odpadRezPct: number | null
  }
  cutList: CutListRow[]
  cutListNote: string | null // BREZ_PRODUKTA / BREZ_RAZMIKA …
  photos: PackagePhoto[]
  checks: ExportCheck[]
  /** R509 (issue #7 §8): kdo je dokument ustvaril — iz Measurement.author. */
  avtor?: { ime: string; vloga: string | null; ustvarjeno: string } | null
  /** R509 (issue #7 §8): zgodovina sprememb meritve (MeasurementVersion). */
  zgodovina?: Array<{ verzija: number; kdaj: string; avtor: string | null; opomba: string | null }>
  /** R509: izvirniki fotografij (SHA-256 + velikost) — dokaz, kaj je bilo merjeno. */
  originali?: Array<{ id: string; sha256: string | null; bayti: number; lokacija: string | null }>
}

// ─── Barve statusov (usklajeno z UI model-core STROKE) ─────────────────────

const SEG_COLOR: Record<string, Rgb> = {
  ESTIMATED: [0.612, 0.647, 0.686],
  AUTO_SUGGESTED: [0.545, 0.361, 0.965],
  MANUAL: [0.851, 0.467, 0.024],
  CALIBRATED: [0.051, 0.58, 0.533],
  VERIFIED: [0.02, 0.59, 0.41],
  CONFIRMED: [0.278, 0.333, 0.412],
}
const segColor = (s: string): Rgb => SEG_COLOR[s] ?? SEG_COLOR.ESTIMATED

const BLACK: Rgb = [0.1, 0.12, 0.16]
const RED: Rgb = [0.79, 0.16, 0.16]

const M = 48
const R = PAGE_W - 48

// ─── Formatiranja (SI) ────────────────────────────────────────────────────────

const numSI = (n: number | null | undefined, digits = 2): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toFixed(digits).replace('.', ',')

const fmtM = (cm: number | null | undefined): string =>
  cm == null || !Number.isFinite(cm) ? '—' : `${numSI(cm / 100)} m`

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${fmtDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const STATUS_LABEL: Record<string, string> = {
  ESTIMATED: 'OCENA', AUTO_SUGGESTED: 'PREDLOG', MANUAL: 'ROČNO',
  CALIBRATED: 'KALIBR.', VERIFIED: 'PREVERJENO', CONFIRMED: 'POTRJENO',
}
const NODE_LABEL: Record<string, string> = {
  ZACETEK: 'Začetek', STEBER: 'Steber', VOGAL: 'Vogal', VRATA: 'Vrata',
  STOPNISCE: 'Stopnišče', KONEC: 'Konec',
}

// ─── Tok strani (prelomi) ────────────────────────────────────────────────────

interface Flow { y: number }

/** Zajami višino h; prelomi stran, če ne gre več. */
function ensure (doc: ReturnType<typeof pdfDoc>, f: Flow, h: number): void {
  if (f.y + h > 762) {
    doc.addPage()
    f.y = 64
  }
}

function sectionTitle (doc: ReturnType<typeof pdfDoc>, f: Flow, n: string, title: string): void {
  ensure(doc, f, 40)
  doc.text(M, f.y, `${n}  ${title.toUpperCase()}`, { size: 12.5, bold: true, color: NAVY })
  doc.line(M, f.y + 5, R, f.y + 5, { width: 1.2, color: AMBER })
  f.y += 20
}

/** Tabela s fiksno širino stolpcev (pt) — samodejna preloma vrstic/strani. */
interface Col { w: number; align?: 'left' | 'right' | 'center' }

function drawTable (
  doc: ReturnType<typeof pdfDoc>, f: Flow,
  cols: Col[], head: string[], rows: (string | { t: string; color?: Rgb; bold?: boolean })[][],
): void {
  const rowH = 16
  const drawHead = (): void => {
    doc.line(M, f.y - 5, R, f.y - 5, { width: 1, color: NAVY })
    let x = M + 4
    for (let i = 0; i < cols.length; i++) {
      const align = cols[i].align ?? 'left'
      doc.text(align === 'right' ? x + cols[i].w - 8 : align === 'center' ? x + cols[i].w / 2 : x, f.y + 8, head[i] ?? '', {
        size: 8, bold: true, color: NAVY,
        align: align === 'right' ? 'right' : align === 'center' ? 'center' : 'left',
      })
      x += cols[i].w
    }
    doc.line(M, f.y + 13, R, f.y + 13, { width: 1, color: NAVY })
    f.y += 26
  }
  drawHead()
  rows.forEach((row, ridx) => {
    if (f.y + rowH > 758) {
      doc.addPage()
      f.y = 60
      drawHead()
    }
    if (ridx % 2 === 1) doc.rect(M, f.y - 5, R - M, rowH, { fill: [0.96, 0.965, 0.97] })
    let x = M + 4
    for (let i = 0; i < cols.length; i++) {
      const c = row[i]
      const txt = typeof c === 'string' ? c : c.t
      const color = typeof c === 'string' ? BLACK : (c.color ?? BLACK)
      const bold = typeof c === 'string' ? false : (c.bold ?? false)
      const align = cols[i].align ?? 'left'
      doc.text(align === 'right' ? x + cols[i].w - 8 : align === 'center' ? x + cols[i].w / 2 : x, f.y + 6, txt, {
        size: 8, color, bold,
        align: align === 'right' ? 'right' : align === 'center' ? 'center' : 'left',
      })
      x += cols[i].w
    }
    f.y += rowH
    doc.line(M, f.y - 5, R, f.y - 5, { width: 0.35 })
  })
  f.y += 8
}

// ─── TLORIS (2D risba XY modela z dimenzijami) ───────────────────────────────

function drawPlan (doc: ReturnType<typeof pdfDoc>, f: Flow, m: PlanModel): void {
  const boxW = R - M
  const boxH = 300
  ensure(doc, f, boxH + 80)
  const bx = M
  const by = f.y + 10

  // meje z robovom (degenerate veriga → minimalen okvir)
  const padCm = 30
  const minX = m.bounds.minX - padCm; const maxX = m.bounds.maxX + padCm
  const minY = m.bounds.minY - padCm; const maxY = m.bounds.maxY + padCm
  const spanX = Math.max(10, maxX - minX)
  const spanY = Math.max(10, maxY - minY)
  const scale = Math.min(boxW / spanX, boxH / spanY)
  // sredinska poravnava
  const offX = (boxW - spanX * scale) / 2
  const offY = (boxH - spanY * scale) / 2
  const tx = (x: number): number => bx + offX + (x - minX) * scale
  const ty = (y: number): number => by + boxH - (offY + (y - minY) * scale) // Y gor

  // okvir risbe
  doc.rect(bx, by, boxW, boxH, { stroke: [0.82, 0.84, 0.87], width: 0.75 })
  doc.rect(bx + 3, by + 3, boxW - 6, boxH - 6, { stroke: [0.93, 0.94, 0.95], width: 0.4 })

  // vozlišča (točke) — nariši PO segmentih, da so črte čez
  for (const s of m.segments) {
    const c = segColor(s.status)
    doc.line(tx(s.a.x), ty(s.a.y), tx(s.b.x), ty(s.b.y), { width: 2.4, color: c })
    // dimenzija ob daljici (zasuk glede na smer)
    const mx = (tx(s.a.x) + tx(s.b.x)) / 2
    const my = (ty(s.a.y) + ty(s.b.y)) / 2
    const dx = tx(s.b.x) - tx(s.a.x)
    const dy = ty(s.b.y) - ty(s.a.y)
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len // normala
    const ny = dx / len
    const off = 10
    const lx = mx + nx * off
    const ly = my + ny * off
    doc.text(lx, ly, `${s.key} · ${fmtM(s.lengthCm)}`, {
      size: 7, color: GRAY, align: 'center',
    })
  }

  // vozlišča — glifi
  for (const n of m.nodes) {
    const x = tx(n.p.x); const y = ty(n.p.y)
    const g = 2.2
    if (n.kind === 'VOGAL' || n.kind === 'STOPNISCE') {
      doc.rect(x - g, y - g, g * 2, g * 2, { fill: BLACK })
    } else if (n.kind === 'VRATA') {
      doc.rect(x - g * 1.4, y - g, g * 2.8, g * 2, { stroke: AMBER, width: 1.4 })
    } else {
      doc.rect(x - g, y - g, g * 2, g * 2, { fill: segColor('CONFIRMED') })
    }
    if (n.kind === 'ZACETEK') {
      doc.text(x + 5, y - 5, 'IZVOR (0,0)', { size: 6.5, color: LIGHT })
    }
    if (n.gateWcm != null) {
      doc.text(x, y + 12, `vrata ${fmtM(n.gateWcm)}`, { size: 6.5, color: [0.72, 0.45, 0.02], align: 'center' })
    } else if (n.heightCm != null) {
      doc.text(x, y + 12, `h ${fmtM(n.heightCm)}`, { size: 6.5, color: LIGHT, align: 'center' })
    }
  }

  // merilo (1 m) + smer +X — POŠTENO: brez severa (ga ne poznamo)
  const barCm = 100
  const barPt = barCm * scale
  const barX = bx + 12
  const barY = by + boxH - 14
  if (barPt > 8) {
    doc.line(barX, barY, barX + barPt, barY, { width: 1.2, color: BLACK })
    doc.line(barX, barY - 3, barX, barY + 3, { width: 1.2, color: BLACK })
    doc.line(barX + barPt, barY - 3, barX + barPt, barY + 3, { width: 1.2, color: BLACK })
    doc.text(barX + barPt / 2, barY + 9, '1 m', { size: 7, color: GRAY, align: 'center' })
  }
  // smer +X puščica zgoraj desno
  const ax = bx + boxW - 46
  const ay = by + 14
  doc.line(ax, ay, ax + 26, ay, { width: 1, color: GRAY })
  doc.line(ax + 26, ay, ax + 21, ay - 3, { width: 1, color: GRAY })
  doc.line(ax + 26, ay, ax + 21, ay + 3, { width: 1, color: GRAY })
  doc.text(ax, ay - 8, '+X (prvi segment)', { size: 6.5, color: GRAY })

  f.y = by + boxH + 18

  // legenda statusov
  const legend: string[] = ['OCENA', 'PREDLOG', 'ROČNO', 'KALIBR.', 'PREVERJENO', 'POTRJENO']
  const keys = ['ESTIMATED', 'AUTO_SUGGESTED', 'MANUAL', 'CALIBRATED', 'VERIFIED', 'CONFIRMED']
  let lx = M
  for (let i = 0; i < keys.length; i++) {
    const c = segColor(keys[i])
    doc.line(lx, f.y - 3, lx + 12, f.y - 3, { width: 2.2, color: c })
    doc.text(lx + 16, f.y, legend[i], { size: 6.5, color: GRAY })
    lx += 16 + doc.wrap(legend[i], 60, 6.5)[0] ? 62 : 62
  }
  f.y += 12
  const turnAssumption = m.quality.assumptions.find((a) => a.code === 'ZAVOJ_SMER_PRIVZETA')
  if (turnAssumption) {
    doc.text(M, f.y, `⚠ ${turnAssumption.message}`, { size: 7.5, color: [0.72, 0.45, 0.02] })
    f.y += 11
  }
  doc.text(M, f.y, m.originNote, { size: 7.5, color: LIGHT })
  f.y += 14
}

// ─── MONTAŽNA SKICA (odvita elevacija: teren + stebri + pritrditve + vrata) ──

function drawElevation (doc: ReturnType<typeof pdfDoc>, f: Flow, m: PlanModel, maxSpanCm: number | null): void {
  const boxW = R - M
  const boxH = 240
  ensure(doc, f, boxH + 90)
  const bx = M
  const by = f.y + 10

  const atMax = m.nodes.length > 0 ? m.nodes[m.nodes.length - 1].atCm : 100
  const atSpan = Math.max(100, atMax)
  const zAll = m.nodes.map((n) => n.p.z)
  const hAll = m.segments.map((s) => (s.heightCm != null ? s.heightCm : 0))
  const zMin = Math.min(0, ...zAll)
  const zMax = Math.max(100, ...zAll.map((z) => z), ...hAll) + 20
  const px = (atCm: number): number => bx + 16 + (atCm / atSpan) * (boxW - 32)
  const pz = (zCm: number): number => by + boxH - 18 - ((zCm - zMin) / Math.max(1, zMax - zMin)) * (boxH - 36)

  doc.rect(bx, by, boxW, boxH, { stroke: [0.82, 0.84, 0.87], width: 0.75 })

  // teren (polilinija skozi vozlišča)
  let prev: ModelNode | null = null
  for (const n of m.nodes) {
    if (prev) doc.line(px(prev.atCm), pz(prev.p.z), px(n.atCm), pz(n.p.z), { width: 1.6, color: [0.45, 0.5, 0.55] })
    prev = n
  }
  // šrafura pod terenom (kratke poševne)
  for (let i = 0; i + 1 < m.nodes.length; i++) {
    const a = m.nodes[i]; const b = m.nodes[i + 1]
    const x1 = px(a.atCm); const x2 = px(b.atCm)
    for (let x = x1 + 6; x < x2 - 2; x += 9) {
      const t = (x - x1) / Math.max(1, x2 - x1)
      const zg = a.p.z + (b.p.z - a.p.z) * t
      doc.line(x, pz(zg), x + 4, pz(zg) + 7, { width: 0.4, color: [0.78, 0.8, 0.83] })
    }
  }

  // ograja: zgornja linija po segmentih (višina polnila, če je znana)
  for (const s of m.segments) {
    const x1 = px(m.nodes[s.order]?.atCm ?? 0)
    const x2 = px(m.nodes[s.order + 1]?.atCm ?? atMax)
    const z1 = s.a.z; const z2 = s.b.z
    const c = segColor(s.status)
    if (s.heightCm != null) {
      doc.line(x1, pz(z1 + s.heightCm), x2, pz(z2 + s.heightCm), { width: 2.6, color: c })
      doc.line(x1, pz(z1), x1, pz(z1 + s.heightCm), { width: 1, color: c })
      doc.line(x2, pz(z2), x2, pz(z2 + s.heightCm), { width: 1, color: c })
    } else {
      doc.line(x1, pz(z1), x2, pz(z2), { width: 2, color: c })
      doc.text((x1 + x2) / 2, pz(Math.max(z1, z2)) - 8, `${s.key}: višina ni znana`, { size: 6, color: RED, align: 'center' })
    }
    // nagib
    doc.text((x1 + x2) / 2, pz(Math.max(z1, z2)) - 18, `${s.key} · ${fmtM(s.lengthCm)}${s.slopeDeg ? ` · ${numSI(s.slopeDeg, 1)}°` : ''}`, {
      size: 6.5, color: GRAY, align: 'center',
    })

    // vmesni stebri — enakomerno (PRIBLIŽEK, zapisan spodaj)
    if (s.posts > 0 && s.heightCm != null) {
      for (let i = 1; i <= s.posts; i++) {
        const t = i / (s.posts + 1)
        const x = x1 + (x2 - x1) * t
        const zg = z1 + (z2 - z1) * t
        doc.line(x, pz(zg), x, pz(zg + s.heightCm), { width: 0.8, color: [0.65, 0.68, 0.72] })
      }
    }
  }

  // vozlišča: pritrditev/podlaga/vrata
  for (const n of m.nodes) {
    const x = px(n.atCm); const y = pz(n.p.z)
    doc.line(x, y - 4, x, y + 4, { width: 1.6, color: BLACK })
    const tags: string[] = []
    if (n.pritrditev) tags.push(n.pritrditev)
    if (n.podlaga) tags.push(n.podlaga)
    if (n.gateWcm != null) tags.push(`VRATA ${fmtM(n.gateWcm)}`)
    if (tags.length > 0) {
      doc.text(x, y + 16, tags.join(' · '), { size: 6, color: [0.35, 0.38, 0.42], align: 'center' })
    }
    if (n.kind === 'VOGAL' && n.interiorDeg != null) {
      doc.text(x, y - 8, `∠${numSI(n.interiorDeg, 0)}°`, { size: 6.5, color: GRAY, align: 'center' })
    }
  }

  // os atCm (spodaj) z oznakami metrov
  const axisY = by + boxH - 6
  doc.line(bx + 16, axisY, bx + boxW - 16, axisY, { width: 0.5, color: LIGHT })
  const stepM = atSpan > 3000 ? 10 : atSpan > 900 ? 5 : 1
  for (let mtr = stepM; mtr * 100 <= atSpan; mtr += stepM) { // 0 izpustimo (izvor je označen)
    const x = px(mtr * 100)
    if (x > bx + boxW - 16) break
    doc.line(x, axisY - 3, x, axisY + 3, { width: 0.5, color: LIGHT })
    doc.text(x, axisY + 6, `${mtr} m`, { size: 6, color: LIGHT, align: 'center' })
  }

  f.y = by + boxH + 16
  doc.text(M, f.y, `Skupaj po teku: ${fmtM(m.totalLengthCm)} · tloris: ${fmtM(m.totalPlanCm)}${m.closureGapCm != null && m.nodes.length > 2 ? ` · odprtina: ${fmtM(m.closureGapCm)}` : ''}`, {
    size: 8, color: BLACK,
  })
  f.y += 12
  doc.text(M, f.y, 'Položaji vmesnih stebrov so prikazani enakomerno porazdeljeni (približek) — dejanski položaji se določijo na terenu.', {
    size: 7, color: LIGHT,
  })
  if (maxSpanCm != null) {
    f.y += 11
    doc.text(M, f.y, `Največji dovoljeni razpon med stebri: ${fmtM(maxSpanCm)} (pravilo max_razdalja_stebrov).`, { size: 7, color: GRAY })
  }
  f.y += 14
}

// ─── ODREZNI SEZNAM ───────────────────────────────────────────────────────────

function drawCutList (doc: ReturnType<typeof pdfDoc>, f: Flow, rows: CutListRow[], note: string | null): void {
  if (rows.length === 0) {
    doc.text(M, f.y, note ?? 'Odrezni seznam ni na voljo.', { size: 9, color: GRAY })
    f.y += 16
    return
  }
  // kompaktna opomba (vmesni/čelni/prvi-segment okrajšave) — stolpec je ozek
  const compactNote = (s: string): string => s
    .replace(' (prvi segment: + začetni)', ' (+zač.)')
    .replace('vmesni ', 'vm. ').replace('čelni ', 'čel. ')
    .replace(' polnila', '').replace(' polnil', '')
    .replace('ročnika/profila', 'roč./profil')
  drawTable(doc, f,
    [{ w: 66 }, { w: 146 }, { w: 46, align: 'center' }, { w: 58, align: 'right' }, { w: 36, align: 'center' }, { w: 147 }],
    ['SKU', 'Artikel', 'Segment', 'Količina', 'Enota', 'Odpad / opomba'],
    rows.map((r) => [
      r.sku, r.name, r.segmentKey, numSI(r.qty, r.qty % 1 === 0 ? 0 : 2), r.unit,
      `${r.wastePct != null ? `+${numSI(r.wastePct, 0)} %` : '—'} · ${compactNote(r.note)}`,
    ]),
  )
  if (note) {
    doc.text(M, f.y, note, { size: 7.5, color: [0.72, 0.45, 0.02] })
    f.y += 12
  }
}

// ─── Fotografije (sličice zajema) ────────────────────────────────────────────

function dataUrlToJpeg (dataUrl: string | null | undefined): Uint8Array | null {
  if (!dataUrl || !dataUrl.startsWith('data:image/jpeg;base64,')) return null
  try {
    const buf = Buffer.from(dataUrl.slice('data:image/jpeg;base64,'.length), 'base64')
    return buf.length > 100 && jpegSize(buf) ? buf : null
  } catch {
    return null
  }
}

function drawPhotos (doc: ReturnType<typeof pdfDoc>, f: Flow, photos: PackagePhoto[]): void {
  if (photos.length === 0) {
    doc.text(M, f.y, '— ni sličic zajema za ta tekač —', { size: 9, color: GRAY })
    f.y += 16
    return
  }
  const perRow = 2
  const gap = 12
  const w = (R - M - gap) / perRow
  let i = 0
  for (const ph of photos) {
    if (i % perRow === 0) ensure(doc, f, 190)
    const x = M + (i % perRow) * (w + gap)
    const jpeg = dataUrlToJpeg(ph.thumb)
    doc.rect(x, f.y, w, 150, { stroke: [0.85, 0.87, 0.89], width: 0.5 })
    if (jpeg) {
      const size = jpegSize(jpeg)
      if (size) {
        // vstavi v okvir 150pt višine, ohrani razmerje, centrirano
        const ih = Math.min(150, (w * size.height) / size.width)
        const iw = (ih / size.height) * size.width
        doc.image(x + (w - iw) / 2, f.y + (150 - ih) / 2, iw, ih, jpeg)
      }
    } else {
      doc.text(x + w / 2, f.y + 78, '— sličica ni na voljo —', { size: 8, color: LIGHT, align: 'center' })
    }
    doc.text(x + 4, f.y + 160, `${ph.zone}${ph.label ? ` — ${ph.label}` : ''}`, { size: 7, color: GRAY })
    i++
    if (i % perRow === 0) f.y += 172
  }
  if (i % perRow !== 0) f.y += 172
  f.y += 4
}

// ─── Glavni renderer ─────────────────────────────────────────────────────────

export function renderMeasurePackagePdf (inp: MeasurePackageInput): Uint8Array<ArrayBuffer> {
  const doc = pdfDoc()
  const m = inp.model

  doc.footer((page, total, d) => {
    d.line(M, 792, R, 792, { width: 0.5 })
    d.text(M, 806, 'Roksal · merilni paket — tekač je vir resnice', { size: 8, color: LIGHT })
    d.text(PAGE_W / 2, 806, `Stran ${page + 1} / ${total}`, { size: 8, color: LIGHT, align: 'center' })
    d.text(R, 806, `${inp.run.id.slice(-8)} · ${MEASURE_PACKAGE_VERSION}`, { size: 8, color: LIGHT, align: 'right' })
  })

  // ── glava
  doc.text(M, 54, 'ROKSAL RAILING MANAGER', { size: 16, bold: true, color: NAVY })
  doc.text(R, 50, 'info@roksal.si · +386 1 234 56 78', { size: 8, color: GRAY, align: 'right' })
  doc.text(R, 60, 'Lesarska cesta 12, 2380 Slovenj Graddek', { size: 8, color: GRAY, align: 'right' })
  doc.line(M, 70, R, 70, { width: 2.5, color: AMBER })

  doc.text(M, 102, 'MERILNI PAKET', { size: 22, bold: true })
  doc.text(R, 96, inp.run.name, { size: 12, bold: true, color: NAVY, align: 'right' })
  doc.text(R, 110, `Status tekača: ${inp.run.status} · ${fmtDate(inp.run.createdAt)}`, { size: 9, color: GRAY, align: 'right' })
  doc.text(R, 123, `Izdelek: ${inp.product ? `${inp.product.name} (${inp.product.sku})` : '— ni vezan izdelek —'}`, { size: 9, color: GRAY, align: 'right' })
  if (inp.variant) doc.text(R, 136, `Varianta: ${inp.variant.name}${inp.variant.ral ? ` — ${inp.variant.ral}` : ''}`, { size: 9, color: GRAY, align: 'right' })

  const f: Flow = { y: 150 }

  // meta blok
  doc.text(M, f.y, 'PODATKI IZMERE', { size: 8, bold: true, color: LIGHT }); f.y += 14
  const metaRows: [string, string][] = [
    ['Projekt', inp.project ? `${inp.project.code} — ${inp.project.title}` : '—'],
    ['Stranka', inp.project?.customer ?? '—'],
    ['Kalibracija', inp.calibration ? `${inp.calibration.method} · referenca ${fmtM(inp.calibration.refValueCm)}` : '— brez kalibracije (mere so ocena) —'],
    ['Napaka položaja', inp.rules.sigmaCm != null ? `± ${numSI(inp.rules.sigmaCm, 1)} cm (${inp.rules.sigmaSource})` : `— (${inp.rules.sigmaSource})`],
    ['Preverjeni segmenti', `${Math.round(m.quality.verifiedShare * 100)} % (${m.quality.unverified} nepreverjenih)`],
    ['Quality gate', m.quality.gate ? `${m.quality.gate.state} (${numSI(m.quality.gate.score, 0)}/100)` : '—'],
    ['Skupna dolžina', `${fmtM(m.totalLengthCm)} po padini · ${fmtM(m.totalPlanCm)} po tlorisu`],
    ['Segmentov / vozlišč', `${m.segments.length} / ${m.nodes.length}`],
  ]
  for (const [k, v] of metaRows) {
    doc.text(M, f.y, `${k}:`, { size: 9, bold: true, color: BLACK })
    doc.text(M + 110, f.y, v, { size: 9, color: GRAY })
    f.y += 13
  }
  f.y += 12

  // ── R509 (issue #7 §8): avtor, zgodovina sprememb in izvirniki zajemov ────
  // Dokument je moral doslej pokazati samo MERITVE — pisarna in stranka nista
  // videli, KDO je meritev potrdil, KAJ se je po tem spremenilo in KATERE
  // originalne fotografije so bile pod njo. Brez teh podatkov PDF ni dokazni
  // dokument — v njem so samo lepe številke.
  if (inp.avtor || (inp.zgodovina?.length ?? 0) > 0 || (inp.originali?.length ?? 0) > 0) {
    doc.text(M, f.y, 'DOKAZNA VERIGA DOKUMENTA', { size: 8, bold: true, color: LIGHT })
    f.y += 14
    if (inp.avtor) {
      ensure(doc, f, 13)
      doc.text(M, f.y, 'Potrdil:', { size: 9, bold: true, color: BLACK })
      doc.text(M + 110, f.y, `${inp.avtor.ime}${inp.avtor.vloga ? ` (${inp.avtor.vloga})` : ''} · ${fmtDate(inp.avtor.ustvarjeno)}`, { size: 9, color: GRAY })
      f.y += 13
    }
    for (const v of inp.zgodovina ?? []) {
      ensure(doc, f, 12)
      doc.text(M, f.y, `v${v.verzija}`, { size: 8, bold: true, color: BLACK })
      doc.text(M + 40, f.y, fmtDateTime(v.kdaj), { size: 8, color: GRAY })
      doc.text(M + 150, f.y, v.avtor ?? '—', { size: 8, color: GRAY })
      doc.text(M + 260, f.y, v.opomba ?? '—', { size: 8, color: GRAY })
      f.y += 12
    }
    for (const o of inp.originali ?? []) {
      ensure(doc, f, 12)
      doc.text(M, f.y, 'izvirnik', { size: 8, bold: true, color: BLACK })
      doc.text(M + 40, f.y, `${o.id.slice(-8)} · ${o.bayti} B · SHA-256 ${o.sha256 ? `${o.sha256.slice(0, 16)}…` : '— (ni datoteke)'}`, { size: 8, color: GRAY })
      doc.text(M + 420, f.y, o.lokacija ?? '—', { size: 8, color: GRAY })
      f.y += 12
    }
    f.y += 12
  }

  // ── 1. TLORIS
  sectionTitle(doc, f, '1', 'Tloris (merilni model)')
  drawPlan(doc, f, m)

  // ── 2. MONTAŽNA SKICA
  sectionTitle(doc, f, '2', 'Montažna skica (odvita elevacija)')
  drawElevation(doc, f, m, inp.rules.maxRazdaljaStebrovCm)

  // ── 3. TABELA SEGMENTOV
  sectionTitle(doc, f, '3', 'Segmenti')
  drawTable(doc, f,
    [{ w: 44, align: 'center' }, { w: 66, align: 'right' }, { w: 66, align: 'right' }, { w: 56, align: 'right' }, { w: 42, align: 'right' }, { w: 38, align: 'center' }, { w: 72 }, { w: 121 }],
    ['Segment', 'Dolžina', 'Tloris', 'Višina', 'Nagib', 'Stebri', 'Status', 'Preverjeno'],
    m.segments.map((s: ModelSegment) => [
      s.key, fmtM(s.lengthCm), fmtM(s.planCm), fmtM(s.heightCm), s.slopeDeg ? `${numSI(s.slopeDeg, 1)}°` : '—',
      { t: String(s.posts), align: 'center' },
      { t: STATUS_LABEL[s.status] ?? s.status, color: segColor(s.status), bold: s.status === 'VERIFIED' || s.status === 'CONFIRMED' },
      s.verifiedCm != null ? `${fmtM(s.verifiedCm)} (${s.verifyMethod ?? '—'})` : '—',
    ] as (string | { t: string; color?: Rgb; bold?: boolean })[]),
  )

  // ── 4. TABELA VOZLIŠČ
  sectionTitle(doc, f, '4', 'Vozlišča')
  drawTable(doc, f,
    [{ w: 52 }, { w: 68 }, { w: 52, align: 'right' }, { w: 54, align: 'right' }, { w: 84 }, { w: 84 }, { w: 63, align: 'right' }, { w: 50 }],
    ['Vozlišče', 'Vrsta', '@ teku', 'Višina', 'Pritrditev', 'Podlaga', 'Vrata', 'Ročno'],
    m.nodes.map((n: ModelNode) => [
      n.key, NODE_LABEL[n.kind] ?? n.kind, fmtM(n.atCm), fmtM(n.heightCm),
      n.pritrditev ?? '—', n.podlaga ?? '—', n.gateWcm != null ? fmtM(n.gateWcm) : '—',
      n.manual ? 'DA' : '—',
    ]),
  )

  // ── 5. ODREZNI SEZNAM
  sectionTitle(doc, f, '5', 'Proizvodni odrezni seznam')
  drawCutList(doc, f, inp.cutList, inp.cutListNote)

  // ── 6. FOTOGRAFIJE
  sectionTitle(doc, f, '6', 'Fotografije zajema (dokazila)')
  drawPhotos(doc, f, inp.photos)

  // ── 7. KAKOVOST IN PREDPOSTAVKE
  sectionTitle(doc, f, '7', 'Kakovost, predpostavke in preverjanja')
  ensure(doc, f, 60)
  if (m.quality.assumptions.length > 0) {
    doc.text(M, f.y, 'Predpostavke izpeljave:', { size: 9, bold: true })
    f.y += 13
    for (const a of m.quality.assumptions) {
      doc.text(M + 8, f.y, `${a.severity === 'OPOZORILO' ? '⚠' : 'ℹ'} [${a.code}] ${a.message}`, {
        size: 8, color: a.severity === 'OPOZORILO' ? [0.72, 0.45, 0.02] : GRAY,
      })
      f.y += 12
    }
    f.y += 6
  }
  const checks = [
    ...inp.checks,
    ...(inp.calibration == null ? [{
      code: 'BREZ_KALIBRACIJE', severity: 'OPOZORILO' as const,
      message: 'Tekač nima referenčne kalibracije — mere so ocena; dokument ni merilno zanesljiv.',
    }] : []),
  ]
  if (checks.length > 0) {
    ensure(doc, f, 40)
    doc.text(M, f.y, 'Preverjanja pred izvozom (inženirska pravila):', { size: 9, bold: true })
    f.y += 13
    for (const c of checks) {
      doc.text(M + 8, f.y, `${c.severity === 'OPOZORILO' ? '⚠' : 'ℹ'} [${c.code}] ${c.message}`, {
        size: 8, color: c.severity === 'OPOZORILO' ? RED : GRAY,
      })
      f.y += 12
    }
    f.y += 6
  }
  ensure(doc, f, 40)
  doc.rect(M, f.y, R - M, 22, { fill: [0.996, 0.949, 0.851] })
  doc.text(M + 8, f.y + 14, 'Vir resnice je ograjni tekač; risba je izpeljava (model-core/1.0) — nezajeti in nepreverjeni deli so vidno označeni.', {
    size: 8.5, bold: true, color: [0.55, 0.35, 0.02],
  })
  f.y += 34
  if (inp.run.note && inp.run.note.trim()) {
    doc.text(M, f.y, 'Opomba tekača:', { size: 8, bold: true, color: LIGHT })
    f.y += 12
    for (const l of doc.wrap(inp.run.note, R - M - 8, 9)) {
      doc.text(M, f.y, l, { size: 9, color: GRAY })
      f.y += 11
    }
  }

  return doc.build()
}
