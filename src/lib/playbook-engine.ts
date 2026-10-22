// playbook-engine — R458 (issue #13: SCRIPT-FIRST FIELD WORKFLOW)
// Strežniško jedro: seed definicij, zagoni, akcije nad koraki, handoff, revizija.
// Deterministična state-machine — VSAK prehod je reviziran (AuditLog), izjeme
// so mogoče LE z razlogom (§6), offline akcije prihajajo prek /api/sync
// (kind 'playbook-step') v ISTO logiko (transport, ne nov sistem — §13).

import { db } from '@/lib/db'
import { writeAudit } from '@/lib/audit'
import { readsAllData, type SessionUser } from '@/lib/auth'
import { Prisma } from '@prisma/client'
import { asJsonObject } from '@/lib/json'
import {
  deserializiraj, napredek, naslednjiKorak, preveriEvidence, serializiraj,
  jeZakljucen, VGRADNJENI_PLAYBOOKI, korakById,
  type Evidence, type KorakStanje, type PlaybookDefinition, type RunContext,
} from '@/lib/playbook-core'

export type Akcija = 'ZACNI' | 'ZAKLJUCI' | 'NI_PRIMERNO' | 'BLOKIRANO' | 'PONOVNO'

export interface RunState {
  run: {
    id: string
    status: string
    playbookKey: string
    playbookVersion: number
    workOrderId: string | null
    projectId: string | null
    startedAt: string
    completedAt: string | null
  }
  def: PlaybookDefinition
  context: RunContext
  koraki: (KorakStanje & { naziv: string; kategorija: string })[]
  naslednji: string | null
  napredek: { trenutni: number; skupaj: number; koncanih: number; izjem: number; odstotek: number }
  handoff: { do: string; opis: string; ob: string }[]
}

// ─── Seed vgrajenih definicij (idempotentno po key+version) ─────────────────

export async function ensurePlaybookSeed (): Promise<void> {
  for (const def of VGRADNJENI_PLAYBOOKI) {
    // R579: upsert (atomarno), ne findUnique→create — ob prvem dostopu sta
    // vzporedno priletela /api/playbook/runs IN /api/playbook/defs, oba sta
    // starih definicij naredila, oba create — drugi je padel s P2002 in
    // monter dobil 500. `update: {}` obstoječe definicije pusti pri miru
    // (idempotentno po key+version, zagoni se sklicujejo nanje).
    await db.playbookDef.upsert({
      where: { key_version: { key: def.key, version: def.version } },
      create: {
        key: def.key,
        name: def.naziv,
        version: def.version,
        status: 'ACTIVE',
        // R542: definicija je jsonb objekt (serializiraj vrača objekt)
        definition: serializiraj(def) as unknown as Prisma.InputJsonValue,
      },
      update: {},
    })
  }
}

/** Aktivna definicija za ključ (najnovejša ACTIVE verzija). */
export async function aktivnaDefinicija (key: string): Promise<{ id: string; def: PlaybookDefinition } | null> {
  const row = await db.playbookDef.findFirst({
    where: { key, status: 'ACTIVE' },
    orderBy: { version: 'desc' },
  })
  if (!row) return null
  const def = deserializiraj(row.definition)
  if (!def) return null
  return { id: row.id, def: { ...def, version: row.version } }
}

// ─── Obseg (fail-closed): monter vidi/izvaja SAMO svoje zagone ──────────────

async function obseg (
  user: SessionUser,
  run: { userId: string; workOrderId: string | null }
): Promise<string | null> {
  if (readsAllData(user)) return null // pisarna: vsi
  if (run.userId !== user.id) return 'Zagon playbooka ni v vašem obsegu.'
  return null
}

// ─── Zagon ────────────────────────────────────────────────────────────────────

export async function zagoniZaNalog (user: SessionUser, workOrderId: string): Promise<
  { ok: false; status: number; napaka: string } | { ok: true; nalog: { id: string; code: string; title: string }; runs: RunOverviewRow[] }
