// src/lib/montaza-qa-core.ts — R489 (GitHub issue #12, P1):
// MONTAŽA QA & PRIMOPREDAJA — jedro poslovne logike.
//
// Načela (iz issueja #12):
//  • PODATKOVNO VEDEN kontrolni seznam: točke nastanejo IZ virov (aktivna
//    playbook definicija MONTAZA, segmenti potrjenega tekača/dvojčka AS-DESIGNED,
//    aktivna inženirska pravila) — nikoli hardcoded brez vira; vsaka točka nosi
//    templateKey + templateVersion (snapshot — sprememba predloge NE spremeni
//    že izvedene montaže za nazaj, §3);
//  • statusni stroj točk: NI_ZACETO | V_REDU | NAPAKA | NI_RELEVANTNO |
//    CAKA_PREVERJANJE — NAPAKA zahteva razlog in ustvari ODSTOPANJE (sledljiv
//    zapis), NI_RELEVANTNO zahteva razlog, odprava (→ V_REDU) zahteva
//    resolutionNote (prejšnjih statusov/fotografij NE prepišemo);
//  • korektivni ukrepi: linearni tok ODPRTO → V_OBRAVNAVI → ODRAVLJENO →
//    PREVERJENO (odgovorna oseba + rok + dokazilo);
//  • kritična nerešena napaka BLOKIRA zaključek naloga (preveriBlokado — uporabita
//    jo OBE poti: /api/nalog/[id]/transition IN sync opTransition);
//  • primopredaja: verzionirano poročilo (zgodovina ostane), podpis na zaslonu
//    je ZABELEŽENA potrditev (NE kvalificiran elektronski podpis), status
//    ZAKLJUCENA | POGOJNA | NEPOPOLNA — poročilo NIKOLI ne pokaže navideznega
//    popolnega zaključka, če obstajajo odprte zadeve.
//
// Strežniški TS (brez 'use client') — rute in /api/sync delita ISTO logiko
// (sync je transport, ne nov sistem — vzorec R439).

