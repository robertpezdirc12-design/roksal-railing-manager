'use client'

// POSTSIG — kokpit "Po podpisu": zaklenjeni posli (deal.lock)
// Za vsak zaklenjen posel pokaže statusni trak Podpisano → Račun → Proizvodnja
// in akciji "Izdaj račun" (invoices.issue) ter "Ustvari proizvodni nalog" (production.manage)
// — obe vidni SAMO z ustrezno pravico. Brez lastnega API-ja: /api/quotes, /api/invoices,
// /api/projects, /api/production (obstoječe poti; povezave po quoteId / projektni kodi).
// R437: gumb "Odkleni" (deal.lock) → POST /api/deal-lock { quoteId, locked: false }.

import { useMemo, useState } from 'react'
import { CheckCircle2, CircleDashed, Factory, FileSignature, FilePlus2, Lock, LockOpen, PenLine, Receipt, XCircle } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPost, fmtDate, fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatCard, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

interface LockedQuote {
  id: string
  code: string
  status: string
  total: number
  createdAt: string
  signature: string | null
  signedAt: string | null
  signedBy: string | null
  customer: { name: string; city: string } | null
  project: { code: string; title: string } | null
  _count: { lines: number }
}

interface InvoiceRow {
  id: string
  code: string
  status: string
  total: number
  paid: number
  quoteId: string | null
  project: { code: string; title: string; customer: { name: string } | null } | null
}

interface ProjectRow { id: string; code: string; title: string; status: string }

interface ProductionRow {
  id: string
  code: string
  title: string
  status: string
  projectId: string | null
  project: { code: string; title: string } | null
}