> {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, assigneeId: true, code: true, title: true },
  })
  if (!wo) return { ok: false, status: 404, napaka: 'Nalog ne obstaja.' }
  if (!readsAllData(user) && wo.assigneeId !== user.id) {
    return { ok: false, status: 403, napaka: 'Nalog ni v vašem obsegu.' }
  }
  const runs = await db.playbookRun.findMany({
    where: { workOrderId },
    orderBy: { startedAt: 'desc' },
    include: { steps: true, playbookDef: true },
  })
  return { ok: true, nalog: wo, runs }
}

export interface RunOverviewRow {
  id: string
  playbookKey: string
  playbookVersion: number
  status: string
  workOrderId: string | null
  projectId: string | null
  context: Prisma.JsonValue
  handoff: Prisma.JsonValue
  startedAt: Date
  completedAt: Date | null
  steps: { stepId: string; status: string; attempts: number }[]
  playbookDef: { definition: Prisma.JsonValue }
}

export async function zacniZagon (
  user: SessionUser,
  input: { workOrderId: string; key: string }
): Promise<{ ok: true; runId: string; nov: boolean } | { ok: false; status: number; napaka: string }> {
  const wo = await db.workOrder.findUnique({
    where: { id: input.workOrderId },
    select: { id: true, projectId: true, assigneeId: true, code: true },
  })
  if (!wo) return { ok: false, status: 404, napaka: 'Nalog ne obstaja.' }
  if (!readsAllData(user) && wo.assigneeId !== user.id) {
    return { ok: false, status: 403, napaka: 'Nalog ni v vašem obsegu — zagon lahko zažene izvajalec ali pisarna.' }
  }
  await ensurePlaybookSeed()
  const aktivna = await aktivnaDefinicija(input.key)
  if (!aktivna) return { ok: false, status: 404, napaka: `Ni aktivnega playbooka „${input.key}".` }

  // en aktiven zagon na (nalog, playbook) — obstoječega V_TEKU vrnemo (idempotenca)
  const zeVTeku = await db.playbookRun.findFirst({
    where: { workOrderId: input.workOrderId, playbookKey: input.key, status: 'V_TEKU' },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  })
  if (zeVTeku) return { ok: true, runId: zeVTeku.id, nov: false }

  const run = await db.playbookRun.create({
    data: {
      playbookDefId: aktivna.id,
      playbookKey: aktivna.def.key,
      playbookVersion: aktivna.def.version, // §14 snapshot
      projectId: wo.projectId,
      workOrderId: wo.id,
      userId: user.id,
      // R542: jsonb — objekt direktno
      context: { odgovori: {} },
      steps: {
        create: aktivna.def.steps.map((s) => ({ stepId: s.id, status: 'PENDING' })),
      },
    },
  })
  await db.workOrderEvent.create({
    data: {
      workOrderId: wo.id,
      userId: user.id,
      type: 'OPOMBA',
      note: `Zagnan vodeni postopek ${aktivna.def.key} v${aktivna.def.version} (${aktivna.def.naziv}).`,
    },
  })
  await writeAudit({
    userId: user.id,
    action: 'PLAYBOOK_RUN_START',
    entity: 'playbook',
    entityId: run.id,
    projectId: wo.projectId,
    detail: { workOrderId: wo.id, key: aktivna.def.key, version: aktivna.def.version, korakov: aktivna.def.steps.length },
  })
  return { ok: true, runId: run.id, nov: true }
}

// ─── Branje stanja ───────────────────────────────────────────────────────────

async function naloziZagon (runId: string) {
  const run = await db.playbookRun.findUnique({
    where: { id: runId },
    include: { steps: true, playbookDef: true },
  })
  if (!run) return null
  const def = deserializiraj(run.playbookDef.definition)
  if (!def) return null
  return { run, def: { ...def, version: run.playbookVersion } }
}

// R542: kontekst/handoff sta jsonb objekta — branje brez JSON.parse;
// obramba pred napačno obliko ostaja (asJsonObject + shape guard).
function razberiContext (v: Prisma.JsonValue): RunContext {
  const c = asJsonObject(v) as RunContext | null
  return c ?? { odgovori: {} }
}