import type { SessionUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { writeAudit } from '@/lib/audit'
import { emitEvent } from '@/lib/notify'
import { readsAllData } from '@/lib/auth'
import { PLAYBOOK_MONTAZA, deserializiraj, type PlaybookDefinition, type PlaybookStep } from '@/lib/playbook-core'
import { segmentsZaProjekt } from '@/lib/capture-qa-service'
import { asJsonObject } from '@/lib/json'
import type { Prisma } from '@prisma/client'

// ── statusni prostori ───────────────────────────────────────────────────────

export const QA_STATUSI = ['NI_ZACETO', 'V_REDU', 'NAPAKA', 'NI_RELEVANTNO', 'CAKA_PREVERJANJE'] as const
export type QaStatus = (typeof QA_STATUSI)[number]

export const QA_STATUS_LABELI: Record<QaStatus, string> = {
  NI_ZACETO: 'Ni začeto',
  V_REDU: 'V redu',
  NAPAKA: 'Napaka',
  NI_RELEVANTNO: 'Ni relevantno',
  CAKA_PREVERJANJE: 'Čaka na preverjanje',
}

/** Dovoljeni prehodi statusov kontrolne točke (issue #12 §2B). */
export const QA_PREHODI: Record<QaStatus, QaStatus[]> = {
  NI_ZACETO: ['V_REDU', 'NAPAKA', 'NI_RELEVANTNO', 'CAKA_PREVERJANJE'],
  V_REDU: ['NAPAKA', 'NI_RELEVANTNO'], // kasneje odkrita napaka / spremenjena relevantnost
  NAPAKA: ['CAKA_PREVERJANJE', 'V_REDU'], // popravljeno → v preverjanje ali takoj V redu (z resolutionNote)
  CAKA_PREVERJANJE: ['V_REDU', 'NAPAKA'], // preverjeno potrditev ali vrnitev v napako
  NI_RELEVANTNO: ['NI_ZACETO'], // ponovna odprta točke (razlog ostane v reviziji)
}

export const ACTION_FLOW = ['ODPRTO', 'V_OBRAVNAVI', 'ODRAVLJENO', 'PREVERJENO'] as const
export type ActionStatus = (typeof ACTION_FLOW)[number]

export const HANDOVER_STATUSI = ['ZAKLJUCENA', 'POGOJNA', 'NEPOPOLNA'] as const
export type HandoverStatus = (typeof HANDOVER_STATUSI)[number]

export const HANDOVER_STATUS_LABELI: Record<HandoverStatus, string> = {
  ZAKLJUCENA: 'Zaključena',
  POGOJNA: 'Pogojna',
  NEPOPOLNA: 'Nepopolna',
}

export const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024 // enako kot podpis ponudbe (Quote)

// ── predloga kontrolnih točk (§3 — podatkovno vodena) ───────────────────────

/** Verzija GRADITELJA predloge (dvig ob spremembi sestave — obstoječe montaže
 *  obdržijo svoj snapshot). */
export const PREDLOGA_VERZIJA = 1

export interface QaCheckDraft {
  templateKey: string
  templateVersion: number
  stepId: string | null
  label: string
  instruction: string | null
  critical: boolean
  targetKey: string | null
  sortOrder: number
}

export interface PredlogaViri {
  playbook: { key: string; version: number; vir: 'baza' | 'vgrajen' }
  segmenti: number
  pravila: number
  runStatus: string | null
}

/** Aktivna definicija MONTAZA iz baze (PlaybookDef), drugače vgrajena (fallback). */
async function montazaDefinicija (): Promise<{ def: PlaybookDefinition; vir: 'baza' | 'vgrajen' }> {
  const row = await db.playbookDef.findFirst({
    where: { key: 'MONTAZA', status: 'ACTIVE' },
    orderBy: { version: 'desc' },
  }).catch(() => null)
  // R542: definicija je jsonb — deserializiraj (obramba pred slabo obliko) namesto JSON.parse
  if (row) {
    const def = deserializiraj(row.definition)
    if (def) return { def, vir: 'baza' }
  }
  return { def: PLAYBOOK_MONTAZA, vir: 'vgrajen' }
}

/**
 * Sestavi osnutke kontrolnih točk IZ VIROV (nikoli hardcoded):
 *  1. playbook MONTAZA (delovni postopek) — koraki razen PREDAJA; koraki s
 *     checklist-om razpadejo na posamezne točke; varnost/kontrola sta kritični;
 *  2. segmenti POTRJENEGA tekača (seg-N) — izvedba po načrtu na segment;
 *  3. aktivna inženirska pravila — kritične (potrjena tehnična pravila).
 */
export async function sestaviPredlogo (projectId: string | null): Promise<{ drafts: QaCheckDraft[]; viri: PredlogaViri }> {
  const drafts: QaCheckDraft[] = []
  let order = 0

  const { def, vir } = await montazaDefinicija()
  const relevantni: PlaybookStep[] = def.steps.filter((s) => s.kategorija !== 'PREDAJA')
  for (const step of relevantni) {
    const kriticen = step.id === 'varnost' || step.kategorija === 'KONTROLA'
    const tocke = (step.checklist && step.checklist.length > 0 ? step.checklist : [step.naziv])
    for (const t of tocke) {
      drafts.push({
        templateKey: `playbook:${def.key}:${def.version}`,
        templateVersion: PREDLOGA_VERZIJA,
        stepId: step.id,
        label: `${step.naziv} — ${t}`,
        instruction: step.rezultat,
        critical: kriticen,
        targetKey: null,
        sortOrder: order++,
      })
    }
  }

  let segCount = 0
  let runStatus: string | null = null
  if (projectId) {
    const seg = await segmentsZaProjekt(projectId, { confirmedFirst: true })
    runStatus = seg.runStatus
    segCount = seg.segments.length
    seg.segments.forEach((s, i) => {
      const key = `seg-${i + 1}`
      const dolzina = Math.round(s.lengthCm)
      drafts.push({
        templateKey: seg.measurementId ? `twin:${seg.measurementId}` : 'twin:tekac',
        templateVersion: PREDLOGA_VERZIJA,
        stepId: null,
        label: `Segment ${key} (${dolzina} cm): izvedba po načrtu — mere, pritrditve, videz`,
        instruction: s.hasGate ? 'Preveri dolžino/višino, pritrditve in vrata na tem segmentu.' : 'Preveri dolžino/višino, pritrditve in videz na tem segmentu.',
        critical: false,
        targetKey: key,
        sortOrder: order++,
      })
    })
  }

  const rules = await db.engineeringRule.findMany({ where: { active: true }, orderBy: { key: 'asc' } })
  for (const rule of rules) {
    drafts.push({
      templateKey: `rule:${rule.key}`,
      templateVersion: PREDLOGA_VERZIJA,
      stepId: null,
      label: `Inženirsko pravilo: ${rule.label} (${rule.value} ${rule.unit})`,
      instruction: `Preveri skladnost izvedbe s potrjenim pravilom ${rule.key}.`,
      critical: true,
      targetKey: null,
      sortOrder: order++,
    })
  }

  return {
    drafts,
    viri: { playbook: { key: def.key, version: def.version, vir }, segmenti: segCount, pravila: rules.length, runStatus },
  }
}

// ── obseg (fail-closed, isti vzorec kot checklist) ──────────────────────────

export interface ScopedWo {
  id: string
  code: string
  projectId: string | null
  assigneeId: string | null
}

export async function obsegNaloga (user: SessionUser, workOrderId: string): Promise<{ wo?: ScopedWo; error?: string; conflict?: boolean; status?: number }> {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, code: true, projectId: true, assigneeId: true },
  })
  if (!wo) return { error: 'Nalog ne obstaja.', status: 404 }
  if (!readsAllData(user) && wo.assigneeId !== user.id) {
    // IDOR: tuj nalog → 403 v REST (sync pot ga obravnava kot CONFLICT)
    return { error: 'Nalog ni v vašem obsegu.', conflict: true, status: 403 }
  }
  return { wo }
}

