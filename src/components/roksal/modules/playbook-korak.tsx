'use client'

// PLAYBOOK KORAK (R549): trenutni korak — dokazila (§10), validacija, pogoji,
// izjeme z obveznim razlogom (§6) + glava koraka (izvlečeno bajtno-identično
// iz playbook.tsx).

import { useState } from 'react'
import { Ban, Check, CheckCircle2, Compass, Laptop, Loader2, NotebookPen, Play, ShieldAlert, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { NAPRAVA_TEHNIKA, type NapravaTier, type PlaybookDefinition } from '@/lib/playbook-core'
import type { RunState } from '@/lib/playbook-engine'
import { KATEGORIJA_BARVA, KATEGORIJA_IKONA } from './playbook-shared'

// ─── trenutni korak: dokazila, validacija, pogoji, izjeme ───────────────────

export function TrenutniKorak ({ stanje, korak, busy, napravaTier, onAkcija }: {
  stanje: RunState
  korak: PlaybookDefinition['steps'][number]
  busy: boolean
  napravaTier: NapravaTier | null
  onAkcija: (stepId: string, telo: Record<string, unknown>, opis: string) => Promise<void>
}) {
  const st = stanje.koraki.find((k) => k.stepId === korak.id)
  const [besedilo, setBesedilo] = useState('')
  const [fotoId, setFotoId] = useState('')
  const [measurementId, setMeasurementId] = useState('')
  const [podpisId, setPodpisId] = useState('')
  const [naslov, setNaslov] = useState('')
  const [odgovor, setOdgovor] = useState<string | null>(null)
  const [tocke, setTocke] = useState<Record<string, boolean>>({})
  const [vrednosti, setVrednosti] = useState<Record<string, string>>({})
  const [izjemaOdprta, setIzjemaOdprta] = useState(false)
  const [izjemaVrsta, setIzjemaVrsta] = useState<'NI_PRIMERNO' | 'BLOKIRANO'>('NI_PRIMERNO')
  const [razlog, setRazlog] = useState('')
  // opomba: lokalni vnosi se ponastavijo samodejno — komponenta ima
  // key={korak.id} v RunView (remount ob preklopu koraka)

  const vTehu = st?.status === 'IN_PROGRESS' || st?.status === 'NEUSPESNO'
  const tehnika = napravaTier ? NAPRAVA_TEHNIKA[napravaTier] : null

  function zberiEvidence (): Record<string, unknown> {
    const ev: Record<string, unknown> = {}
    if (fotoId.trim()) ev.fotoId = fotoId.trim()
    if (measurementId.trim()) ev.measurementId = measurementId.trim()
    if (podpisId.trim()) ev.podpisId = podpisId.trim()
    if (besedilo.trim()) ev.besedilo = besedilo.trim()
    if (naslov.trim() || korak.evidence.some((e) => e.vrsta === 'LOKACIJA')) {
      ev.lokacija = { naslov: naslov.trim() || undefined }
    }
    if (odgovor !== null) ev.odgovor = korak.moznosti ? odgovor : odgovor === 'DA'
    if (Object.keys(tocke).length > 0) {
      ev.tocke = Object.entries(tocke).map(([id, odkljukano]) => ({ id, odkljukano }))
    }
    const stevilke: Record<string, number | string> = {}
    for (const [k, v] of Object.entries(vrednosti)) {
      const n = Number(v.replace(',', '.'))
      stevilke[k] = Number.isFinite(n) && v.trim() !== '' ? n : v.trim()
    }
    if (Object.keys(stevilke).length > 0) ev.vrednosti = stevilke
    return ev
  }

  // ── ODLOČITEV: veliki DA/NE oz. radio možnosti (§5) ──
  if (korak.kategorija === 'ODLOCITEV') {
    return (
      <Card className="border-roksal-amber/40">
        <CardContent className="space-y-4 p-4 sm:p-6">
          <KorakGlava korak={korak} rezultatText={korak.rezultat} />
          {korak.moznosti ? (
            <RadioGroup value={odgovor ?? ''} onValueChange={setOdgovor} className="gap-2">
              {korak.moznosti.map((m) => (
                <label
                  key={m}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary"
                >
                  <RadioGroupItem value={m} /> {m}
                </label>
              ))}
            </RadioGroup>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOdgovor('DA')}
                className={`min-h-14 rounded-xl border-2 text-base font-bold transition-colors ${
                  odgovor === 'DA' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-border hover:bg-secondary'
                }`}
              >
                DA
              </button>
              <button
                type="button"
                onClick={() => setOdgovor('NE')}
                className={`min-h-14 rounded-xl border-2 text-base font-bold transition-colors ${
                  odgovor === 'NE' ? 'border-orange-600 bg-orange-600 text-white' : 'border-border hover:bg-secondary'
                }`}
              >
                NE
              </button>
            </div>
          )}
          <Button
            className="h-12 w-full text-base font-bold"
            disabled={busy || odgovor === null}
            onClick={() => void onAkcija(korak.id, { akcija: 'ZAKLJUCI', evidence: zberiEvidence() }, 'Odločitev zabeležena')}
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-5" aria-hidden />}
            POTRDI ODLOČITEV
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ── vsemi ostalimi kategorijami: navodilo + dokazila + glavna akcija ──
  return (
    <Card className="border-roksal-amber/40">
      <CardContent className="space-y-4 p-4 sm:p-6">
        <KorakGlava korak={korak} rezultatText={korak.rezultat} />

        {/* namig po odgovoru (npr. čelna/bočna pritrditev §5) */}
        {korak.namigOdgovorov && stanje.context.odgovori['pritrditev-odlocba'] !== undefined ? (
          <p className="rounded-lg bg-secondary/60 px-3 py-2 text-sm text-foreground">
            {korak.namigOdgovorov[String(stanje.context.odgovori['pritrditev-odlocba'])] ?? ''}
          </p>
        ) : null}

        {/* tehnika zajema za merilne korake (§9 — prilagodi napravi) */}
        {korak.kategorija === 'MERITEV' && tehnika ? (
          <p className="flex items-center gap-2 rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            <Compass className="size-3.5 shrink-0" aria-hidden /> Tehnika za tvojo napravo: {tehnika.meritev}
          </p>
        ) : null}

        {/* offline zmožnost koraka (§13) */}
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {korak.offline ? (
            <><Laptop className="size-3.5" aria-hidden /> Ta korak deluje tudi brez povezave.</>
          ) : (
            <><ShieldAlert className="size-3.5 text-orange-500" aria-hidden /> Ta korak zahteva povezavo.</>
          )}
        </p>

        {/* dokazila (§10) */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Dokazila</h3>

          {korak.evidence.some((e) => e.vrsta === 'LOKACIJA') ? (
            <div className="space-y-1.5">
              <Label htmlFor="ev-naslov">Lokacija (naslov ali opis)</Label>
              <Input
                id="ev-naslov" className="h-11" value={naslov}
                onChange={(e) => setNaslov(e.target.value)}
                placeholder="npr. Terase 12, Ljubljana"
              />
            </div>
          ) : null}

          {korak.evidence.some((e) => e.vrsta === 'OPOMBA') ? (
            <div className="space-y-1.5">
              <Label htmlFor="ev-besedilo">Opomba {korak.evidence.find((e) => e.vrsta === 'OPOMBA')?.obvezno ? '(obvezna)' : '(neobvezna)'}</Label>
              <Textarea
                id="ev-besedilo" rows={3} value={besedilo}
                onChange={(e) => setBesedilo(e.target.value)}
                placeholder="Zapiši opažanja, referenco, posebnosti …"
              />
            </div>
          ) : null}

          {korak.evidence.some((e) => e.vrsta === 'FOTO') ? (
            <div className="space-y-1.5">
              <Label htmlFor="ev-foto">Fotografija — ID iz Foto zajema</Label>
              <Input
                id="ev-foto" className="h-11" value={fotoId}
                onChange={(e) => setFotoId(e.target.value)}
                placeholder="ID obstoječe fotografije (po zajemu prek Foto)"
              />
              <p className="text-xs text-muted-foreground">
                Najprej zajemi fotografijo v Foto zajemu (gumb spodaj), nato prilepi ID.
              </p>
            </div>
          ) : null}

          {korak.evidence.some((e) => e.vrsta === 'MERITEV') ? (
            <div className="space-y-1.5">
              <Label htmlFor="ev-mer">Meritev — ID iz Meritev</Label>
              <Input
                id="ev-mer" className="h-11" value={measurementId}
                onChange={(e) => setMeasurementId(e.target.value)}
                placeholder="ID obstoječe meritve (ali izpolni vrednosti)"
              />
            </div>
          ) : null}

          {korak.evidence.some((e) => e.vrsta === 'PODPIS') ? (
            <div className="space-y-1.5">
              <Label htmlFor="ev-podpis">Podpis — ID iz Signatura</Label>
              <Input
                id="ev-podpis" className="h-11" value={podpisId}
                onChange={(e) => setPodpisId(e.target.value)}
                placeholder="ID zajetega podpisa"
              />
            </div>
          ) : null}

          {korak.checklist ? (
            <div className="space-y-1.5">
              <Label>Kontrolni seznam (vse točke so obvezne)</Label>
              <ul className="space-y-1">
                {korak.checklist.map((t) => (
                  <li key={t}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 transition-colors hover:bg-secondary">
                      <Checkbox
                        checked={!!tocke[t]}
                        onCheckedChange={(v) => setTocke((s) => ({ ...s, [t]: v === true }))}
                      />
                      <span className="text-sm">{t}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* validacijska polja (npr. segmenti, višina, referenca) */}
          {(korak.validacija ?? []).length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {(korak.validacija ?? []).map((pr) => (
                <div key={pr.polje} className="space-y-1">
                  <Label htmlFor={`ev-v-${pr.polje}`}>{pr.polje}</Label>
                  <Input
                    id={`ev-v-${pr.polje}`} inputMode="decimal" className="h-11"
                    value={vrednosti[pr.polje] ?? ''}
                    onChange={(e) => setVrednosti((s) => ({ ...s, [pr.polje]: e.target.value }))}
                    placeholder="vrednost"
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* neuspešna validacija — viden razlog (§1 retry/failure) */}
        {st?.status === 'NEUSPESNO' ? (
          <p className="rounded-lg border border-orange-500/40 bg-orange-50 px-3 py-2 text-sm text-orange-700 dark:bg-orange-950/40 dark:text-orange-400">
            Zadnji poskus ni bil veljaven — preveri dokazila in ponovi.
          </p>
        ) : null}

        {/* GLAVNA AKCIJA (§3: velika primarna, malo sekundarnih) */}
        {vTehu ? (
          <Button
            className="h-14 w-full text-base font-bold"
            disabled={busy}
            onClick={() => void onAkcija(korak.id, { akcija: 'ZAKLJUCI', evidence: zberiEvidence() }, `„${korak.naziv}" zaključen`)}
          >
            {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <CheckCircle2 className="size-5" aria-hidden />}
            ZAKLJUČI: {korak.naziv.toUpperCase()}
          </Button>
        ) : (
          <Button
            variant="default" className="h-14 w-full text-base font-bold"
            disabled={busy}
            onClick={() => void onAkcija(korak.id, { akcija: 'ZACNI' }, `„${korak.naziv}" v teku`)}
          >
            {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Play className="size-5" aria-hidden />}
            ZAČNI: {korak.naziv.toUpperCase()}
          </Button>
        )}

        {/* sekundarne akcije: izjema (§6) + ponovitev zaključenih (§16) */}
        <div className="flex flex-wrap gap-2">
          {!vTehu ? null : (
            <>
              <Button
                variant="outline" size="sm" disabled={busy}
                onClick={() => { setIzjemaVrsta('NI_PRIMERNO'); setIzjemaOdprta(true) }}
              >
                <SkipForward className="size-4" aria-hidden /> Ni primerno
              </Button>
              <Button
                variant="outline" size="sm" disabled={busy}
                onClick={() => { setIzjemaVrsta('BLOKIRANO'); setIzjemaOdprta(true) }}
              >
                <Ban className="size-4" aria-hidden /> Blokirano
              </Button>
            </>
          )}
        </div>

        {/* izjema — obvezen razlog (§6) */}
        <Dialog open={izjemaOdprta} onOpenChange={setIzjemaOdprta}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{izjemaVrsta === 'NI_PRIMERNO' ? 'Označi kot ni primerno' : 'Označi kot blokirano'}</DialogTitle>
              <DialogDescription>
                Kritičnih mer ni mogoče tiho preskočiti — izjema zahteva razlog, ki se zapiše v revizijski dnevnik.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="izjema-razlog">Razlog (obvezen, vsaj 5 znakov)</Label>
              <Textarea
                id="izjema-razlog" rows={3} value={razlog}
                onChange={(e) => setRazlog(e.target.value)}
                placeholder="npr. Stopnišča ni — ravna terasa brez stopnic."
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIzjemaOdprta(false)}>Prekliči</Button>
              <Button
                disabled={busy || razlog.trim().length < 5}
                onClick={() => {
                  setIzjemaOdprta(false)
                  void onAkcija(korak.id, { akcija: izjemaVrsta, razlog: razlog.trim() }, 'Izjema zabeležena')
                }}
              >
                Potrdi izjemo
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

/** glava koraka: naziv + navodilo/kje/rezultat (§3) */
function KorakGlava ({ korak, rezultatText }: { korak: PlaybookDefinition['steps'][number]; rezultatText: string }) {
  const Ikona = KATEGORIJA_IKONA[korak.kategorija] ?? NotebookPen
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`flex size-9 items-center justify-center rounded-lg bg-secondary ${KATEGORIJA_BARVA[korak.kategorija] ?? ''}`}>
          <Ikona className="size-5" aria-hidden />
        </span>
        <h2 className="text-lg font-bold leading-tight text-foreground">{korak.naziv}</h2>
      </div>
      <p className="text-sm leading-relaxed text-foreground">{korak.navodilo}</p>
      <dl className="space-y-1 rounded-lg bg-secondary/40 p-3 text-xs">
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-muted-foreground">Kje:</dt>
          <dd className="text-foreground">{korak.kje}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-muted-foreground">Pričakovan rezultat:</dt>
          <dd className="text-foreground">{rezultatText}</dd>
        </div>
      </dl>
    </div>
  )
}
