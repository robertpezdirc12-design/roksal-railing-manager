'use client'

// NAPREDNA POROČILA — R451 (issue #7 §16 P3).
// 4 tipi: PRODAJA (računi/plačila — samo invoices.read; ponudbe s quotes.read) ·
// SERVIS (reklamacije po odločitvi, obiski garancije/servisa) · ZALOGA
// (gibanja PREVZEM/IZDAJA, menjavci, vrednost) · PROJEKTI (novi po mesecih,
// statusi, pravočasnost nalogov). Obdobje: 3/6/12 mesecev.
// Fail-closed: sklopi, ki jih API vrne kot null (manjkajoče pravice), se
// NE izrišejo — enak vzorec kot dashboard. Tipi, za katere uporabnik nima
// nobenega sklopa (npr. skladišče → Prodaja), se skrijejo že v izbiri.

import { useMemo, useState } from 'react'
import {
  AlertTriangle, Banknote, Boxes, CalendarCheck2, FolderKanban, Receipt, TrendingUp, Wrench,
} from '@/components/roksal/custom-icons'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatCard, StatusBadge } from '@/components/roksal/ui-bits'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'

// ─── tipi (odgovor /api/reports) ──────────────────────────────────────────────

interface ProdajaData {
  type: 'prodaja'; months: number; from: string
  invoicedMonthly: { month: string; total: number; count: number }[] | null
  paymentsMonthly: { month: string; amount: number; count: number }[] | null
  quotesMonthly: { month: string; created: number; accepted: number }[] | null
  conversion: { total: number; accepted: number; pct: number } | null
  topCustomers: { name: string; total: number }[] | null
}

interface ServisData {
  type: 'servis'; months: number; from: string
  claimsByDecision: { decision: string | null; count: number }[] | null
  claimsMonthly: { month: string; count: number }[] | null
  warrantyVisits: number
  serviceVisits: number
  billableCount: number
  freeCount: number
}

interface ZalogaData {
  type: 'zaloga'; months: number; from: string
  movementsMonthly: { month: string; prevzem: number; izdaja: number }[]
  topMovers: { name: string; qty: number; unit: string }[]
  slowMovers: { name: string; qty: number; unit: string; value: number }[]
  stockValue: { total: number; items: number }
}

interface ProjektiData {
  type: 'projekti'; months: number; from: string
  newMonthly: { month: string; count: number }[]
  statusFlow: Record<string, number>
  onTime: { completed: number; onTime: number; late: number; noSchedule: number; pct: number; overdueNow: number }
}

type ReportData = ProdajaData | ServisData | ZalogaData | ProjektiData

// ─── oznake mesecev (slovensko, iz ključa 'YYYY-MM') ─────────────────────────

const MESECI = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec']
const mesecLabel = (key: string) => MESECI[Number(key.slice(5, 7)) - 1] ?? key

