// camera-capabilities — R508 (issue #7 §4A/§4D): zmožnosti kamere se UGOTOVIJO
// iz naprave, ne predpostavijo. Osnovni potek (živi zajem + ročne točke +
// referenčna mera) NE SME biti odvisen od bliskavice ali preklopa kamer, zato
// ta modul nič ne ve o DOM-u in nič ne trdi, česar naprava ni potrdila.
//
// Tri stanja so namenoma ločena:
//   PODPRTO        — naprava je zmožnost potrdila (getCapabilities / število vhodov)
//   NI_PODPRE      — naprava je zmožnosti eksplicitno NI dala (gumb se ne pokaže)
//   NI_DOKAZA      — brskalnik/platforma odgovora ne moreta dati (API manjka,
//                    nezavarjen kontekst) → NE smemo reči ne »podprto« ne »ni podprto«
//
// Brez zunanjih odvisnosti, brez AI, brez plačljivih API-jev.

export type StanjeZmogljivosti = 'PODPRTO' | 'NI_PODPRE' | 'NI_DOKAZA'

/**
 * Minimalni rez MediaStreamTrack, ki ga potrebujemo (testi dajo lažnjak).
 * Metode (ne lastnosti) so namenoma — tako je pravi `MediaStreamTrack`
 * strukturno sprejemljiv, ne da bi morali its DOM tipi biti skladni.
 */
export interface TrackLike {
  applyConstraints? (c?: unknown): Promise<void>
  getCapabilities? (): unknown
  getContext? (): unknown
  label?: string
}

export interface ZmogljivostiKamere {
  torch: StanjeZmogljivosti
  /** Preklop spredaj/zadaj ima smisel samo, če je videnih vsaj dve kameri. */
  preklop: StanjeZmogljivosti
  /** Zakaj je preklop NI_DOKAZA: v nezavarjenem kontekstu brskalnik skrije deviceId-e. */
  razlogPreklopa: 'vec-kamer' | 'ena-kamera' | 'nezavarjen-kontekst' | 'brez-podatka'
  /**
   * R550: optično/električno približevanje (zoom). Razpon pride IZKLJUČNO iz
   * `getCapabilities().zoom` (špecifikacija MediaTrackCapability: {min,max,step})
   * — drsnik se pokaže SAMO, kadar je razpon potrjen. `step` lahko manjka
   * (privzeto 1); `konec` je vrednost, ki jo brskalnik uporabi kot mejo.
   */
  zoom: { stanje: StanjeZmogljivosti; min: number; max: number; step: number }
  /**
   * R550: tap-to-focus (focusMode/pointsOfInterest, Chrome Android). Gumb se
   * pokaže SAMO, kadar naprava v getCapabilities POTRDI seznam načinov ostrenja.
   */
  fokus: StanjeZmogljivosti
}

/** R550: razpon zooma iz surove vrednosti capabilities — z validacijo, brez domnev. */
export function zoomRazpon (cap: Record<string, unknown> | null): { stanje: StanjeZmogljivosti; min: number; max: number; step: number } {
  if (cap === null) return { stanje: 'NI_DOKAZA', min: 0, max: 0, step: 1 }
  const z = cap.zoom
  if (z === null || typeof z !== 'object' || Array.isArray(z)) return { stanje: 'NI_PODPRE', min: 0, max: 0, step: 1 }
  const r = z as { min?: unknown; max?: unknown; step?: unknown }
  const min = typeof r.min === 'number' && Number.isFinite(r.min) ? r.min : NaN
  const max = typeof r.max === 'number' && Number.isFinite(r.max) ? r.max : NaN
  const step = typeof r.step === 'number' && Number.isFinite(r.step) && r.step > 0 ? r.step : 1
  if (Number.isNaN(min) || Number.isNaN(max) || max <= min) return { stanje: 'NI_PODPRE', min: 0, max: 0, step: 1 }
  return { stanje: 'PODPRTO', min, max, step }
}

export type SmerKamere = 'environment' | 'user'

/** Izid ukaza za bliskavico — z dokazom, če ga je naprava dala. */
export type StanjeTorcha =
  | 'VKLOPLJEN'            // applyConstraints sprejet IN getContext to potrdi
  | 'IZKLOPLJEN'           // enako, a za izklop
  | 'SPREJETO_BREZ_POTRDITVE' // naprava je ukaz sprejela, a ne vrne stanja
  | 'NI_PODPRE'
  | 'NAPAKA'

