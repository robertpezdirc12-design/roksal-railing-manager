'use client'

// smart-guide — R490 (GitHub issue #11): ROKSAL SMART GUIDE.
// Enoten kontekstni gumb »Pomoč« v glavi aplikacije (vsi moduli) + plošča:
//  - vsebina se prilagodi TRENUTNEMU modulu (useAppStore().tab → registry vnos),
//  - kratki koraki, pričakovani rezultat, pogoste napake, »Pokaži primer« (skica),
//  - SL/HR preklop (shranjen), glas prek Web Speech API (use-guide-speech):
//    Predvajaj / Premor / Ponovi, hitrost, utišanje — brez samodejnega ponavljanja,
//  - vodena prva uporaba za MONTERJA: ob prvem obisku modula se plošča enkrat
//    odpre (badge »Vodeni uvod«), preskok = »Ne pokaži več« (localStorage),
//  - dostopnost: ena roka na telefonu (Sheet bottom, veliki gumbi), tipkovnica
//    (Esc/zapiranje nudi Sheet), aria-oznake, motion-reduce, kontrast (teme),
//  - plošča je MODALNA — nikoli fiksirana čez kontrole kamere; zajem poteka
//    samo po zaprtju plošče.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, CircleHelp, Gauge, Languages, Pause, Play, RotateCcw, Volume2, VolumeX, X } from '@/components/roksal/custom-icons'
import { useAppStore } from '@/lib/store'
import { guideByTab, type GuideLang } from '@/lib/smart-guide-registry'
import { GuideSketch } from './guide-sketches'
import { useGuideSpeech } from '@/hooks/use-guide-speech'
import { useIsMobile } from '@/hooks/use-mobile'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

const LS_PREFS = 'roksal-guide-prefs'
const LS_SEEN = 'roksal-guide-seen'

interface GuidePrefs { lang: GuideLang; skipFirstUse: boolean }

function readPrefs (): GuidePrefs {
  if (typeof window === 'undefined') return { lang: 'sl', skipFirstUse: false }
  try {
    const raw = window.localStorage.getItem(LS_PREFS)
    if (raw) {
      const p = JSON.parse(raw) as Partial<GuidePrefs>
      return { lang: p.lang === 'hr' ? 'hr' : 'sl', skipFirstUse: !!p.skipFirstUse }
    }
  } catch { /* okvarjena shramba → privzeto */ }
  return { lang: 'sl', skipFirstUse: false }
}

function readSeenTabs (): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LS_SEEN)
    if (raw) {
      const v = JSON.parse(raw)
      if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
    }
  } catch { /* ignore */ }
  return []
}

function markTabSeen (tab: string) {
  try {
    const seen = new Set(readSeenTabs())
    seen.add(tab)
    window.localStorage.setItem(LS_SEEN, JSON.stringify([...seen]))
  } catch { /* ignore */ }
}