// kratki zapis denarja za stolpce (aria-label nosi polno vrednost)
const fmtShortEUR = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString('sl-SI', { maximumFractionDigits: 1 })} M€`
  if (abs >= 1_000) return `${(n / 1_000).toLocaleString('sl-SI', { maximumFractionDigits: 1 })} t€`
  return `${n.toLocaleString('sl-SI', { maximumFractionDigits: 0 })} €`
}

const ODLOCITVE: Record<string, string> = {
  UTEMELJENA: 'Utemeljena',
  DELNO_UTEMELJENA: 'Delno utemeljena',
  NEUTEMELJENA: 'Neutemeljena',
}
const odlocitevLabel = (v: string | null) => (v ? (ODLOCITVE[v] ?? v) : 'Brez odločitve')

// ─── grafikon po mesecih — enak stil kot "Kapaciteta" v dashboard.tsx ─────────

function BarChart<T extends { month: string }> ({ points, value, format, color, ariaLabel }: {
  points: T[]
  value: (p: T) => number
  format: (n: number) => string
  color: string
  ariaLabel: string
}) {
  const max = Math.max(...points.map(value), 1)
  return (
    <div className="flex items-end justify-between gap-1 sm:gap-1.5" role="img" aria-label={ariaLabel}>
      {points.map((p) => {
        const v = value(p)
        return (
          <div key={p.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="text-[10px] font-bold leading-none tabular-nums sm:text-xs">{v > 0 ? format(v) : ''}</span>
            <div
              className={cn('w-full rounded-t-md', v > 0 ? color : 'bg-secondary')}
              style={{ height: `${Math.max((v / max) * 64, 4)}px` }}
            />
            <span className="text-[10px] uppercase text-muted-foreground">{mesecLabel(p.month)}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Dvojnistopnični grafikon (npr. ustvarjene vs sprejete ponudbe, prevzem vs izdaja). */
function DualBarChart<T extends { month: string }> ({ points, a, b, labelA, labelB, colorA, colorB, ariaLabel }: {
  points: T[]
  a: (p: T) => number
  b: (p: T) => number
  labelA: string
  labelB: string
  colorA: string
  colorB: string
  ariaLabel: string
}) {
  const max = Math.max(...points.map((p) => Math.max(a(p), b(p))), 1)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className={cn('size-2.5 rounded-sm', colorA)} aria-hidden /> {labelA}</span>
        <span className="flex items-center gap-1.5"><span className={cn('size-2.5 rounded-sm', colorB)} aria-hidden /> {labelB}</span>
      </div>
      <div className="flex items-end justify-between gap-1 sm:gap-1.5" role="img" aria-label={ariaLabel}>
        {points.map((p) => {
          const va = a(p); const vb = b(p)
          return (
            <div key={p.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="text-[10px] font-bold leading-none tabular-nums sm:text-xs">
                {va > 0 || vb > 0 ? `${va}/${vb}` : ''}
              </span>
              <div className="flex h-full w-full items-end justify-center gap-0.5">
                <div
                  className={cn('w-full max-w-3 rounded-t-md', va > 0 ? colorA : 'bg-secondary')}
                  style={{ height: `${Math.max((va / max) * 64, 4)}px` }}
                />
                <div
                  className={cn('w-full max-w-3 rounded-t-md', vb > 0 ? colorB : 'bg-secondary')}
                  style={{ height: `${Math.max((vb / max) * 64, 4)}px` }}
                />
              </div>
              <span className="text-[10px] uppercase text-muted-foreground">{mesecLabel(p.month)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── definicije tipov poročil (vidnost iz pravic — API vrne null brez njih) ──

const TYPE_DEFS: { id: ProdajaData['type'] | ServisData['type'] | ZalogaData['type'] | ProjektiData['type']; label: string; desc: string; icon: typeof TrendingUp; available: (perms: string[]) => boolean }[] = [
  { id: 'prodaja', label: 'Prodaja', desc: 'Računi, plačila, ponudbe', icon: TrendingUp, available: (p) => p.includes('invoices.read') || p.includes('quotes.read') },
  { id: 'servis', label: 'Servis', desc: 'Reklamacije in obiski', icon: Wrench, available: () => true },
  { id: 'zaloga', label: 'Zaloga', desc: 'Gibanja in menjavci', icon: Boxes, available: (p) => p.includes('inventory.read') },
  { id: 'projekti', label: 'Projekti', desc: 'Portfelj in roki', icon: FolderKanban, available: () => true },
]

type ReportType = (typeof TYPE_DEFS)[number]['id']

export default function ReportsModule () {
  const perms = useAppStore((s) => s.user?.perms) ?? []
  const [type, setType] = useState<ReportType>('prodaja')
  const [months, setMonths] = useState<3 | 6 | 12>(6)

  // skrij tipe, za katere uporabnik nima NOBENEGA sklopa (fail-closed izbira)
  const available = useMemo(() => TYPE_DEFS.filter((t) => t.available(perms)), [perms])
  const active: ReportType = available.some((t) => t.id === type) ? type : (available[0]?.id ?? 'projekti')

  const { data, loading, error } = useApi<{ data: ReportData }>(
    `/api/reports?type=${active}&months=${months}`,
    [active, months]
  )

  const d = data?.data
  const periodLabel = `zadnjih ${months} mesecev`

  return (
    <div className="space-y-5">
      <PageHeader
        title="Napredna poročila"
        desc={`Trendi in analitika po mesecih — ${periodLabel} (R451).`}
        actions={
          <div className="inline-flex rounded-lg border p-1" role="group" aria-label="Obdobje poročila">
            {([3, 6, 12] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMonths(m)}
                aria-pressed={months === m}
                className={cn(
                  'min-h-11 rounded-md px-3 text-sm font-medium transition-colors sm:px-4',
                  months === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'
                )}
              >
                {m} mes.
              </button>
            ))}
          </div>
        }
      />
      <ErrorBox error={error} />

      {/* izbira tipa poročila — samo tisti, za katere API vrne podatke */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="tablist" aria-label="Tip poročila">
        {available.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setType(t.id)}
            className={cn(
              'flex min-h-[76px] flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors',
              active === t.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-secondary/60'
            )}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <t.icon className="size-4 text-roksal-amber" aria-hidden /> {t.label}
            </span>
            <span className="text-xs text-muted-foreground">{t.desc}</span>
          </button>
        ))}
      </div>

      {loading ? <LoadingRows rows={3} /> : d ? (
        <>
          {d.type === 'prodaja' ? <ProdajaView d={d} /> : null}
          {d.type === 'servis' ? <ServisView d={d} /> : null}
          {d.type === 'zaloga' ? <ZalogaView d={d} /> : null}
          {d.type === 'projekti' ? <ProjektiView d={d} /> : null}
        </>
      ) : !error ? (
        <EmptyState title="Ni podatkov" desc="Poročila za izbrani tip niso na voljo." icon={FolderKanban} />
      ) : null}
    </div>
  )
}

// ─── PRODAJA ──────────────────────────────────────────────────────────────────

function ProdajaView ({ d }: { d: ProdajaData }) {
  const sumInv = d.invoicedMonthly?.reduce((s, m) => s + m.total, 0) ?? 0
  const cntInv = d.invoicedMonthly?.reduce((s, m) => s + m.count, 0) ?? 0
  const sumPay = d.paymentsMonthly?.reduce((s, m) => s + m.amount, 0) ?? 0
  const cntPay = d.paymentsMonthly?.reduce((s, m) => s + m.count, 0) ?? 0

  return (
    <>
      {/* denarni KPI — samo če jih je API vrnel (invoices.read) */}
      {d.invoicedMonthly ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Izdani računi" value={fmtEUR(sumInv)} hint={`${cntInv} računov`} icon={Receipt} />
          <StatCard label="Prejeta plačila" value={fmtEUR(sumPay)} hint={`${cntPay} plačil`} icon={Banknote} tone="green" />
          {d.conversion ? (
            <StatCard label="Konverzija ponudb" value={`${d.conversion.pct.toFixed(1).replace('.', ',')} %`} hint={`${d.conversion.accepted}/${d.conversion.total} sprejetih`} icon={TrendingUp} />
          ) : null}
        </div>
      ) : d.conversion ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Konverzija ponudb" value={`${d.conversion.pct.toFixed(1).replace('.', ',')} %`} hint={`${d.conversion.accepted}/${d.conversion.total} sprejetih`} icon={TrendingUp} />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {d.invoicedMonthly ? (
          <Card>
            <CardHeader><CardTitle className="text-base">Izdani računi po mesecih</CardTitle></CardHeader>
            <CardContent>
              <BarChart
                points={d.invoicedMonthly}
                value={(m) => m.total}
                format={fmtShortEUR}
                color="bg-roksal-amber"
                ariaLabel={`Znesek izdanih računov po mesecih: ${d.invoicedMonthly.map((m) => `${mesecLabel(m.month)} ${fmtEUR(m.total)} (${m.count} računov)`).join(', ')}`}
              />
            </CardContent>
          </Card>
        ) : null}

        {d.paymentsMonthly ? (
          <Card>
            <CardHeader><CardTitle className="text-base">Prejeta plačila po mesecih</CardTitle></CardHeader>
            <CardContent>
              <BarChart
                points={d.paymentsMonthly}
                value={(m) => m.amount}
                format={fmtShortEUR}
                color="bg-roksal-green"
                ariaLabel={`Znesek prejetih plačil po mesecih: ${d.paymentsMonthly.map((m) => `${mesecLabel(m.month)} ${fmtEUR(m.amount)} (${m.count} plačil)`).join(', ')}`}
              />
            </CardContent>
          </Card>
        ) : null}

        {d.quotesMonthly ? (
          <Card>
            <CardHeader><CardTitle className="text-base">Ponudbe po mesecih</CardTitle></CardHeader>
            <CardContent>
              <DualBarChart
                points={d.quotesMonthly}
                a={(m) => m.created}
                b={(m) => m.accepted}
                labelA="ustvarjene"
                labelB="sprejete"
                colorA="bg-roksal-navy-soft"
                colorB="bg-roksal-green"
                ariaLabel={`Ponudbe po mesecih (ustvarjene/sprejete): ${d.quotesMonthly.map((m) => `${mesecLabel(m.month)} ${m.created}/${m.accepted}`).join(', ')}`}
              />
            </CardContent>
          </Card>
        ) : null}

        {d.topCustomers ? (
          <Card>
            <CardHeader><CardTitle className="text-base">Top stranke po znesku računov</CardTitle></CardHeader>
            <CardContent className="p-0">
              {d.topCustomers.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">V obdobju ni izdanih računov.</p>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead className="pl-4">Stranka</TableHead>
                        <TableHead className="pr-4 text-right">Znesek</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.topCustomers.map((c) => (
                        <TableRow key={c.name}>
                          <TableCell className="pl-4 font-medium">{c.name}</TableCell>
                          <TableCell className="pr-4 text-right font-mono font-semibold tabular-nums">{fmtEUR(c.total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  )
}

// ─── SERVIS ───────────────────────────────────────────────────────────────────

function ServisView ({ d }: { d: ServisData }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Obiski garancije" value={d.warrantyVisits} hint="v obdobju" icon={CalendarCheck2} />
        <StatCard label="Servisni obiski" value={d.serviceVisits} hint="v obdobju" icon={Wrench} tone="amber" />
        <StatCard label="Zaračunani primeri" value={d.billableCount} hint="billable" icon={Banknote} />
        <StatCard label="Po garanciji" value={d.freeCount} hint="brezplačni" icon={CalendarCheck2} tone="green" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {d.claimsMonthly ? (
          <Card>
            <CardHeader><CardTitle className="text-base">Nove reklamacije po mesecih</CardTitle></CardHeader>
            <CardContent>
              <BarChart
                points={d.claimsMonthly}
                value={(m) => m.count}
                format={(n) => String(n)}
                color="bg-roksal-amber"
                ariaLabel={`Nove reklamacije po mesecih: ${d.claimsMonthly.map((m) => `${mesecLabel(m.month)} ${m.count}`).join(', ')}`}
              />
            </CardContent>
          </Card>
        ) : null}

        {d.claimsByDecision ? (
          <Card>
            <CardHeader><CardTitle className="text-base">Reklamacije po odločitvi</CardTitle></CardHeader>
            <CardContent>
              {d.claimsByDecision.length === 0 ? (
                <p className="text-sm text-muted-foreground">V obdobju ni novih reklamacij.</p>
              ) : (
                <AnimatedList className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {d.claimsByDecision.map((c) => (
                    <AnimatedListItem key={c.decision ?? 'brez'} className="flex items-center justify-between gap-2">
                      <span className={cn(
                        'rounded-full px-3 py-1 text-xs font-medium',
                        c.decision === 'UTEMELJENA'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : c.decision === 'DELNO_UTEMELJENA'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : c.decision === 'NEUTEMELJENA'
                              ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                              : 'border bg-muted text-muted-foreground'
                      )}>
                        {odlocitevLabel(c.decision)}
                      </span>
                      <span className="font-bold tabular-nums">{c.count}</span>
                    </AnimatedListItem>
                  ))}
                </AnimatedList>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  )
}

// ─── ZALOGA ───────────────────────────────────────────────────────────────────

function ZalogaView ({ d }: { d: ZalogaData }) {
  const sumPrevzem = d.movementsMonthly.reduce((s, m) => s + m.prevzem, 0)
  const sumIzdaja = d.movementsMonthly.reduce((s, m) => s + m.izdaja, 0)

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Vrednost zaloge" value={fmtEUR(d.stockValue.total)} hint={`${d.stockValue.items} artiklov po povprečju lotov`} icon={Boxes} />
        <StatCard label="Prevzem v obdobju" value={sumPrevzem.toLocaleString('sl-SI')} hint="skupna količina" icon={Boxes} tone="green" />
        <StatCard label="Izdaja v obdobju" value={sumIzdaja.toLocaleString('sl-SI')} hint="skupna količina" icon={Boxes} tone="amber" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Gibanja po mesecih (količine)</CardTitle></CardHeader>
        <CardContent>
          <DualBarChart
            points={d.movementsMonthly}
            a={(m) => m.prevzem}
            b={(m) => m.izdaja}
            labelA="prevzem"
            labelB="izdaja"
            colorA="bg-roksal-green"
            colorB="bg-roksal-amber"
            ariaLabel={`Gibanja zaloge po mesecih (prevzem/izdaja): ${d.movementsMonthly.map((m) => `${mesecLabel(m.month)} ${m.prevzem}/${m.izdaja}`).join(', ')}`}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Najbolj menjani artikli (izdaja)</CardTitle></CardHeader>
          <CardContent className="p-0">
            {d.topMovers.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">V obdobju ni bilo izdaj materiala.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead className="pl-4">Artikel</TableHead>
                      <TableHead className="pr-4 text-right">Izdaja</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.topMovers.map((m) => (
                      <TableRow key={m.name}>
                        <TableCell className="pl-4 font-medium">{m.name}</TableCell>
                        <TableCell className="pr-4 text-right font-mono font-semibold tabular-nums">
                          {m.qty.toLocaleString('sl-SI')} {m.unit}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Počasni menjavci (brez izdaje)</CardTitle></CardHeader>
          <CardContent className="p-0">
            {d.slowMovers.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Vsi artikli z zalogo so imeli izdajo v obdobju.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead className="pl-4">Artikel</TableHead>
                      <TableHead className="text-right">Zaloga</TableHead>
                      <TableHead className="pr-4 text-right">Vrednost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.slowMovers.map((m) => (
                      <TableRow key={m.name}>
                        <TableCell className="pl-4 font-medium">{m.name}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{m.qty.toLocaleString('sl-SI')} {m.unit}</TableCell>
                        <TableCell className="pr-4 text-right font-mono font-semibold tabular-nums">{fmtEUR(m.value)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

// ─── PROJEKTI ─────────────────────────────────────────────────────────────────

function ProjektiView ({ d }: { d: ProjektiData }) {
  const sumNew = d.newMonthly.reduce((s, m) => s + m.count, 0)

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Novi projekti" value={sumNew} hint="v obdobju" icon={FolderKanban} />
        <StatCard label="Zaključeni nalogi" value={d.onTime.completed} hint={`${d.onTime.noSchedule} brez termina`} icon={CalendarCheck2} />
        <StatCard label="Pravočasno" value={`${d.onTime.pct.toFixed(1).replace('.', ',')} %`} hint={`${d.onTime.onTime} od ${d.onTime.onTime + d.onTime.late} z terminom`} icon={CalendarCheck2} tone={d.onTime.pct >= 80 ? 'green' : 'amber'} />
        <StatCard label="Zamude zdaj" value={d.onTime.overdueNow} hint="odprti nalogi po roku" icon={AlertTriangle} tone={d.onTime.overdueNow > 0 ? 'red' : 'green'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Novi projekti po mesecih</CardTitle></CardHeader>
          <CardContent>
            <BarChart
              points={d.newMonthly}
              value={(m) => m.count}
              format={(n) => String(n)}
              color="bg-roksal-navy-soft"
              ariaLabel={`Novi projekti po mesecih: ${d.newMonthly.map((m) => `${mesecLabel(m.month)} ${m.count}`).join(', ')}`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Projekti po statusih</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {Object.keys(d.statusFlow).length === 0 ? (
              <p className="text-sm text-muted-foreground">Ni projektov.</p>
            ) : (
              Object.entries(d.statusFlow).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between gap-2">
                  <StatusBadge status={status} />
                  <span className="font-bold tabular-nums">{count}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