function razberiHandoff (v: Prisma.JsonValue): { do: string; opis: string; ob: string }[] {
  return Array.isArray(v) ? v as { do: string; opis: string; ob: string }[] : []
}

export function sestaviStanje (
  run: {
    id: string; status: string; playbookKey: string; playbookVersion: number
    workOrderId: string | null; projectId: string | null
    startedAt: Date; completedAt: Date | null
    context: Prisma.JsonValue; handoff: Prisma.JsonValue
    steps: {
      stepId: string; status: string; attempts: number; evidence: Prisma.JsonValue
      exceptionReason: string | null; startedAt: Date | null; completedAt: Date | null
    }[]
  },
  def: PlaybookDefinition
): RunState {
  const context = razberiContext(run.context)
  if (!context.odgovori) context.odgovori = {}
  // koraki v VRSTNEM REDU DEFINICIJE (deterministični API odgovor — include brez
  // orderBy vrstni red baze ni zajamčen)
  const vrstniRed = new Map(def.steps.map((s, i) => [s.id, i]))
  const stanja: KorakStanje[] = [...run.steps]
    .sort((a, b) => (vrstniRed.get(a.stepId) ?? 999) - (vrstniRed.get(b.stepId) ?? 999))
    .map((s) => ({
    stepId: s.stepId,
    status: s.status as KorakStanje['status'],
    attempts: s.attempts,
    evidence: s.evidence !== null && typeof s.evidence === 'object' && !Array.isArray(s.evidence)
      ? s.evidence as Evidence
      : null,
    exceptionReason: s.exceptionReason,
    startedAt: s.startedAt?.toISOString() ?? null,
    completedAt: s.completedAt?.toISOString() ?? null,
  }))
  const naslednji = naslednjiKorak(def, stanja, context.odgovori)
  return {
    run: {
      id: run.id,
      status: run.status,
      playbookKey: run.playbookKey,
      playbookVersion: run.playbookVersion,
      workOrderId: run.workOrderId,
      projectId: run.projectId,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
    },
    def,
    context,
    koraki: stanja.map((s) => ({
      ...s,
      naziv: korakById(def, s.stepId)?.naziv ?? s.stepId,
      kategorija: korakById(def, s.stepId)?.kategorija ?? 'AKCIJA',
    })),
    naslednji: naslednji?.id ?? null,
    napredek: napredek(def, stanja, context.odgovori),
    handoff: razberiHandoff(run.handoff),
  }
}

export async function stanjeZagona (
  user: SessionUser,
  runId: string
): Promise<{ napaka: string; status: number } | { stanje: RunState }> {
  const nalozeno = await naloziZagon(runId)
  if (!nalozeno) return { napaka: 'Zagon ne obstaja ali je definicija neveljavna.', status: 404 }
  const err = await obseg(user, nalozeno.run)
  if (err) return { napaka: err, status: 403 }
  return { stanje: sestaviStanje(nalozeno.run, nalozeno.def) }
}

// ─── Akcija nad korakom (ISTO logiko kličeta /api/playbook/runs/[id]/action
//     in /api/sync kind 'playbook-step' — sync je samo transport, §13) ───────

export interface AkcijaVhod {
  runId: string
  stepId: string
  akcija: Akcija
  evidence?: Evidence | null
  razlog?: string | null
}

export interface AkcijaIzhod {
  status: number
  stanje?: RunState
  napake?: string[]
  napaka?: string
}

