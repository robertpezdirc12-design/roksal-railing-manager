// R511 (issue #7 §8/§10 in issue #3 §4E): kosovnica sme biti izpeljana PO
// SEGMENTIH tudi, kadar obseg ni prišel iz konfiguratorja, ampak iz POTRJENEGA
// ograjnega tekača, ki je vezan na isto mero.
//
// MODUL JE NAMENOMA ČIST (brez Prisma, brez DOM-a): odloči SAMO, ali je
// geometrija tekača sploh uporabna kot vir segmentov, in jo pretvori v ISTI
// m-format (`RawSegmentRow`), ki ga že danes razume `normalizeSegments` →
// `planBom`. Količin, cen, marž ali pravil tu NE računamo — sicer bi nastalo
// drugo merilno/cenovno jedro, kar issue #7 izrecno prepoveduje.
//
// Fail-closed pravila (brez tihe domišljije in brez tiha pada na predlogo):
//   • konfiguratorjevi segmenti IMAJO prednost — če paket že nosi svoje
//     vhodne segmente (`calcJson.inputs.segments`), se jih NE dotikamo;
//   • tekač mora biti POTRJEN (`status === 'POTRJEN'`) — OSNUTEK/PREGLED/ARHIV
//     ni dokazan obseg;
//   • na mero sme viseti NATANČENO EN potrjeni tekač: dva bi bila dva vira
//     resnice, sistem ne sme izbrati enega namesto pisarn;
//   • vsak segment mora imeti poslovno uporabno raven (ista vrata kot R501:
//     `measurementStatusAllowsBusiness`) — sicer bi bil dele kosovnice iz
//     ocene;
//   • veriga mora biti zaprta in urejena (od 0 navzgor, brez pretrga in
//     brez prekrivanja); poškodovana veriga NE SME roditi količin;
//   • dolžine morajo biti pozitivne; višina je lahko null — takrat obstoječa
//     matematika sama izpusti `POLNILO_M2` z opozorilom `BREZ_VISINE`;
//   • razmik stebrov se tu NE izmišljuje: če ga paket nima, naj ga
//     obstoječa pot razreši iz pravila ali pa javi `BREZ_RAZMIKA`.
//   • vsak odlok (zavrnitev ali sprejem) nosi razlog, ki ga pišemo v
//     kalkulacijo —
//     odločitev mora biti sledljiva tudi čez tri mesece.

import { measurementStatusAllowsBusiness } from '@/lib/measure-engine'
import type { RawSegmentRow } from '@/lib/segment-bom'

export const GEOMETRY_SOURCE_VERSION = 'measure-geometry-source/1.0'

/** Potrjeni tekač, kot ga potrebuje odločitev (strežnik ga prebere iz baze). */
export interface TekocZaGeometrijo {
  id: string
  status: string | null
  projectId: string | null
  /** segmenti v vrstnem redu teka (strežnik jih razvrsti po `order`) */
  segmenti: SintSegmentaZaGeometrijo[]
}

export interface SintSegmentaZaGeometrijo {
  order: number
  fromAtCm: number | null
  toAtCm: number | null
  lengthCm: number | null
  heightCm: number | null
  /** raven mere segmenta (ista lestvica kot meritev — en vir resnice) */
  status: string | null
}

/** Segment, ki je že prestal preverjanje verige (polja so zagotovljena). */
interface PreverjeniSegment {
  order: number
  zacetek: number
  konec: number
  dolzina: number
  visina: number | null
  status: string | null
}

export interface VhodGeometrije {
  paketProjectId: string
  /** ali paket že nosi konfiguratorjeve segmente (calcJson.inputs.segments) */
  paketZeImaSegmente: boolean
  razmikStebrovCm: number | null
  tekoci: TekocZaGeometrijo[]
}