export interface TorchIzid {
  stanje: StanjeTorcha
  /** Slovensko sporočilo, ki monterju pove STANJE in napotek, ne tehnične izjeme. */
  sporocilo: string
}

/**
 * Zmožnosti iz tracka in števila vidnih kamer.
 *
 * `vidniVhodi` je število `videoinput` naprav, ki jih je `enumerateDevices()`
 * vrnila v ZAVARJENEM kontekstu; `null` pomeni »podatka ni« (npr. http →
 * brskalnik vrne prazne deviceId-e), zato je odgovor NI_DOKAZA in ne »1 kamera«.
 */
export function zmogljivostiKamere (track: TrackLike | null | undefined, vidniVhodi: number | null): ZmogljivostiKamere {
  let cap: Record<string, unknown> | null = null
  if (track && typeof track.getCapabilities === 'function') {
    try {
      const surova = track.getCapabilities()
      cap = surova && typeof surova === 'object' ? surova as Record<string, unknown> : null
    } catch { cap = null }
  }
  // `torch` je po specifikaciji boolean (`true`), a brskalnik ga zna vrniti tudi
  // kot seznam vrednosti. Kadar dokaza ni (API manjka ali izjema), NI_DOKAZA.
  const torchDokaz = cap !== null
    && (cap.torch === true || (Array.isArray(cap.torch) && cap.torch.length > 0))
  const torch: StanjeZmogljivosti = cap === null ? 'NI_DOKAZA' : torchDokaz ? 'PODPRTO' : 'NI_PODPRE'

  let preklop: StanjeZmogljivosti = 'NI_DOKAZA'
  let razlogPreklopa: ZmogljivostiKamere['razlogPreklopa'] = 'brez-podatka'
  if (vidniVhodi === null) {
    razlogPreklopa = 'nezavarjen-kontekst'
  } else if (vidniVhodi >= 2) {
    preklop = 'PODPRTO'
    razlogPreklopa = 'vec-kamer'
  } else {
    preklop = 'NI_PODPRE'
    razlogPreklopa = 'ena-kamera'
  }
  // R550: zoom in tap-to-focus iz ISTEGA potrditvenega vira (getCapabilities).
  // focusMode je po raziskavi (Dynamsoft/MDN) Chrome-Android — seznam načinov
  // ostrenja mora biti neprazen, sicer zmožnosti NI dokazano.
  const zoom = zoomRazpon(cap)
  const focusSeznam = cap !== null && Array.isArray(cap.focusMode) && cap.focusMode.length > 0
  const fokus: StanjeZmogljivosti = cap === null ? 'NI_DOKAZA' : focusSeznam ? 'PODPRTO' : 'NI_PODPRE'
  return { torch, preklop, razlogPreklopa, zoom, fokus }
}

/** Naslednja smer preklopa (brez domneve o tem, katera kamera je privzeta). */
export function naslednjaSmer (trenutna: SmerKamere): SmerKamere {
  return trenutna === 'environment' ? 'user' : 'environment'
}

export function napisSmeri (smer: SmerKamere): string {
  return smer === 'environment' ? 'zadnja kamera' : 'sprednja kamera'
}

/**
 * Prižgi/ugasni bliskavico in POVEDI, ali je bil ukaz potrjen.
 *
 * Naprava, ki `applyConstraints` sprejme, a ne vrača `getContext`, dobi
 * SPREJETO_BREZ_POTRDITVE — UI to pokaže kot »poskus« in ne kot dokazano
 * stanje (issue #7 §7: brez lažnih stanj).
 */