// ── posodobitev kontrolne točke (skupna API + sync) ─────────────────────────

export interface PosodobiCheckVhod {
  checkId: string
  status: string
  note?: string | null
  photoId?: string | null
  resolutionNote?: string | null
  /** ob NAPAKA (obvezno): razlog → ustvari odstopanje */
  deviationReason?: string | null
  deviationLocation?: string | null
  deviationTargetKey?: string | null
  deviationImpactMaterial?: boolean
  deviationImpactPrice?: boolean
  deviationImpactSafety?: boolean
}

export interface PosodobiRezultat { data?: unknown; error?: string; conflict?: boolean; status?: number }

/** Preveri, da je photoId veljavna FOTO meritev (dokazila ne izmišljujemo). */
async function preveriFoto (photoId: string | null | undefined): Promise<string | null> {
  if (!photoId) return null
  const m = await db.measurement.findUnique({ where: { id: photoId }, select: { type: true } })
  if (!m || m.type !== 'FOTO') return 'Dokazna fotografija ne obstaja (pričakovana FOTO meritev tega naloga/projekta).'
  return null
}

export async function posodobiCheck (user: SessionUser, workOrderId: string, vhod: PosodobiCheckVhod): Promise<PosodobiRezultat> {
  const scoped = await obsegNaloga(user, workOrderId)
  if (scoped.error || !scoped.wo) return { error: scoped.error, conflict: scoped.conflict }

  if (!vhod?.checkId) return { error: 'Manjka identifikator kontrolne točke.' }
  const status = vhod.status
  if (!(QA_STATUSI as readonly string[]).includes(status)) {
    return { error: `Neznan status. Veljavni: ${QA_STATUSI.join(', ')}.` }
  }
  const fotoErr = await preveriFoto(vhod.photoId)
  if (fotoErr) return { error: fotoErr }

  const check = await db.montazaCheck.findUnique({ where: { id: vhod.checkId } })
  if (!check || check.workOrderId !== workOrderId) return { error: 'Kontrolna točka ne pripada temu nalogu.', conflict: true, status: 404 }

  const cilj = status as QaStatus
  if (!QA_PREHODI[check.status as QaStatus]?.includes(cilj)) {
    return {
      error: `Prehod ${check.status} → ${cilj} ni dovoljen. Dovoljeni: ${(QA_PREHODI[check.status as QaStatus] ?? []).join(', ') || '—'}.`,
      conflict: true,
    }
  }

  const note = typeof vhod.note === 'string' && vhod.note.trim() ? vhod.note.trim().slice(0, 500) : null
  const resolutionNote = typeof vhod.resolutionNote === 'string' && vhod.resolutionNote.trim() ? vhod.resolutionNote.trim().slice(0, 500) : null
  const razlog = typeof vhod.deviationReason === 'string' ? vhod.deviationReason.trim() : ''

  // obvezni podatki po prehodu (issue #12 §2B: razlogi, ne tiho stanje)
  if (cilj === 'NI_RELEVANTNO' && !note) {
    return { error: 'Označitev NI RELEVANTNO zahteva razlog (opomba).' }
  }
  if (cilj === 'NAPAKA' && razlog.length < 3) {
    return { error: 'Napaka zahteva razlog odstopanja (vsaj 3 znaki) — ustvari se sledljiv zapis.' }
  }
  if (cilj === 'V_REDU' && (check.status === 'NAPAKA' || check.status === 'CAKA_PREVERJANJE') && !resolutionNote) {
    return { error: 'Odprava napake zahteva opombo o rešitvi (resolutionNote).' }
  }

  const now = new Date()
  const updated = await db.montazaCheck.update({
    where: { id: check.id },
    data: {
      status: cilj,
      note: note ?? check.note,
      photoId: vhod.photoId ?? check.photoId,
      resolutionNote,
      checkedById: user.id,
      checkedAt: now,
    },
    include: { checkedBy: { select: { name: true } } },
  })

  // NAPAKA → obvezno odstopanje (sledljiv zapis, ne samo status)
  if (cilj === 'NAPAKA') {
    const dev = await db.montazaDeviation.create({
      data: {
        workOrderId,
        checkId: check.id,
        reason: razlog.slice(0, 500),
        location: typeof vhod.deviationLocation === 'string' && vhod.deviationLocation.trim() ? vhod.deviationLocation.trim().slice(0, 200) : null,
        targetKey: typeof vhod.deviationTargetKey === 'string' && vhod.deviationTargetKey.trim() ? vhod.deviationTargetKey.trim().slice(0, 40) : null,
        photoId: vhod.photoId ?? null,
        impactMaterial: vhod.deviationImpactMaterial === true,
        impactPrice: vhod.deviationImpactPrice === true,
        impactSafety: vhod.deviationImpactSafety === true || check.critical,
        createdById: user.id,
      },
    })
    await writeAudit({
      userId: user.id,
      action: 'MONTAZA_DEVIATION_CREATE',
      entity: 'montazaDeviation',
      entityId: dev.id,
      projectId: scoped.wo.projectId,
      detail: { workOrder: scoped.wo.code, reason: razlog.slice(0, 200), checkId: check.id, targetKey: dev.targetKey, impactSafety: dev.impactSafety, avto: true },
    })
  }

  await writeAudit({
    userId: user.id,
    action: 'MONTAZA_CHECK_STATUS',
    entity: 'montazaCheck',
    entityId: check.id,
    projectId: scoped.wo.projectId,
    detail: {
      workOrder: scoped.wo.code, label: check.label, from: check.status, to: cilj,
      critical: check.critical, note, resolutionNote, photoId: vhod.photoId ?? null,
      blokira: cilj === 'NAPAKA' && (check.critical || vhod.deviationImpactSafety === true),
    },
  })

  // kritična napaka → dogodek težave na nalogu + obvestilo pisarni (QC_NOK kanal
  // — tip je fiksna webhook pogodba, 16 tipov; montažne podrobnosti so v naslovu)
  if (cilj === 'NAPAKA' && (check.critical || vhod.deviationImpactSafety === true)) {
    await db.workOrderEvent.create({
      data: { workOrderId, userId: user.id, type: 'TEZAVA', note: `QA ${check.label}: ${razlog.slice(0, 160)}` },
    })
    await emitEvent({
      type: 'QC_NOK',
      key: `montaza-nok:${check.id}:${now.getTime()}`,
      title: 'Kritična napaka na montaži',
      body: `Nalog ${scoped.wo.code}: ${check.label} — ${razlog.slice(0, 140)}`,
      projectId: scoped.wo.projectId,
      audience: 'OFFICE',
    })
  }

  return { data: updated }
}