export async function izvediAkcijo (user: SessionUser, vhod: AkcijaVhod): Promise<AkcijaIzhod> {
  const nalozeno = await naloziZagon(vhod.runId)
  if (!nalozeno) return { status: 404, napaka: 'Zagon ne obstaja ali je definicija neveljavna.' }
  const { run, def } = nalozeno
  const err = await obseg(user, run)
  if (err) return { status: 403, napaka: err }
  // PONOVNO je edina akcija, ki sme odpreti ZAKLJUČEN zagon (§16 recovery po
  // prekinitvi); vse ostale akcije zahtevajo V_TEKU
  const odprtostOK = vhod.akcija === 'PONOVNO'
    ? run.status === 'V_TEKU' || run.status === 'ZAKLJUCEN'
    : run.status === 'V_TEKU'
  if (!odprtostOK) {
    return { status: 409, napaka: `Zagon je ${run.status === 'ZAKLJUCEN' ? 'zaključen' : 'prekinjen'} — akcije niso mogoče.` }
  }

  const korak = korakById(def, vhod.stepId)
  if (!korak) return { status: 404, napaka: `Neznan korak „${vhod.stepId}" v definiciji.` }
  const st = run.steps.find((s) => s.stepId === vhod.stepId)
  if (!st) return { status: 404, napaka: 'Stanje koraka ne obstaja.' }

  const context = razberiContext(run.context)
  if (!context.odgovori) context.odgovori = {}

  // ── ZACNI: PENDING/NEUSPESNO → IN_PROGRESS (poskus +1)
  if (vhod.akcija === 'ZACNI') {
    if (st.status !== 'PENDING' && st.status !== 'NEUSPESNO') {
      return { status: 409, napaka: `Korak je v stanju ${st.status} — začetek ni mogoč.` }
    }
    await db.playbookStepRun.update({
      where: { id: st.id },
      data: { status: 'IN_PROGRESS', attempts: st.attempts + 1, startedAt: st.startedAt ?? new Date(), exceptionReason: null },
    })
    const stanje = await stanjeZagona(user, vhod.runId)
    return 'stanje' in stanje ? { status: 200, stanje: stanje.stanje } : { status: stanje.status, napaka: stanje.napaka }
  }

  // ── ZAKLJUCI: validacija dokazil (§10) + shranjevanje
  if (vhod.akcija === 'ZAKLJUCI') {
    const napake = preveriEvidence(korak, vhod.evidence)
    if (napake.length > 0) {
      // §1 retry/failure: validacija pade → NEUSPESNO, korak ostane odprt za PONOVNO
      await db.playbookStepRun.update({
        where: { id: st.id },
        data: { status: st.status === 'PENDING' ? 'IN_PROGRESS' : st.status },
      })
      return { status: 400, napake }
    }
    await db.playbookStepRun.update({
      where: { id: st.id },
      data: {
        status: 'COMPLETED',
        // R542: jsonb — objekt direktno; null pomeni DB NULL (polje je izrecno
        // v patchu, zato DbNull in ne izpuščena vrednost)
        evidence: vhod.evidence ? vhod.evidence as unknown as Prisma.InputJsonValue : Prisma.DbNull,
        exceptionReason: null,
        completedAt: new Date(),
      },
    })
    // ODLOCITEV: odgovor shrani v kontekst (§5 pogoji veje)
    if (korak.kategorija === 'ODLOCITEV' && vhod.evidence?.odgovor !== undefined) {
      context.odgovori[korak.id] = vhod.evidence.odgovor
      await db.playbookRun.update({
        where: { id: run.id },
        // R542: jsonb — objekt direktno
        data: { context: context as unknown as Prisma.InputJsonValue },
      })
    }
    await writeAudit({
      userId: user.id,
      action: 'PLAYBOOK_STEP_COMPLETE',
      entity: 'playbook',
      entityId: run.id,
      projectId: run.projectId,
      detail: { stepId: korak.id, naziv: korak.naziv, workOrderId: run.workOrderId, key: run.playbookKey, version: run.playbookVersion },
    })
    return await moznoZakljucek(user, run.id)
  }

  // ── NI_PRIMERNO / BLOKIRANO: §6 izjema SAMO z razlogom (+ revizija)
  if (vhod.akcija === 'NI_PRIMERNO' || vhod.akcija === 'BLOKIRANO') {
    const razlog = (vhod.razlog ?? '').trim()
    if (razlog.length < 5) {
      return { status: 400, napaka: 'Izjema zahteva razlog (vsaj 5 znakov) — kritičnih mer ni mogoče tiho preskočiti (§6).' }
    }
    await db.playbookStepRun.update({
      where: { id: st.id },
      data: {
        status: vhod.akcija === 'NI_PRIMERNO' ? 'NI_PRIMERNO' : 'BLOKIRANO',
        exceptionReason: razlog,
        completedAt: new Date(),
      },
    })
    await writeAudit({
      userId: user.id,
      action: 'PLAYBOOK_STEP_EXCEPTION',
      entity: 'playbook',
      entityId: run.id,
      projectId: run.projectId,
      detail: { stepId: korak.id, naziv: korak.naziv, vrsta: vhod.akcija, razlog, workOrderId: run.workOrderId, key: run.playbookKey },
    })
    return await moznoZakljucek(user, run.id)
  }

  // ── PONOVNO: reset zaključenega/neuspešnega koraka (§16 ponovitev koraka)
  if (vhod.akcija === 'PONOVNO') {
    if (korak.ponovi === false) return { status: 409, napaka: 'Ta korak ne dovoljuje ponovitve.' }
    if (st.status !== 'COMPLETED' && st.status !== 'NEUSPESNO' && st.status !== 'NI_PRIMERNO' && st.status !== 'BLOKIRANO') {
      return { status: 409, napaka: `Korak je v stanju ${st.status} — ponovitev ni mogoča.` }
    }
    await db.playbookStepRun.update({
      where: { id: st.id },
      // R542: evidence null = DB NULL (stolpec je jsonb)
      data: { status: 'IN_PROGRESS', evidence: Prisma.DbNull, exceptionReason: null, completedAt: null },
    })
    // če je bil run že zaključen → znova V_TEKU (stanje v bazi se je lahko spremenilo)
    if ((run.status as string) === 'ZAKLJUCEN') {
      await db.playbookRun.update({ where: { id: run.id }, data: { status: 'V_TEKU', completedAt: null } })
    }
    await writeAudit({
      userId: user.id,
      action: 'PLAYBOOK_STEP_RETRY',
      entity: 'playbook',
      entityId: run.id,
      projectId: run.projectId,
      detail: { stepId: korak.id, naziv: korak.naziv, prej: st.status, workOrderId: run.workOrderId },
    })
    const stanje = await stanjeZagona(user, vhod.runId)
    return 'stanje' in stanje ? { status: 200, stanje: stanje.stanje } : { status: stanje.status, napaka: stanje.napaka }
  }

  return { status: 400, napaka: `Neznana akcija „${vhod.akcija}".` }
}