export async function nastaviTorch (track: TrackLike | null | undefined, vklopljen: boolean): Promise<TorchIzid> {
  const zmo = zmogljivostiKamere(track, null)
  if (!track || typeof track.applyConstraints !== 'function' || zmo.torch !== 'PODPRTO') {
    return {
      stanje: 'NI_PODPRE',
      sporocilo: 'Ta naprava bliskavice v brskalniku ne podpira — meritev lahko nadaljuješ brez nje.',
    }
  }
  try {
    await track.applyConstraints({ advanced: [{ torch: vklopljen }] })
  } catch {
    return {
      stanje: 'NAPAKA',
      sporocilo: vklopljen
        ? 'Bliskavice ni bilo mogoče prižgati — poskusi z zunanjo svetlobo ali z nalaganjem fotografije.'
        : 'Bliskavice ni bilo mogoče ugasniti — zajem lahko nadaljuješ, svetloba pa ostane prižgana.',
    }
  }
  let kontekst: Record<string, unknown> | null = null
  if (typeof track.getContext === 'function') {
    try {
      const surovo = track.getContext()
      kontekst = surovo && typeof surovo === 'object' ? surovo as Record<string, unknown> : null
    } catch { kontekst = null }
  }
  const potrjeno = kontekst !== null && typeof kontekst.torch === 'boolean'
  if (!potrjeno) {
    return {
      stanje: 'SPREJETO_BREZ_POTRDITVE',
      sporocilo: vklopljen
        ? 'Ukaz za bliskavico je bil posredovan; naprava stanja ne potrjuje — preveri v kadru, ali sveti.'
        : 'Ukaz za izklop bliskavice je bil posredovan; naprava stanja ne potrjuje.',
    }
  }
  const stanje: StanjeTorcha = (kontekst as { torch: boolean }).torch ? 'VKLOPLJEN' : 'IZKLOPLJEN'
  return {
    stanje,
    sporocilo: stanje === 'VKLOPLJEN' ? 'Bliskavica prižgana (potrdila naprava).' : 'Bliskavica ugasnjena (potrdila naprava).',
  }
}

/**
 * Steje video vhode iz `enumerateDevices` rezultata. Vhodi brez `deviceId`
 * (nezavarjen kontekst) se NE štejejo kot kamera, ker jih brskalnik ne razloči —
 * brez te omejitve bi bila trditev »ima samo eno kamero« lažna.
 */
export function prestejVideoVhode (
  devices: Array<{ kind?: string; deviceId?: string }> | null | undefined,
  zavarjenKontekst: boolean,
): number | null {
  if (!Array.isArray(devices) || !zavarjenKontekst) return null
  return devices.filter((d) => d.kind === 'videoinput' && typeof d.deviceId === 'string' && d.deviceId.length > 0).length
}

/**
 * R550: prižgi približevanje na vrednost znotraj POTRJENEGA razpona.
 * Vrednost se priščeta na `step` od `min` (enako kot drsnik v brskalnikih
 * najboljših implementacij — web.dev PTZ); ukaz je lahko zavrnjen, takrat
 * ostane staro stanje in monterju povedana rešitev.
 */
export async function nastaviZoom (track: TrackLike | null | undefined, zeljena: number): Promise<{ uspesno: boolean; sporocilo: string; uporabljena: number | null }> {
  if (!track || typeof track.getCapabilities !== 'function') return { uspesno: false, sporocilo: 'Približevanje ni potrjeno — zajem poteka brez njega.', uporabljena: null }
  let cap: Record<string, unknown> | null = null
  try {
    const surova = track.getCapabilities()
    cap = surova && typeof surova === 'object' ? surova as Record<string, unknown> : null
  } catch { cap = null }
  const r = zoomRazpon(cap)
  if (r.stanje !== 'PODPRTO' || typeof track.applyConstraints !== 'function') {
    return { uspesno: false, sporocilo: 'Ta naprava približevanja v brskalniku ne podpira — približaj se fizično.', uporabljena: null }
  }
  // priščeta vrednost: od min v korakih step, ograjena na [min, max]
  const korakov = Math.round((zeljena - r.min) / r.step)
  const uporabljena = Math.min(r.max, Math.max(r.min, r.min + korakov * r.step))
  try {
    await track.applyConstraints({ advanced: [{ zoom: uporabljena }] })
    return { uspesno: true, sporocilo: `Približanje ${(Math.round((uporabljena / r.min) * 10) / 10).toFixed(1)}× od najmanjšega.`, uporabljena }
  } catch {
    return { uspesno: false, sporocilo: 'Približevanja ni bilo mogoče nastaviti — poskusi znova ali se približaj fizično.', uporabljena: null }
  }
}

/**
 * R550: tap-to-focus — POSKUS, ne dokaz. pointsOfInterest NI del capabilities
 * (brskalnik ga ne more potrditi), zato je sporočilo pošteno: ukaz je bil
 * posredovan, izid monter preveri v kadru. Klical se le, kadar je focusMode
 * potrjen (Chrome Android).
 */
