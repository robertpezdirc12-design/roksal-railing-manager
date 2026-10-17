'use client'

// KATALOG — originalna produktna gradiva ROKSAL (R493, issue #6 §5/§6)
// Iskreni statusi: Preverjeno / V preverjanju / Manjka / Ni odobreno.
// Približki (VLM barva, RAL_HEX) so VEDNO ločeno označeni od uradnih podatkov.
// — R548 izvleček iz katalog.tsx (razbitje po vzorcu R546/R547; BREZ spremembe obnašanja).

import { Badge } from '@/components/ui/badge'
import { ShieldCheck } from 'lucide-react'
import { useApi } from '@/lib/api-client'
import { ErrorBox } from '@/components/roksal/ui-bits'

// ─── Originalna produktna gradiva ROKSAL (R493, issue #6 §5/§6) ─────────────
// Iskreni statusi: Preverjeno / V preverjanju / Manjka / Ni odobreno.
// Približki (VLM barva, RAL_HEX) so VEDNO ločeno označeni od uradnih podatkov.

export interface AssetRow {
  id: string
  kind: string
  orientation: string | null
  view: string | null
  colorName: string | null
  colorApprox: string | null
  filePath: string | null
  cdnUrl: string | null
  sourceUrl: string | null
  sha256: string | null
  bytes: number | null
  sourceName: string
  status: string
  note: string | null
}

export const ASSET_KIND_LABEL: Record<string, string> = {
  FOTO_IZDELEK: 'Fotografija izdelka',
  PROFIL_PRESEK: 'Presek profila',
  BARVNA_LESTVICA: 'Barvna lestvica',
  DETAJL: 'Detajl',
  GALERIJA: 'Galerija (referenčna montaža)',
  KOMPONENTA: 'Komponenta',
}