export interface OdlokGeometrije {
  odlok: 'KONFIGURATOR' | 'TEKOC' | 'PREDLOGA'
  razlog: string
  /** m-format segmentov za obstoječi `normalizeSegments` (prazno = brez) */
  rows: RawSegmentRow[]
  fenceRunId: string | null
  /** cm vsote merjenih dolžin segmentov (null, kadar obsega ni) */
  dolzinaCm: number | null
  /** razmik stebrov v cm, ki ga sme sprejeti obstoječa matematika */
  razmikStebrovCm: number | null
  opozorila: string[]
}

const solidno = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v)

const zavrni = (razlog: string, opozorila: string[] = []): OdlokGeometrije => ({
  odlok: 'PREDLOGA', razlog, rows: [], fenceRunId: null, dolzinaCm: null,
  razmikStebrovCm: null, opozorila,
})

/**
 * Odloči, ali in kako sme geometrija ograjnega tekača napajati segmentno
 * kosovnico. Vedno vrne razlog; `PREDLOGA` NI napaka — je pošten padec na
 * današnje obnašanje (predloga × količina), zapisan v kalkulacijo.
 */
export function izberiGeometrijo (vhod: VhodGeometrije): OdlokGeometrije {
  if (vhod.paketZeImaSegmente) {
    return {
      odlok: 'KONFIGURATOR',
      razlog: 'Paket že nosi segmente iz konfiguratorjevih vhodov — tekač jih ne prepisuje.',
      rows: [], fenceRunId: null, dolzinaCm: null,
      razmikStebrovCm: solidno(vhod.razmikStebrovCm) && vhod.razmikStebrovCm > 0 ? vhod.razmikStebrovCm : null,
      opozorila: [],
    }
  }

  const tekoci = Array.isArray(vhod.tekoci) ? vhod.tekoci : []
  if (tekoci.length === 0) {
    return zavrni('Meritev nima ograjnega tekača, zato obsega ni iz česa izpeljati — kosovnica ostane predloga × količina.')
  }

  const potrjeni = tekoci.filter((t) => t.status === 'POTRJEN')
  if (potrjeni.length === 0) {
    const stanja = tekoci.map((t) => `${t.id} (${t.status ?? 'brez stanja'})`).join(', ')
    return zavrni(`Noben tekač na tej meri ni POTRJEN — osnutek ali arhiv ni dokazan obseg. Tekači: ${stanja}.`)
  }
  if (potrjeni.length > 1) {
    return zavrni(
      `Na to meritev visi ${potrjeni.length} potrjenih tekačev (${potrjeni.map((t) => t.id).join(', ')}). Dvoje potrjenih tekačev je dva vira resnice — izberite enega v pisarni, ne ugibamo.`,
      ['VECPOTRJENIH'],
    )
  }

  const tekoc = potrjeni[0]
  const opozorila: string[] = []
  if (tekoc.projectId !== vhod.paketProjectId) {
    return zavrni('Tekač ne pripada projektu paketa — njegove geometrije ne smemo uporabiti drugje.', ['TUJI_PROJEKT'])
  }

  const robovi = tekoc.segmenti
  if (!Array.isArray(robovi) || robovi.length === 0) {
    return zavrni('Potrjeni tekač nima segmentov — iz prazne verige ne računamo količin.', ['BREZ_SEGMENTOV'])
  }

  // 1) urejenost in zaprtost verige
  const urejeni = [...robovi].sort((a, b) => a.order - b.order)
  if (urejeni[0].order !== 0) {
    return zavrni(`Veriga se ne začne pri 0 (prvi segment je ${urejeni[0].order}) — vrstni red je poškodovan in ne sme roditi količin.`, ['PRETRGANA_VERIGA'])
  }
  let kup = 0
  const preverjeni: PreverjeniSegment[] = []
  for (let i = 0; i < urejeni.length; i++) {
    const s = urejeni[i]
    if (s.order !== i) {
      return zavrni(`Vrstni red segmentov ni zaporeden (pričakovano ${i}, dobili ${s.order}) — verige ne razpolovimo.`, ['PRETRGANA_VERIGA'])
    }
    if (!solidno(s.lengthCm) || s.lengthCm <= 0) {
      return zavrni(`Segment ${s.order} nima veljavne dolžine — poškodovanega segmenta ne zaokrožimo na ničlo.`, ['BREZ_DOLZINE'])
    }
    if (!solidno(s.fromAtCm) || !solidno(s.toAtCm)) {
      return zavrni(`Segment ${s.order} nima položaja ob teku — zmanjkalo je dokaza, kjer veriga teče.`, ['BREZ_POLOZAJA'])
    }
    const zacetek = s.fromAtCm
    const konec = s.toAtCm
    const dolzina = s.lengthCm
    if (i === 0 && Math.abs(zacetek) > 1) {
      return zavrni(`Prvi segment se začne šele pri ${Math.round(zacetek)} cm — začetek teka manjka in ga ne zaokrožujemo na 0.`, ['PRETRGANA_VERIGA'])
    }
    if (preverjeni.length > 0) {
      const prejsnji = preverjeni[preverjeni.length - 1]
      const reza = zacetek - prejsnji.konec
      if (reza > 1) {
        return zavrni(`Med segmentoma ${prejsnji.order} in ${s.order} je pretrg ${Math.round(reza)} cm — kosovnice iz luknje ne delamo.`, ['PRETRGANA_VERIGA'])
      }
      if (reza < -1) {
        return zavrni(`Segmenta ${prejsnji.order} in ${s.order} se prekrivata ${Math.round(-reza)} cm — podvojenega odseka v kosovnici ne sme biti.`, ['PREKRIVANJE'])
      }
    }
    kup += dolzina
    // dolzinaCm je VSOTA merjenih dolžin (tisto, kar napaja količine),
    // ne zaključni položaj verige — ob pretrgih znotraj tolerance se razideta.
    preverjeni.push({ order: s.order, zacetek, konec, dolzina, visina: s.heightCm, status: s.status })
  }

  // 2) raven vsakega segmenta (ISTA vrata kot R501 — brez druge lestvice)
  const slabi = preverjeni.filter((s) => !measurementStatusAllowsBusiness(s.status))
  if (slabi.length > 0) {
    return zavrni(
      `Segmenti ${slabi.map((s) => `${s.order} (${s.status ?? 'brez stanja'})`).join(', ')} niso poslovno uporabni — kosovnica ne sme nastati iz ocene ali razveljavljene mere.`,
      ['SEGMENT_NI_POTRJEN'],
    )
  }

  // 3) pretvorba v obstoječi m-format (matematika ostane v segment-bom)
  const rows: RawSegmentRow[] = preverjeni.map((s) => ({
    kljuc: `seg-${s.order + 1}`,
    dolzina: Math.round(s.dolzina) / 100,
    visina: solidno(s.visina) && s.visina > 0 ? Math.round(s.visina) / 100 : null,
  }))

  const nepopolni = preverjeni.filter((s) => !(solidno(s.visina) && s.visina > 0))
  if (nepopolni.length > 0) {
    opozorila.push('BREZ_VISINE')
  }
  const razmik = solidno(vhod.razmikStebrovCm) && vhod.razmikStebrovCm > 0 ? vhod.razmikStebrovCm : null
  if (razmik === null) opozorila.push('BREZ_RAZMIKA')

  return {
    odlok: 'TEKOC',
    razlog: `Obseg je vzet iz potrjenega tekača ${tekoc.id} (${rows.length} segmentov, ${Math.round(kup)} cm izmerjenih dolžin po teku) — cene in količine računa obstoječa segmentna matematika.`,
    rows,
    fenceRunId: tekoc.id,
    dolzinaCm: Math.round(kup),
    razmikStebrovCm: razmik,
    opozorila,
  }
}
