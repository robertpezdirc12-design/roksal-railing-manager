'use client'

// NALOGI — nov nalog (dialog) — R548 izvleček iz nalogi.tsx (razbitje po
// vzorcu R546/R547; BREZ spremembe obnašanja).

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { apiPost, useApi } from '@/lib/api-client'
import { ErrorBox } from '@/components/roksal/ui-bits'

// ─── nov nalog ───────────────────────────────────────────────────────────────

export function CreateNalogDialog ({ open, canReadUsers, onClose, onCreated }: {
  open: boolean
  canReadUsers: boolean
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('none')
  const [assigneeId, setAssigneeId] = useState('none')
  const [assigneeName, setAssigneeName] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)

  // izbirnike naložimo šele ob odprtju dialoga
  const projects = useApi<{ data: { id: string; code: string; title: string }[] }>(open ? '/api/projects' : null, [open])
  const users = useApi<{ data: { id: string; name: string; role: string }[] }>(open && canReadUsers ? '/api/users' : null, [open, canReadUsers])

  async function submit () {
    if (!title.trim()) {
      toast({ title: 'Naslov naloga je obvezen.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      await apiPost('/api/nalog', {
        title: title.trim(),
        projectId: projectId === 'none' ? null : projectId,
        assigneeId: canReadUsers && assigneeId !== 'none' ? assigneeId : null,
        scheduledFor: scheduledFor || null,
        instructions: instructions.trim() || null,
      })
      toast({ title: 'Nalog ustvarjen.', description: `${title.trim()} — kodo je določil sistem.` })
      setTitle(''); setProjectId('none'); setAssigneeId('none'); setAssigneeName(''); setScheduledFor(''); setInstructions('')
      await onCreated()
    } catch (e) {
      toast({ title: 'Napaka pri ustvarjanju naloga', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Nov nalog</DialogTitle>
        <DialogDescription>
          Kodo (N-letno-številka) določi sistem. Nalog se nato vodi skozi terenski tok.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="nn-title">Naslov</Label>
          <Input id="nn-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="npr. Zajem meritev — stopnišče" />
        </div>

        <div className="space-y-2">
          <Label>Projekt</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger aria-label="Projekt"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="none">Brez projekta</SelectItem>
              {(projects.data?.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ErrorBox error={projects.error} />
        </div>

        {canReadUsers ? (
          <div className="space-y-2">
            <Label>Izvajalec</Label>
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger aria-label="Izvajalec"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="none">Ni dodeljen</SelectItem>
                {(users.data?.data ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="nn-assignee">Izvajalec (ime)</Label>
            <Input
              id="nn-assignee" value={assigneeName} onChange={(e) => setAssigneeName(e.target.value)}
              placeholder="Ime izvajalca …"
              aria-describedby="nn-assignee-hint"
            />
            <p id="nn-assignee-hint" className="text-xs text-muted-foreground">
              Brez pravice users.read izvajalca ni mogoče povezati z uporabniškim računom.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="nn-date">Termin</Label>
          <Input id="nn-date" type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="nn-instructions">Navodila za monterja</Label>
          <Textarea
            id="nn-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)}
            placeholder="npr. Pokliči stranko 30 min pred prihodom. Stopnišče ima 14 stopnic — izmeri višino in nagib. Pri vhodu pazi na ploščice."
            className="min-h-20"
          />
          <p className="text-xs text-muted-foreground">Navodila se pokažejo monterju v podrobnosti naloga.</p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Ustvarjam…' : 'Ustvari nalog'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}
