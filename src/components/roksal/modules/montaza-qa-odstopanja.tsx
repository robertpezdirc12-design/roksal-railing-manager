'use client'

// MONTAŽA QA ODSTOPANJA (R549): kartica odstopanja (vplivi, lokacija, ukrepi
// s tokom ODPRTO → V_OBRAVNAVI → ODRAVLJENO → PREVERJENO) + obrazec korektivnega
// ukrepa (izvlečeno bajtno-identično iz montaza-qa.tsx).

import { Check, Plus } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmtDateTime } from '@/lib/api-client'
import { StatusBadge } from '@/components/roksal/ui-bits'
import { ACTION_FLOW } from './montaza-qa-shared'
import type { QaActionRow, QaDeviationRow } from './montaza-qa-shared'

// ── kartica odstopanja + ukrepi ─────────────────────────────────────────────

export function DeviationCard ({ d, canWrite, busy, users, canPickUsers, onResi, actionForm, onActionForm, onActionFormChange, onUstvariUkrep, onNaprejUkrep }: {
  d: QaDeviationRow
  canWrite: boolean
  busy: boolean
  users: { id: string; name: string }[]
  canPickUsers: boolean
  onResi: () => void
  actionForm: { deviationId: string; description: string; assigneeId: string; dueAt: string } | null
  onActionForm: (open: boolean) => void
  onActionFormChange: (f: { deviationId: string; description: string; assigneeId: string; dueAt: string }) => void
  onUstvariUkrep: () => void
  onNaprejUkrep: (a: QaActionRow) => void
}) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 dark:border-amber-900 dark:bg-amber-950/40">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words text-xs font-medium leading-snug">{d.reason}</p>
        {d.resolvedAt ? (
          <span className="shrink-0 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">odpravljeno {fmtDateTime(d.resolvedAt)}</span>
        ) : (
          <span className="shrink-0 text-[10px] font-semibold text-red-600">NEREŠENO</span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {d.impactSafety ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800 dark:bg-red-950 dark:text-red-300">VARNOST</span> : null}
        {d.impactMaterial ? <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-300">MATERIAL</span> : null}
        {d.impactPrice ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">CENA</span> : null}
        {d.location ? <span className="text-[10px] text-muted-foreground">📍 {d.location}</span> : null}
      </div>

      {d.actions.length > 0 ? (
        <AnimatedList className="mt-2 space-y-1">
          {d.actions.map((a) => {
            const idx = ACTION_FLOW.indexOf(a.status)
            const next = idx >= 0 && idx < ACTION_FLOW.length - 1 ? ACTION_FLOW[idx + 1] : null
            return (
              <AnimatedListItem key={a.id} className="flex items-start justify-between gap-2 rounded bg-background/80 px-2 py-1.5">
                <span className="min-w-0">
                  <span className="block break-words text-[11px] leading-snug">{a.description}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {a.assignee ? `${a.assignee.name}` : 'brez odgovorne osebe'}{a.dueAt ? ` · rok ${fmtDateTime(a.dueAt)}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <StatusBadge status={a.status} />
                  {canWrite && next ? (
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" disabled={busy} onClick={() => onNaprejUkrep(a)}>
                      → {next === 'V_OBRAVNAVI' ? 'obdelava' : next === 'ODRAVLJENO' ? 'odpravljeno' : 'preverjeno'}
                    </Button>
                  ) : null}
                </span>
              </AnimatedListItem>
            )
          })}
        </AnimatedList>
      ) : null}

      {canWrite ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {!d.resolvedAt ? (
            <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={onResi}>
              <Check className="size-3" aria-hidden /> Odpravi odstopanje
            </Button>
          ) : null}
          {actionForm?.deviationId === d.id ? (
            <div className="w-full space-y-1.5 rounded border bg-background p-2">
              <Label htmlFor={`adesc-${d.id}`} className="text-[11px]">Korektivni ukrep — opis (obvezno)</Label>
              <Input id={`adesc-${d.id}`} className="h-8 text-xs" value={actionForm.description}
                onChange={(e) => onActionFormChange({ ...actionForm, description: e.target.value })} placeholder="Kaj je treba storiti …" />
              {canPickUsers ? (
                <>
                  <Label htmlFor={`aasg-${d.id}`} className="text-[11px]">Odgovorna oseba</Label>
                  <Select value={actionForm.assigneeId || 'none'} onValueChange={(v) => onActionFormChange({ ...actionForm, assigneeId: v === 'none' ? '' : v })}>
                    <SelectTrigger id={`aasg-${d.id}`} className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— ne določeno —</SelectItem>
                      {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </>
              ) : null}
              <Label htmlFor={`adue-${d.id}`} className="text-[11px]">Rok</Label>
              <Input id={`adue-${d.id}`} type="date" className="h-8 text-xs" value={actionForm.dueAt}
                onChange={(e) => onActionFormChange({ ...actionForm, dueAt: e.target.value })} />
              <div className="flex gap-1.5">
                <Button size="sm" className="h-7 text-[11px]" disabled={busy} onClick={onUstvariUkrep}>
                  <Plus className="size-3" aria-hidden /> Dodaj ukrep
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => onActionForm(false)}>Prekliči</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onActionForm(true)}>
              <Plus className="size-3" aria-hidden /> Korektivni ukrep
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}