// ── odstopanja ──────────────────────────────────────────────────────────────

export interface OdstopanjeVhod {
  reason: string
  checkId?: string | null
  location?: string | null
  targetKey?: string | null
  photoId?: string | null
  impactMaterial?: boolean
  impactPrice?: boolean
  impactSafety?: boolean
  note?: string | null
}

export async function ustvariOdstopanje (user: SessionUser, workOrderId: string, vhod: OdstopanjeVhod): Promise<PosodobiRezultat> {
  const scoped = await obsegNaloga(user, workOrderId)
  if (scoped.error || !scoped.wo) return { error: scoped.error, conflict: scoped.conflict }

  const reason = typeof vhod?.reason === 'string' ? vhod.reason.trim() : ''
  if (reason.length < 3) return { error: 'Razlog odstopanja je obvezen (vsaj 3 znaki).' }
  if (reason.length > 500) return { error: 'Razlog je predolg (največ 500 znakov).' }

  let checkId: string | null = null
  if (vhod?.checkId) {
    const check = await db.montazaCheck.findUnique({ where: { id: vhod.checkId }, select: { id: true, workOrderId: true } })
    if (!check || check.workOrderId !== workOrderId) return { error: 'Kontrolna točka ne pripada temu nalogu.', conflict: true, status: 404 }
    checkId = check.id
  }
  const fotoErr = await preveriFoto(vhod?.photoId)
  if (fotoErr) return { error: fotoErr }

  const row = await db.montazaDeviation.create({
    data: {
      workOrderId,
      checkId,
      reason,
      location: typeof vhod.location === 'string' && vhod.location.trim() ? vhod.location.trim().slice(0, 200) : null,
      targetKey: typeof vhod.targetKey === 'string' && vhod.targetKey.trim() ? vhod.targetKey.trim().slice(0, 40) : null,
      photoId: vhod.photoId ?? null,
      impactMaterial: vhod.impactMaterial === true,
      impactPrice: vhod.impactPrice === true,
      impactSafety: vhod.impactSafety === true,
      note: typeof vhod.note === 'string' && vhod.note.trim() ? vhod.note.trim().slice(0, 500) : null,
      createdById: user.id,
    },
    include: { createdBy: { select: { name: true } }, check: { select: { label: true } } },
  })

  await writeAudit({
    userId: user.id,
    action: 'MONTAZA_DEVIATION_CREATE',
    entity: 'montazaDeviation',
    entityId: row.id,
    projectId: scoped.wo.projectId,
    detail: { workOrder: scoped.wo.code, reason, checkId, targetKey: row.targetKey, impactSafety: row.impactSafety, impactPrice: row.impactPrice, impactMaterial: row.impactMaterial },
  })
  return { data: row }
}

