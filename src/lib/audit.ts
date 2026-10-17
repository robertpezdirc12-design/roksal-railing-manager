// audit — REKONSTRUKCIJA R431 (vir: R428 — sistemski/globalni pregled)
// readAudit (per-projekt) + readAuditGlobal (projectId=null dogodki).

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

/** Odjemalec, prek katerega gre zapis revizije: globalni db ALI transakcijski
 * klient (tx) — R464: revizija občutljivih mutacij se zapiše V transakciji
 * (atomarna z mutacijo; pod sočasnimi zahtevami ni SQLITE_BUSY trkov). */
export type AuditClient = Pick<Prisma.TransactionClient, 'auditLog'>

export async function writeAudit (input: {
  userId?: string | null
  action: string
  entity: string
  entityId?: string | null
  projectId?: string | null
  detail?: Record<string, unknown> | null
}, client: AuditClient = db): Promise<void> {
  await client.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      projectId: input.projectId ?? null, // null = sistemski dogodek (R428)
      // R542: detail je jsonb OBJEKT (ne niz) — null gre eksplicitno kot DB NULL
      detail: input.detail ? input.detail as Prisma.InputJsonValue : Prisma.DbNull,
    },
  })
}

export async function readAudit (projectId: string, opts: { limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
  return db.auditLog.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { user: { select: { name: true, role: true } } },
  })
}

/** R428: sistemski (globalni) dogodki — projectId = null. */
export async function readAuditGlobal (opts: { limit?: number; action?: string; userId?: string } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
  return db.auditLog.findMany({
    where: {
      projectId: null,
      ...(opts.action ? { action: opts.action } : {}),
      ...(opts.userId ? { userId: opts.userId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { user: { select: { name: true, role: true } } },
  })
}
