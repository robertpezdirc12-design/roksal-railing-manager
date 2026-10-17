// R510 (issue #15 Faza 6 — «izvedene slike ... naj imajo povezavo na
// uporabljene reference»): dokazna veriga IZVEDENE slike.
//
// Zakaj obstaja: fotovizualizacija (issue #14) je že vedela, KTERO originalno
// ROKSALOVO gradivo je izbrala (`izberiGradivo`), in je preverila, da povezana
// mera sploh obstaja (`preveriMeritev`). Dokaz pa je ostal v ODJEMALCU:
// shranjena verzija je imela samo opozorila in verzijo engine-a, izvedena slika
// pa povezave do svojega izvirnika ni imela (`sourcePhotoId` je bil v UI-ju
// vedno null). Posledica: ob pregledu shranjene vizualizacije ni bilo mogoče
// podkrepiti, kateri ROKSALOV izvirnik je bil uporabljen in na kateri meri
// slika stoji.
//
// Načela (ista kot #14, #15, #7):
//  - TRDITEV ODJEMALCA NI DOKAZ: odjemalec sme SAMO povedati, katero gradivo se
//    mu je zdelo uporabljeno. STREŽNIK ga mora znova prebrati iz baze in sme v
//    dokument zapisati samo to, kar je sam potrdil (status VERIFIED, dejanska
//    pot do izvirnika, dejanski SHA-256, zapisana podlaga dovoljenja, pravi
//    izdelek).
//  - FAJL-ZAPRTO: kadar potrditve ni, se v dokument zapiše RAZLOG zavrnitve, ne
//    izmišljen dokaz in ne tiho prazno polje — slednje bi bralcu pustilo vtis,
//    da je dokaz obstajal.
//  - BREZ NOVEGA JEDRA: nič cen, nič novih stolpcev, nič migracij. Dokaz gre v
//    že obstoječi JSON (`PhotoVisualizationVersion.data.meta`); izvirnik mere
//    ostaja `Measurement`, izvirnik gradiva `ProductAsset`.
//  - VIZUALIZACIJA OSTANE PREDSTAVITEV: ta modul NE dokazuje mer, NE proizvaja
//    količin in NE posega v kosovnico/cenik — to niso njegovi viri.

import { asJsonObject } from '@/lib/json'

/** Trditev odjemalca: «pri izrisu je bilo uporabljeno TO gradivo». */
export interface TrdnjaGradiva {
  assetId: string
}

/** Minimalni presek `ProductAsset` za potrjevanje (brez Prisma tipov — testable). */
export interface GradivoIzBaze {
  id: string
  productId: string | null
  kind: string
  status: string
  permission: string
  filePath: string | null
  sha256: string | null
}

/** Kaj SME priti v dokument — samo strežniško potrjene vrednosti. */
export interface PotrjenDokaz {
  assetId: string
  kind: string
  pot: string
  sha256: string
}

export interface RezultatGradiva {
  /** potrjen dokaz ali null (null = v dokumentu NI dokaza o gradivu) */
  dokaz: PotrjenDokaz | null
  /** zakaj dokaza ni — pri null VEDNO neprazno, da ga lahko pokažemo uporabniku */
  razlog: string | null
}

/**
 * Dokazna veriga IZVEDENE slike — gre v `PhotoVisualizationVersion.data.meta.dokaz`.
 * Stari zapisi dokaza NIMajo (`null`): njemu se ne prisoja dokaz, ki ob
 * nastanku ni bil zapisan — branje ga pokaže kot »verige ni«.
 */
export interface VizDokaz {
  /** na kateri meri in na kateri njeni ravni/verziji slika stoji (null = brez mere) */
  meritev: { status: string; verzija: number | null } | null
  /** meritev tipa FOTO, ki je izvirnik fotografije (null = naložena datoteka) */
  izvirnikFotografije: string | null
  /** strežniško potrjeno ROKSALOVO gradivo (null = dokaza ni) */
  gradivo: PotrjenDokaz | null
  /** zakaj dokaza o gradivu ni — neprazno, kadar je bila trditev nepotrdljiva */
  gradivoRazlog: string | null
}

const jeId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64

/**
 * Oblika trditve odjemalca. `null`/izpuserno = NI trditve — stare stranke in
 * vizualizacije brez preverjenega gradiva se obnašajo enako kot doslej.
 * Drugo mora biti TOČNO `{ assetId }`: poti in SHA-256 odjemalec NE sme
 * podajati, ker bi tako podtiskal tuj identifikator namesto baze.
 */
export function normalizirajTrdnjo (v: unknown): { napaka: string } | { trdnja: TrdnjaGradiva | null } {
  if (v === undefined || v === null) return { trdnja: null }
  if (typeof v !== 'object' || Array.isArray(v)) {
    return { napaka: 'Trditev o gradivu mora biti predmet oblike { assetId }.' }
  }
  const o = v as Record<string, unknown>
  const nepoznani = Object.keys(o).filter((k) => k !== 'assetId')
  if (nepoznani.length > 0) {
    return { napaka: `Trditev o gradivu sme vsebovati samo assetId — nepoznana polja: ${[...new Set(nepoznani)].sort().join(', ')}.` }
  }
  if (!jeId(o.assetId)) return { napaka: 'Trditev o gradivu mora vsebovati veljaven assetId.' }
  return { trdnja: { assetId: o.assetId } }
}

/**
 * Strežniška POTRDITEV trditve. `vrstica` je zapis, ki ga je route vrnil iz
 * baze (`null`, kadar id v bazi ne obstaja); `productIdVizualizacije` je
 * izdelek, na katerem vizualizacija stoji. Dokument nastane IZKLJUČNO iz teh
 * podatkov.
 */
