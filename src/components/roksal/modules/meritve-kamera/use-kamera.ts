'use client'

// MERITVE S KAMERO — hook žive kamere: getUserMedia zagon, smer (spredaj/
// zadaj), bliskavica (torch), zmogljivosti IZBRANE kamere in spomin monterjevih
// nastavitev. Stanje hooka je samozadostno (lastnik je izključno ta hook);
// `toast` prejme kot argument (stabilna modulska funkcija iz useToast).
// R537-a: selitev iz meritve-kamera.tsx (izhodiščne glave ostajajo ob kodi).

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  napisSmeri, naslednjaSmer, nastaviTorch, nastaviZoom, poskusiOstrenje, prestejVideoVhode, razloziNapakoKamere, zmogljivostiKamere,
  type SmerKamere, type ZmogljivostiKamere,
} from '@/lib/camera-capabilities'
import { napisNastavitev, nastaviSmer, nastaviSvetilko, preberiNastavitve, shramba, type KameraNastavitve } from '@/lib/camera-prefs'
import type { ToastFn } from './tipi'

export function useKamera ({ toast }: { toast: ToastFn }) {
  const [camActive, setCamActive] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // R508 (issue #7 §4A/§6): zmožnosti IZBRANE kamere (bliskavica, preklop) in
  // statusna vrstica shranjevanja — obe sta povzeti iz naprave/strežnika, nikoli
  // predpostavljene.
  const [zmoKamere, setZmoKamere] = useState<ZmogljivostiKamere | null>(null)
  // R509 (issue #7 §9): spomin na monterjeve nastavitve. Beremo SAMO na
  // odjemalcu (`shramba()` je na strežniku `null` → privzeto), neveljaven zapis
  // pade na privzeto. Svetilka se iz spomina NIKOLI ne prižge sama — iz njega je
  // samo opomba, ker je prižig hardverski ukaz (§7).
  const [nastavitve, setNastavitve] = useState<KameraNastavitve>(() => preberiNastavitve(shramba()))
  const [smerKamere, setSmerKamere] = useState<SmerKamere>(() => nastavitve.smer)
  const [torchNa, setTorchNa] = useState(false)

  const streamRef = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // R550: trenutna vrednost zooma — `null` pomeni »naprava še ni potrdila
  // vrednosti« (ali zmožnost ni podprta); drsnik takrat stoji na min.
  const [zoomVrednost, setZoomVrednost] = useState<number | null>(null)

  // priprava kamere
  /**
   * R508 (issue #7 §4A/§4D): kaj naprava ZARES zmore. Številka vidnih kamer se
   * v nezavarjenem kontekstu ne dobi (brskalnik skrije deviceId-e) — takrat je
   * odgovor NI_DOKAZA in UI preklopa NE pokaže, namesto da bi trdil »ena kamera«.
   */
  const zajemiZmogljivosti = useCallback(async (stream: MediaStream): Promise<void> => {
    const track = stream.getVideoTracks()[0] ?? null
    let vhodi: number | null = null
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      vhodi = prestejVideoVhode(devices, window.isSecureContext === true)
    } catch { vhodi = null }
    setZmoKamere(zmogljivostiKamere(track, vhodi))
  }, [])

  /**
   * R508: zagon kamere vrne `true` SAMO, če je zagon uspel — preklop sicer ne
   * sme trditi »aktivna je zadnja kamera«, ko kamera ni dosegljiva (§7).
   * R550: idealna resolucija toka — bez nje brskalnik pogosto ponudi privzeti
   * 640×480, kar je za merilne fotografije preslabo (točke se oddajo na
   * pomanjšani sliki). `ideal` (ne `exact`) pomeni pošteno prilagoditev:
   * naprava, ki 1920 ne zmore, dobi najbližjo podprto vrednost.
   * Vzorec najboljših implementacij na spletu (web.dev, Dynamsoft).
   */
  const startCamera = useCallback(async (smer: SmerKamere = smerKamere): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: smer }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      streamRef.current = stream
      setSmerKamere(smer)
      setTorchNa(false)
      setZoomVrednost(null)
      setCamActive(true)
      // R509: uspešen zagon si zapomni smer (zapisi v brskalnik, ne v bazo).
      if (nastaviSmer(shramba(), smer)) setNastavitve((p) => ({ ...p, smer }))
      requestAnimationFrame(() => { if (videoRef.current) videoRef.current.srcObject = stream })
      await zajemiZmogljivosti(stream)
      return true
    } catch (e) {
      setZmoKamere(zmogljivostiKamere(null, null))
      // R550: napaka po IMENU (NotAllowed/NotFound/NotReadable/…) — monterju
      // povedan UKREP, ne generična opomba; padec na nalaganje ostaja.
      const razlaga = razloziNapakoKamere(e)
      toast({
        title: razlaga.naslov,
        description: razlaga.opis,
      })
      fileRef.current?.click()
      return false
    }
  }, [toast, smerKamere, zajemiZmogljivosti])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCamActive(false)
    setTorchNa(false)
    setZoomVrednost(null)
  }, [])

  /**
   * R550: zoom drsnik — vrednost živi SAMO, kadar jo je naprava potrdila
   * (zmoKamere.zoom PODPRTO). Uspeh je TIH (drsanje je zvezno, toast ob vsakem
   * premiku bi bil vsiljiv — vzorec web.dev); napaka pa se POVE, s postopkom.
   */
  const nastaviZoomVrednost = useCallback(async (zeljena: number): Promise<void> => {
    const track = streamRef.current?.getVideoTracks()[0] ?? null
    const izid = await nastaviZoom(track, zeljena)
    if (izid.uporabljena !== null) setZoomVrednost(izid.uporabljena)
    if (!izid.uspesno) {
      toast({
        title: 'Približanje',
        description: izid.sporocilo,
        variant: 'destructive',
      })
    }
  }, [toast])

  /** Preklop spredaj/zadaj — ponovni zagon z izbrano smerjo (brez domneve o napravi). */
  const preklopiSmer = useCallback(async (): Promise<void> => {
    const naslednja = naslednjaSmer(smerKamere)
    stopCamera()
    const uspelo = await startCamera(naslednja)
    if (uspelo) toast({ title: 'Preklop kamere', description: `Aktivna je ${napisSmeri(naslednja)}.` })
  }, [smerKamere, startCamera, stopCamera, toast])

  /**
   * Bliskavica: ukaz se posreduje samo, če ga je naprava potrdila, rezultat pa
   * je lahko SPREJETO_BREZ_POTRDITVE — monter to dobi kot »poskus«, ne kot dokaz.
   */
  const preklopiTorch = useCallback(async (): Promise<void> => {
    const track = streamRef.current?.getVideoTracks()[0] ?? null
    const izid = await nastaviTorch(track, !torchNa)
    const prižgana = izid.stanje === 'VKLOPLJEN' || (izid.stanje === 'SPREJETO_BREZ_POTRDITVE' && !torchNa)
    const ugasnjena = izid.stanje === 'IZKLOPLJEN' || (izid.stanje === 'SPREJETO_BREZ_POTRDITVE' && torchNa)
    if (prižgana) setTorchNa(true)
    if (ugasnjena) setTorchNa(false)
    // R509 (issue #7 §9): v spomin gre samo stanje, ki ga UI zares pokaže —
    // NAPAKA/NI_PODPRE ne spremenita ničesar, sicer bi monterju ostal prižig,
    // ki se nikoli ni zgodil.
    if (prižgana !== ugasnjena && nastaviSvetilko(shramba(), prižgana)) {
      setNastavitve((p) => ({ ...p, svetilkaNazadnje: prižgana }))
    }
    toast({
      title: 'Bliskavica',
      description: izid.sporocilo,
      variant: izid.stanje === 'NAPAKA' || izid.stanje === 'NI_PODPRE' ? 'destructive' : undefined,
    })
  }, [torchNa, toast])

  /**
   * R550: tap-to-focus — posredovanje POSKUSA ostrenja na normalizirano točko
   * (0..1 v okviru videa). Lastništvo tracka ostaja v hooku (isti vzorec kot
   * torch); izid je pošteno sporočilo, izida pa monterju ne lažemo (POSKUS).
   */
  const ostrenjeNaTocki = useCallback(async (tocka: { x: number; y: number }): Promise<void> => {
    const track = streamRef.current?.getVideoTracks()[0] ?? null
    const izid = await poskusiOstrenje(track, tocka)
    if (izid.stanje === 'POSKUS') {
      toast({ title: 'Ostrenje', description: izid.sporocilo })
    } else if (izid.stanje === 'NAPAKA') {
      toast({ title: 'Ostrenje', description: izid.sporocilo, variant: 'destructive' })
    }
  }, [toast])

  useEffect(() => () => stopCamera(), [stopCamera])

  return {
    camActive, videoRef, fileRef, torchNa, zmoKamere, nastavitve, smerKamere,
    zoomVrednost, nastaviZoomVrednost, ostrenjeNaTocki,
    startCamera, stopCamera, preklopiSmer, preklopiTorch,
  }
}
