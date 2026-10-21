'use client'

// KOSOVNICE (BOM) — R442 (issue #7 §2): seznam generiranih kosovnic z EKSPlicitnimi
// ID povezavami na artikle. Nadomešča stari "Material V5" fuzzy matching (ROOTS
// besede), ki ga issue #7 §2/§15 izrecno prepoveduje kot vir resnice.
// R443: skladiščni tok — rezervacija / sprostitev / picking lista iz kosovnice.
// Vrata: inventory.read (pogled) / inventory.write (status, rezervacija, picking).

import { useState } from 'react'
import { ClipboardList, Eye, Lock, LockOpen, PackageSearch, ShieldCheck } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, apiPost, fmtDate, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

interface BomLineRow {
  itemId: string; qty: number; unit: string; note: string | null
  reserved: number // rezervirano ZA TA BOM
  reservedGlobal: number // rezervirano globalno (vse aktivne rezervacije)
  available: number // fizična − globalno rezervirana
  item: { sku: string; name: string; unit: string; qty: number }
}

interface BomRow {
  id: string; code: string; status: string; qty: number; unit: string
  note: string | null; createdAt: string
  product: { sku: string; name: string; unit: string }
  variant: { sku: string; name: string } | null
  package: { code: string; name: string; project: { code: string; title: string } } | null
  lines: BomLineRow[]
  pickings?: { id: string; code: string; status: string }[]
}

