'use client'

// MERITVE S KAMERO — hook žive kamere: getUserMedia zagon, smer (spredaj/
// zadaj), bliskavica (torch), zmogljivosti IZBRANE kamere in spomin monterjevih
// nastavitev. Stanje hooka je samozadostno (lastnik je izključno ta hook);
// `toast` prejme kot argument (stabilna modulska funkcija iz useToast).
// R537-a: selitev iz meritve-kamera.tsx (izhodiščne glave ostajajo ob kodi).

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  izberiNaprave, napisResolucije, napisSmeri, naslednjaSmer, nastaviTorch, nastaviZoom, poskusiOstrenje, prestejVideoVhode, razloziNapakoKamere, zmogljivostiKamere,
  type NapravaZaIzbiro, type SmerKamere, type ZmogljivostiKamere,
} from '@/lib/camera-capabilities'
import { napisNastavitev, nastaviSmer, nastaviSvetilko, preberiNastavitve, shramba, type KameraNastavitve } from '@/lib/camera-prefs'
import { vzorecOstrine, vzorecSvetlobe } from './kakovost'
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

  // R553: POŠTENA resolucija toka (getSettings — naprava pove, kaj je ZAGOTOVILA,
  // ne kaj smo prosili). `null` = ni dokaza → UI ne izpiše ničesar.
  const [resToka, setResToka] = useState<string | null>(null)
  // R553: kamere z oznakami za izbirnik objektiva (enumerateDevices PO odobritvi).
  const [naprave, setNaprave] = useState<NapravaZaIzbiro[]>([])
  // R553: deviceId toka, ki teče ZDAJ (iz getSettings — ne iz domneve o facing).
  const [trenutnaNaprava, setTrenutnaNaprava] = useState<string | null>(null)
  // R553: glajena (EWMA α=0,5) svetlost živega predogleda; `null` = brez vzorca.
  const [svetloba, setSvetloba] = useState<number | null>(null)
  // R580 (SAMODEJNI ZAJEM): glajena (EWMA α=0,5) ostrina živega predogleda
  // (Laplaceova varianca na 240 px — ista skala/prag kot analiza po zajemu);
  // `null` = brez vzorca, UI nikoli ne laže z vrednostjo.
  const [ostrina, setOstrina] = useState<number | null>(null)
  // R579: generacija toka — naraste ob vsakem uspešnem zagonu. Učinek priklopa
  // (spodaj) se sproži na [camActive, tokGeneracija], s čimer je priklop
  // zagotovljen po vsakem zagonu — tudi če bi se camActive v eni Reactovi
  // seriji sprememb ohranil `true` (bliskovit preklop brez prehoda false→true).
  const [tokGeneracija, setTokGeneracija] = useState(0)

  // priprava kamere
  /**
   * R508 (issue #7 §4A/§4D): kaj naprava ZARES zmore. Številka vidnih kamer se
   * v nezavarjenem kontekstu ne dobi (brskalnik skrije deviceId-e) — takrat je
   * odgovor NI_DOKAZA in UI preklopa NE pokaže, namesto da bi trdil »ena kamera«.
   */
  const zajemiZmogljivosti = useCallback(async (stream: MediaStream): Promise<void> => {
    const track = stream.getVideoTracks()[0] ?? null
    let vhodi: number | null = null
    let devices: Awaited<ReturnType<typeof navigator.mediaDevices.enumerateDevices>> | null = null
    try {
      devices = await navigator.mediaDevices.enumerateDevices()
      vhodi = prestejVideoVhode(devices, window.isSecureContext === true)
    } catch { vhodi = null }
    setZmoKamere(zmogljivostiKamere(track, vhodi))
    // R553: isti enumerate klic — zdaj tudi seznam OZNAČENIH kamer za izbirnik.
    if (devices !== null) setNaprave(izberiNaprave(devices, window.isSecureContext === true))
    // R553: POŠTENA resolucija + dejanski deviceId IZ TOKA (getSettings je
    // edini vir resnice — Snap/web.dev praksa). Ob napaki NE lažemo z vrednostjo.
    if (track && typeof track.getSettings === 'function') {
      try {
        const surovo = track.getSettings()
        const s = surovo && typeof surovo === 'object' ? surovo as Record<string, unknown> : null
        setResToka(napisResolucije(s))
        const id = s !== null ? (s as { deviceId?: unknown }).deviceId : undefined
        setTrenutnaNaprava(typeof id === 'string' && id.length > 0 ? id : null)
      } catch {
        setResToka(null)
        setTrenutnaNaprava(null)
      }
    } else {
      setResToka(null)
      setTrenutnaNaprava(null)
    }
  }, [])

  /**
   * R508: zagon kamere vrne `true` SAMO, če je zagon uspel — preklop sicer ne
   * sme trditi »aktivna je zadnja kamera«, ko kamera ni dosegljiva (§7).
   * R550: idealna resolucija toka — bez nje brskalnik pogosto ponudi privzeti
   * 640×480, kar je za merilne fotografije preslabo (točke se oddajo na
   * pomanjšani sliki). `ideal` (ne `exact`) pomeni pošteno prilagoditev:
   * naprava, ki 1920 ne zmore, dobi najbližjo podprto vrednost.
   * Vzorec najboljših implementacij na spletu (web.dev, Dynamsoft).
   * R553: `deviceId` (če je podan) izbere DOLOČEN objektiv (multi-lens:
   * ultraširoka/tele — Twilio/MDN vzorec); `exact` je nujen, sicer bi
   * brskalnik lahko vrnil katerokoli kamero. Brez deviceId ostaja facingMode.
   */
  const startCamera = useCallback(async (smer: SmerKamere = smerKamere, deviceId?: string): Promise<boolean> => {
    try {
      const videoConstraints: MediaTrackConstraints = deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { facingMode: { ideal: smer }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints })
      streamRef.current = stream
      setSmerKamere(smer)
      setTorchNa(false)
      setZoomVrednost(null)
      setSvetloba(null)
      setOstrina(null)
      setCamActive(true)
      // R509: uspešen zagon si zapomni smer (zapisi v brskalnik, ne v bazo).
      if (nastaviSmer(shramba(), smer)) setNastavitve((p) => ({ ...p, smer }))
      setTokGeneracija((g) => g + 1)
      // R579: priklop TAKOJ, če <video> že stoji (npr. ponovni zagon med
      // aktivnostjo); sicer ga oprani učinek po commitu (spodaj). Prejšnji rAF
      // je ob hladnem prvem zagonu lahko izpel PRED Reactovim izrisom pogojnega
      // <video> (ref še null) → priklop tiho izpuščen → črn predogled do
      // ponovnega odprtja. play() po vzorcu AR modula (iOS avtopredvajanje).
      const v = videoRef.current
      if (v && v.srcObject !== stream) {
        v.srcObject = stream
        void v.play().catch(() => { /* autoPlay+muted → zavrnitev ni usodna */ })
      }
      await zajemiZmogljivosti(stream)
      return true
    } catch (e) {
      setZmoKamere(zmogljivostiKamere(null, null))
      setResToka(null)
      setTrenutnaNaprava(null)
      setSvetloba(null)
      setOstrina(null)
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
    // R579: odklop toka tudi na elementu (vzorec AR modula) — brez tega zadnji
    // okvir obvisi; ob odklopu komponente je ref React že ničel (varovalka).
    if (videoRef.current) videoRef.current.srcObject = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCamActive(false)
    setTorchNa(false)
    setZoomVrednost(null)
    setResToka(null)
    setTrenutnaNaprava(null)
    setSvetloba(null)
    setOstrina(null)
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
   * R553: preklop na DOLOČEN objektiv po deviceId (izbirnik kamer). Uspeh se
   * trdi SAMO po dejanskem zagonu (ista poštenost kot preklopiSmer); oznaka
   * v toastu je tista, ki jo je razkril brskalnik — ne naša domneva.
   */
  const preklopiNapravo = useCallback(async (deviceId: string): Promise<void> => {
    const cilj = naprave.find((n) => n.deviceId === deviceId) ?? null
    stopCamera()
    const uspelo = await startCamera(smerKamere, deviceId)
    if (uspelo && cilj) toast({ title: 'Izbira kamere', description: `Aktivna je ${cilj.label}.` })
  }, [naprave, smerKamere, startCamera, stopCamera, toast])

  /**
   * R553: živi vzorec svetlosti predogleda (vsakih 1,5 s). Vrednost je EWMA
   * (α=0,5) — glajenje preprečuje utripanje ob meji (isto past kot auto-torch
   * oscilacija, le tu brez ukaza: nikoli se NE prižga nič sam). Samo svetlost;
   * ostrina v živo ni zanesljiva (Laplace na 48 px bi lagal).
   */
  useEffect(() => {
    if (!camActive) return
    const id = window.setInterval(() => {
      void vzorecSvetlobe(videoRef.current).then((b) => {
        if (b === null) return
        setSvetloba((prej) => prej === null ? b : prej * 0.5 + b * 0.5)
      })
      // R580: živi vzorec OSTRINE ob svetlobi — vir za samodejni zajem.
      void vzorecOstrine(videoRef.current).then((v) => {
        if (v === null) return
        setOstrina((prej) => prej === null ? v : prej * 0.5 + v * 0.5)
      })
    }, 1500)
    return () => window.clearInterval(id)
  }, [camActive])

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

  /**
   * R579: priklop toka na <video> PO commitu — pokriva zagon, ob katerem
   * element še ni bil izrisan (prvi zagon: rAF je lahko izpel pred izrisom,
   * ref null, priklop izpuščen → črno), in bliskovit preklop (camActive brez
   * prehoda false→true). Učinek teče ZA Reactovim izrisom, ref je zapolnjen;
   * idempotenca (srcObject !== stream) preprečuje dvojni priklop.
   */
  useEffect(() => {
    if (!camActive) return
    const v = videoRef.current
    const stream = streamRef.current
    if (v && stream && v.srcObject !== stream) {
      v.srcObject = stream
      void v.play().catch(() => { /* autoPlay+muted → zavrnitev ni usodna */ })
    }
  }, [camActive, tokGeneracija])

  useEffect(() => () => stopCamera(), [stopCamera])

  return {
    camActive, videoRef, fileRef, torchNa, zmoKamere, nastavitve, smerKamere,
    zoomVrednost, nastaviZoomVrednost, ostrenjeNaTocki,
    resToka, naprave, trenutnaNaprava, svetloba, ostrina, preklopiNapravo,
    startCamera, stopCamera, preklopiSmer, preklopiTorch,
  }
}