export async function resiOdstopanje (user: SessionUser, workOrderId: string, deviationId: string): Promise<PosodobiRezultat> {
  const scoped = await obsegNaloga(user, workOrderId)
  if (scoped.error || !scoped.wo) return { error: scoped.error, conflict: scoped.conflict }
  const row = await db.montazaDeviation.findUnique({ where: { id: deviationId } })
  if (!row || row.workOrderId !== workOrderId) return { error: 'Odstopanje ne pripada temu nalogu.', conflict: true, status: 404 }
  if (row.resolvedAt) return { error: 'Odstopanje je že odpravljeno.', conflict: true }

  const now = new Date()
  const updated = await db.montazaDeviation.update({
    where: { id: deviationId },
    data: { resolvedAt: now, resolvedById: user.id },
    include: { createdBy: { select: { name: true } }, resolvedBy: { select: { name: true } }, check: { select: { label: true } } },
  })
  await writeAudit({
    userId: user.id,
    action: 'MONTAZA_DEVIATION_RESOLVE',
    entity: 'montazaDeviation',
    entityId: deviationId,
    projectId: scoped.wo.projectId,
    detail: { workOrder: scoped.wo.code, reason: row.reason },
  })
  return { data: updated }
}

// ── korektivni ukrepi ───────────────────────────────────────────────────────

export interface UkrepVhod {
  deviationId: string
  description: string
  assigneeId?: string | null
  dueAt?: string | null
}

export async function ustvariUkrep (user: SessionUser, workOrderId: string, vhod: UkrepVhod): Promise<PosodobiRezultat> {
  const scoped = await obsegNaloga(user, workOrderId)
  if (scoped.error || !scoped.wo) return { error: scoped.error, conflict: scoped.conflict }

  const dev = await db.montazaDeviation.findUnique({ where: { id: vhod?.deviationId ?? '' }, select: { id: true, workOrderId: true } })
  if (!dev || dev.workOrderId !== workOrderId) return { error: 'Odstopanje ne pripada temu nalogu.', conflict: true, status: 404 }

  const description = typeof vhod?.description === 'string' ? vhod.description.trim() : ''
  if (description.length < 3) return { error: 'Opis korektivnega ukrepa je obvezen (vsaj 3 znaki).' }

  let assigneeId: string | null = null
  if (vhod?.assigneeId) {
    const u = await db.user.findUnique({ where: { id: vhod.assigneeId }, select: { id: true, active: true } })
    if (!u || !u.active) return { error: 'Odgovorna oseba ne obstaja ali ni aktivna.' }
    assigneeId = u.id
  }
  let dueAt: Date | null = null
  if (vhod?.dueAt) {
    const t = Date.parse(vhod.dueAt)
    if (!Number.isFinite(t)) return { error: 'Neveljaven rok (ISO 8601).' }
    dueAt = new Date(t)
  }

  const row = await db.montazaAction.create({
    data: { deviationId: dev.id, description: description.slice(0, 500), assigneeId, dueAt },
    include: { assignee: { select: { name: true } } },
  })
  await writeAudit({
    userId: user.id,
    action: 'MONTAZA_ACTION_CREATE',
    entity: 'montazaAction',
    entityId: row.id,
    projectId: scoped.wo.projectId,
    detail: { workOrder: scoped.wo.code, deviationId: dev.id, description: description.slice(0, 200), assigneeId, dueAt: dueAt?.toISOString() ?? null },
  })
  return { data: row }
}

export async function posodobiUkrep (
  user: SessionUser,
  workOrderId: string,
  actionId: string,
  status: string,
  note?: string | null,
  photoId?: string | null
): Promise<PosodobiRezultat> {
  const scoped = await obsegNaloga(user, workOrderId)
  if (scoped.error || !scoped.wo) return { error: scoped.error, conflict: scoped.conflict }

  if (!(ACTION_FLOW as readonly string[]).includes(status)) {
    return { error: `Neznan status ukrepa. Veljavni: ${ACTION_FLOW.join(', ')}.` }
  }
  const row = await db.montazaAction.findUnique({ where: { id: actionId }, include: { deviation: { select: { workOrderId: true } } } })
  if (!row || row.deviation.workOrderId !== workOrderId) return { error: 'Ukrep ne pripada temu nalogu.', conflict: true, status: 404 }

  const fromIdx = (ACTION_FLOW as readonly string[]).indexOf(row.status)
  const toIdx = (ACTION_FLOW as readonly string[]).indexOf(status)
  if (toIdx !== fromIdx + 1) {
    return {
      error: `Prehod ${row.status} → ${status} ni dovoljen. Korektivni ukrepi tečejo linearno: ${ACTION_FLOW.join(' → ')}.`,
      conflict: true,
    }
  }

  const fotoErr = await preveriFoto(photoId)
  if (fotoErr) return { error: fotoErr }

  const now = new Date()
  const updated = await db.montazaAction.update({
    where: { id: actionId },
    data: {
      status,
      note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : row.note,
      photoId: photoId ?? row.photoId,
      completedAt: status === 'ODRAVLJENO' ? now : row.completedAt,
      verifiedById: status === 'PREVERJENO' ? user.id : row.verifiedById,
      verifiedAt: status === 'PREVERJENO' ? now : row.verifiedAt,
    },
    include: { assignee: { select: { name: true } }, verifiedBy: { select: { name: true } } },
  })
  await writeAudit({
    userId: user.id,
    action: 'MONTAZA_ACTION_STATUS',
    entity: 'montazaAction',
    entityId: actionId,
    projectId: scoped.wo.projectId,
    detail: { workOrder: scoped.wo.code, from: row.status, to: status, note: note ?? null, photoId: photoId ?? null },
  })
  return { data: updated }
}

