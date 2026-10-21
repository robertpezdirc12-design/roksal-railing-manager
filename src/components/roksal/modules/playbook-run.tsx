'use client'

// PLAYBOOK RUNNER (R549): en zaslon = en glavni cilj (§3/§12) — glava zagona
// + napredek, handoff po zaključku (§11), seznam korakov verige in vezave na
// obstoječe module (izvlečeno bajtno-identično iz playbook.tsx).

import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Ban, Camera, CheckCircle2, Circle, NotebookPen, Play, Ruler, Smartphone } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiGet, apiPost } from '@/lib/api-client'
import { ErrorBox, LoadingRows } from '@/components/roksal/ui-bits'
import { jeVVerigi, NAPRAVA_TEHNIKA, type NapravaTier } from '@/lib/playbook-core'
import type { RunState } from '@/lib/playbook-engine'
import { KATEGORIJA_BARVA, KATEGORIJA_IKONA, preveriNapravo } from './playbook-shared'
import { TrenutniKorak } from './playbook-korak'

// ═══ RUNNER — en zaslon = en glavni cilj (§3/§12) ═════════════════════════

export function RunView ({ runId, onNazaj }: { runId: string; onNazaj: () => void }) {
  const { toast } = useToast()
  const user = useAppStore((s) => s.user)
  const setSection = useAppStore((s) => s.setSection)
  const setTab = useAppStore((s) => s.setTab)
  const [stanje, setStanje] = useState<RunState | null>(null)
  const [napaka, setNapaka] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [naprava, setNaprava] = useState<{ tier: NapravaTier; opis: string } | null>(null)

  useEffect(() => { void preveriNapravo().then(setNaprava) }, [])

  async function nalozi () {
    try {
      const r = await apiGet<{ data: RunState }>(`/api/playbook/runs/${runId}`)
      setStanje(r.data)
    } catch (e) {
      setNapaka(e instanceof Error ? e.message : 'Napaka nalaganja')
    }
  }
  useEffect(() => { void nalozi() }, [runId])

  async function akcija (stepId: string, telo: Record<string, unknown>, opis: string) {
    setBusy(true)
    try {
      const r = await apiPost<{ data: RunState }>(`/api/playbook/runs/${runId}/action`, { stepId, ...telo })
      setStanje(r.data)
      toast({ title: opis, description: 'Stanje korakov posodobljeno.' })
    } catch (e) {
      toast({ title: 'Akcija zavrnjena', description: e instanceof Error ? e.message : 'Napaka', variant: 'destructive' })
      await nalozi()
    } finally {
      setBusy(false)
    }
  }

  if (napaka) return <ErrorBox error={{ message: napaka }} />
  if (!stanje) return <LoadingRows rows={4} />

  const trenutni = stanje.def.steps.find((s) => s.id === stanje.naslednji) ?? null
  const veriga = stanje.def.steps.filter((s) => jeVVerigi(s, stanje.context.odgovori))
  const zakljucen = stanje.run.status === 'ZAKLJUCEN'
  const tehnika = naprava ? NAPRAVA_TEHNIKA[naprava.tier] : null

  return (
    <div className="space-y-4">
      {/* glava zagona + napredek */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="size-9" onClick={onNazaj} aria-label="Nazaj na seznam">
            <ArrowLeft className="size-4" aria-hidden />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-foreground">{stanje.def.naziv}</h1>
            <p className="text-xs text-muted-foreground">
              {stanje.def.key} v{stanje.def.version}
              {zakljucen ? ' · ZAKLJUČEN' : ` · KORAK ${Math.min(stanje.napredek.trenutni, stanje.napredek.skupaj)}/${stanje.napredek.skupaj}`}
              {stanje.napredek.izjem > 0 ? ` · ${stanje.napredek.izjem} izjem` : ''}
            </p>
          </div>
        </div>
        <Progress value={stanje.napredek.odstotek} aria-label={`Napredek ${stanje.napredek.odstotek} %`} />
      </div>

      {/* naprava (§9) */}
      {naprava && tehnika ? (
        <div className="flex items-center gap-2 rounded-lg border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          <Smartphone className="size-3.5 shrink-0" aria-hidden />
          <span><strong className="text-foreground">{tehnika.naziv}</strong> — meritev: {tehnika.meritev}</span>
        </div>
      ) : null}

      {/* handoff po zaključku (§11) */}
      {zakljucen && stanje.handoff.length > 0 ? (
        <Card className="border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-950/30">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-4" aria-hidden /> Postopek zaključen
            </div>
            {stanje.handoff.map((h, i) => (
              <p key={i} className="text-sm text-foreground">{h.opis}</p>
            ))}
            {stanje.handoff.some((h) => h.do === 'KONFIGURATOR') ? (
              <Button
                className="h-11 w-full sm:w-auto"
                onClick={() => { setSection('projekti'); setTab('konfigurator') }}
              >
                Odpri konfigurator <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : null}
            {stanje.handoff.some((h) => h.do === 'NALOG_ZAKLJUCEK') ? (
              <Button
                className="h-11 w-full sm:w-auto"
                onClick={() => { setSection('danes'); setTab('danes') }}
              >
                Zaključi teren v Danes <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* trenutni korak — EN ZASLON = EN GLAVNI CILJ (§3) */}
      {trenutni && !zakljucen ? (
        <TrenutniKorak
          key={trenutni.id} // remount ob preklopu koraka → lokalni vnosi se ponastavijo
          stanje={stanje}
          korak={trenutni}
          busy={busy}
          napravaTier={naprava?.tier ?? null}
          onAkcija={akcija}
        />
      ) : !zakljucen ? (
        <ErrorBox error={{ message: 'Naslednji korak ni znan — osveži stanje.' }} />
      ) : null}

      {/* seznam korakov verige (✓ / → / ○, §12) */}
      <Card>
        <CardContent className="p-4">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Koraki ({stanje.napredek.koncanih}/{stanje.napredek.skupaj})
          </h2>
          <ul className="space-y-1.5">
            {veriga.map((s) => {
              const st = stanje.koraki.find((k) => k.stepId === s.id)
              const jeTrenutni = trenutni?.id === s.id
              const Ikona = KATEGORIJA_IKONA[s.kategorija] ?? NotebookPen
              return (
                <li
                  key={s.id}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                    jeTrenutni ? 'bg-secondary font-medium' : ''
                  }`}
                >
                  {st?.status === 'COMPLETED' ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Zaključen" />
                  ) : st?.status === 'NI_PRIMERNO' || st?.status === 'BLOKIRANO' ? (
                    <Ban className="size-4 shrink-0 text-orange-500" aria-label={st.status === 'NI_PRIMERNO' ? 'Ni primerno' : 'Blokirano'} />
                  ) : jeTrenutni ? (
                    <Play className="size-4 shrink-0 text-roksal-amber" aria-label="Trenutni" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-muted-foreground/40" aria-label="Čaka" />
                  )}
                  <Ikona className={`size-3.5 shrink-0 ${KATEGORIJA_BARVA[s.kategorija] ?? ''}`} aria-hidden />
                  <span className={st?.status === 'COMPLETED' ? 'text-muted-foreground line-through' : 'text-foreground'}>
                    {s.naziv}
                  </span>
                  {st?.status === 'NI_PRIMERNO' || st?.status === 'BLOKIRANO' ? (
                    <span className="ml-auto truncate text-[11px] text-muted-foreground" title={st.exceptionReason ?? ''}>
                      {st.status === 'NI_PRIMERNO' ? 'ni primerno' : 'blokirano'}
                    </span>
                  ) : st?.attempts && st.attempts > 1 ? (
                    <span className="ml-auto text-[11px] text-muted-foreground">{st.attempts}× poskus</span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>

      {/* vodeni koraki povezani na obstoječe module (§7 kamera = vodeni korak) */}
      {!zakljucen ? (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline" className="h-11 justify-start gap-2"
            onClick={() => { setSection('projekti'); setTab('foto') }}
          >
            <Camera className="size-4 text-roksal-amber" aria-hidden /> Foto zajem
          </Button>
          <Button
            variant="outline" className="h-11 justify-start gap-2"
            onClick={() => { setSection('projekti'); setTab('meritve') }}
          >
            <Ruler className="size-4 text-roksal-amber" aria-hidden /> Meritve
          </Button>
        </div>
      ) : null}
    </div>
  )
}
