'use client'

// MERITVE S KAMERO — statusni pasici NAD fazami + 5-fazni statusni koraki.
// R537-a: selitev iz meritve-kamera.tsx (izhodiščne glave ostajajo ob kodi);
// stanje prejmejo prek propsov (lastnik je vstopna komponenta).

import type { Dispatch, SetStateAction } from 'react'
import { Redo2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/lib/store'
import { clearDraft, sejaKljuc, type MeasureDraft } from '@/lib/measure-draft'
import type { VrsticaShranjevanja } from '@/lib/offline'
import { PHASES } from './tipi'

/** R455: 5-fazni profesionalni status (§4). */
export function FazniStatus ({ phase, stepDone }: {
  phase: 1 | 2 | 3 | 4 | 5
  stepDone: boolean[]
}) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[11px]" aria-label="Status zajema">
      {PHASES.map((t, i) => {
        const st = phase === i + 1 ? 'active' : stepDone[i] ? 'done' : 'todo'
        return (
          <li key={t} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${st === 'active' ? 'border-roksal-amber bg-amber-50 font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : st === 'done' ? 'border-emerald-300 text-emerald-800 dark:border-emerald-900 dark:text-emerald-300' : 'text-muted-foreground'}`}>
            <span className={`flex size-4 items-center justify-center rounded-full text-[10px] ${st === 'done' ? 'bg-emerald-500 text-white' : st === 'active' ? 'bg-roksal-amber text-white' : 'bg-muted'}`} aria-hidden>
              {st === 'done' ? '✓' : i + 1}
            </span>
            {t.toUpperCase()}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * R508 (issue #7 §6): status shranjevanja korak-na-korak — monter vidi,
 *     KJE so njegovi podatki (telefon / vrsta / strežnik / napaka), ne le
 *     da je »nekaj obkljukano«. Stanje je izračunano iz vrste in signala.
 *     (R537-ac-verify: besedilo povrnjeno na izvirnik 1741–1743.)
 */
export function StatusShranjevanja ({ vrstica }: { vrstica: VrsticaShranjevanja }) {
  const v = vrstica
  const barva = v.stanje === 'NAPAKA' || v.stanje === 'NESKLADJE'
    ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'
    : v.stanje === 'SINHRONIZIRANO'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
      : v.stanje === 'CAKA_NA_SINHRONIZACIJO'
        ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
        : 'border-border bg-muted/40 text-muted-foreground'
  return (
    <p className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border px-3 py-1.5 text-[11px] font-medium ${barva}`} role="status" aria-label={`Shranjevanje: ${v.oznaka}`}>
      <span className="font-semibold">{v.oznaka}</span>
      <span>{v.opis}</span>
      {v.dejanje ? <span className="opacity-80">{v.dejanje}</span> : null}
    </p>
  )
}

/** R486 (issue #7 §3/§6): nedokončana meritev — pasica nadaljevanja. */
export function PasicaOsnutek ({ pendingDraft, sejeNedokoncanih, resumeDraft, setPendingDraft, setSejeNedokoncanih }: {
  pendingDraft: MeasureDraft
  sejeNedokoncanih: number
  resumeDraft: (d: MeasureDraft) => void
  setPendingDraft: Dispatch<SetStateAction<MeasureDraft | null>>
  setSejeNedokoncanih: Dispatch<SetStateAction<number>>
}) {
  const pts = pendingDraft.views.reduce((s, v) => s + (Array.isArray(v.points) ? v.points.length : 0), 0)
  const at = new Date(pendingDraft.savedAt)
  const hm = Number.isFinite(at.getTime())
    ? at.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' })
    : ''
  return (
    <div
      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40"
      role="status"
      aria-label="Nedokončana meritev shranjena v telefonu"
    >
      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
        Imaš nedokončano meritev{hm ? ` (shranjeno ${hm})` : ''} — {pendingDraft.views.length} {pendingDraft.views.length === 1 ? 'pogled' : 'pogleda/pogledi'}, {pts} točk.
        {sejeNedokoncanih > 1 ? ` Skupno jih imaš ${sejeNedokoncanih}; tu je najnovejša.` : ''}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" className="h-9" onClick={() => resumeDraft(pendingDraft)}>
          <Redo2 className="size-4" aria-hidden /> NADALJUJ
        </Button>
        <Button
          size="sm" variant="outline" className="h-9"
          onClick={() => {
            const uid = useAppStore.getState().user?.id
            // R508 (§6): ZAČNI NOVO pobriše SAMO to sejo. Druge nedokončane
            // meritve istega monterja na napravi ostanejo (brez tihe izgube).
            if (uid) void clearDraft(uid, sejaKljuc(pendingDraft))
            setPendingDraft(null)
            setSejeNedokoncanih((n) => Math.max(0, n - 1))
          }}
        >
          <Trash2 className="size-4" aria-hidden /> ZAČNI NOVO
        </Button>
      </div>
    </div>
  )
}
