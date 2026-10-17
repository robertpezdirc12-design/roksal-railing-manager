// src/lib/handover-pdf.ts — R489 (GitHub issue #12 §2D): PRIMOPREDAJNI ZAPIS PDF.
// Zadnja stran dokumentacije primopredaje: kontrolne točke, odstopanja in
// ukrepi, primerjava načrtovano/potrjeno/izvedeno (seg-N, z virom mere),
// fotografije pred/med/po, potrditvi monterja in stranke (podpis na zaslonu =
// ZABELEŽENA potrditev — NE kvalificiran e-podpis; izrecna opomba v PDF).
// Lasten generator pdf-mini (vzorec merilni paket, R477).

import { NextResponse } from 'next/server'
import type { SessionUser } from '@/lib/auth'
import { readsAllData } from '@/lib/auth'
import { db } from '@/lib/db'
import { asJsonObject } from '@/lib/json'
import { pdfDoc, NAVY, AMBER, GRAY, LIGHT, type Rgb } from '@/lib/pdf-mini'

export const HANDOVER_PDF_VERSION = 'handover-pdf/1.0'

const M = 48
const R = 595 - 48
const BLACK: Rgb = [0.08, 0.09, 0.11]
const GREEN: Rgb = [0.05, 0.55, 0.35]
const RED: Rgb = [0.75, 0.15, 0.15]

export interface HandoverCheckRow {
  label: string
  status: string
  critical: boolean
  targetKey: string | null
  checkedBy: string | null
  checkedAt: Date | null
}

export interface HandoverActionRow { description: string; status: string; assignee: string | null }

export interface HandoverDeviationRow {
  reason: string
  impactSafety: boolean
  impactPrice: boolean
  impactMaterial: boolean
  resolvedAt: Date | null
  actions: HandoverActionRow[]
}

export interface HandoverPhotoRow { id: string; stage: string; thumb: string | null }

export interface HandoverPdfInput {
  reportId: string
  workOrderCode: string
  workOrderTitle: string
  version: number
  status: string
  builtAt: Date
  summary: string | null
  project: { code: string; title: string } | null
  customer: string | null
  monter: { name: string | null; at: Date | null } | null
  customerSign: { name: string | null; at: Date | null; remark: string | null; signature: string | null } | null
  checks: HandoverCheckRow[]
  deviations: HandoverDeviationRow[]
  diff: {
    primerjava: { key: string; nacrtCm: number | null; izvedenoCm: number | null; ujema: boolean | null }[]
    nacrtVir: string | null
    izvedenoVir: string | null
  }
  photos: HandoverPhotoRow[]
}

const STATUS_LABEL: Record<string, string> = {
  NI_ZACETO: 'Ni začeto',
  V_REDU: 'V redu',
  NAPAKA: 'Napaka',
  NI_RELEVANTNO: 'Ni relevantno',
  CAKA_PREVERJANJE: 'Čaka na preverjanje',
  ZAKLJUCENA: 'ZAKLJUČENA',
  POGOJNA: 'POGOJNA',
  NEPOPOLNA: 'NEPOPOLNA',
}

