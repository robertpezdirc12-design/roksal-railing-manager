'use client'

// naklonomer.tsx — R558 (raziskava R557 V1.1): živi naklonomer za stopniške
// ograje — RELATIVNA gravitacijska metoda (lib/nagib-core, dvojna izmera).
// UI tok (tri stanja, eno samo kartico — ne dialog, enoročno na terenu):
//   1. »Zajemi ničlo« — telefon na vodoravno referenco (tread/podest/tla);
//      zadnjih ~1,2 s vzorcev se povpreči (glajenje šuma ceničnega senzorja).
//   2. Telefon na desko/ploščo čez zobce → ŽIVI kot vsak dogodek.
//   3. »Prevzemi kot« → vrednost gre v ročni vnos naklona (slopeInput).
// iOS 13+: senzorji gibanja zahtevajo izrecno dovoljenje (gumb, ki ga
// naredi uporabnikov klik — ne moremo ga zahtevati samodejno).
// Poštenost: brez podatka/zahteve → vrstica z razlogom; ročni vnos
// ostaja vedno dosegljiv (padec, ne izguba).

import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import {
  formatKota, kategorijaNaklona, kotMedPospeskoma, normalizirajKotPovrsine,
  povprecjePospeskov, veljavnostPospeska, vrednostZaVnos, type Pospesek,
} from '@/lib/nagib-core'

import { Move3d, Smartphone } from 'lucide-react'

type Faza = 'nic' | 'zbira' | 'ziv'

interface DevMotionEventLike {
  accelerationIncludingGravity?: { x?: number | null; y?: number | null; z?: number | null } | null
}

