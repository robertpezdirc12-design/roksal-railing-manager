'use client'

// KATALOG — zavihek CENIKI (PriceList/PriceRule — poslovne cene NISO hardcoded)
// + uvoz cenika (R516) + ročno urejanje pravil — R548 izvleček iz katalog.tsx
// (razbitje po vzorcu R546/R547; BREZ spremembe obnašanja).

import { useRef, useState } from 'react'
import { Layers, Pencil, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPost, fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { type PriceListRow, type PriceRuleRow, konfigLabel } from './katalog-shared'

// ─── zavihek: ceniki ─────────────────────────────────────────────────────────

export const PL_TYPE_LABELS: Record<string, string> = {
  NABAVNA: 'Nabavni',
  PRODAJNA: 'Prodajni',
  MONTAZA: 'Montaža',
}

export function PriceListsTab () {
  const user = useAppStore((s) => s.user)
  const lists = useApi<{ data: PriceListRow[] }>('/api/price-lists')
  const canManage = hasPerm(user?.perms, 'price.override')
  const [editing, setEditing] = useState<{ listId: string; listName: string; rule: PriceRuleRow | null } | null>(null)
  const [importing, setImporting] = useState(false)

  const rows = lists.data?.data ?? []

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-xl text-xs text-muted-foreground">
            Poslovne cene niso hardcodirane — živijo kot pravila cenika. Uvozite jih iz CSV/XLSX/JSON (glava: SKU;Cena;Enota;Popust %;Min cena;Veljavno od;Veljavno do;Opomba).
          </p>
          <Button size="sm" onClick={() => setImporting(true)}>
            <Upload className="mr-1.5 size-4" aria-hidden /> Uvozi cenik
          </Button>
        </div>
      ) : null}
      {canManage ? null : (
        <p className="rounded-xl border border-dashed bg-secondary/40 p-3 text-xs text-muted-foreground">
          Prikazani so prodajni in montažni ceniki. Nabavni cenik je viden samo pooblaščeni osebi (price.override).
        </p>
      )}
      <ErrorBox error={lists.error} />
      {lists.loading ? <LoadingRows /> : rows.length === 0 && !lists.error ? (
        <EmptyState title="Ni cenikov" desc="Ceniki še niso definirani." icon={Layers} />
      ) : (
        <div className="space-y-4">
          {rows.map((l) => (
            <Card key={l.id}>
              <CardContent className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                  <div>
                    <div className="font-semibold">{l.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {PL_TYPE_LABELS[l.type] ?? l.type} · velja od {new Date(l.validFrom).toLocaleDateString('sl-SI')}
                      {l.validTo ? ` do ${new Date(l.validTo).toLocaleDateString('sl-SI')}` : ' dalje'}
                      {l.note ? ` · ${l.note}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground">{l.rules.length} pravil</Badge>
                  </div>
                </div>
                {l.rules.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">Cenik je prazen.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-4">Cilj pravila</TableHead>
                          <TableHead className="text-right">Cena</TableHead>
                          <TableHead className="text-right">Popust</TableHead>
                          <TableHead className="hidden sm:table-cell">Sezona</TableHead>
                          {canManage ? <TableHead className="pr-4" /> : null}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {l.rules.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="max-w-64 pl-4">
                              {konfigLabel(r) ? (
                                <span className="font-medium">{konfigLabel(r)}</span>
                              ) : (
                                <>
                                  <span className="font-mono text-xs text-muted-foreground">{r.product?.sku ?? r.item?.sku}</span>
                                  <span className="ml-2 font-medium">{r.product?.name ?? r.item?.name}</span>
                                </>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-bold">{r.unit === '%' ? `${r.price} %` : fmtEUR(r.price)}<span className="text-xs font-normal text-muted-foreground"> / {r.product?.unit ?? r.item?.unit ?? r.unit}</span></TableCell>
                            <TableCell className="text-right">{r.discountPct > 0 ? `${r.discountPct} %` : '—'}</TableCell>
                            <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                              {r.seasonFrom && r.seasonTo ? `${r.seasonFrom} → ${r.seasonTo}` : '—'}
                            </TableCell>
                            {canManage ? (
                              <TableCell className="pr-4 text-right">
                                <Button variant="ghost" size="icon" aria-label="Uredi pravilo" onClick={() => setEditing({ listId: l.id, listName: l.name, rule: r })}>
                                  <Pencil className="size-4" aria-hidden />
                                </Button>
                              </TableCell>
                            ) : null}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null) }}>
        <EditRuleDialog
          ctx={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await lists.reload() }}
        />
      </Dialog>

      <ImportCenikDialog
        open={importing}
        onOpenChange={setImporting}
        lists={rows}
        onImported={async () => { setImporting(false); await lists.reload() }}
      />
    </div>
  )
}

/** R516 (issue #15 Faza 6): uvoz cenika iz CSV/XLSX/JSON — PREVERI (brez
 *  zapisov, diff se pokaže) nato UVOZI. Cene ostanejo PODATEK (PriceRule). */
function ImportCenikDialog ({ open, onOpenChange, lists, onImported }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  lists: PriceListRow[]
  onImported: () => Promise<void>
}) {
  const token = useAppStore((s) => s.token)
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [targetId, setTargetId] = useState<string>('__nov__')
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('PRODAJNA')
  const [result, setResult] = useState<CenikImportResult | null>(null)
  const [rowErrors, setRowErrors] = useState<{ row: number; field: string; problem: string }[] | null>(null)
  const [busy, setBusy] = useState(false)

  function reset (): void {
    setFile(null); setResult(null); setRowErrors(null)
    if (inputRef.current != null) inputRef.current.value = ''
  }

  async function run (mode: 'preveri' | 'uvozi'): Promise<void> {
    if (file == null || !token) return
    if (targetId === '__nov__' && newName.trim() === '') {
      toast({ title: 'Vnesite ime novega cenika.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('mode', mode)
      if (targetId === '__nov__') {
        fd.append('name', newName.trim())
        fd.append('type', newType)
      } else {
        fd.append('priceListId', targetId)
      }
      const res = await fetch('/api/import/cenik', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const raw = await res.json().catch(() => ({})) as { data?: CenikImportResult; error?: string; hint?: string; rowErrors?: { row: number; field: string; problem: string }[]; diff?: CenikImportResult['diff'] }
      if (!res.ok) {
        setRowErrors(raw.rowErrors ?? null)
        setResult(raw.error != null && raw.diff != null ? { ...raw.diff, mode: 'preveri', lines: 0 } as CenikImportResult : null)
        throw new Error([raw.error ?? `Napaka strežnika (${res.status}).`, raw.hint].filter(Boolean).join(' '))
      }
      setRowErrors(null)
      if (mode === 'preveri') {
        setResult(raw.data ?? null)
      } else {
        const d = raw.data
        toast({
          title: `Cenik „${d?.list?.name ?? ''}“ uvožen (${d?.novo ?? 0} novih, ${d?.posodobljeno ?? 0} nadomeščenih pravil).`,
          description: 'Cene so zapisane kot pravila cenika — izračuni ponudb jih upoštevajo od zdaj.',
        })
        reset()
        onOpenChange(false)
        await onImported()
      }
    } catch (e) {
      toast({ title: 'Uvoz ni uspel.', description: e instanceof Error ? e.message : 'Neznana napaka.', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  const d = result?.diff
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onOpenChange(false) } else { onOpenChange(true) } }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader className="min-w-0">
          <DialogTitle>Uvoz cenika</DialogTitle>
          <DialogDescription>
            CSV (podpičje, decimalna vejica ali pika), XLSX ali JSON. Najprej PREVERI (brez zapisov) — predogled se pokaže spodaj. Neznani SKU zavrne CEL uvoz.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.json"
            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium hover:file:bg-secondary/80"
            aria-label="Datoteka cenika (CSV, XLSX ali JSON)"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setRowErrors(null) }}
          />

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cenik-target">Cilj uvoza</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger id="cenik-target"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__nov__">Nov cenik …</SelectItem>
                  {lists.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name} ({PL_TYPE_LABELS[l.type] ?? l.type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {targetId === '__nov__' ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="cenik-name">Ime novega cenika</Label>
                  <Input id="cenik-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="npr. Prodajni cenik 2027" />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="cenik-type">Tip</Label>
                  <Select value={newType} onValueChange={setNewType}>
                    <SelectTrigger id="cenik-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PRODAJNA">Prodajni</SelectItem>
                      <SelectItem value="NABAVNA">Nabavni</SelectItem>
                      <SelectItem value="MONTAZA">Montažni</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : null}
          </div>

          {file != null ? (
            <p className="text-xs text-muted-foreground">{file.name} · {Math.max(1, Math.round(file.size / 1024))} KB</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Glava: <span className="font-mono">SKU;Cena;Enota;Popust %;Min cena;Veljavno od;Veljavno do;Opomba</span> — enota je neobvezna (vzame se iz kataloga), datumi ISO ali DD.MM.YYYY.
            </p>
          )}

          {rowErrors != null && rowErrors.length > 0 ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200" role="alert">
              <p className="mb-1 font-bold">Napake v vrsticah ({rowErrors.length}):</p>
              <ul className="max-h-32 space-y-0.5 overflow-y-auto">
                {rowErrors.map((e, i) => <li key={i}>Vrsta {e.row} · {e.field}: {e.problem}</li>)}
              </ul>
            </div>
          ) : null}

          {result != null && d != null ? (
            <div className="space-y-2 rounded-lg border bg-secondary/30 p-3 text-xs">
              <p className="font-bold">Predogled: {result.lines} vrstic · {result.skus ?? 0} SKU</p>
              <p className={d.neznani.length === 0 ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'font-medium text-red-700 dark:text-red-400'}>
                {d.novo} novih · {d.posodobljeno} nadomeščenih{d.neznani.length > 0 ? ` · ${d.neznani.length} NEZNANIH SKU (uvoz bo zavrnjen)` : ''}
              </p>
              {d.entries != null && d.entries.length > 0 ? (
                <ul className="max-h-40 space-y-0.5 overflow-y-auto font-mono">
                  {d.entries.slice(0, 30).map((e: { kind: string; sku: string; unit: string | null; fromPrice?: number; toPrice: number }, i: number) => (
                    <li key={i}>
                      {e.kind === 'NOVO' ? '+' : e.kind === 'POSODOBLJENO' ? '±' : '✗'} {e.sku}
                      {e.kind === 'POSODOBLJENO' ? `: ${e.fromPrice} → ${e.toPrice}` : `: ${e.toPrice}`} EUR/{e.unit ?? '?'}
                    </li>
                  ))}
                </ul>
              ) : null}
              {(result.warnings ?? []).length > 0 ? (
                <ul className="space-y-0.5 text-muted-foreground">
                  {(result.warnings ?? []).slice(0, 5).map((w: string, i: number) => <li key={i}>• {w}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <Button type="button" variant="secondary" disabled={busy || file == null} onClick={() => { void run('preveri') }}>
              {busy ? '…' : 'Preveri'}
            </Button>
            <Button type="button" disabled={busy || file == null || (d != null && d.neznani.length > 0)} onClick={() => { void run('uvozi') }}>
              {busy ? '…' : 'Uvozi'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export interface CenikImportResult {
  mode: string
  lines: number
  skus?: number
  list?: { id: string | null; name: string; type: string }
  novo?: number
  posodobljeno?: number
  diff?: {
    novo: number
    posodobljeno: number
    neznani: string[]
    brezEnote: string[]
    entries: { kind: string; sku: string; unit: string | null; fromPrice?: number; toPrice: number }[]
  }
  warnings?: string[]
}

function EditRuleDialog ({ ctx, onClose, onSaved }: {
  ctx: { listId: string; listName: string; rule: PriceRuleRow | null } | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { toast } = useToast()
  const [price, setPrice] = useState('')
  const [discount, setDiscount] = useState('')

  const [lastKey, setLastKey] = useState<string | null>(null)
  const ruleKey = ctx ? `${ctx.listId}:${ctx.rule?.id ?? 'new'}` : null
  if (ctx && ruleKey && ruleKey !== lastKey) {
    setLastKey(ruleKey)
    setPrice(String(ctx.rule?.price ?? ''))
    setDiscount(String(ctx.rule?.discountPct ?? 0))
  }

  async function submit () {
    if (!ctx) return
    const p = Number(price)
    if (!Number.isFinite(p) || p < 0) { toast({ title: 'Cena mora biti veljavno število.', variant: 'destructive' }); return }
    const d = Number(discount)
    // generično konfiguracijsko pravilo prenesemo kot key (note = KONFIG:<ključ>)
    const konfigKey = ctx.rule?.note?.startsWith('KONFIG:')
      ? ctx.rule.note.slice('KONFIG:'.length)
      : null
    try {
      await apiPost(`/api/price-lists/${ctx.listId}/rules`, {
        productId: ctx.rule?.product?.id ?? null,
        itemId: ctx.rule?.item?.id ?? null,
        key: konfigKey,
        price: p,
        discountPct: Number.isFinite(d) ? d : 0,
        unit: ctx.rule?.product?.unit ?? ctx.rule?.item?.unit ?? ctx.rule?.unit ?? 'm2',
      })
      toast({ title: 'Pravilo shranjeno.', description: konfigKey
        ? `${konfigLabel(ctx.rule) ?? konfigKey}: ${p}`
        : ctx.rule ? `${ctx.rule.product?.name ?? ctx.rule.item?.name}: ${fmtEUR(p)}` : undefined })
      await onSaved()
    } catch (e) {
      toast({ title: 'Napaka pri shranjevanju', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  if (!ctx) return null
  const target = konfigLabel(ctx.rule) ?? (ctx.rule?.product?.name ?? ctx.rule?.item?.name ?? '')
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Uredi pravilo cenika</DialogTitle>
        <DialogDescription>{ctx.listName} — {target}</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="er-price">Cena (€)</Label>
        <Input id="er-price" type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
        <Label htmlFor="er-disc">Popust (%)</Label>
        <Input id="er-disc" type="number" min="0" max="100" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        <p className="text-xs text-muted-foreground">Sprememba se zapiše v revizijski dnevnik (PRICE_RULE_UPDATE).</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()}>Shrani</Button>
      </DialogFooter>
    </DialogContent>
  )
}