// ── blokada zaključka (§2C — OBE poti: transition + sync) ───────────────────

export interface BlokadaZakljucka {
  blokira: boolean
  razlogi: string[]
}

/** Kritična nerešena napaka / varnostno odstopanje / odprt ukrep na varnostnem
 *  odstopanju blokirata zaključek naloga (dokazljivo, z imeni). */
export async function preveriBlokadoZakljucka (workOrderId: string): Promise<BlokadaZakljucka> {
  const razlogi: string[] = []

  const checks = await db.montazaCheck.findMany({
    where: { workOrderId, critical: true, status: { in: ['NAPAKA', 'CAKA_PREVERJANJE'] } },
    select: { label: true, status: true },
  })
  for (const c of checks) {
    razlogi.push(`Kritična kontrolna točka »${c.label}« ima status ${QA_STATUS_LABELI[c.status as QaStatus]}.`)
  }

  const safety = await db.montazaDeviation.findMany({
    where: { workOrderId, impactSafety: true, resolvedAt: null },
    select: { reason: true, actions: { select: { description: true, status: true } } },
  })
  for (const d of safety) {
    const odprti = d.actions.filter((a) => a.status === 'ODPRTO' || a.status === 'V_OBRAVNAVI')
    razlogi.push(`Nerešeno varnostno odstopanje: ${d.reason.slice(0, 120)}${odprti.length > 0 ? ` (odprti ukrepi: ${odprti.map((a) => a.description.slice(0, 40)).join('; ')})` : ''}`)
  }

  return { blokira: razlogi.length > 0, razlogi }
}

// ── primopredaja (§2D) ──────────────────────────────────────────────────────

export interface PorociloStanjeVhod {
  checks: { status: string; critical: boolean }[]
  deviations: { impactSafety: boolean; resolvedAt: Date | null; actions: { status: string }[] }[]
  monterConfirmedAt: Date | null
  customerSignedAt: Date | null
  customerRemark: string | null
}

/** Status primopredaje — poročilo NIKOLI ne pokaže navideznega popolnega
 *  zaključka: kritične odprte zadeve ⇒ NEPOPOLNA; brez obeh podpisov ⇒
 *  NEPOPOLNA; odprte nekritične zadeve/pripomba ⇒ POGOJNA; sicer ZAKLJUCENA. */
export function statusPorocila (vhod: PorociloStanjeVhod): HandoverStatus {
  const odprto = vhod.checks.filter((c) => c.status === 'NAPAKA' || c.status === 'CAKA_PREVERJANJE')
  const odprtiUkrepi = vhod.deviations.flatMap((d) => d.actions).filter((a) => a.status === 'ODPRTO' || a.status === 'V_OBRAVNAVI')
  const neresenaOdstopanja = vhod.deviations.filter((d) => !d.resolvedAt)

  // kritično: kritična točka v napaki ali nerešeno varnostno odstopanje → NEPOPOLNA
  if (odprto.some((c) => c.critical) || vhod.deviations.some((d) => d.impactSafety && !d.resolvedAt)) return 'NEPOPOLNA'
  // podpisi: oba (monter + stranka) — sicer NEPOPOLNA
  if (!vhod.monterConfirmedAt || !vhod.customerSignedAt) return 'NEPOPOLNA'
  // odprte zadeve (nekritične) ali pripomba stranke → POGOJNA
  if (odprto.length > 0 || odprtiUkrepi.length > 0 || neresenaOdstopanja.length > 0) return 'POGOJNA'
  if (vhod.customerRemark && vhod.customerRemark.trim()) return 'POGOJNA'
  return 'ZAKLJUCENA'
}

interface DiffSegment { key: string; lengthCm: number | null; heightCm: number | null; source: string }