interface DevMotionCtor {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

export function Naklonomer ({ onPrevzemi, onClose }: {
  onPrevzemi: (vrednost: string) => void
  onClose: () => void
}): React.ReactElement {
  const [faza, setFaza] = useState<Faza>('nic')
  const [zivKot, setZivKot] = useState<number | null>(null)
  const [obrnjeno, setObrnjeno] = useState(false)
  const [opozorilo, setOpozorilo] = useState<string | null>(null)
  const [dovoljenje, setDovoljenje] = useState<'neznano' | 'zahtevano' | 'zavrnjeno'>(() => {
    // iOS 13+: če ta brskalnik zahteva dovoljenje, je stanje že ob prikazu
    // »zahtevano« (lazy init — brez efekta, brez setState v render poti).
    try {
      const dm = window.DeviceMotionEvent as unknown as DevMotionCtor | undefined
      return dm != null && typeof dm.requestPermission === 'function' ? 'zahtevano' : 'neznano'
    } catch {
      return 'neznano'
    }
  })
  const [videlDogodek, setVidelDogodek] = useState(false)

  const niclaRef = useRef<Pospesek | null>(null)
  const zbiraRef = useRef<Pospesek[]>([])
  const ziviRef = useRef<Pospesek | null>(null)

  // ── živi poslušalec devicemotion (edini vir podatkov) ──
  useEffect(() => {
    const h = (e: Event): void => {
      const dm = e as unknown as DevMotionEventLike
      const a = dm.accelerationIncludingGravity
      if (a == null) return
      const x = a.x, y = a.y, z = a.z
      if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return
      // setState je v poslušalcu dogodka (asinhrono iz senzorja, ne med
      // montiranjem) — kaskadni render iz efekta ni možen (vzorec izdelek-izbor).
      setVidelDogodek(true)
      const g: Pospesek = { x, y, z }
      ziviRef.current = g
      if (faza === 'zbira') {
        // zadnjih 8 vzorcev (~0,8 s pri 10 Hz) — povprečje zajema
        zbiraRef.current = [...zbiraRef.current.slice(-7), g]
      }
      if (faza === 'ziv' && niclaRef.current != null) {
        const v = veljavnostPospeska(g)
        if (!v.veljavno) { setOpozorilo(v.razlog); setZivKot(null); return }
        const surovi = kotMedPospeskoma(niclaRef.current, g)
        const norm = normalizirajKotPovrsine(surovi)
        setObrnjeno(norm.obrnjeno)
        setZivKot(norm.deg)
        setOpozorilo(norm.obrnjeno
          ? 'Telefon je bil obrnjen (ekran dol) — kot je geometrijsko enak, a preverite lego.'
          : null)
      }
    }
    window.addEventListener('devicemotion', h)
    return () => { window.removeEventListener('devicemotion', h) }
  }, [faza])

  // ── iOS 13+: dovoljenje za senzorje (enkrat, na klik) — zaznava je v
  // lazy init stanja zgoraj (brez efekta; setState v efektu je bil opozorjen).
  function zaprosiDovoljenje (): void {
    const dm = window.DeviceMotionEvent as unknown as DevMotionCtor | undefined
    if (dm == null || typeof dm.requestPermission !== 'function') return
    void dm.requestPermission().then((r) => {
      setDovoljenje(r === 'granted' ? 'neznano' : 'zavrnjeno')
    }).catch(() => { setDovoljenje('zavrnjeno') })
  }

  /** Začetek zajema ničle: 1,2 s zbiranja → povprečje → veljavnost. */
  function zajemiNiclo (): void {
    zbiraRef.current = []
    setFaza('zbira')
    setOpozorilo(null)
    setZivKot(null)
    window.setTimeout(() => {
      const povp = povprecjePospeskov(zbiraRef.current)
      const v = veljavnostPospeska(povp)
      if (povp == null || !v.veljavno) {
        niclaRef.current = null
        setFaza('nic')
        setOpozorilo(povp == null
          ? 'V času zajema ni bilo podatka o pospešku — preverite, da senzorji delujejo.'
          : (v.razlog ?? 'Ničle ni bilo mogoče zajeti.'))
        return
      }
      niclaRef.current = povp
      setFaza('ziv')
      setOpozorilo(null)
    }, 1200)
  }

  function ponastavi (): void {
    niclaRef.current = null
    zbiraRef.current = []
    ziviRef.current = null
    setFaza('nic')
    setZivKot(null)
    setObrnjeno(false)
    setOpozorilo(null)
  }

  const lahkoPrevzamem = faza === 'ziv' && zivKot != null

  return (
    <Card className="border-roksal-amber/30 bg-roksal-amber/5">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            <Smartphone className="size-4 text-roksal-amber" aria-hidden /> Naklonomer (relativna metoda)
          </h4>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClose}>Zapri</Button>
        </div>

        {/* iOS dovoljenje — samo kadar brskalnik zahteva (poštenost §0) */}
        {dovoljenje === 'zahtevano' ? (
          <div className="rounded-lg border bg-secondary/50 p-3 text-sm">
            <p className="mb-2 text-muted-foreground">Ta brskalnik zahteva dovoljenje za senzorje gibanja.</p>
            <Button size="sm" variant="outline" onClick={zaprosiDovoljenje}><Move3d className="mr-1 size-3.5" aria-hidden /> Dovoli senzorje</Button>
          </div>
        ) : null}
        {dovoljenje === 'zavrnjeno' ? (
          <p className="rounded-lg border bg-destructive/10 p-3 text-sm text-destructive">
            Dovoljenje za senzorje je zavrnjeno — naklon vnesite ročno (zaprto polje spodaj ostaja).
          </p>
        ) : null}

        {faza === 'nic' ? (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              <span className="font-semibold text-foreground">1. korak — ničla:</span> položite telefon na znano
              vodoravno površino (stopnica/podest/tla) in pritisnite. Zajame povprečje ~1,2 s.
            </p>
            <Button size="sm" variant="outline" onClick={zajemiNiclo} disabled={dovoljenje === 'zahtevano'}>
              Zajemi ničlo
            </Button>
          </div>
        ) : null}

        {faza === 'zbira' ? (
          <p className="text-sm text-muted-foreground" role="status">Zajemam ničlo … telefon naj leži mirno.</p>
        ) : null}

        {faza === 'ziv' ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">2. korak — meritev:</span> položite telefon na desko
              ali ploščo, ki leži čez več zobcev stopnice. Kot se posodablja v živo.
            </p>
            <div className="flex flex-wrap items-baseline gap-3" aria-live="polite">
              <span className="text-4xl font-black tabular-nums text-foreground">{formatKota(zivKot)}</span>
              <span className="text-sm text-muted-foreground">{kategorijaNaklona(zivKot)}</span>
              {obrnjeno ? <span className="text-xs text-amber-600 dark:text-amber-400">(telefon obrnjen)</span> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!lahkoPrevzamem} onClick={() => { onPrevzemi(vrednostZaVnos(zivKot)); onClose() }}>
                Prevzemi kot v vnos naklona
              </Button>
              <Button size="sm" variant="ghost" onClick={ponastavi}>Ponastavi ničlo</Button>
            </div>
          </div>
        ) : null}

        {opozorilo ? <p className="text-xs text-amber-700 dark:text-amber-400" role="alert">{opozorilo}</p> : null}
        {!videlDogodek ? (
          <p className="text-xs text-muted-foreground">
            Podatek o pospešku še ni prispel — če se ne pojavi, senzorji niso na voljo (http ali zavrnjeno
            dovoljenje); naklon vnesite ročno.
          </p>
        ) : null}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Metoda je relativna (kot med gravitacijo na ničli in na plošči) — neodvisna od smeri
          držanja in platforme. Merite večkrat in prevzemite mirno vrednost.
        </p>
      </CardContent>
    </Card>
  )
}