/** Korak statusnega traku: opravljen / v teku / manjka. */
function StripStep ({ label, state, hint }: { label: string; state: 'done' | 'partial' | 'none'; hint?: string }) {
  const cls = {
    done: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
    partial: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
    none: 'border-dashed border-muted-foreground/40 bg-muted/40 text-muted-foreground',
  }[state]
  const Icon = state === 'done' ? CheckCircle2 : state === 'partial' ? CircleDashed : XCircle
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${cls}`}
      title={hint}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />{label}
    </span>
  )
}

export default function PostsigModule () {
  const { toast } = useToast()
  const user = useAppStore((s) => s.user)

  const quotes = useApi<{ data: LockedQuote[] }>('/api/quotes?status=ZAKLENJEN&limit=100', [])
  const invoices = useApi<{ data: InvoiceRow[] }>('/api/invoices?limit=200', [])
  const projects = useApi<{ data: ProjectRow[] }>('/api/projects', [])
  const production = useApi<{ data: ProductionRow[] }>('/api/production', [])

  const [busyKey, setBusyKey] = useState<string | null>(null)

  const canIssue = hasPerm(user?.perms, 'invoices.issue')
  const canManageProduction = hasPerm(user?.perms, 'production.manage')
  // R437: odklep zaklenjenega posla (deal.lock)
  const canUnlock = hasPerm(user?.perms, 'deal.lock')

  const reloadAll = async () => {
    await Promise.all([quotes.reload(), invoices.reload(), projects.reload(), production.reload()])
  }

  const cards = useMemo(() => {
    const locked = quotes.data?.data ?? []
    const invs = invoices.data?.data ?? []
    const projs = projects.data?.data ?? []
    const prods = production.data?.data ?? []
    return locked.map((qq) => {
      const project = qq.project ? projs.find((p) => p.code === qq.project!.code) ?? null : null
      const invoice = invs.find((iv) => iv.quoteId === qq.id) ?? null
      const prodsForProject = qq.project ? prods.filter((pr) => pr.project?.code === qq.project!.code) : []
      return { quote: qq, project, invoice, prods: prodsForProject }
    })
  }, [quotes.data, invoices.data, projects.data, production.data])

  async function issueInvoice (quote: LockedQuote) {
    setBusyKey(`inv-${quote.id}`)
    try {
      const res = await apiPost<{ data: { code: string } }>('/api/invoices', { quoteId: quote.id })
      toast({ title: `Račun ${res.data.code} izdan.`, description: `Iz ponudbe ${quote.code}.` })
      await reloadAll()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusyKey(null) }
  }

  async function createProduction (quote: LockedQuote, project: ProjectRow | null) {
    if (!project) return
    setBusyKey(`prod-${quote.id}`)
    try {
      const res = await apiPost<{ data: { code: string } }>('/api/production', {
        projectId: project.id,
        title: `Izdelava po ponudbi ${quote.code} — ${project.title}`,
      })
      toast({ title: `Proizvodni nalog ${res.data.code} ustvarjen.`, description: `Za projekt ${project.code}.` })
      await reloadAll()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusyKey(null) }
  }

  /** R437: odklep posla — nazaj na SPREJET (zavrnjeno, če ima ponudba že račune). */
  async function unlockDeal (quote: LockedQuote) {
    setBusyKey(`unlock-${quote.id}`)
    try {
      await apiPost('/api/deal-lock', { quoteId: quote.id, locked: false })
      toast({ title: `Posel ${quote.code} odklenjen.`, description: 'Ponudba je nazaj v statusu SPREJET.' })
      await reloadAll()
    } catch (e) {
      toast({ title: 'Odklep ni uspel', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusyKey(null) }
  }

  const stats = useMemo(() => {
    const withInvoice = cards.filter((c) => !!c.invoice).length
    const withProduction = cards.filter((c) => c.prods.length > 0).length
    return {
      locked: cards.length,
      value: cards.reduce((s, c) => s + c.quote.total, 0),
      withInvoice,
      withProduction,
    }
  }, [cards])

  return (
    <div className="space-y-4">
      <PageHeader
        title="PostSig — po podpisu"
        desc="Zaklenjeni posli: nadaljnji tok izdaje računa in proizvodnje po podpisu stranke"
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Zaklenjeni posli" value={stats.locked} icon={Lock} hint="s podpisom stranke" />
        <StatCard label="Vrednost" value={fmtEUR(stats.value)} icon={FileSignature} hint="skupaj podpisanih poslov" />
        <StatCard label="Z izdanim računom" value={stats.withInvoice} tone="green" icon={Receipt} hint={`${stats.locked - stats.withInvoice} še brez računa`} />
        <StatCard label="Z proizvodnjo" value={stats.withProduction} tone="amber" icon={Factory} hint={`${stats.locked - stats.withProduction} še brez naloga`} />
      </div>

      <ErrorBox error={quotes.error ?? invoices.error ?? production.error} />
      {quotes.loading || invoices.loading ? <LoadingRows /> : !quotes.error && cards.length === 0 ? (
        <EmptyState
          title="Ni zaklenjenih poslov"
          desc="Posli, podpisani v modulu Signatura, se tukaj pojavijo takoj po zaklepu."
          icon={FileSignature}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {cards.map(({ quote: qq, project, invoice, prods }) => {
            const invoiceState: 'done' | 'partial' | 'none' = !invoice ? 'none' : invoice.status === 'PLACAN' ? 'done' : 'partial'
            const productionState: 'done' | 'partial' | 'none' = prods.length === 0 ? 'none' : prods.some((p) => p.status === 'DOKONCAN' || p.status === 'ODPOSLAN') ? 'done' : 'partial'
            const showIssue = canIssue && !invoice
            const showProduction = canManageProduction && !!project && prods.length === 0
            return (
              <Card key={qq.id} className="min-w-0 transition-shadow hover:shadow-md">
                <CardContent className="flex h-full flex-col gap-3 p-4 sm:p-6">
                  {/* glava */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Lock className="size-4 shrink-0 text-roksal-amber" aria-hidden />
                        <span className="font-mono text-sm font-bold text-roksal-amber">{qq.code}</span>
                        <StatusBadge status={qq.status} />
                      </div>
                      <p className="mt-1 truncate font-semibold text-foreground">{qq.customer?.name ?? 'Brez stranke'}</p>
                      {qq.project ? (
                        <p className="truncate text-xs text-muted-foreground">{qq.project.code} · {qq.project.title}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Brez projekta</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-lg font-bold tabular-nums text-foreground">{fmtEUR(qq.total)}</div>
                      <div className="text-xs text-muted-foreground">{qq._count.lines} pozicij</div>
                    </div>
                  </div>

                  {/* podpis */}
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
                    <PenLine className="size-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
                    <span className="font-medium text-emerald-800 dark:text-emerald-300">
                      Podpisal {qq.signedBy ?? '—'}
                    </span>
                    <span className="ml-auto text-xs text-emerald-700/80 dark:text-emerald-400/80">{fmtDate(qq.signedAt)}</span>
                  </div>

                  {/* statusni trak */}
                  <div className="flex flex-wrap items-center gap-1.5" aria-label="Status posla po podpisu">
                    <StripStep label="Podpisano" state="done" hint={`Podpisnik: ${qq.signedBy ?? '—'}`} />
                    <span className="text-muted-foreground/60" aria-hidden>→</span>
                    <StripStep
                      label={invoice ? `Račun: ${invoice.code}` : 'Račun: NI'}
                      state={invoiceState}
                      hint={invoice ? `Status ${invoice.status} · plačano ${fmtEUR(invoice.paid)} od ${fmtEUR(invoice.total)}` : 'Račun še ni izdan'}
                    />
                    <span className="text-muted-foreground/60" aria-hidden>→</span>
                    <StripStep
                      label={prods.length > 0 ? `Proizvodnja: ${prods.length}` : 'Proizvodnja: NI'}
                      state={productionState}
                      hint={prods.length > 0 ? prods.map((p) => `${p.code} (${p.status})`).join(', ') : 'Proizvodni nalog še ni dodeljen'}
                    />
                  </div>

                  {/* račun + proizvodnja podrobnosti */}
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    {invoice ? (
                      <div className="rounded-lg bg-secondary/60 p-2.5">
                        <div className="mb-0.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                          <Receipt className="size-3.5" aria-hidden />Račun
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-semibold text-roksal-amber">{invoice.code}</span>
                          <StatusBadge status={invoice.status} />
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">plačano {fmtEUR(invoice.paid)} / {fmtEUR(invoice.total)}</p>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">
                        <div className="mb-0.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide"><Receipt className="size-3.5" aria-hidden />Račun</div>
                        Račun iz te ponudbe še ni izdan.
                      </div>
                    )}
                    {prods.length > 0 ? (
                      <div className="rounded-lg bg-secondary/60 p-2.5">
                        <div className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                          <Factory className="size-3.5" aria-hidden />Proizvodnja
                        </div>
                        <AnimatedList className="space-y-1">
                          {prods.map((p) => (
                            <AnimatedListItem key={p.id} className="flex items-center justify-between gap-2">
                              <span className="truncate font-mono text-xs font-semibold text-roksal-amber">{p.code}</span>
                              <StatusBadge status={p.status} />
                            </AnimatedListItem>
                          ))}
                        </AnimatedList>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">
                        <div className="mb-0.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide"><Factory className="size-3.5" aria-hidden />Proizvodnja</div>
                        {project ? 'Proizvodni nalog še ni ustvarjen.' : 'Ponudba ni povezana s projektom.'}
                      </div>
                    )}
                  </div>

                  {/* akcije — samo z ustreznimi pravicami */}
                  {showIssue || showProduction || canUnlock ? (
                    <div className="mt-auto flex flex-wrap gap-2 border-t pt-3">
                      {showIssue ? (
                        <Button size="sm" className="min-h-11" disabled={busyKey === `inv-${qq.id}`} onClick={() => void issueInvoice(qq)}>
                          <FilePlus2 className="size-4" aria-hidden /> {busyKey === `inv-${qq.id}` ? 'Izdajam …' : 'Izdaj račun'}
                        </Button>
                      ) : null}
                      {showProduction ? (
                        <Button size="sm" variant="outline" className="min-h-11" disabled={busyKey === `prod-${qq.id}`} onClick={() => void createProduction(qq, project)}>
                          <Factory className="size-4" aria-hidden /> {busyKey === `prod-${qq.id}` ? 'Ustvarjam …' : 'Ustvari proizvodni nalog'}
                        </Button>
                      ) : null}
                      {canUnlock ? (
                        <Button
                          size="sm" variant="outline" className="min-h-11"
                          disabled={busyKey === `unlock-${qq.id}`}
                          title={invoice ? 'Ponudba z izdanim računom se ne more odkleniti' : 'Odkleni posel — ponudba nazaj na SPREJET'}
                          onClick={() => void unlockDeal(qq)}
                        >
                          <LockOpen className="size-4" aria-hidden /> {busyKey === `unlock-${qq.id}` ? 'Odklepanjem …' : 'Odkleni'}
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-auto border-t pt-3 text-xs text-muted-foreground">
                      {!invoice ? 'Za izdajo računa potrebujete pravico invoices.issue.' : null}
                      {prods.length === 0 && project ? ' Za proizvodni nalog potrebujete pravico production.manage.' : null}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
