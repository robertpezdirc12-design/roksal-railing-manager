'use client'

// KOSOVNICE (BOM) — R442 (issue #7 §2): seznam generiranih kosovnic z EKSPlicitnimi
// ID povezavami na artikle. Nadomešča stari "Material V5" fuzzy matching (ROOTS
// besede), ki ga issue #7 §2/§15 izrecno prepoveduje kot vir resnice.
// Vrata: inventory.read (pogled) / inventory.write (status).

import { useState } from 'react'
import { ClipboardList, Eye, PackageSearch, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, fmtDate, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

interface BomLineRow {
  itemId: string; qty: number; unit: string; note: string | null
  item: { sku: string; name: string; unit: string; qty: number }
}

interface BomRow {
  id: string; code: string; status: string; qty: number; unit: string
  note: string | null; createdAt: string
  product: { sku: string; name: string; unit: string }
  variant: { sku: string; name: string } | null
  package: { code: string; name: string; project: { code: string; title: string } } | null
  lines: BomLineRow[]
}

const BOM_STATUS_OPTIONS = ['OSNUTEK', 'POTRJEN', 'REZERVIRAN', 'PORABLJEN', 'PREKLICAN']

export default function KosovniceModule () {
  const user = useAppStore((s) => s.user)
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState<string | null>(null)

  const list = useApi<{ data: BomRow[] }>(`/api/bom${status !== 'all' ? `?status=${status}` : ''}`, [status])
  const detail = useApi<{ data: BomRow }>(selected ? `/api/bom/${selected}` : null, [selected])

  const canWrite = hasPerm(user?.perms, 'inventory.write')
  const rows = list.data?.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kosovnice (BOM)"
        desc="Generirane kosovnice paketov — vrstice so vezane na artikle z eksplicitnimi ID"
        actions={
          <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground">{rows.length} kosovnic</Badge>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" aria-label="Filter statusa"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vsi statusi</SelectItem>
            {BOM_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <ErrorBox error={list.error} />
      {list.loading ? <LoadingRows /> : !list.error && rows.length === 0 ? (
        <EmptyState
          title="Ni kosovnic"
          desc="Kosovnice nastanejo, ko pisarna iz paketa projekta generira BOM (Projekti → podrobnost → Paketi)."
          icon={ClipboardList}
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((b) => {
            const uncovered = b.lines.filter((l) => l.item.qty < l.qty).length
            return (
              <li key={b.id}>
                <Card className="transition hover:border-roksal-amber/60">
                  <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-1.5 p-4">
                    <span className="font-mono text-xs font-semibold text-roksal-amber">{b.code}</span>
                    <StatusBadge status={b.status} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{b.product.name}{b.variant ? ` · ${b.variant.name}` : ''}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {b.qty} {b.unit}
                        {b.package ? ` · ${b.package.code} — ${b.package.project.code} ${b.package.project.title}` : ' · brez paketa'}
                        {` · ${b.lines.length} vrstic`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {uncovered > 0 ? (
                        <Badge variant="secondary" className="border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">{uncovered} manjka</Badge>
                      ) : (
                        <Badge variant="secondary" className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"><ShieldCheck className="mr-1 size-3" aria-hidden />zaloga OK</Badge>
                      )}
                      <Button variant="outline" size="sm" onClick={() => setSelected(b.id)}>
                        <Eye className="size-4" aria-hidden /> Vrstice
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <BomDetailDialog
          bom={detail.data?.data ?? null}
          loading={detail.loading}
          canWrite={canWrite}
          onChanged={async () => { await list.reload(); await detail.reload() }}
        />
      </Dialog>
    </div>
  )
}

function BomDetailDialog ({ bom, loading, canWrite, onChanged }: {
  bom: BomRow | null
  loading: boolean
  canWrite: boolean
  onChanged: () => Promise<void>
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  async function changeStatus (status: string) {
    if (!bom) return
    setBusy(true)
    try {
      await apiPatch(`/api/bom/${bom.id}`, { status })
      toast({ title: 'Status kosovnice posodobljen.', description: `${bom.code} → ${status}` })
      await onChanged()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <PackageSearch className="size-5 text-roksal-amber" aria-hidden />
          {bom ? bom.code : 'Nalagam kosovnico …'}
          {bom ? <StatusBadge status={bom.status} /> : null}
        </DialogTitle>
        <DialogDescription>
          {bom
            ? `${bom.product.sku} — ${bom.product.name} · ${bom.qty} ${bom.unit}`
              + (bom.package ? ` · paket ${bom.package.code} (${bom.package.project.code})` : '')
              + ` · ${fmtDate(bom.createdAt)}`
            : 'Vrstice kosovnice z eksplicitnimi povezavami na artikle.'}
        </DialogDescription>
      </DialogHeader>
      {loading || !bom ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Nalagam kosovnico …</div>
      ) : (
        <>
          {bom.note ? <p className="text-sm text-muted-foreground">{bom.note}</p> : null}

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-3">Artikel</TableHead>
                  <TableHead className="text-right">Potrebno</TableHead>
                  <TableHead className="text-right">Zaloga</TableHead>
                  <TableHead className="pr-3">Stanje</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bom.lines.map((l) => (
                  <TableRow key={l.itemId}>
                    <TableCell className="pl-3">
                      <span className="font-mono text-xs text-muted-foreground">{l.item.sku}</span>
                      <span className="ml-2 font-medium">{l.item.name}</span>
                      {l.note ? <span className="block text-[11px] text-muted-foreground">{l.note}</span> : null}
                    </TableCell>
                    <TableCell className="text-right font-bold">{l.qty} <span className="text-xs font-normal text-muted-foreground">{l.unit}</span></TableCell>
                    <TableCell className="text-right text-muted-foreground">{l.item.qty} {l.item.unit}</TableCell>
                    <TableCell className="pr-3">
                      {l.item.qty >= l.qty ? (
                        <Badge variant="secondary" className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">pokrito</Badge>
                      ) : (
                        <Badge variant="secondary" className="border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">manjka {Math.round((l.qty - l.item.qty) * 100) / 100}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {canWrite ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Status:</span>
              <Select value={bom.status} onValueChange={(v) => void changeStatus(v)} disabled={busy}>
                <SelectTrigger className="w-40" aria-label="Status kosovnice"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BOM_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Rezervacije zaloge po paketih sledijo v fazi INVENTORY CORE (issue #7 P1) —
            trenutno prikazujemo fizično zalogo artiklov.
          </p>
        </>
      )}
    </DialogContent>
  )
}