const BOM_STATUS_OPTIONS = ['OSNUTEK', 'POTRJEN', 'REZERVIRAN', 'PORABLJEN', 'PREKLICAN']
// ročno nastavljivi statusi (REZERVIRAN/PORABLJEN nastaneta samo prek skladiščnega toka)
const BOM_MANUAL_STATUSES = ['OSNUTEK', 'POTRJEN', 'PREKLICAN']

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
        <AnimatedList className="space-y-2">
          {rows.map((b) => {
            const uncovered = b.lines.filter((l) => l.item.qty < l.qty).length
            return (
              <AnimatedListItem key={b.id}>
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
            </AnimatedListItem>
            )
          })}
        </AnimatedList>
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
  const [busy, setBusy] = useState<string | null>(null)

  const activePicking = bom?.pickings?.[0] ?? null
  const reservable = bom && (bom.status === 'OSNUTEK' || bom.status === 'POTRJEN' || bom.status === 'PREKLICAN')
  const releasable = bom && bom.status === 'REZERVIRAN'

  async function changeStatus (status: string) {
    if (!bom) return
    setBusy('status')
    try {
      await apiPatch(`/api/bom/${bom.id}`, { status })
      toast({ title: 'Status kosovnice posodobljen.', description: `${bom.code} → ${status}` })
      await onChanged()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  async function reserve () {
    if (!bom) return
    setBusy('reserve')
    try {
      const res = await apiPost<{ data: { reserved: number } }>(`/api/bom/${bom.id}/reserve`)
      toast({
        title: 'Material rezerviran.',
        description: `${bom.code}: ${res.data.reserved} vrstic — razpoložljiva zaloga je zmanjšana, fizična nespremenjena.`,
      })
      await onChanged()
    } catch (e) {
      toast({ title: 'Rezervacija ni uspela', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  async function release () {
    if (!bom) return
    setBusy('release')
    try {
      const res = await apiPost<{ data: { released: number } }>(`/api/bom/${bom.id}/release`)
      toast({ title: 'Rezervacije sproščene.', description: `${bom.code}: ${res.data.released} rezervacij preklicanih — material je spet razpoložljiv.` })
      await onChanged()
    } catch (e) {
      toast({ title: 'Sprostitev ni uspela', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  async function createPicking () {
    if (!bom) return
    setBusy('picking')
    try {
      const res = await apiPost<{ data: { code: string } }>('/api/picking', { bomId: bom.id })
      toast({
        title: 'Picking lista ustvarjena.',
        description: `${res.data.code} — poiščete jo pod Zaloga → Picking; zaključek izda material in porabi rezervacije.`,
      })
      await onChanged()
    } catch (e) {
      toast({ title: 'Ustvarjanje pickinga ni uspelo', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
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

          {activePicking ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-roksal-amber/40 bg-roksal-amber/10 p-3 text-sm">
              <ClipboardList className="size-4 text-roksal-amber" aria-hidden />
              <span className="font-semibold">Aktivna picking lista {activePicking.code}</span>
              <StatusBadge status={activePicking.status} />
              <span className="text-xs text-muted-foreground">— zaključek izdaje najdete pod Zaloga → Picking.</span>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-3">Artikel</TableHead>
                  <TableHead className="text-right">Potrebno</TableHead>
                  <TableHead className="text-right">Fizična</TableHead>
                  <TableHead className="text-right">Rezervirana</TableHead>
                  <TableHead className="text-right">Razpoložljiva</TableHead>
                  <TableHead className="pr-3">Stanje</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bom.lines.map((l) => {
                  const reservedHere = l.reserved >= l.qty - 1e-9
                  const covered = l.available >= l.qty - 1e-9
                  return (
                    <TableRow key={l.itemId}>
                      <TableCell className="pl-3">
                        <span className="font-mono text-xs text-muted-foreground">{l.item.sku}</span>
                        <span className="ml-2 font-medium">{l.item.name}</span>
                        {l.note ? <span className="block text-[11px] text-muted-foreground">{l.note}</span> : null}
                      </TableCell>
                      <TableCell className="text-right font-bold">{l.qty} <span className="text-xs font-normal text-muted-foreground">{l.unit}</span></TableCell>
                      <TableCell className="text-right text-muted-foreground">{l.item.qty}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {l.reservedGlobal > 0 ? (
                          <>
                            {l.reservedGlobal}
                            {l.reserved > 0 ? <span className="block text-[11px] text-roksal-amber">ta BOM: {l.reserved}</span> : null}
                          </>
                        ) : '0'}
                      </TableCell>
                      <TableCell className={`text-right font-semibold ${covered ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{l.available}</TableCell>
                      <TableCell className="pr-3">
                        {reservedHere ? (
                          <Badge variant="secondary" className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"><Lock className="mr-1 size-3" aria-hidden />rezervirano</Badge>
                        ) : covered ? (
                          <Badge variant="secondary" className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"><ShieldCheck className="mr-1 size-3" aria-hidden />se da rezervirati</Badge>
                        ) : (
                          <Badge variant="secondary" className="border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">manjka {Math.round((l.qty - l.available) * 100) / 100}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {canWrite ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Status:</span>
                <Select value={BOM_MANUAL_STATUSES.includes(bom.status) ? bom.status : 'POTRJEN'} onValueChange={(v) => void changeStatus(v)} disabled={busy !== null}>
                  <SelectTrigger className="w-40" aria-label="Status kosovnice"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BOM_MANUAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap gap-2">
                {reservable ? (
                  <Button size="sm" onClick={() => void reserve()} disabled={busy !== null}>
                    <Lock className="size-4" aria-hidden /> {busy === 'reserve' ? 'Rezerviram …' : 'Rezerviraj material'}
                  </Button>
                ) : null}
                {releasable ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => void release()} disabled={busy !== null}>
                      <LockOpen className="size-4" aria-hidden /> {busy === 'release' ? 'Sproščam …' : 'Sprosti rezervacije'}
                    </Button>
                    {!activePicking ? (
                      <Button size="sm" onClick={() => void createPicking()} disabled={busy !== null}>
                        <ClipboardList className="size-4" aria-hidden /> {busy === 'picking' ? 'Ustvarjam …' : 'Ustvari picking listo'}
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Rezervacija zmanjša RAZPOLOŽLJIVO zalogo (fizična ostane); zaključek picking liste izda material
            (fizična −) in porabi rezervacije. Invarianta: fizična ≠ rezervirana ≠ razpoložljiva (issue #7 §7).
          </p>
        </>
      )}
    </DialogContent>
  )
}
