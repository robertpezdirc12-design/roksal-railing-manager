import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { hasPerm } from '@/lib/permissions-core'

// /api/search — globalno iskanje po entitetah (route-map: GET/POST /api/search)
// Obseg rezultatov strogo po pravicah prijavljenega uporabnika (fail-closed).
// Vrača skupine: projekti, stranke, ponudbe, računi, nalogi, dostave,
// reklamacije/servis (R446 — samo pisarna), zaloga, izdelki, uporabniki — z navigacijskimi podatki.

type Hit = {
  id: string
  label: string
  sub: string
  section: string
  tab: string
  kind: string
}

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { perms } = auth

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ data: { groups: [] as { kind: string; label: string; hits: Hit[] }[], q } })

  const groups: { kind: string; label: string; hits: Hit[] }[] = []

  const projects = await db.project.findMany({
    where: { OR: [{ title: { contains: q } }, { code: { contains: q } }, { address: { contains: q } }] },
    select: { id: true, code: true, title: true, status: true }, take: 5,
  })
  if (projects.length) groups.push({
    kind: 'projekt', label: 'Projekti',
    hits: projects.map((p) => ({ id: p.id, label: `${p.code} — ${p.title}`, sub: p.status, section: 'projekti', tab: 'projekti', kind: 'projekt' })),
  })

  if (hasPerm(perms, 'customers.read')) {
    const customers = await db.customer.findMany({
      where: { OR: [{ name: { contains: q } }, { email: { contains: q } }, { city: { contains: q } }] },
      select: { id: true, name: true, city: true }, take: 5,
    })
    if (customers.length) groups.push({
      kind: 'stranka', label: 'Stranke',
      hits: customers.map((c) => ({ id: c.id, label: c.name, sub: c.city ?? '—', section: 'projekti', tab: 'stranke', kind: 'stranka' })),
    })
  }

  if (hasPerm(perms, 'quotes.read')) {
    const quotes = await db.quote.findMany({
      where: { OR: [{ code: { contains: q } }, { note: { contains: q } }] },
      select: { id: true, code: true, status: true, total: true, customer: { select: { name: true } } }, take: 5,
    })
    if (quotes.length) groups.push({
      kind: 'ponudba', label: 'Ponudbe',
      hits: quotes.map((x) => ({ id: x.id, label: x.code, sub: `${x.customer?.name ?? '—'} · ${(x.total ?? 0).toLocaleString('sl-SI', { style: 'currency', currency: 'EUR' })}`, section: 'projekti', tab: 'ponudbe', kind: 'ponudba' })),
    })
  }

  if (hasPerm(perms, 'invoices.read')) {
    const invoices = await db.invoice.findMany({
      where: { code: { contains: q } },
      select: { id: true, code: true, status: true, total: true, project: { select: { customer: { select: { name: true } } } } }, take: 5,
    })
    if (invoices.length) groups.push({
      kind: 'racun', label: 'Računi',
      hits: invoices.map((x) => ({ id: x.id, label: x.code, sub: `${x.project?.customer?.name ?? '—'} · ${(x.total ?? 0).toLocaleString('sl-SI', { style: 'currency', currency: 'EUR' })}`, section: 'projekti', tab: 'racuni', kind: 'racun' })),
    })
  }

  if (hasPerm(perms, 'nalog.read')) {
    const wos = await db.workOrder.findMany({
      where: { OR: [{ code: { contains: q } }, { title: { contains: q } }] },
      select: { id: true, code: true, title: true, status: true }, take: 5,
    })
    if (wos.length) groups.push({
      kind: 'nalog', label: 'Delovni nalogi',
      hits: wos.map((w) => ({ id: w.id, label: `${w.code} — ${w.title}`, sub: w.status, section: 'projekti', tab: 'nalogi', kind: 'nalog' })),
    })
  }

  // R445 (issue #7 §9): dostave — obseg spoštuje enak obseg kot /api/deliveries:
  // uporabnik z omejenim branjem (monter) vidi SAMO dostave, kjer je voznik ALI
  // so vezane na nalog, dodeljen njemu (fail-closed).
  {
    const base = { OR: [{ code: { contains: q } }, { address: { contains: q } }, { note: { contains: q } }] }
    const where = readsAllData(auth.user)
      ? base
      : { AND: [base, { OR: [{ driverId: auth.user.id }, { workOrder: { assigneeId: auth.user.id } }] }] }
    const deliveries = await db.delivery.findMany({
      where,
      select: { id: true, code: true, status: true, project: { select: { code: true } } }, take: 5,
    })
    if (deliveries.length) groups.push({
      kind: 'dostava', label: 'Dostave',
      hits: deliveries.map((d) => ({
        id: d.id, label: d.code,
        sub: `${d.project?.code ?? 'brez projekta'} · ${d.status}`,
        section: 'pisarna', tab: 'dostave', kind: 'dostava',
      })),
    })
  }

  // R446 (issue #7 §10): reklamacije in servisni primeri — SAMO za readsAllData
  // (pisarna); monter in ostali z omejenim branjem ne vidijo opisov težav strank
  // (fail-closed). Zadetki navigirajo na zavihek servis.
  if (readsAllData(auth.user)) {
    const claims = await db.claim.findMany({
      where: { OR: [{ code: { contains: q } }, { title: { contains: q } }] },
      select: { id: true, code: true, title: true, status: true, customer: { select: { name: true } } },
      take: 5,
    })
    const cases = await db.serviceCase.findMany({
      where: { OR: [{ code: { contains: q } }, { title: { contains: q } }] },
      select: { id: true, code: true, title: true, status: true, project: { select: { code: true } } },
      take: 5,
    })
    const hits: Hit[] = [
      ...claims.map((c) => ({
        id: c.id, label: `${c.code} — ${c.title}`,
        sub: `reklamacija · ${c.customer.name} · ${c.status}`,
        section: 'pisarna', tab: 'servis', kind: 'reklamacija',
      })),
      ...cases.map((c) => ({
        id: c.id, label: `${c.code} — ${c.title}`,
        sub: `servis · ${c.project.code} · ${c.status}`,
        section: 'pisarna', tab: 'servis', kind: 'servis',
      })),
    ]
    if (hits.length) groups.push({ kind: 'servis', label: 'Reklamacije / Servis', hits })
  }

  if (hasPerm(perms, 'inventory.read')) {
    const items = await db.inventoryItem.findMany({
      where: { OR: [{ name: { contains: q } }, { sku: { contains: q } }] },
      select: { id: true, sku: true, name: true, qty: true, unit: true }, take: 5,
    })
    if (items.length) groups.push({
      kind: 'zaloga', label: 'Zaloga',
      hits: items.map((i) => ({ id: i.id, label: i.name, sub: `${i.sku} · ${i.qty} ${i.unit}`, section: 'pisarna', tab: 'zaloga', kind: 'zaloga' })),
    })
  }

  // R442: izdelki iz produktnega modela (katalog po družinah)
  if (hasPerm(perms, 'catalog.read')) {
    const products = await db.product.findMany({
      where: { active: true, OR: [{ name: { contains: q } }, { sku: { contains: q } }] },
      select: { id: true, sku: true, name: true, unit: true, salePrice: true, family: { select: { name: true } } }, take: 5,
    })
    if (products.length) groups.push({
      kind: 'izdelek', label: 'Izdelki',
      hits: products.map((p) => ({
        id: p.id, label: p.name, sub: `${p.sku} · ${p.family.name} · ${p.salePrice} €/${p.unit}`,
        section: 'pisarna', tab: 'katalog', kind: 'izdelek',
      })),
    })
  }

  if (hasPerm(perms, 'users.read')) {
    const users = await db.user.findMany({
      where: { OR: [{ name: { contains: q } }, { email: { contains: q } }] },
      select: { id: true, name: true, email: true, role: true }, take: 5,
    })
    if (users.length) groups.push({
      kind: 'uporabnik', label: 'Uporabniki',
      hits: users.map((u) => ({ id: u.id, label: u.name, sub: `${u.email} · ${u.role}`, section: 'pisarna', tab: 'vodja-ekipa', kind: 'uporabnik' })),
    })
  }

  return NextResponse.json({ data: { groups, q } })
}