/** Po ZAKLJUCI/izjemi: če je zagon zaključen → status + handoff + revizija (§11). */
async function moznoZakljucek (user: SessionUser, runId: string): Promise<AkcijaIzhod> {
  const nalozeno = await naloziZagon(runId)
  if (!nalozeno) return { status: 404, napaka: 'Zagon ne obstaja.' }
  const { run, def } = nalozeno
  const context = razberiContext(run.context)
  const stanja: KorakStanje[] = run.steps.map((s) => ({
    stepId: s.stepId, status: s.status as KorakStanje['status'], attempts: s.attempts,
  }))
  if (run.status === 'V_TEKU' && jeZakljucen(def, stanja, context.odgovori ?? {})) {
    const handoffCilj = [...def.steps].reverse().find((s) => s.handoff)?.handoff
    const dosedanji = razberiHandoff(run.handoff)
    const novi = handoffCilj
      ? [...dosedanji, { do: handoffCilj.do, opis: handoffCilj.opis, ob: new Date().toISOString() }]
      : dosedanji
    await db.playbookRun.update({
      where: { id: run.id },
      // R542: jsonb — objekt direktno
      data: { status: 'ZAKLJUCEN', completedAt: new Date(), handoff: novi as unknown as Prisma.InputJsonValue },
    })
    await writeAudit({
      userId: user.id,
      action: 'PLAYBOOK_RUN_COMPLETE',
      entity: 'playbook',
      entityId: run.id,
      projectId: run.projectId,
      detail: {
        workOrderId: run.workOrderId, key: run.playbookKey, version: run.playbookVersion, // §14: vezava na verzijo
        handoff: handoffCilj?.do ?? null,
        izjeme: stanja.filter((s) => s.status === 'NI_PRIMERNO' || s.status === 'BLOKIRANO').map((s) => s.stepId),
      },
    })
    if (handoffCilj) {
      await writeAudit({
        userId: user.id,
        action: 'PLAYBOOK_HANDOFF',
        entity: 'playbook',
        entityId: run.id,
        projectId: run.projectId,
        detail: { do: handoffCilj.do, workOrderId: run.workOrderId, key: run.playbookKey },
      })
    }
  }
  const stanje = await stanjeZagona(user, runId)
  return 'stanje' in stanje ? { status: 200, stanje: stanje.stanje } : { status: stanje.status, napaka: stanje.napaka }
}

