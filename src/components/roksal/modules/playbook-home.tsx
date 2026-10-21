'use client'

// PLAYBOOK DOMOV (R549): izbira naloga + playbooka + seznam zagonov (§12) —
// gradnik vodenega postopka (izvlečeno bajtno-identično iz playbook.tsx).

import { useEffect, useState } from 'react'
import { ChevronRight, Loader2, Play, Settings2, Workflow } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { apiGet, apiPost } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import type { DefRow, NalogRow, RunPovzetek } from './playbook-shared'

// ─── domov: izbira naloga + playbooka + seznam zagonov (§12) ────────────────

export function PlaybookHome ({ onOdpriRun, onAdmin, isAdmin }: {
  onOdpriRun: (id: string) => void
  onAdmin: () => void
  isAdmin: boolean
}) {
  const { toast } = useToast()
  const [nalogi, setNalogi] = useState<NalogRow[] | null>(null)
  const [defs, setDefs] = useState<DefRow[] | null>(null)
  const [runs, setRuns] = useState<RunPovzetek[] | null>(null)
  const [napaka, setNapaka] = useState<string | null>(null)
  const [izbranNalog, setIzbranNalog] = useState<string>('')
  const [izbranKey, setIzbranKey] = useState<string>('OGRAJA')
  const [busy, setBusy] = useState(false)

  async function nalozi () {
    try {
      const [n, d, r] = await Promise.all([
        apiGet<{ data: NalogRow[] }>('/api/nalog?scope=open'),
        apiGet<{ data: DefRow[] }>('/api/playbook/defs'),
        apiGet<{ data: RunPovzetek[] }>('/api/playbook/runs'),
      ])
      setNalogi(n.data); setDefs(d.data); setRuns(r.data)
    } catch (e) {
      setNapaka(e instanceof Error ? e.message : 'Napaka nalaganja')
    }
  }
  useEffect(() => { void nalozi() }, [])

  async function zagoni () {
    if (!izbranNalog) {
      toast({ title: 'Izberi nalog', description: 'Vodeni postopek se izvaja na delovnem nalogu.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const rez = await apiPost<{ data: { runId: string; nov: boolean } }>('/api/playbook/runs', {
        workOrderId: izbranNalog, key: izbranKey,
      })
      toast({
        title: rez.data.nov ? 'Vodeni postopek zagnan' : 'Nadaljevanje obstoječega',
        description: `${izbranKey} — sistem te vodi po korakih.`,
      })
      onOdpriRun(rez.data.runId)
    } catch (e) {
      toast({ title: 'Zagon ni uspel', description: e instanceof Error ? e.message : 'Napaka', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vodeni postopek"
        desc="Deterministični playbooki vodijo monterja skozi celoten postopek brez runtime AI (R458)"
        actions={isAdmin ? (
          <Button variant="outline" size="sm" onClick={onAdmin}>
            <Settings2 className="size-4" aria-hidden /> Upravljanje
          </Button>
        ) : undefined}
      />

      {napaka ? <ErrorBox error={{ message: napaka }} /> : null}

      {/* nov zagon: nalog + playbook */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            <Play className="size-4 text-roksal-amber" aria-hidden /> Zaženi postopek
          </h2>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="pb-nalog">Nalog</Label>
              <Select value={izbranNalog} onValueChange={setIzbranNalog}>
                <SelectTrigger id="pb-nalog" className="h-11 w-full">
                  <SelectValue placeholder="Izberi nalog …" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {(nalogi ?? []).map((n) => (
                    <SelectItem key={n.id} value={n.id}>{n.code} — {n.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pb-key">Playbook</Label>
              <Select value={izbranKey} onValueChange={setIzbranKey}>
                <SelectTrigger id="pb-key" className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(defs ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.key}>
                      {d.key} · v{d.version} · {d.korakov} korakov
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button className="h-11 w-full sm:w-auto" disabled={busy || !nalogi} onClick={() => void zagoni()}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
                NADALJUJ
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Edinstvena pot na nalogu: obstoječi zagon se nadaljuje, brez podvajanja.
          </p>
        </CardContent>
      </Card>

      {/* moji zagoni */}
      <section aria-label="Zagoni">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">Zagoni</h2>
        {runs === null ? <LoadingRows rows={2} /> : runs.length === 0 ? (
          <EmptyState
            title="Ni še zagonov"
            desc="Zaženi prvi vodeni postopek na nalogu zgoraj."
            icon={Workflow}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {runs.map((r) => (
              <Card key={r.id} className="transition-shadow hover:shadow-md">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-foreground">{r.naziv}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.key} v{r.version} · {new Date(r.startedAt).toLocaleString('sl-SI')}
                        {r.status !== 'V_TEKU' ? ` · ${r.status === 'ZAKLJUCEN' ? 'zaključen' : 'prekinjen'}` : ''}
                      </div>
                    </div>
                    {r.napredek ? (
                      <span className="whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold">
                        {r.napredek.koncanih}/{r.napredek.skupaj}
                      </span>
                    ) : null}
                  </div>
                  {r.napredek ? <Progress value={r.napredek.odstotek} aria-label={`Napredek ${r.napredek.odstotek} %`} /> : null}
                  <Button
                    variant={r.status === 'V_TEKU' ? 'default' : 'outline'}
                    className="h-10 w-full"
                    onClick={() => onOdpriRun(r.id)}
                  >
                    {r.status === 'V_TEKU' ? 'NADALJUJ' : 'Odpri'}
                    <ChevronRight className="size-4" aria-hidden />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