export async function poskusiOstrenje (track: TrackLike | null | undefined, tocka: { x: number; y: number }): Promise<{ stanje: 'POSKUS' | 'NI_PODPRE' | 'NAPAKA'; sporocilo: string }> {
  if (!track || typeof track.getCapabilities !== 'function') return { stanje: 'NI_PODPRE', sporocilo: 'Ostrenje na točko ni podprto — naprava ostri sama.' }
  let cap: Record<string, unknown> | null = null
  try {
    const surova = track.getCapabilities()
    cap = surova && typeof surova === 'object' ? surova as Record<string, unknown> : null
  } catch { cap = null }
  if (cap === null || !Array.isArray(cap.focusMode) || cap.focusMode.length === 0 || typeof track.applyConstraints !== 'function') {
    return { stanje: 'NI_PODPRE', sporocilo: 'Ostrenje na točko ni podprto — naprava ostri sama.' }
  }
  const x = Math.min(1, Math.max(0, Number.isFinite(tocka.x) ? tocka.x : 0.5))
  const y = Math.min(1, Math.max(0, Number.isFinite(tocka.y) ? tocka.y : 0.5))
  try {
    await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }, { pointsOfInterest: [{ x, y }] }] })
    return { stanje: 'POSKUS', sporocilo: 'Poskus ostrenja na izbrano točko je posredovan — preveri v kadru, ali je ostrina dobra.' }
  } catch {
    return { stanje: 'NAPAKA', sporocilo: 'Ostrenja na točko ni bilo mogoče posredovati — ostri se s premikanjem kamere.' }
  }
}

/**
 * R550: napaka getUserMedia po IMENU (MDN) — vsak vzrok ima svoje, ukrepajoče
 * sporočilo. Generična »kamera ni dosegljiva« monterju ne pove, kaj storiti.
 */
export function razloziNapakoKamere (napaka: unknown): { naslov: string; opis: string } {
  const ime = napaka instanceof Error ? napaka.name : typeof (napaka as { name?: unknown })?.name === 'string' ? (napaka as { name: string }).name : ''
  switch (ime) {
    case 'NotAllowedError':
      return {
        naslov: 'Dovoljenje za kamero je zavrnjeno.',
        opis: 'V nastavitvah brskalnika (ikona ključavnice ob naslovu) dovoli kamero za to stran in poskusi znova.',
      }
    case 'NotFoundError':
      return {
        naslov: 'Kamere ni bilo mogoče najti.',
        opis: 'Naprava nima vidne kamere — uporabi nalaganje fotografije ali izberi obstoječo.',
      }
    case 'NotReadableError':
      return {
        naslov: 'Kamera je zasedena.',
        opis: 'Druga aplikacija uporablja kamero — zapri jo in poskusi znova, ali naloži fotografijo.',
      }
    case 'OverconstrainedError':
      return {
        naslov: 'Kamera ne zmore zahteve.',
        opis: 'Naprava ne ponudi tražene slike — poskusi znova ali naloži fotografijo.',
      }
    case 'SecurityError':
      return {
        naslov: 'Kamera zahteva varno povezavo.',
        opis: 'Stran ni v zavarovanem kontekstu (https) — uporabi nalaganje fotografije.',
      }
    default:
      return {
        naslov: 'Kamera ni dosegljiva.',
        opis: 'Uporabite nalaganje fotografije ali izberite obstoječo.',
      }
  }
}

/**
 * Kratka slovenska oznaka za statusno vrstico (nič ne obljublja več, kot vemo).
 * R550: zoom in ostrenje se omenita SAMO, kadar ju je naprava potrdila.
 */
export function napisZmogljivosti (zmo: ZmogljivostiKamere): string {
  const t = zmo.torch === 'PODPRTO' ? 'bliskavica' : zmo.torch === 'NI_PODPRE' ? 'brez bliskavice' : 'blaskavica ni potrjena'
  const p = zmo.preklop === 'PODPRTO' ? 'zamenjava kamer' : zmo.preklop === 'NI_PODPRE' ? 'samo ena kamera' : 'zamenjava ni potrjena'
  const deli = [`${t} · ${p}`]
  if (zmo.zoom?.stanje === 'PODPRTO') deli.push('približevanje')
  if (zmo.fokus === 'PODPRTO') deli.push('ostrenje na točko')
  return deli.join(' · ')
}