// ─── Admin (§15): upravljanje definicij brez poseganja v poslovno logiko ────

export async function novejsaVerzija (
  user: SessionUser,
  input: { key: string; def: PlaybookDefinition }
): Promise<{ ok: true; version: number } | { ok: false; status: number; napaka: string }> {
  if (user.role !== 'ADMIN' && user.role !== 'VODJA') {
    return { ok: false, status: 403, napaka: 'Samo ADMIN/VODJA lahko ureja playbooke.' }
  }
  if (input.def.key !== input.key) return { ok: false, status: 400, napaka: 'Ključ definicije se ne ujema.' }
  if (!Array.isArray(input.def.steps) || input.def.steps.length === 0) {
    return { ok: false, status: 400, napaka: 'Definicija brez korakov.' }
  }
  const zadnja = await db.playbookDef.findFirst({
    where: { key: input.key },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  const version = (zadnja?.version ?? 0) + 1
  const row = await db.playbookDef.create({
    data: {
      key: input.key,
      name: input.def.naziv ?? input.key,
      version,
      status: 'ACTIVE', // nova verzija takoj aktivna za nove zagone (stare ostanejo vezane — §14)
      authorId: user.id,
      // R542: definicija je jsonb objekt
      definition: serializiraj({ ...input.def, version }) as unknown as Prisma.InputJsonValue,
    },
  })
  // prejšnje ACTIVE umakni v RETIRED
  await db.playbookDef.updateMany({
    where: { key: input.key, status: 'ACTIVE', id: { not: row.id } },
    data: { status: 'RETIRED' },
  })
  await writeAudit({
    userId: user.id,
    action: 'PLAYBOOK_DEF_VERSION',
    entity: 'playbook',
    entityId: row.id,
    detail: { key: input.key, version, korakov: input.def.steps.length },
  })
  return { ok: true, version }
}

export async function nastaviStatus (user: SessionUser, defId: string, status: 'DRAFT' | 'ACTIVE' | 'RETIRED'): Promise<{ ok: boolean; status: number; napaka?: string }> {
  if (user.role !== 'ADMIN' && user.role !== 'VODJA') {
    return { ok: false, status: 403, napaka: 'Samo ADMIN/VODJA lahko spreminja status playbooka.' }
  }
  const row = await db.playbookDef.findUnique({ where: { id: defId }, select: { id: true, key: true, version: true } })
  if (!row) return { ok: false, status: 404, napaka: 'Definicija ne obstaja.' }
  if (status === 'ACTIVE') {
    await db.playbookDef.updateMany({ where: { key: row.key, status: 'ACTIVE', id: { not: row.id } }, data: { status: 'RETIRED' } })
  }
  await db.playbookDef.update({ where: { id: defId }, data: { status } })
  await writeAudit({
    userId: user.id,
    action: 'PLAYBOOK_DEF_STATUS',
    entity: 'playbook',
    entityId: defId,
    detail: { key: row.key, version: row.version, status },
  })
  return { ok: true, status: 200 }
}