export function potrdiGradivo (
  trdnja: TrdnjaGradiva | null,
  vrstica: GradivoIzBaze | null,
  productIdVizualizacije: string | null
): RezultatGradiva {
  if (trdnja === null) return { dokaz: null, razlog: null }
  if (vrstica === null) {
    return { dokaz: null, razlog: `Trjeno gradivo (assetId ${trdnja.assetId}) v katalogu ne obstaja — dokaza o izvirniku ni zapisano.` }
  }
  if (vrstica.id !== trdnja.assetId) {
    return { dokaz: null, razlog: `Prebrano gradivo (${vrstica.id}) ne ustreza trditvi (${trdnja.assetId}) — dokaza ne zapisujemo.` }
  }
  if (vrstica.status !== 'VERIFIED') {
    return { dokaz: null, razlog: `Gradivo ${vrstica.id} nima statusa VERIFIED (status: ${vrstica.status}) — kot izvirnik ga ne dokazujemo.` }
  }
  if (typeof vrstica.permission !== 'string' || vrstica.permission.trim() === '') {
    return { dokaz: null, razlog: `Gradivo ${vrstica.id} nima zapisane podlage dovoljenja — dokaza o izvirniku ne zapisujemo.` }
  }
  if (typeof vrstica.filePath !== 'string' || vrstica.filePath.length === 0) {
    return { dokaz: null, razlog: `Gradivo ${vrstica.id} je preverjeno, a datoteka izvirnika v bazi ni zapisana — brez poti ni dokaza.` }
  }
  if (typeof vrstica.sha256 !== 'string' || vrstica.sha256.length < 16) {
    return { dokaz: null, razlog: `Gradivo ${vrstica.id} nima SHA-256 izvirnika — dokaza o nespremenjenosti ni mogoče zapisati.` }
  }
  if (productIdVizualizacije !== null && vrstica.productId !== productIdVizualizacije) {
    return {
      dokaz: null,
      razlog: `Gradivo ${vrstica.id} ne pripada izdelku te vizualizacije (${vrstica.productId ?? 'brez izdelka'}) — tuji original ne more biti dokaz.`,
    }
  }
  return {
    dokaz: { assetId: vrstica.id, kind: vrstica.kind, pot: vrstica.filePath, sha256: vrstica.sha256 },
    razlog: null,
  }
}

/**
 * Ali sme na tej meri vizualizacija SPLOH nastati. `INVALIDATED` pomeni, da je
 * pisarna mero razveljavila PO uporabi (referenca/merilo se je spremenilo) —
 * slika na njej bi trdila meritev, ki jo je pisarna umaknila. Ostale ravni so
 * dovoljene, ker je vizualizacija PREDSTAVITEV in ne proizvodni izračun;
 * njihova raven se zabeleži v dokument (`dokazMere`), da bralec ve, kako trdna
 * je bila podlaga.
 */
export function smeVizualizacijo (status: string | null | undefined): { sme: boolean; razlog: string | null } {
  if (status === 'INVALIDATED') {
    return { sme: false, razlog: 'Meritev je razveljavljena (referenca se je spremenila po uporabi) — vizualizacije na razveljavljeni meri ne ustvarjamo.' }
  }
  return { sme: true, razlog: null }
}

/** Kratek zapis o meri za dokument: na kateri verziji in na kateri ravni slika stoji. */
export function dokazMere (status: string | null | undefined, verzija: number | null): { status: string; verzija: number | null } {
  return { status: typeof status === 'string' && status.length > 0 ? status : 'NEPOZNANO', verzija }
}

/**
 * Prebere dokaz iz posnetka verzije (`PhotoVisualizationVersion.data`).
 * Fail-closed: verzija brez dokaza ali dokaz s poškodovanimi polji vrne null —
 * star zapis ne more dobiti verige, ki ob nastanku ni bila zapisana, pokvarjen
 * posnetek pa ne more podtiskati lažnega dokaza.
 * R542: data je jsonb objekt — brez JSON.parse.
 */
export function preberiDokaz (data: unknown): VizDokaz | null {
  const parsed = asJsonObject(data)
  if (!parsed) return null
  const surov = asJsonObject(parsed.meta)?.dokaz
  if (!surov || typeof surov !== 'object' || Array.isArray(surov)) return null
  const d = surov as Record<string, unknown>
  return {
    meritev: preberiMero(d.meritev),
    izvirnikFotografije: jeId(d.izvirnikFotografije) ? d.izvirnikFotografije : null,
    gradivo: preberiGradivo(d.gradivo),
    gradivoRazlog: typeof d.gradivoRazlog === 'string' && d.gradivoRazlog.trim() ? d.gradivoRazlog : null,
  }
}

function preberiMero (v: unknown): { status: string; verzija: number | null } | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const m = v as Record<string, unknown>
  return { status: typeof m.status === 'string' && m.status.length > 0 ? m.status : 'NEPOZNANO', verzija: typeof m.verzija === 'number' ? m.verzija : null }
}

function preberiGradivo (v: unknown): PotrjenDokaz | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const g = v as Record<string, unknown>
  if (!jeId(g.assetId) || typeof g.pot !== 'string' || g.pot.length === 0) return null
  if (typeof g.sha256 !== 'string' || g.sha256.length < 16) return null
  return { assetId: g.assetId, kind: typeof g.kind === 'string' ? g.kind : '', pot: g.pot, sha256: g.sha256 }
}
