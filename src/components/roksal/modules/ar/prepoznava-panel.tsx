'use client'

// prepoznava-panel.tsx — R559: VLM PREPOZNAVANJE OBSTOJEČE OGRAJE
// (vprašanje lastnika: »ali kamera sama zazna, kaj je ograja, kakšno okovje,
// keramika ali les«). Fotografija iz živega predogleda (zajemiKader) ali
// nalaganje → POST /api/ar/inspect (backend VLM glm-4.6v) → material
// ročnika/stebrov, polnilo, okovje, stanje — VSAKO s zaupanjem.
// Pomoč pri odločitvi — NE vir resnice (material na terenu potrdi monter).

import { useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Camera, CheckCircle2, Loader2, MinusCircle, ScanSearch, Upload, X, XCircle } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { apiPost } from '@/lib/api-client'
import type { InspectMaterial, InspectOgraja } from './tipi'

/** slovenske oznake materialov (NEZNANO prikažemo ločeno — sivo). */
const MATERIALI: Record<InspectMaterial, string> = {
  LES: 'Les', KERAMIKA: 'Keramika', INOX: 'Inox', ALUMINIJ: 'Aluminij',
  JEKLO: 'Jeklo', PLASTIKA: 'Plastika', DRUGO: 'Drugo', NEZNANO: 'Neznano',
}

const POLNILA: Record<string, string> = {
  STEKLO: 'Steklo', NAVPICNE_CEVI: 'Navpične cevi', VODORAVNE_CEVI: 'Vodoravne cevi',
  NAVPICNI_PROFILI: 'Navpični profili', BREZ: 'Brez polnila', DRUGO: 'Drugo', NEZNANO: 'Neznano',
}

const TIPI: Record<string, string> = {
  BALKONSKA: 'Balkonska', STOPNISKA: 'Stopniška', TERASNA: 'Terasna',
  VRTNA: 'Vrtna', DRUGO: 'Drugo', NEZNANO: 'Neznano',
}

const STANJA: Record<string, string> = {
  NOVO: 'Novo', DOBRO: 'Dobro', RABLJENO: 'Rabljeno', POSKODOVANO: 'Poškodovano', NEZNANO: 'Neznano',
}

/** Badge zaupanja: ≥0,7 prepoznano (zeleno) · 0,4–0,69 verjetno (amber) · sicer nejasno (sivo). */
function ZaupanjeBadge ({ v }: { v: number }): React.ReactElement {
  const pct = Math.round(v * 100)
  if (v >= 0.7) {
    return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">prepoznano · {pct} %</Badge>
  }
  if (v >= 0.4) {
    return <Badge className="border-roksal-amber/40 bg-amber-50 text-roksal-amber dark:bg-amber-950/30 dark:text-amber-400">verjetno · {pct} %</Badge>
  }
  return <Badge variant="secondary">nejasno · {pct} %</Badge>
}

/** Vrstica okovja: Da / Ne / Ni vidno (null = iz tega kota ni vidno — pošteno). */
function OkovjeVrstica ({ label, v }: { label: string; v: boolean | null }): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      {v === true ? <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden /> : v === false ? <XCircle className="size-3.5 text-muted-foreground" aria-hidden /> : <MinusCircle className="size-3.5 text-muted-foreground/60" aria-hidden />}
      {label}: {v === true ? 'da' : v === false ? 'ne' : 'ni vidno'}
    </span>
  )
}

function MeterVrstica ({ kaj, cm }: { kaj: string; cm: number | null }): React.ReactElement | null {
  if (cm == null) return null
  return (
    <span className="text-sm text-muted-foreground">
      {kaj}: <span className="font-semibold text-foreground">{Math.round(cm)} cm</span> (ocena)
    </span>
  )
}

