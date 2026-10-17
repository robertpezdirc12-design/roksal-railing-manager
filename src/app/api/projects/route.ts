import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { readsAllData, requirePermission } from '@/lib/auth'
import { nextCodeFromList } from '@/lib/codes'
import { parseBody, PROJECT_STATUSES } from '@/lib/validate'
import { retryOnUnique } from '@/lib/versioning'

// R536: zod shema za ustvarjanje projekta — naslov obvezen (neprazno po trim),
// customerId je neobvezen (null ⇒ brez stranke; UI pošilja null za „brez").
// R541: status je zdaj enumeriran (PROJECT_STATUSES — prej gol z.string(),
// ki je spustil poljuben niz; neveljaven status zdaj → 400, skladno z
// CHECK omejitvijo Project_status_check v bazi).
const ProjectCreateSchema = z.object({
  title: z.string().trim().min(1, 'Naslov projekta je obvezen.'),
  status: z.enum(PROJECT_STATUSES, { error: `Neveljaven status projekta. Dovoljeni: ${PROJECT_STATUSES.join(', ')}.` }).nullish().transform((v) => v ?? 'NACRT'),
  customerId: z.string().nullish().transform((v) => v || null),
  address: z.string().nullish().transform((v) => v ?? null),
  note: z.string().nullish().transform((v) => v ?? null),
})

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const q = url.searchParams.get('q')

  const projects = await db.project.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }, { customer: { name: { contains: q, mode: 'insensitive' } } }] } : {}),
      // obseg (issue #1): monter vidi SAMO projekte svojih nalogov
      ...(readsAllData(user) ? {} : { workOrders: { some: { assigneeId: user.id } } }),
    },
    include: {
      customer: { select: { name: true, city: true } },
      _count: { select: { workOrders: true, quotes: true, measurements: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ data: projects })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.write')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseBody(req, ProjectCreateSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  // R439: koda glede na zasedene (count pade ob brisanju → unikatnost ni zagotovljena)
  // R537 (vzorec R535 za ponudbe): koda + zapis v ENI transakciji (koda se bere
  // ZNOTRAJ tx); ob sočasnem P2002 (dva POST si izračunata isto kodo P-…) do
  // 3 poskusi — read-then-create dirka je s tem zaprta. Ta ruta nima revizije
  // (nespremenjeno — zapis revizije bi bil vedenjska sprememba).
  const project = await retryOnUnique(() => db.$transaction(async (tx) => {
    const existingCodes = await tx.project.findMany({ where: { code: { startsWith: 'P-' } }, select: { code: true } })
    const code = nextCodeFromList(existingCodes.map((p) => p.code), 'P-')

    return tx.project.create({
      data: {
        code,
        title: data.title,
        status: data.status,
        customerId: data.customerId,
        address: data.address,
        note: data.note,
      },
      include: { customer: { select: { name: true, city: true } } },
    })
  }), 3)
  return NextResponse.json({ data: project }, { status: 201 })
}
