'use client'

// PLAYBOOK ADMIN (R549): §15 upravljanje definicij — verzije, statusi in
// urejanje korakov brez poseganja v poslovno logiko (izvlečeno bajtno-identično
// iz playbook.tsx).

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Ban, BookOpen, Loader2, Pencil, Play, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { apiGet, apiPatch, apiPost } from '@/lib/api-client'
import { ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import type { PlaybookDefinition } from '@/lib/playbook-core'
import type { DefRow } from './playbook-shared'

// ═══ ADMIN (§15): upravljanje definicij playbookov ════════════════════════

export function AdminDefs ({ onNazaj }: { onNazaj: () => void }) {
  const { toast } = useToast()
  const [defs, setDefs] = useState<DefRow[] | null>(null)
  const [napaka, setNapaka] = useState<string | null>(null)
  const [urejanje, setUrejanje] = useState<string | null>(null)
  const [draft, setDraft] = useState<string>('')
  const [busy, setBusy] = useState(false)

  async function nalozi () {
    try {
      const r = await apiGet<{ data: DefRow[] }>('/api/playbook/defs?vse=1')
      setDefs(r.data)
    } catch (e) {
      setNapaka(e instanceof Error ? e.message : 'Napaka')
    }
  }
  useEffect(() => { void nalozi() }, [])

  async function status (id: string, nov: string) {
    setBusy(true)
    try {
      await apiPatch('/api/playbook/defs', { id, status: nov })
      toast({ title: `Status → ${nov}` })
      await nalozi()
    } catch (e) {
      toast({ title: 'Sprememba zavrnjena', description: e instanceof Error ? e.message : 'Napaka', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function shraniNovoVerzijo (key: string) {
    setBusy(true)
    try {
      const def = JSON.parse(draft) as PlaybookDefinition
      await apiPost<{ data: { version: number } }>('/api/playbook/defs', { key, def })
      toast({ title: `Nova verzija playbooka ${key} shranjena`, description: 'Prejšnje verzije ostanejo vezane na zaključene zagone.' })
      setUrejanje(null)
      await nalozi()
    } catch (e) {
      toast({ title: 'Shranjevanje zavrnjeno', description: e instanceof Error ? e.message : 'Neveljaven JSON', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const poKljucih = useMemo(() => {
    const m = new Map<string, DefRow[]>()
    for (const d of defs ?? []) {
      const list = m.get(d.key) ?? []
      list.push(d)
      m.set(d.key, list)
    }
    return [...m.entries()]
  }, [defs])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Upravljanje playbookov"
        desc="Verzije, statusi in urejanje korakov brez poseganja v poslovno logiko (§15)"
        actions={
          <Button variant="outline" size="sm" onClick={onNazaj}>
            <ArrowLeft className="size-4" aria-hidden /> Nazaj
          </Button>
        }
      />

      {napaka ? <ErrorBox error={{ message: napaka }} /> : null}
      {defs === null ? <LoadingRows rows={3} /> : poKljucih.map(([key, verzije]) => (
        <Card key={key}>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="font-bold text-foreground">{key}</h2>
                <p className="text-xs text-muted-foreground">{verzije[0]?.name} · {verzije.length} verzij</p>
              </div>
              <Button
                variant="outline" size="sm"
                onClick={() => {
                  setUrejanje(urejanje === key ? null : key)
                  setDraft(JSON.stringify({
                    key, naziv: verzije[0]?.name ?? key, opis: 'Urejena definicija', scenarij: '',
                    version: verzije[0]?.version ?? 1,
                    steps: [{ id: 'prihod', naziv: 'Prihod', navodilo: '…', kje: '…', rezultat: '…', kategorija: 'PRIHOD', offline: true, evidence: [{ vrsta: 'LOKACIJA', obvezno: true, opis: 'lokacija' }] }],
                  }, null, 2))
                }}
              >
                <Pencil className="size-4" aria-hidden /> Nova verzija
              </Button>
            </div>

            <ul className="divide-y rounded-lg border">
              {verzije.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <BookOpen className="size-4 text-muted-foreground" aria-hidden />
                  <span className="font-mono text-xs">v{v.version}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    v.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : v.status === 'RETIRED' ? 'bg-secondary text-muted-foreground'
                        : 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300'
                  }`}>
                    {v.status}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {v.korakov} korakov · {v.zagonov} zagonov · {(v.author ?? 'sistem')}
                  </span>
                  <span className="ml-auto flex gap-1">
                    {v.status !== 'ACTIVE' ? (
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => void status(v.id, 'ACTIVE')}>
                        <Play className="size-3.5" aria-hidden /> Aktiviraj
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => void status(v.id, 'RETIRED')}>
                        <Ban className="size-3.5" aria-hidden /> Upokoji
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            {urejanje === key ? (
              <div className="space-y-2 rounded-lg border bg-secondary/20 p-3">
                <Label htmlFor={`draft-${key}`}>Definicija (JSON — koraki, dokazila, validacije, pogoji)</Label>
                <Textarea
                  id={`draft-${key}`} rows={12} className="font-mono text-xs"
                  value={draft} onChange={(e) => setDraft(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void shraniNovoVerzijo(key)}>
                    {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                    Shrani kot novo verzijo
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setUrejanje(null)}>Prekliči</Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Nova verzija postane ACTIVE za nove zagone; zaključeni zagoni ostanejo vezani na svojo verzijo (§14).
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