export function PrepoznavaPanel ({ zajemiKader }: {
  /** R559: zajem čistega kadra iz živega predogleda (brez overlayja); undefined, kadar kamera ni aktivna. */
  zajemiKader?: () => Promise<string>
}): React.ReactElement {
  const { toast } = useToast()
  const [photo, setPhoto] = useState<string | null>(null)
  const [virFoto, setVirFoto] = useState<'kader' | 'upload' | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyKader, setBusyKader] = useState(false)
  const [rezultat, setRezultat] = useState<InspectOgraja | null>(null)
  const [hint, setHint] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function zajemi (): Promise<void> {
    if (!zajemiKader || busyKader) return
    setBusyKader(true)
    try {
      const kader = await zajemiKader()
      setPhoto(kader)
      setVirFoto('kader')
      setRezultat(null)
      toast({ title: 'Kader zajet.', description: 'Prepoznajte ograjo z gumbom spodaj.' })
    } catch (e) {
      toast({ title: 'Zajem kadra ni uspel.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusyKader(false)
    }
  }

  async function nalozi (f: FileList | null): Promise<void> {
    if (f == null || f.length === 0) return
    const file = f[0]
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Ni veljavna slika.', description: 'Izberite JPG ali PNG.' })
      return
    }
    const url = await new Promise<string>((res, rej) => {
      const fr = new FileReader()
      fr.onload = () => { res(String(fr.result ?? '')) }
      fr.onerror = () => { rej(new Error('branje')) }
      fr.readAsDataURL(file)
    }).catch(() => '')
    if (!url.startsWith('data:image/')) {
      toast({ title: 'Slike ni bilo mogoče prebrati.' })
      return
    }
    setPhoto(url)
    setVirFoto('upload')
    setRezultat(null)
  }

  async function prepoznaj (): Promise<void> {
    if (busy || !photo) return
    setBusy(true)
    try {
      const res = await apiPost<{ data: InspectOgraja }>('/api/ar/inspect', {
        photo,
        hint: hint.trim() || undefined,
      })
      setRezultat(res.data)
      toast({
        title: res.data.jeOgraja ? 'Ograja prepoznana.' : 'Ograja ni bila prepoznana.',
        description: res.data.jeOgraja
          ? `Ročnik: ${MATERIALI[res.data.rocnik.material]}${res.data.rocnik.zaupanje > 0 ? ` (${Math.round(res.data.rocnik.zaupanje * 100)} %)` : ''} — preverite na terenu.`
          : 'Poskusite z bolj frontalno fotografijo ograje.',
      })
    } catch (e) {
      toast({ title: 'Prepoznavanje ni uspelo.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  function pocisti (): void {
    setPhoto(null)
    setVirFoto(null)
    setRezultat(null)
  }

  return (
    <Card className="border-roksal-amber/30">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            <ScanSearch className="size-4 text-roksal-amber" aria-hidden /> Prepoznaj obstoječo ograjo
          </h2>
          {rezultat || photo ? (
            <Button variant="ghost" size="icon" className="size-8" aria-label="Počisti prepoznavanje" onClick={() => { pocisti() }}>
              <X className="size-4" aria-hidden />
            </Button>
          ) : null}
        </div>

        {!rezultat ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Ali je kamera »pametna«? Fotografija obstoječe ograje → AI prepozna
              <span className="font-medium text-foreground"> material ročnika (les / keramika / inox)</span>,
              polnilo, stebre, <span className="font-medium text-foreground">okovje (kljuka, tečaji, ključavnica)</span> in stanje —
              vsako s stopnjo zaupanja; kadar komponente ne vidi, to iskreno pove.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label="Izberi fotografijo ograje"
              onChange={(e) => { void nalozi(e.target.files); e.target.value = '' }}
            />
            <div className="flex flex-wrap items-center gap-2">
              {zajemiKader ? (
                <Button size="sm" variant="outline" disabled={busyKader} onClick={() => { void zajemi() }}>
                  {busyKader ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Camera className="size-3.5" aria-hidden />}
                  Zajemi kader iz predogleda
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => { fileRef.current?.click() }}>
                <Upload className="size-3.5" aria-hidden /> Naloži fotografijo
              </Button>
              {photo ? (
                <span className="text-xs text-muted-foreground" role="status">
                  {virFoto === 'kader' ? 'kader iz predogleda' : 'nalaganje'} ✓
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">fotografija še ni pripravljena</span>
              )}
            </div>
            <div className="space-y-0.5">
              <Input
                value={hint}
                onChange={(e) => { setHint(e.target.value) }}
                placeholder="Namig (neobvezno): npr. »stopniščna ograja, ročnik naj bi bil hrastov«"
                className="h-8 text-xs"
                aria-label="Namig za prepoznavanje"
              />
            </div>
            <Button size="sm" disabled={busy || !photo} onClick={() => { void prepoznaj() }}>
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ScanSearch className="size-3.5" aria-hidden />}
              {busy ? 'Prepoznavanje poteka …' : 'Prepoznaj ograjo'}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {!rezultat.jeOgraja ? (
              <div className="rounded-lg border bg-secondary/40 p-3 text-sm">
                <p className="font-semibold">Na fotografiji ni bilo mogoče prepoznati ograje.</p>
                {rezultat.scene ? <p className="mt-1 text-muted-foreground">{rezultat.scene}</p> : null}
                <p className="mt-1 text-xs text-muted-foreground">Poskusite s frontalno fotografijo, na kateri so ročnik in stebri jasno vidni.</p>
              </div>
            ) : (
              <>
                {rezultat.scene ? <p className="text-sm font-medium">{rezultat.scene}</p> : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{TIPI[rezultat.tipOgraje]}</Badge>
                  <Badge variant={rezultat.stanje === 'POSKODOVANO' ? 'destructive' : rezultat.stanje === 'NOVO' || rezultat.stanje === 'DOBRO' ? 'secondary' : 'outline'}>
                    Stanje: {STANJA[rezultat.stanje]}
                  </Badge>
                  <MeterVrstica kaj="višina" cm={rezultat.ocenaVisineCm} />
                  <MeterVrstica kaj="dolžina" cm={rezultat.ocenaDolzineCm} />
                </div>

                <ul className="space-y-1.5">
                  <li className="rounded-lg border bg-secondary/40 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ročnik</span>
                      <span className="font-semibold">{MATERIALI[rezultat.rocnik.material]}</span>
                      <ZaupanjeBadge v={rezultat.rocnik.zaupanje} />
                      {rezultat.rocnik.barva ? <span className="text-xs text-muted-foreground">barva: {rezultat.rocnik.barva}</span> : null}
                    </div>
                    {rezultat.rocnik.opis ? <p className="mt-1 text-sm text-muted-foreground">{rezultat.rocnik.opis}</p> : null}
                  </li>
                  <li className="rounded-lg border bg-secondary/40 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Polnilo</span>
                      <span className="font-semibold">{POLNILA[rezultat.polnilo.vrsta]}</span>
                      <ZaupanjeBadge v={rezultat.polnilo.zaupanje} />
                    </div>
                    {rezultat.polnilo.opis ? <p className="mt-1 text-sm text-muted-foreground">{rezultat.polnilo.opis}</p> : null}
                  </li>
                  <li className="rounded-lg border bg-secondary/40 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stebri</span>
                      <span className="font-semibold">{MATERIALI[rezultat.stebri.material]}</span>
                      {rezultat.stebri.steviloOcena != null ? (
                        <Badge variant="outline" className="border-roksal-amber/40 text-roksal-amber">≈ {rezultat.stebri.steviloOcena}</Badge>
                      ) : null}
                      <ZaupanjeBadge v={rezultat.stebri.zaupanje} />
                    </div>
                    {rezultat.stebri.opis ? <p className="mt-1 text-sm text-muted-foreground">{rezultat.stebri.opis}</p> : null}
                  </li>
                  <li className="rounded-lg border bg-secondary/40 p-2.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Okovje</p>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      <OkovjeVrstica label="Kljuka" v={rezultat.okovje.kljuka} />
                      <OkovjeVrstica label="Tečaji" v={rezultat.okovje.tecaji} />
                      <OkovjeVrstica label="Ključavnica" v={rezultat.okovje.kljucavnica} />
                    </div>
                    {rezultat.okovje.opis ? <p className="mt-1 text-sm text-muted-foreground">{rezultat.okovje.opis}</p> : null}
                  </li>
                </ul>

                {rezultat.stanjeOpis ? (
                  <p className="text-sm"><span className="font-semibold">Stanje:</span> {rezultat.stanjeOpis}</p>
                ) : null}
                {rezultat.opombe.length > 0 ? (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Opombe za monterja</p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm">
                      {rezultat.opombe.map((o, i) => <li key={i}>{o}</li>)}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
            <p className="text-xs text-muted-foreground">
              Prepoznavanje je pomoč pri odločitvi — material in okovje vedno potrdite na terenu (dotik, vizualni pregled).
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