export function SmartGuide () {
  const tab = useAppStore((s) => s.tab)
  const user = useAppStore((s) => s.user)
  const isMobile = useIsMobile()
  const entry = useMemo(() => guideByTab(tab), [tab])

  const [open, setOpen] = useState(false)
  // lenična inicializacija iz localStorage (komponenta se izrisuje samo po
  // prijavi — odjemalec; enak vir stanja kot zustand persist)
  const [prefs, setPrefs] = useState<GuidePrefs>(readPrefs)
  const [showExample, setShowExample] = useState(true)
  const speech = useGuideSpeech()
  const { stop: stopSpeech } = speech
  const lang = prefs.lang
  const isMonter = user?.role === 'MONTER'
  const [firstUseShown, setFirstUseShown] = useState<string | null>(null)

  const persistPrefs = useCallback((p: GuidePrefs) => {
    setPrefs(p)
    try { window.localStorage.setItem(LS_PREFS, JSON.stringify(p)) } catch { /* ignore */ }
  }, [])

  // vodena prva uporaba (issue #11 §1): monterju se ob prvem obisku modula
  // s firstUse vnosa plošča ENKRAT samodejno odpre (z odlogom, da se modul
  // najprej izriše); preskok se zapomni. setState v asinhronem povratku —
  // brez kaskadnih renderjev v telesu efekta.
  useEffect(() => {
    if (!entry || !entry.firstUse || !isMonter || prefs.skipFirstUse) return
    const t = setTimeout(() => {
      if (readSeenTabs().includes(entry.tabId)) return
      setFirstUseShown(entry.tabId)
      setOpen(true)
    }, 400)
    return () => clearTimeout(t)
  }, [entry, isMonter, prefs.skipFirstUse])

  // ob zaprtju označi zavihek kot videnega + ustavi glas (brez ponavljanja)
  const closeGuide = useCallback((markSeen: boolean) => {
    setOpen(false)
    stopSpeech()
    if (entry && markSeen) markTabSeen(entry.tabId)
  }, [entry, stopSpeech])

  // tab je zamenjan → glas utihne (plošča sledi novemu kontekstu ob ponovnem odprtju)
  useEffect(() => { stopSpeech() }, [tab, stopSpeech])

  if (!entry) return null // modul brez vnosa pomoči → gumb se ne pokaže (graceful)

  const L = <T,>(b: readonly [T, T]): T => b[lang === 'sl' ? 0 : 1]
  const voiceText = L(entry.voice)

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => setOpen(true)}
        className="h-9 gap-2 rounded-full px-3 text-muted-foreground transition motion-reduce:transition-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`${L(['Pomoč za modul', 'Pomoć za modul'])}: ${L(entry.title)}`}
        aria-expanded={open}
      >
        <CircleHelp className="size-4" aria-hidden />
        <span className="hidden text-xs sm:inline">{L(['Pomoč', 'Pomoć'])}</span>
      </Button>

      <Sheet open={open} onOpenChange={(v) => { if (!v) closeGuide(true); else setOpen(true) }}>
        <SheetContent
          side={isMobile ? 'bottom' : 'right'}
          className={cn(
            'flex flex-col gap-0 overflow-hidden p-0 motion-reduce:transform-none',
            isMobile ? 'max-h-[85dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]' : 'w-[26rem] sm:max-w-[26rem]'
          )}
        >
          {/* glava */}
          <SheetHeader className="border-b p-4 pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {firstUseShown === entry.tabId && isMonter && (
                    <Badge className="bg-roksal-amber text-roksal-ink">{L(['Vodeni uvod', 'Vođeni uvod'])}</Badge>
                  )}
                  <Badge variant="secondary" className="font-mono text-[10px]">v{entry.version}</Badge>
                </div>
                <SheetTitle className="mt-1.5 pr-6 text-left text-lg leading-snug">{L(entry.title)}</SheetTitle>
                <SheetDescription className="text-left">{L(entry.desc)}</SheetDescription>
              </div>
              <Button
                variant="ghost" size="icon" className="size-8 shrink-0 rounded-full"
                onClick={() => closeGuide(true)} aria-label={L(['Zapri pomoč', 'Zatvori pomoć'])}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>

            {/* jezik + glasovne kontrole — vedno dosegljive z eno roko (veliki gumbi) */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="outline" size="sm" className="h-9 gap-1.5 rounded-full"
                onClick={() => { speech.stop(); persistPrefs({ ...prefs, lang: lang === 'sl' ? 'hr' : 'sl' }) }}
                aria-label={L(['Preklopi jezik pomoči', 'Prebaci jezik pomoći'])}
              >
                <Languages className="size-4" aria-hidden />
                {lang === 'sl' ? 'SL' : 'HR'}
              </Button>

              {speech.supported ? (
                <>
                  <Button
                    variant="outline" size="sm" className="h-9 gap-1.5 rounded-full"
                    onClick={() => speech.speak(voiceText, lang)}
                    aria-label={L(['Predvajaj glasovno navodilo', 'Reproduciraj glasovno uputstvo'])}
                  >
                    <Play className="size-4" aria-hidden />
                    {L(['Predvajaj', 'Reproduciraj'])}
                  </Button>
                  <Button
                    variant="outline" size="sm" className="h-9 w-9 rounded-full p-0"
                    onClick={speech.togglePause}
                    aria-label={L(['Premor ali nadaljevanje', 'Pauza ili nastavak'])}
                    disabled={!speech.speaking}
                  >
                    <Pause className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="outline" size="sm" className="h-9 w-9 rounded-full p-0"
                    onClick={() => speech.speak(voiceText, lang)}
                    aria-label={L(['Ponovi glasovno navodilo', 'Ponovi glasovno uputstvo'])}
                    disabled={!speech.speaking && !speech.paused}
                  >
                    <RotateCcw className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="outline" size="sm" className="h-9 w-9 rounded-full p-0"
                    onClick={() => speech.setMuted(!speech.muted)}
                    aria-label={speech.muted ? L(['Vklopi zvok', 'Uključi zvuk']) : L(['Utišaj zvok', 'Isključi zvuk'])}
                    aria-pressed={speech.muted}
                  >
                    {speech.muted ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
                  </Button>
                </>
              ) : (
                <span className="text-xs text-muted-foreground" role="note">
                  {L([
                    'Glasovna sinteza ni podprta na tej napravi — besedilna razlaga je spodaj.',
                    'Glasovna sinteza nije podržana na ovom uređaju — tekstualno objašnjenje je niže.'
                  ])}
                </span>
              )}
            </div>

            {/* hitrost (samo če sinteza podprta in ni utišana) */}
            {speech.supported && !speech.muted ? (
              <div className="mt-2 flex items-center gap-2">
                <Gauge className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <Slider
                  value={[speech.rate]}
                  min={0.5} max={1.5} step={0.1}
                  onValueChange={([v]) => speech.setRate(v)}
                  className="flex-1"
                  aria-label={L(['Hitrost govora', 'Brzina govora'])}
                />
                <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{speech.rate.toFixed(1)}×</span>
              </div>
            ) : null}

            {/* poštena opomba o glasu: ne obljubimo SL/HR glasu na vsaki napravi */}
            {speech.supported && !speech.voiceAvailable(lang) && !speech.muted ? (
              <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground" role="note">
                {L([
                  'Ta naprava ne navaja posebnega glasu za izbrani jezik — poskus predvajanja je vseeno mogoč, sicer pa velja besedilna razlaga.',
                  'Ovaj uređaj ne navodi poseban glas za odabrani jezik — pokušaj reprodukcije je ipak moguć, inače vrijedi tekstualno objašnjenje.'
                ])}
              </p>
            ) : null}
          </SheetHeader>

          {/* vsebina — berljivo na terenu, veliki vrstični presledki */}
          <div className="flex-1 overflow-y-auto overscroll-contain p-4">
            <section aria-label={L(['Koraki', 'Koraci'])}>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <BookOpen className="size-4 text-roksal-amber" aria-hidden />
                {L(['Kako to naredim', 'Kako to napravim'])}
              </h3>
              <ol className="space-y-2.5">
                {entry.steps.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-foreground">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-bold text-foreground" aria-hidden>
                      {i + 1}
                    </span>
                    <span>{L(s)}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section aria-label={L(['Pričakovani rezultat', 'Očekivani rezultat'])} className="mt-5 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3">
              <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{L(['Pričakovani rezultat', 'Očekivani rezultat'])}</h3>
              <p className="mt-1 text-sm leading-relaxed text-foreground">{L(entry.expected)}</p>
            </section>

            <section aria-label={L(['Pogoste napake', 'Česte greške'])} className="mt-4 rounded-lg border border-amber-600/30 bg-amber-600/5 p-3">
              <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400">{L(['Pogoste napake', 'Česte greške'])}</h3>
              <ul className="mt-1.5 space-y-1.5">
                {entry.mistakes.map((m, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground">
                    <span aria-hidden className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-600 dark:bg-amber-400" />
                    <span>{L(m)}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Pokaži primer — skica (shematska, vedno označena) */}
            {entry.sketchKey && entry.sketchAlt ? (
              <section aria-label={L(['Primer (skica)', 'Primjer (shema)'])} className="mt-5">
                <button
                  type="button"
                  onClick={() => setShowExample((v) => !v)}
                  className="flex w-full items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-sm font-semibold text-foreground transition hover:bg-secondary/60 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none"
                  aria-expanded={showExample}
                >
                  {L(['Pokaži primer (skico)', 'Prikaži primjer (shemu)'])}
                  <span aria-hidden className="text-muted-foreground">{showExample ? '▾' : '▸'}</span>
                </button>
                {showExample ? (
                  <div className="mt-3">
                    <GuideSketch k={entry.sketchKey} alt={L(entry.sketchAlt)} lang={lang} />
                  </div>
                ) : null}
              </section>
            ) : null}

            {/* vodeni uvod — preskok za izkušenega uporabnika */}
            {isMonter && entry.firstUse ? (
              <label className="mt-5 flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={prefs.skipFirstUse}
                  onChange={(e) => persistPrefs({ ...prefs, skipFirstUse: e.target.checked })}
                  className="size-4 accent-roksal-amber"
                />
                {L([
                  'Sem izkušen uporabnik — ne odpiraj vodenega uvoda več',
                  'Sam iskusan korisnik — ne otvaraj vođeni uvod više'
                ])}
              </label>
            ) : null}
          </div>

          {/* noga — status govora (aria-live, ne moti klica/kamere; brez avtorun-a) */}
          <footer className="border-t bg-card/60 px-4 py-2.5">
            <p aria-live="polite" className="text-center text-[11px] text-muted-foreground">
              {speech.speaking
                ? (speech.paused ? L(['Glasovno navodilo v premoru', 'Glasovno uputstvo u pauzi']) : L(['Glasovno navodilo se predvaja …', 'Glasovno uputstvo se reproducira …']))
                : L([
                  'Pomoč se ne ponavlja sama. Vsebina velja za trenutni modul.',
                  'Pomoć se ne ponavlja sama. Sadržaj vrijedi za trenutni modul.'
                ])}
            </p>
          </footer>
        </SheetContent>
      </Sheet>
    </>
  )
}