/** Zgradi primerjavo načrtovano/potrjeno/izvedeno (seg-N) iz virov, ki jih
 *  sistem DEJANSKO ima — vir vsake mere je zapisan (issue #12 §2D). */
export async function zgradiDiff (projectId: string | null): Promise<{
  nacrtovano: DiffSegment[]
  izvedeno: DiffSegment[]
  primerjava: { key: string; nacrtCm: number | null; izvedenoCm: number | null; ujema: boolean | null }[]
  designedSnapshotId: string | null
  installedSnapshotId: string | null
}> {
  let designed: DiffSegment[] = []
  let designedSnapshotId: string | null = null
  if (projectId) {
    const snap = await db.digitalTwinSnapshot.findFirst({
      where: { projectId, kind: 'AS_DESIGNED' },
      orderBy: { version: 'desc' },
      select: { id: true, data: true },
    })
    designedSnapshotId = snap?.id ?? null
    if (snap) {
      // R542: data je jsonb — branje brez JSON.parse (obramba za neobjektno obliko)
      const data = asJsonObject(snap.data)
      const segs = Array.isArray(data?.segments) ? data.segments as unknown as { key?: unknown; lengthCm?: unknown; heightCm?: unknown }[] : []
      designed = segs.map((s, i) => ({
        key: typeof s.key === 'string' ? s.key : `seg-${i + 1}`,
        lengthCm: typeof s.lengthCm === 'number' ? s.lengthCm : null,
        heightCm: typeof s.heightCm === 'number' ? s.heightCm : null,
        source: 'AS-DESIGNED',
      }))
    }
    if (designed.length === 0) {
      // brez dvojčka: zadnji POTRJENI tekač (isti vir kot AS-DESIGNED, P5)
      const seg = await segmentsZaProjekt(projectId, { confirmedFirst: true })
      designed = seg.segments.map((s, i) => ({
        key: `seg-${i + 1}`,
        lengthCm: s.lengthCm,
        heightCm: s.heightCm,
        source: seg.measurementId ? `tekač (meritev ${seg.measurementId})` : 'tekač',
      }))
    }
  }

  let izvedeno: DiffSegment[] = []
  let installedSnapshotId: string | null = null
  if (projectId) {
    const snap = await db.digitalTwinSnapshot.findFirst({
      where: { projectId, kind: 'AS_INSTALLED' },
      orderBy: { version: 'desc' },
      select: { id: true, data: true },
    })
    installedSnapshotId = snap?.id ?? null
    if (snap) {
      // R542: data je jsonb — branje brez JSON.parse (obramba za neobjektno obliko)
      const data = asJsonObject(snap.data)
      const segs = Array.isArray(data?.segments) ? data.segments as unknown as { key?: unknown; lengthCm?: unknown; heightCm?: unknown }[] : []
      izvedeno = segs.map((s, i) => ({
        key: typeof s.key === 'string' ? s.key : `seg-${i + 1}`,
        lengthCm: typeof s.lengthCm === 'number' ? s.lengthCm : null,
        heightCm: typeof s.heightCm === 'number' ? s.heightCm : null,
        source: 'AS-INSTALLED',
      }))
    }
  }

  const keys = Array.from(new Set([...designed.map((s) => s.key), ...izvedeno.map((s) => s.key)]))
  const primerjava = keys.map((key) => {
    const n = designed.find((s) => s.key === key)?.lengthCm ?? null
    const i = izvedeno.find((s) => s.key === key)?.lengthCm ?? null
    return {
      key,
      nacrtCm: n,
      izvedenoCm: i,
      ujema: n === null || i === null ? null : Math.abs(n - i) <= 1, // toleranca 1 cm (ločljivost dvojčka)
    }
  })

  return { nacrtovano: designed, izvedeno, primerjava, designedSnapshotId, installedSnapshotId }
}

interface PhotoRef { id: string; stage: 'PRED' | 'MED' | 'PO'; createdAt: string }

/** Fotografije pred/med/po iz FOTO meritev naloga (+ dokazila točk/odstopanj)
 *  — izvirniki ostanejo meritve, poročilo nosi samo reference. */
