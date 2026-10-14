/**
 * EXIF orientacija (issue #15, faza 4 — nevarnost H8 iz
 * `docs/MEASUREMENT-BASELINE.md` §5).
 *
 * Izmerjene količine se računajo iz pikslov. Če slikovni prostor (točke, ki
 * jih monter klika na zaslonu) NI isti kot piksli, ki jih vidiš na sliki, je
 * vsaka številka sistematicno napačna — pri 90° zamenjavi tudi za faktor
 * širina/višina. Brskalniki danes EXIF orientacijo uporabijo samodejno, a
 * NI JAMSTVO: odvisno je od brskalnika in izvedbe kodeka. Zato se orientacija
 * ne predpostavlja, ampak PREBERE IN PREVERI.
 *
 * Čist modul: brez DOM-a, brez odvisnosti, determinističen (isti vhod →
 * ista ugotovitev), testljiv na sintetičnih JPEG datotekah
 * (`tests/r503.py` blok N).
 */

/** EXIF orientation vrednosti 1..8 (CIPA DC-008). Ničla = podatek ni najden. */
export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface RawSize { w: number; h: number }

/** Ali orientacija zamenja širino in višino (5..8 = 90° ali 270°). */
export function swapsAxes (o: Orientation | number | null): boolean {
  return o === 5 || o === 6 || o === 7 || o === 8
}

const be16 = (b: Uint8Array, i: number, le: boolean): number =>
  le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]

const be32 = (b: Uint8Array, i: number, le: boolean): number =>
  le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
    : ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0

/**
 * Preberi EXIF `Orientation` (tag 0x0112) iz JPEG bajtov.
 *
 * Oblika: SOI (FF D8) → verižni segmenti; iščemo APP1 (FF E1) z začetkom
 * `Exif\0\0`, nato TIFF glavo (II/MM + magic 42) in IFD0 vnose. Vrne `null`,
 * kadar orientacije ni, datoteka ni JPEG ali pa je glava pokvarjena —
 * takrat je treba ravnati, kot da podatka NI, in ne kot z orientacijo 1.
 */
export function parseExifOrientation (b: Uint8Array): Orientation | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  const max = b.length - 1
  while (i < max) {
    if (b[i] !== 0xff) { i++; continue }
    const marker = b[i + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
    if (marker === 0xda || marker === 0xd9) return null // začetek slikovnih podatkov → ni več metapodatkov
    if (i + 4 > b.length) return null
    const len = be16(b, i + 2, false)
    if (len < 2 || i + 2 + len > b.length) return null
    if (marker === 0xe1 && len >= 8 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66 && b[i + 8] === 0 && b[i + 9] === 0) {
      return readTiffOrientation(b, i + 10, i + 2 + len)
    }
    i += 2 + len
  }
  return null
}

/** IFD0 se razčleni samo zaradi orientacije — ostali tagi niso potrebni. */
function readTiffOrientation (b: Uint8Array, tiff: number, end: number): Orientation | null {
  if (tiff + 8 > end) return null
  const c0 = b[tiff]; const c1 = b[tiff + 1]
  if (c0 === 0x49 && c1 === 0x49) { /* II */ } else if (c0 === 0x4d && c1 === 0x4d) { /* MM */ } else return null
  const le = c0 === 0x49
  if (be16(b, tiff + 2, le) !== 42) return null
  const ifd0 = be32(b, tiff + 4, le)
  const countAt = tiff + ifd0
  if (ifd0 <= 0 || countAt + 2 > end) return null
  const n = be16(b, countAt, le)
  for (let k = 0; k < n; k++) {
    const e = countAt + 2 + k * 12
    if (e + 12 > end) return null
    if (be16(b, e, le) !== 0x0112) continue
    const v = be16(b, e + 8, le) // SHORT, vrednost je v prvih dveh bajtih polja
    return v >= 1 && v <= 8 ? (v as Orientation) : null
  }
  return null
}

/**
 * Dimenzije, kot jih opisuje JPEG SOF0..SOF15 — torej PRED morebitno EXIF
 * zamenjavo osi. `null` za progresivne/eksotične kodeke ali ne-JPEG.
 */
export function parseJpegFrameSize (b: Uint8Array): RawSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  const max = b.length - 1
  while (i < max) {
    if (b[i] !== 0xff) { i++; continue }
    const marker = b[i + 1]
    if (marker === 0xda || marker === 0xd9) return null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
    if (i + 4 > b.length) return null
    const len = be16(b, i + 2, false)
    if (len < 2 || i + 2 + len > b.length) return null
    const sof = (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (sof && len >= 9) {
      return { h: be16(b, i + 5, false), w: be16(b, i + 7, false) }
    }
    i += 2 + len
  }
  return null
}

export type OrientationStatus = 'NI_PODATKA' | 'PRAVOKOTNA' | 'UPORABLJENA' | 'NEUPORABLJENA' | 'NI_DOKAZA'