export const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  VERIFIED: { label: 'Preverjeno', cls: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' },
  NEEDS_REVIEW: { label: 'V preverjanju', cls: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200' },
  MISSING: { label: 'Manjka datoteka', cls: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200' },
  NOT_AUTHORIZED: { label: 'Ni odobreno', cls: 'border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300' },
}

export function ProductAssetsSection ({ productId }: { productId: string }) {
  const q = useApi<{ data: AssetRow[]; colors?: string[] }>(`/api/product-assets?productId=${productId}`, [productId])
  const rows = q.data?.data ?? []
  const colors = q.data?.colors ?? []

  if (q.loading) {
    return (
      <section className="space-y-1.5" aria-label="Produktna gradiva">
        <h3 className="text-sm font-semibold">Produktna gradiva</h3>
        <p className="text-xs text-muted-foreground">Nalagam …</p>
      </section>
    )
  }
  if (q.error) {
    return (
      <section className="space-y-1.5" aria-label="Produktna gradiva">
        <h3 className="text-sm font-semibold">Produktna gradiva</h3>
        <ErrorBox error={q.error} />
      </section>
    )
  }
  if (rows.length === 0) return null

  const verified = rows.filter((a) => a.status === 'VERIFIED').length
  const scaleRows = rows.filter((a) => a.kind === 'BARVNA_LESTVICA')
  const otherRows = rows.filter((a) => a.kind !== 'BARVNA_LESTVICA')
  return (
    <section className="space-y-2" aria-label="Produktna gradiva">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Produktna gradiva</h3>
        <Badge variant="secondary" className="border-transparent bg-secondary text-xs text-secondary-foreground">
          <ShieldCheck className="mr-1 size-3" aria-hidden />{verified}/{rows.length} preverjenih
        </Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Izvirniki: {rows[0]?.sourceName ?? 'Roksal d.o.o.'}. Dovoljenje: izvajalec dela za Roksal (izjava lastnika). Izvirne datoteke se ne spreminjajo; izpeljane različice nosijo sled do izvirnika.
      </p>

      {/* R494: barvne lestvice — čez celo širino, neskrčene, z imeni odtenkov */}
      {scaleRows.map((a) => {
        const st = STATUS_BADGE[a.status] ?? STATUS_BADGE.NEEDS_REVIEW
        const src = a.filePath ? a.filePath.replace(/^public/, '') : a.cdnUrl ?? a.sourceUrl ?? ''
        return (
          <div key={a.id} className="overflow-hidden rounded-lg border bg-card">
            {a.status === 'MISSING' ? (
              <div className="flex h-28 items-center justify-center bg-muted/60 p-2 text-center text-[11px] text-muted-foreground" role="img" aria-label="Datoteka barvne lestvice ni bila prenesena">
                Barvna lestvica obstaja na roksal.com — datoteka ni prenesena (WAF). Izvorni URL in alt so zabeleženi.
              </div>
            ) : src ? (
              <img
                src={src}
                alt={ASSET_KIND_LABEL[a.kind] ?? a.kind}
                className="w-full bg-white object-contain dark:bg-zinc-900"
                loading="lazy"
                width={1024}
                height={320}
              />
            ) : (
              <div className="flex h-28 items-center justify-center bg-muted/60 text-xs text-muted-foreground">brez datoteke</div>
            )}
            <div className="space-y-1.5 p-2">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-semibold leading-tight">Uradna barvna lestvica (roksal.com)</span>
                <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
              </div>
              {colors.length > 0 ? (
                <div className="flex flex-wrap gap-1" aria-label="Imena odtenkov">
                  {colors.map((c) => (
                    <span key={c} className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium">{c}</span>
                  ))}
                </div>
              ) : null}
              {a.note ? <p className="text-[10px] leading-snug text-muted-foreground" title={a.note}>{a.note.slice(0, 160)}{a.note.length > 160 ? '…' : ''}</p> : null}
              {a.sha256 ? <p className="truncate font-mono text-[9px] text-muted-foreground" title={a.sha256}>sha256: {a.sha256.slice(0, 12)}…</p> : null}
              {a.sourceUrl ? (
                <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="block truncate text-[10px] text-roksal-amber hover:underline" title={a.sourceUrl}>izvirnik (roksal.com)</a>
              ) : null}
            </div>
          </div>
        )
      })}

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {otherRows.map((a) => {
          const st = STATUS_BADGE[a.status] ?? STATUS_BADGE.NEEDS_REVIEW
          const src = a.filePath ? a.filePath.replace(/^public/, '') : a.cdnUrl ?? a.sourceUrl ?? ''
          return (
            <li key={a.id} className="overflow-hidden rounded-lg border bg-card">
              {a.status === 'MISSING' ? (
                <div className="flex h-28 items-center justify-center bg-muted/60 p-2 text-center text-[11px] text-muted-foreground" role="img" aria-label="Datoteka gradiva ni bila prenesena">
                  Gradivo obstaja na roksal.com — datoteka ni prenesena. Izvorni URL in alt so zabeleženi.
                </div>
              ) : src ? (
                <img
                  src={src}
                  alt={ASSET_KIND_LABEL[a.kind] ?? a.kind}
                  className="h-28 w-full object-cover"
                  loading="lazy"
                  width={320}
                  height={160}
                />
              ) : (
                <div className="flex h-28 items-center justify-center bg-muted/60 text-xs text-muted-foreground">brez datoteke</div>
              )}
              <div className="space-y-1 p-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-semibold leading-tight">{ASSET_KIND_LABEL[a.kind] ?? a.kind}</span>
                  <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
                </div>
                <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                  {a.orientation && a.orientation !== 'SPLOSNO' ? <span className="rounded bg-muted px-1 py-0.5">{a.orientation === 'POKOCNA' ? 'pokončna' : a.orientation === 'PRECNA' ? 'prečna' : a.orientation}</span> : null}
                  {a.view ? <span className="rounded bg-muted px-1 py-0.5">{a.view.toLowerCase()}</span> : null}
                  {a.colorName ? <span className="rounded bg-muted px-1 py-0.5">barva: {a.colorName} (potrjena)</span> : null}
                  {a.colorApprox ? <span className="rounded bg-muted px-1 py-0.5">približno: {a.colorApprox} (VLM ocena, ni uradno ime)</span> : null}
                </div>
                {a.sha256 ? <p className="truncate font-mono text-[9px] text-muted-foreground" title={a.sha256}>sha256: {a.sha256.slice(0, 12)}…</p> : null}
                {a.sourceUrl ? (
                  <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="block truncate text-[10px] text-roksal-amber hover:underline" title={a.sourceUrl}>izvirnik (roksal.com)</a>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
      {rows.some((a) => a.status === 'MISSING') ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Manjkajo uradne barvne lestvice (datoteke). Imena odtenkov so zapisana v slikah na roksal.com in jih bo mogoče dokončno potrditi z datotekami od Roksala — v aplikaciji niso izmišljena.
        </p>
      ) : (
        <p className="text-[10px] text-muted-foreground">Odtenki so potrjeni z uradnimi lestvicami roksal.com (2026-10-12) in z naslovi galerijskih fotografij (2026-10-13, oznaka »potrjena«) — fotografije profil×barv so iz Roksalovih galerij. Odtenka Golden teak in White sta potrjena samo s sliko lestvice.</p>
      )}
    </section>
  )
}