function fmtDate (d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('sl-SI', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtDateTime (d: Date | null): string {
  if (!d) return '—'
  return `${fmtDate(d)} ${d.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' })}`
}
function cm (v: number | null): string {
  return v == null ? '—' : `${Math.round(v)} cm`
}

function dataUrlJpeg (dataUrl: string | null): Uint8Array | null {
  if (!dataUrl || !dataUrl.startsWith('data:image/jpeg;base64,')) return null
  try {
    const b64 = dataUrl.slice('data:image/jpeg;base64,'.length)
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

export function renderHandoverPdf (inp: HandoverPdfInput): Uint8Array<ArrayBuffer> {
  const doc = pdfDoc()

  doc.footer((page, total, d) => {
    d.line(M, 792, R, 792, { width: 0.5 })
    d.text(M, 806, 'Roksal · primopredajni zapis — poročilo je verzionirano', { size: 8, color: LIGHT })
    d.text(595 / 2, 806, `Stran ${page + 1} / ${total}`, { size: 8, color: LIGHT, align: 'center' })
    d.text(R, 806, `${inp.reportId.slice(-8)} · ${HANDOVER_PDF_VERSION}`, { size: 8, color: LIGHT, align: 'right' })
  })

  // ── glava
  doc.text(M, 54, 'ROKSAL RAILING MANAGER', { size: 16, bold: true, color: NAVY })
  doc.text(R, 50, 'info@roksal.si · +386 1 234 56 78', { size: 8, color: GRAY, align: 'right' })
  doc.text(R, 60, 'Lesarska cesta 12, 2380 Slovenj Graddek', { size: 8, color: GRAY, align: 'right' })
  doc.line(M, 70, R, 70, { width: 2.5, color: AMBER })

  doc.text(M, 102, 'PRIMOPREDAJNI ZAPIS', { size: 22, bold: true })
  doc.text(R, 96, `Nalog ${inp.workOrderCode}`, { size: 12, bold: true, color: NAVY, align: 'right' })
  const statusColor = inp.status === 'ZAKLJUCENA' ? GREEN : inp.status === 'POGOJNA' ? AMBER : RED
  doc.text(R, 110, `Status primopredaje: ${STATUS_LABEL[inp.status] ?? inp.status}`, { size: 10, bold: true, color: statusColor, align: 'right' })
  doc.text(R, 123, `Verzija poročila ${inp.version} · zgrajeno ${fmtDateTime(inp.builtAt)}`, { size: 9, color: GRAY, align: 'right' })

  let y = 150

  // ── meta
  doc.text(M, y, 'PODATKI PRIMOPREDAJE', { size: 8, bold: true, color: LIGHT }); y += 14
  const meta: [string, string][] = [
    ['Projekt', inp.project ? `${inp.project.code} — ${inp.project.title}` : '—'],
    ['Stranka', inp.customer ?? '—'],
    ['Delovni nalog', `${inp.workOrderCode} — ${inp.workOrderTitle}`],
    ['Izdal poročilo', `${fmtDate(inp.builtAt)} (verzija ${inp.version})`],
  ]
  for (const [k, v] of meta) {
    doc.text(M, y, `${k}:`, { size: 9, bold: true, color: BLACK })
    doc.text(M + 110, y, v, { size: 9, color: GRAY })
    y += 13
  }
  y += 6

  if (inp.summary) {
    doc.text(M, y, 'POVZETEK IZVEDBE', { size: 8, bold: true, color: LIGHT }); y += 13
    for (const line of doc.wrap(inp.summary, R - M, 9).slice(0, 10)) {
      doc.text(M, y, line, { size: 9, color: BLACK }); y += 12
    }
    y += 6
  }

  // ── kontrolne točke
  doc.text(M, y, `KONTROLNE TOČKE MONTAŽE (${inp.checks.length})`, { size: 8, bold: true, color: LIGHT }); y += 14
  doc.text(M, y, 'Točka', { size: 8, bold: true, color: BLACK })
  doc.text(R - 128, y, 'Status', { size: 8, bold: true, color: BLACK })
  doc.text(R - 38, y, 'Preveril', { size: 8, bold: true, color: BLACK, align: 'right' })
  y += 4; doc.line(M, y, R, y); y += 8
  for (const c of inp.checks.slice(0, 40)) {
    const label = doc.wrap(`${c.critical ? '★ ' : ''}${c.label}`, R - M - 175, 8)[0] ?? c.label
    doc.text(M, y, label, { size: 8, color: BLACK })
    doc.text(R - 128, y, STATUS_LABEL[c.status] ?? c.status, { size: 8, color: c.status === 'NAPAKA' ? RED : c.status === 'V_REDU' ? GREEN : GRAY })
    doc.text(R - 38, y, c.checkedBy ?? '—', { size: 8, color: GRAY, align: 'right' })
    y += 12
    if (y > 730) { doc.addPage(); y = 60 }
  }
  if (inp.checks.length === 0) { doc.text(M, y, '— ni kontrolnih točk (nalog brez montažnega QA) —', { size: 8, color: GRAY }); y += 12 }
  y += 8

  // ── odstopanja + ukrepi
  doc.text(M, y, `ODSTOPANJA IN KOREKTIVNI UKREPI (${inp.deviations.length})`, { size: 8, bold: true, color: LIGHT }); y += 14
  if (inp.deviations.length === 0) {
    doc.text(M, y, '— ni odstopanj od potrjenega načrta —', { size: 8, color: GRAY }); y += 12
  }
  for (const d of inp.deviations.slice(0, 20)) {
    const vpliv = [d.impactSafety ? 'VARNOST' : null, d.impactPrice ? 'CENA' : null, d.impactMaterial ? 'MATERIAL' : null].filter(Boolean).join('/') || 'brez vpliva'
    const reason = doc.wrap(d.reason, R - M - 60, 8)[0] ?? d.reason
    doc.text(M, y, reason, { size: 8, bold: true, color: BLACK })
    doc.text(R, y, d.resolvedAt ? `odpravljeno ${fmtDate(d.resolvedAt)}` : 'NEREŠENO', { size: 8, bold: true, color: d.resolvedAt ? GREEN : RED, align: 'right' })
    y += 11
    doc.text(M + 8, y, `vpliv: ${vpliv}`, { size: 7, color: GRAY })
    y += 10
    for (const a of d.actions.slice(0, 6)) {
      const desc = doc.wrap(`• ${a.description}`, R - M - 100, 7)[0] ?? a.description
      doc.text(M + 16, y, desc, { size: 7, color: BLACK })
      doc.text(R, y, `${a.status}${a.assignee ? ` — ${a.assignee}` : ''}`, { size: 7, color: GRAY, align: 'right' })
      y += 9
    }
    if (y > 730) { doc.addPage(); y = 60 }
  }
  y += 8

  // ── primerjava segmentov
  doc.text(M, y, 'PRIMERJAVA NAČRTOVANO / IZVEDENO (seg-N)', { size: 8, bold: true, color: LIGHT }); y += 14
  doc.text(M, y, 'Segment', { size: 8, bold: true, color: BLACK })
  doc.text(M + 180, y, 'Načrtovano', { size: 8, bold: true, color: BLACK })
  doc.text(M + 270, y, 'Izvedeno', { size: 8, bold: true, color: BLACK })
  doc.text(R, y, 'Ujema', { size: 8, bold: true, color: BLACK, align: 'right' })
  y += 4; doc.line(M, y, R, y); y += 8
  if (inp.diff.primerjava.length === 0) {
    doc.text(M, y, '— ni segmentov (vir: brez potrjenega tekača/dvojčka) —', { size: 8, color: GRAY }); y += 12
  }
  for (const p of inp.diff.primerjava.slice(0, 30)) {
    doc.text(M, y, p.key, { size: 8, color: BLACK })
    doc.text(M + 180, y, cm(p.nacrtCm), { size: 8, color: GRAY })
    doc.text(M + 270, y, cm(p.izvedenoCm), { size: 8, color: GRAY })
    doc.text(R, y, p.ujema == null ? '—' : p.ujema ? 'DA' : 'NE', { size: 8, bold: true, color: p.ujema == null ? GRAY : p.ujema ? GREEN : RED, align: 'right' })
    y += 12
  }
  if (inp.diff.nacrtVir) {
    doc.text(M, y, `Vir načrtovane mere: ${inp.diff.nacrtVir}`, { size: 7, color: LIGHT }); y += 9
  }
  if (inp.diff.izvedenoVir) {
    doc.text(M, y, `Vir izvedene mere: ${inp.diff.izvedenoVir}`, { size: 7, color: LIGHT }); y += 9
  }
  y += 6

  // ── fotografije
  if (inp.photos.length > 0) {
    if (y > 620) { doc.addPage(); y = 60 }
    doc.text(M, y, `FOTOGRAFIJE PRED / MED / PO (${inp.photos.length})`, { size: 8, bold: true, color: LIGHT }); y += 10
    const cols = 4
    const cellW = (R - M) / cols
    const imgW = cellW - 6
    const imgH = 52
    let col = 0
    let rowY = y
    for (const p of inp.photos.slice(0, 12)) {
      const bytes = dataUrlJpeg(p.thumb)
      const x = M + col * cellW
      doc.text(x, rowY, p.stage, { size: 6, bold: true, color: p.stage === 'PRED' ? GRAY : p.stage === 'PO' ? GREEN : AMBER })
      if (bytes) doc.image(x, rowY + 8, imgW, imgH, bytes)
      else doc.rect(x, rowY + 8, imgW, imgH, { stroke: LIGHT })
      col++
      if (col >= cols) { col = 0; rowY += imgH + 16; if (rowY > 730) { doc.addPage(); rowY = 60 } }
    }
    y = rowY + (col > 0 ? imgH + 16 : 0) + 8
  }

  // ── potrditvi
  if (y > 620) { doc.addPage(); y = 60 }
  doc.text(M, y, 'POTRDITVI', { size: 8, bold: true, color: LIGHT }); y += 14
  doc.text(M, y, 'Monter:', { size: 9, bold: true, color: BLACK })
  doc.text(M + 60, y, inp.monter?.at ? `${inp.monter?.name ?? '—'} · ${fmtDateTime(inp.monter.at)}` : '— ni potrjeno —', { size: 9, color: inp.monter?.at ? BLACK : RED })
  y += 14
  doc.text(M, y, 'Stranka:', { size: 9, bold: true, color: BLACK })
  doc.text(M + 60, y, inp.customerSign?.at ? `${inp.customerSign?.name ?? '—'} · ${fmtDateTime(inp.customerSign.at)}` : '— ni podpisano —', { size: 9, color: inp.customerSign?.at ? BLACK : RED })
  y += 12
  if (inp.customerSign?.remark) {
    doc.text(M, y, 'Pripomba stranke:', { size: 8, bold: true, color: BLACK }); y += 11
    for (const line of doc.wrap(inp.customerSign.remark, R - M - 8, 8).slice(0, 6)) {
      doc.text(M + 8, y, line, { size: 8, color: BLACK }); y += 10
    }
    y += 4
  }
  // podpisna slika
  const sig = dataUrlJpeg(inp.customerSign?.signature ?? null)
  if (sig) {
    if (y > 620) { doc.addPage(); y = 60 }
    doc.text(M, y, 'Zabeležena potrditev stranke (podpis na zaslonu):', { size: 8, color: GRAY }); y += 6
    doc.image(M, y, 170, 56, sig)
    y += 64
  }

  // ── izrecna opomba (issue #12 §2D: ne trdi kvalificiranega e-podpisa)
  if (y > 720) { doc.addPage(); y = 60 }
  doc.rect(M, y, R - M, 30, { fill: [0.97, 0.97, 0.98] })
  doc.text(M + 6, y + 11, 'Podpis na zaslonu je zabeležena potrditev v sistemu Roksal Railing Manager', { size: 7, bold: true, color: BLACK })
  doc.text(M + 6, y + 21, 'in ni kvalificiran elektronski podpis. Poročilo je verzionirano; zgodovina verzij ostaja v sistemu.', { size: 7, color: GRAY })

  return doc.build()
}

/** Naloži vse podatke poročila (z obsegom: monter svoj nalog ali readsAllData)
 *  in zrendera PDF. Fail-closed na tuj nalog. */
export async function handoverPdfZaUporabnika (
  user: SessionUser,
  reportId: string
): Promise<{ bytes: Uint8Array<ArrayBuffer>; code: string; projectId: string | null } | NextResponse> {
  const report = await db.handoverReport.findUnique({
    where: { id: reportId },
    include: {
      monterConfirmedBy: { select: { name: true } },
      workOrder: {
        select: {
          id: true, code: true, title: true, assigneeId: true,
          project: { select: { id: true, code: true, title: true, customer: { select: { name: true } } } },
        },
      },
    },
  })
  if (!report) {
    return NextResponse.json({ error: 'Poročilo primopredaje ne obstaja.' }, { status: 404 })
  }
  if (!readsAllData(user) && report.workOrder.assigneeId !== user.id) {
    return NextResponse.json({ error: 'Nalog ni v vašem obsegu.' }, { status: 403 })
  }

  const [checks, deviations] = await Promise.all([
    db.montazaCheck.findMany({
      where: { workOrderId: report.workOrderId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { checkedBy: { select: { name: true } } },
    }),
    db.montazaDeviation.findMany({
      where: { workOrderId: report.workOrderId },
      orderBy: { createdAt: 'asc' },
      include: { actions: { include: { assignee: { select: { name: true } } } } },
    }),
  ])

  // R542: diffJson je jsonb objekt — branje brez JSON.parse (obramba za
  // neobjektno obliko ostane prek asJsonObject)
  let diff: HandoverPdfInput['diff'] = { primerjava: [], nacrtVir: null, izvedenoVir: null }
  {
    const parsed = asJsonObject(report.diffJson) as {
      primerjava?: HandoverPdfInput['diff']['primerjava']
      nacrtovano?: { source: string }[]
      izvedeno?: { source: string }[]
    } | null
    diff = {
      primerjava: parsed?.primerjava ?? [],
      nacrtVir: parsed?.nacrtovano?.[0]?.source ?? null,
      izvedenoVir: parsed?.izvedeno?.[0]?.source ?? null,
    }
  }

  let photos: HandoverPhotoRow[] = []
  {
    // R542: photosJson je jsonb tabela — brez JSON.parse
    const refs = Array.isArray(report.photosJson) ? report.photosJson as unknown as { id: string; stage: string }[] : []
    // naloži palačinko (thumbnail) vsake FOTO meritve — zmerno število
    const ids = refs.slice(0, 12).map((r) => r.id)
    const rows = ids.length > 0
      ? await db.measurement.findMany({ where: { id: { in: ids }, type: 'FOTO' }, select: { id: true, params: true } })
      : []
    const byId = new Map(rows.map((r) => [r.id, r.params]))
    photos = refs.slice(0, 12).map((r) => {
      // R542: params je jsonb objekt — brez JSON.parse
      const p = asJsonObject(byId.get(r.id))
      const thumb = typeof p?.photo === 'string' ? p.photo : null
      return { id: r.id, stage: r.stage, thumb }
    })
  }

  const bytes = renderHandoverPdf({
    reportId: report.id,
    workOrderCode: report.workOrder.code,
    workOrderTitle: report.workOrder.title,
    version: report.version,
    status: report.status,
    builtAt: report.createdAt,
    summary: report.summary,
    project: report.workOrder.project
      ? { code: report.workOrder.project.code, title: report.workOrder.project.title }
      : null,
    customer: report.workOrder.project?.customer?.name ?? null,
    monter: report.monterConfirmedAt
      ? { name: report.monterConfirmedBy?.name ?? null, at: report.monterConfirmedAt }
      : null,
    customerSign: {
      name: report.customerSignedBy,
      at: report.customerSignedAt,
      remark: report.customerRemark,
      signature: report.customerSignature,
    },
    checks: checks.map((c) => ({
      label: c.label,
      status: c.status,
      critical: c.critical,
      targetKey: c.targetKey,
      checkedBy: c.checkedBy?.name ?? null,
      checkedAt: c.checkedAt,
    })),
    deviations: deviations.map((d) => ({
      reason: d.reason,
      impactSafety: d.impactSafety,
      impactPrice: d.impactPrice,
      impactMaterial: d.impactMaterial,
      resolvedAt: d.resolvedAt,
      actions: d.actions.map((a) => ({ description: a.description, status: a.status, assignee: a.assignee?.name ?? null })),
    })),
    diff,
    photos,
  })

  return { bytes, code: `primopredaja-${report.workOrder.code}-v${report.version}`, projectId: report.projectId }
}