export interface OrientationCheck {
  /** EXIF orientacija ali `null`, kadar je ni. */
  exif: Orientation | null
  /** Dimenzije kot jih opisuje JPEG (pred orientacijo) ali `null`. */
  raw: RawSize | null
  /** Dimenzije, ki jih upošteva brskalnik (npr. `img.naturalWidth`). */
  natural: RawSize
  status: OrientationStatus
  /** Besedilo, ki ga vidi monter — NE trdi več, kot je preverjeno. */
  razlog: string
  /** Ali mora klicatelj rotacijo izvesti SAM (brskalnik je ni). */
  popraviRočno: boolean
}

/**
 * Preveri, ali slikovni prostor (kar brskalnik prikaže) soglaša z EXIF
 * orientacijo. Deterministično in brez DOM API-jev — primerjajo se samo
 * dimenzije.
 */
export function checkOrientation (exif: Orientation | null, raw: RawSize | null, natural: RawSize): OrientationCheck {
  const base = { exif, raw, natural, popraviRočno: false }
  if (exif === null || exif === 1) {
    return {
      ...base, exif,
      status: exif === 1 ? 'PRAVOKOTNA' : 'NI_PODATKA',
      razlog: exif === 1
        ? 'Slika je ravna (EXIF orientacija 1) — pikselni prostor je prikazani prostor.'
        : 'EXIF orientacije ni v datoteki — pikselni prostor je prikazani prostor.',
    }
  }
  if (!raw || raw.w <= 0 || raw.h <= 0) {
    return {
      ...base, status: 'NI_DOKAZA',
      razlog: `EXIF pravi orientacijo ${exif}, izvirnih dimenzij kodeka pa ni bilo mogoče prebrati — usklajenost ni dokazana.`,
    }
  }
  if (!swapsAxes(exif)) {
    // 2/3/4 (zrcaljenje, 180°): dimenzije se NE spremenijo, zato jih primerjava
    // ne more dokazati. Pošteno: NI_DOKAZA, ne »v redu«.
    return {
      ...base, status: 'NI_DOKAZA',
      razlog: `EXIF orientacija ${exif} (zrcaljenje ali vrtljaj za 180°) dimenzij ne zamenja — s primerjavo širine in višine ni dokazati, da jo je brskalnik upošteval.`,
    }
  }
  const swapped = natural.w === raw.h && natural.h === raw.w
  const unswapped = natural.w === raw.w && natural.h === raw.h
  if (swapped) {
    return {
      ...base, status: 'UPORABLJENA',
      razlog: `EXIF orientacija ${exif} je UPORABLJENA (širina in višina sta zamenjani) — merjene točke in piksli so v istem prostoru.`,
    }
  }
  if (unswapped) {
    return {
      ...base, status: 'NEUPORABLJENA', popraviRočno: true,
      razlog: `EXIF pravi 90°/270° obrat (orientacija ${exif}), a brskalnik ga NI uporabil — brez popravka bi monter meril na zavrtih pikslih.`,
    }
  }
  return {
    ...base, status: 'NI_DOKAZA',
    razlog: `Dimenzije slike (${natural.w}×${natural.h}) se ne ujemajo niti z izvirnimi dimenzijami niti z zamenjanimi (raw ${raw.w}×${raw.h}) — orientacije ni mogoče razložiti.`,
  }
}

/** Preveri neposredno iz bajtov (poveže `parseExifOrientation` + `parseJpegFrameSize`). */
export function checkOrientationFromBytes (bytes: Uint8Array, natural: RawSize): OrientationCheck {
  return checkOrientation(parseExifOrientation(bytes), parseJpegFrameSize(bytes), natural)
}

/** Canvas dimenzije, ko rotacijo izvedemo SAMI (za 5..8 zamenja osi; drugače vrne enake). */
export function normalizedSize (natural: RawSize, exif: Orientation | null): RawSize {
  return swapsAxes(exif) ? { w: natural.h, h: natural.w } : { w: natural.w, h: natural.h }
}

/**
 * Transformacijska matrika `[a,b,c,d,e,f]` za `ctx.transform`, ki nariše
 * piksle v ORIENTIRANI prostor (uporabi se SAMO, kadar je status
 * `NEUPORABLJENA` — sicer je rotacijo že izvedel brskalnik).
 */
export function orientationMatrix (exif: Orientation, w: number, h: number): [number, number, number, number, number, number] {
  switch (exif) {
    case 2: return [-1, 0, 0, 1, w, 0]
    case 3: return [-1, 0, 0, -1, w, h]
    case 4: return [1, 0, 0, -1, 0, h]
    case 5: return [0, 1, 1, 0, 0, 0]
    case 6: return [0, 1, -1, 0, h, 0]
    case 7: return [0, -1, -1, 0, h, w]
    case 8: return [0, -1, 1, 0, 0, w]
    default: return [1, 0, 0, 1, 0, 0]
  }
}