export async function zgradiFotografije (workOrderId: string, startedAt: Date | null, completedAt: Date | null): Promise<PhotoRef[]> {
  const fotos = await db.measurement.findMany({
    where: { workOrderId, type: 'FOTO' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, createdAt: true },
  })
  const out: PhotoRef[] = fotos.map((f) => {
    const t = f.createdAt.getTime()
    if (startedAt && t < startedAt.getTime()) return { id: f.id, stage: 'PRED' as const, createdAt: f.createdAt.toISOString() }
    if (completedAt && t >= completedAt.getTime()) return { id: f.id, stage: 'PO' as const, createdAt: f.createdAt.toISOString() }
    return { id: f.id, stage: 'MED' as const, createdAt: f.createdAt.toISOString() }
  })
  // dokazila kontrolnih točk/odstopanj — MED (dokaz med delom)
  const dokazila = await db.montazaCheck.findMany({ where: { workOrderId, photoId: { not: null } }, select: { photoId: true } })
  const dokazilaDev = await db.montazaDeviation.findMany({ where: { workOrderId, photoId: { not: null } }, select: { photoId: true } })
  const obstojeci = new Set(out.map((p) => p.id))
  for (const d of [...dokazila, ...dokazilaDev]) {
    const pid = d.photoId as string
    if (!obstojeci.has(pid)) out.push({ id: pid, stage: 'MED', createdAt: new Date().toISOString() })
  }
  return out
}

/** Celotna izgradnja nove verzije primopredajnega poročila (zgodovina ostane). */
export async function zgradiPorocilo (user: SessionUser, workOrderId: string, summary?: string | null): Promise<PosodobiRezultat> {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, code: true, projectId: true, assigneeId: true, startedAt: true, completedAt: true },
  })
  if (!wo) return { error: 'Nalog ne obstaja.', status: 404 }
  if (!readsAllData(user) && wo.assigneeId !== user.id) return { error: 'Nalog ni v vašem obsegu.', conflict: true, status: 403 }

  const zadnja = await db.handoverReport.findFirst({
    where: { workOrderId },
    orderBy: { version: 'desc' },
    select: { version: true, customerRemark: true },
  })
  const version = (zadnja?.version ?? 0) + 1

  const [diff, photos, bom] = await Promise.all([
    zgradiDiff(wo.projectId),
    zgradiFotografije(workOrderId, wo.startedAt, wo.completedAt),
    wo.projectId
      ? db.bom.findFirst({ where: { package: { projectId: wo.projectId }, status: 'POTRJEN' }, orderBy: { createdAt: 'desc' }, select: { id: true } })
      : null,
  ])

  const checks = await db.montazaCheck.findMany({ where: { workOrderId }, select: { status: true, critical: true } })
  const deviations = await db.montazaDeviation.findMany({
    where: { workOrderId },
    select: { impactSafety: true, resolvedAt: true, actions: { select: { status: true } } },
  })
  const status = statusPorocila({
    checks,
    deviations,
    monterConfirmedAt: null, // nova verzija še ni potrjena (podpisi stare verzije ostanejo v zgodovini)
    customerSignedAt: null,
    // pripomba stranke se PRENESE v novo verzijo (odprta postavka ne sme
    // tihe izginiti ob obnovi poročila — issue #12 §2D)
    customerRemark: zadnja?.customerRemark ?? null,
  })

  const row = await db.handoverReport.create({
    data: {
      workOrderId,
      version,
      projectId: wo.projectId,
      designedSnapshotId: diff.designedSnapshotId,
      installedSnapshotId: diff.installedSnapshotId,
      producedBomId: bom?.id ?? null,
      // R542: jsonb — objekta direktno (ne JSON.stringify)
      diffJson: { ...diff, zgrajeno: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
      photosJson: photos as unknown as Prisma.InputJsonValue,
      summary: typeof summary === 'string' && summary.trim() ? summary.trim().slice(0, 2000) : null,
      customerRemark: zadnja?.customerRemark ?? null,
      status,
      createdById: user.id,
    },
  })

  await writeAudit({
    userId: user.id,
    action: 'HANDOVER_CREATE',
    entity: 'handoverReport',
    entityId: row.id,
    projectId: wo.projectId,
    detail: { workOrder: wo.code, version, status, segments: diff.primerjava.length, photos: photos.length, designedSnapshotId: diff.designedSnapshotId, installedSnapshotId: diff.installedSnapshotId },
  })
  return { data: row }
}

/** Ponovno izračunaj in zapiši status poročila iz trenutnega stanja (varno —
 *  podpisov NE prepiše). Vrne novi status. */
export async function osveziStatusPorocila (reportId: string): Promise<HandoverStatus> {
  const row = await db.handoverReport.findUnique({ where: { id: reportId } })
  if (!row) return 'NEPOPOLNA'
  const [checks, deviations] = await Promise.all([
    db.montazaCheck.findMany({ where: { workOrderId: row.workOrderId }, select: { status: true, critical: true } }),
    db.montazaDeviation.findMany({
      where: { workOrderId: row.workOrderId },
      select: { impactSafety: true, resolvedAt: true, actions: { select: { status: true } } },
    }),
  ])
  const status = statusPorocila({
    checks,
    deviations,
    monterConfirmedAt: row.monterConfirmedAt,
    customerSignedAt: row.customerSignedAt,
    customerRemark: row.customerRemark,
  })
  if (status !== row.status) {
    await db.handoverReport.update({ where: { id: reportId }, data: { status } })
  }
  return status
}
