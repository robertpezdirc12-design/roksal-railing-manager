import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// /api/csp-reports — R545: ADMIN pregled poročil o kršitvah Content-Security-Policy.
// Shrambo je uvedel R543 (model CspReport + javna točka POST /api/csp-report +
// job csp-gc z 7-dnevnim TTL) — ta route doda zadnji del zanke: vidljivost v
// aplikaciji, da lastnik opazovalno obdobje (Report-Only) dejansko lahko oceni
// in odloči o preklopu CSP_MODE=enforce (glej config/ENV-VARS.md).
//
//   GET    ?limit=N  → { mode, readyToEnforce, summary { total, last24h, last7d, byDirective, topDocuments }, data[] }
//   DELETE           → počisti VSA poročila (diagnostika, ne poslovni podatek) + revizija
//
// Vrata: security.read (ADMIN — enako kot seje/dnevnik obvestil; VODJA izrecno brez).
// R551: odgovor nosi readyToEnforce — POGLEDNICA PO PODATKIH za preklop v
// CSP_MODE=enforce (true SAMO v report načinu z 0 kršitvami v zadnjih 7 dneh,
// ker je to TTL okno poročil csp-gc). Odločitev o preklopu ostane LASTNIKOVA —
// aplikacija jo le omogoča z vidljivimi podatki (filozofija R545).

export const dynamic = 'force-dynamic'

const MAX_LIMIT = 200

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'security.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const parsed = Number(url.searchParams.get('limit') ?? 100)
  // fail-closed meja: smiselna zgornja meja 200 (tabela je za diagnostiko,
  // globinska analiza pripada JobRun/DB; prepreči neskončne odgovore)
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIMIT) : 100

  const zdaj = new Date()
  const pred24h = new Date(zdaj.getTime() - 24 * 60 * 60 * 1000)
  const pred7d = new Date(zdaj.getTime() - 7 * 24 * 60 * 60 * 1000)

  const [reports, total, last24h, last7d, byDirective, topDocuments] = await Promise.all([
    db.cspReport.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, documentUri: true, violatedDirective: true,
        blockedUri: true, userAgent: true, createdAt: true,
      },
    }),
    db.cspReport.count(),
    db.cspReport.count({ where: { createdAt: { gte: pred24h } } }),
    db.cspReport.count({ where: { createdAt: { gte: pred7d } } }),
    db.cspReport.groupBy({
      by: ['violatedDirective'],
      _count: { _all: true },
      orderBy: { _count: { violatedDirective: 'desc' } },
      take: 12,
    }),
    db.cspReport.groupBy({
      by: ['documentUri'],
      _count: { _all: true },
      orderBy: { _count: { documentUri: 'desc' } },
      take: 8,
    }),
  ])

  // Način politike (R543): Report-Only javlja brez blokade, Enforce blokira.
  // Brano ob vsakem klicu — sprememba env zahteva nov build/deploy.
  const mode = process.env.CSP_MODE === 'enforce' ? 'enforce' : 'report'

  return NextResponse.json({
    mode,
    // R551: pripravljenost za preklop v enforce PO PODATKIH — true samo, ko
    // politika še teče v report načinu in je TTL okno (7 dni) čisto. Ni
    // zahteve po minimalnem obdobju opazovanja: poročila se zbirajo od R543,
    // dolžino opazovalnega obdobja presodi lastnik (fresh deploy s 0 kršitvami
    // je dejstvo, ne napaka — banner izpiše število, ne sklepa).
    readyToEnforce: mode === 'report' && last7d === 0,
    summary: {
      total,
      last24h,
      last7d,
      byDirective: byDirective.map((g) => ({ directive: g.violatedDirective, count: g._count._all })),
      topDocuments: topDocuments.map((g) => ({ documentUri: g.documentUri, count: g._count._all })),
    },
    data: reports,
  })
}

export async function DELETE (req: NextRequest) {
  const auth = await requirePermission(req, 'security.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  // R538: transakcijska celovitost — brisanje + revizija atomarno (vzorec R537-d).
  // Poročila so diagnostika z 7-dnevnim TTL (job csp-gc) — ročni izbris je
  // vzdrževanje, ne izguba poslovnega podatka; vseeno se zapiše v revizijo.
  const deleted = await db.$transaction(async (tx) => {
    const r = await tx.cspReport.deleteMany({})
    await writeAudit({
      userId: user.id,
      action: 'CSP_REPORTS_CLEAR',
      entity: 'cspReport',
      entityId: null,
      detail: { deleted: r.count },
    }, tx)
    return r.count
  })

  return NextResponse.json({ data: { deleted } })
}
