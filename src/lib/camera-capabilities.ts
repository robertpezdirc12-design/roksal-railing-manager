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
  return { torch, preklop, razlogPreklopa }
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

/** Kratka slovenska oznaka za statusno vrstico (nič ne obljublja več, kot vemo). */
export function napisZmogljivosti (zmo: ZmogljivostiKamere): string {
  const t = zmo.torch === 'PODPRTO' ? 'bliskavica' : zmo.torch === 'NI_PODPRE' ? 'brez bliskavice' : 'bliskavica ni potrjena'
  const p = zmo.preklop === 'PODPRTO' ? 'zamenjava kamer' : zmo.preklop === 'NI_PODPRE' ? 'samo ena kamera' : 'zamenjava ni potrjena'
  return `${t} · ${p}`
}
