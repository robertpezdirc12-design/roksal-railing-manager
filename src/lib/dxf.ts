// dxf.ts — R558 (raziskava R557, V1.3): DXF IZVOZ meritve.
//
// Najdena vrzel: konkurenta (SiteScape/Polycam/Canvas) izvaža CAD; mi smo
// imeli samo CSV/JSON/PNG. DXF je čist tekstovni format (ASCII, R12) —
// odpre se v AutoCAD-u, LibreCAD, BricsCAD, SolidWorks … brez odvisnosti.
//
// DOMENSKA ODLOČITEV (poštenost §5): DXF nosi POSLOVNO mero (m.lengthCm),
// ne izmišljenih segmentov. Segmentnih dolžin v px točkah ne moremo
// »pretentati« v cm brez skale — zato risba vsebuje:
//   • LINE  0 → lengthCm po X (layer OGRAJA)     — osnovna linija ograje
//   • LINE  odmik y=heightCm (layer ROCNIK)      — ročnik (če je znan)
//   • CIRCLE na intervalih (layer STEBRI)        — stebri (če so znani)
//   • TEXT z metapodatki (layer META)           — projekt, mere, datum, verzija
// Razviti prikaz (development view) — standard v CAD risbah ograj.
//
// Formato števila: DXF float z 2 decimalkami (toFixed(2)), decimalna PIKA
// (specifikacija — ne locale). Vsi kliči so ČISTI (testirljivi v bun).

export interface DxfLine { x1: number; y1: number; x2: number; y2: number }
export interface DxfCircle { x: number; y: number; r: number }
export interface DxfText { x: number; y: number; visina: number; vsebina: string }

export interface DxfMeta {
  naslov: string
  dolzinaCm: number | null
  visinaCm: number | null
  stebri: number | null
  naklonDeg: number | null
  projekt: string | null
  lokacija: string | null
  operater: string | null
  datum: string | null
  verzija: number | null
}

/** DXF float: fiksno 2 decimali, decimalna PIKA (specifikacija, ne locale). */
export function dxfStevilo (n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

/** LINE entiteta (koda/vrednost pari po vrsticah). */
export function dxfLine (l: DxfLine, layer: string): string[] {
  return [
    '0', 'LINE',
    '8', layer,
    '10', dxfStevilo(l.x1),
    '20', dxfStevilo(l.y1),
    '30', '0.00',
    '11', dxfStevilo(l.x2),
    '21', dxfStevilo(l.y2),
    '31', '0.00',
  ]
}

/** CIRCLE entiteta (stebri). */
export function dxfCircle (c: DxfCircle, layer: string): string[] {
  return [
    '0', 'CIRCLE',
    '8', layer,
    '10', dxfStevilo(c.x),
    '20', dxfStevilo(c.y),
    '30', '0.00',
    '40', dxfStevilo(c.r),
  ]
}

/** TEXT entiteta (metapodatki) — višina v enotah risbe. */
export function dxfText (t: DxfText, layer: string): string[] {
  return [
    '0', 'TEXT',
    '8', layer,
    '10', dxfStevilo(t.x),
    '20', dxfStevilo(t.y),
    '30', '0.00',
    '40', dxfStevilo(t.visina),
    '1', t.vsebina.slice(0, 160),
  ]
}

/**
 * Pozicije stebrov po dolžini: enakomerno po intervalu, brez dvojnih
 * končnih točk. 1 steber → [sredina]; brez dolžine/števila → [].
 * Interval izhaja IZ poslovne mere (lengthCm / (posts−1)), nikoli obratno.
 */
export function pozicijeStebrov (dolzinaCm: number | null, stebri: number | null): number[] {
  if (typeof dolzinaCm !== 'number' || !Number.isFinite(dolzinaCm) || dolzinaCm <= 0) return []
  if (typeof stebri !== 'number' || !Number.isFinite(stebri) || stebri < 1 || stebri > 200) return []
  if (stebri === 1) return [Math.round((dolzinaCm / 2) * 100) / 100]
  const korak = dolzinaCm / (stebri - 1)
  const out: number[] = []
  for (let i = 0; i < stebri; i++) {
    out.push(Math.round(i * korak * 100) / 100)
  }
  return out
}

/**
 * Celotna DXF (R12 ASCII): SECTION ENTITIES z LINE/CIRCLE/TEXT + ENDSEC/EOF.
 * Entitete so v cm (1 enota = 1 cm) — naravnost v skico za proizvodnjo.
 */
export function sestaviDxf (
  linije: Array<{ geo: DxfLine; layer: string }>,
  krogi: Array<{ geo: DxfCircle; layer: string }>,
  besedila: Array<{ geo: DxfText; layer: string }>,
): string {
  const vrstice: string[] = ['0', 'SECTION', '2', 'ENTITIES']
  for (const l of linije) vrstice.push(...dxfLine(l.geo, l.layer))
  for (const c of krogi) vrstice.push(...dxfCircle(c.geo, c.layer))
  for (const t of besedila) vrstice.push(...dxfText(t.geo, t.layer))
  vrstice.push('0', 'ENDSEC', '0', 'EOF')
  return vrstice.join('\n') + '\n'
}

/**
 * DXF vsebina iz poslovne mere meritve (razviti prikaz):
 * osnovna linija + ročnik (odmik) + stebri (krogi) + metapodatki (TEXT).
 * Vrne VEDNO veljavno DXF — brez mere je risba prazna, meta pa pove zakaj.
 */
export function dxfIzMeritve (meta: DxfMeta): string {
  const linije: Array<{ geo: DxfLine; layer: string }> = []
  const krogi: Array<{ geo: DxfCircle; layer: string }> = []
  const besedila: Array<{ geo: DxfText; layer: string }> = []

  const dolzina = typeof meta.dolzinaCm === 'number' && Number.isFinite(meta.dolzinaCm) && meta.dolzinaCm > 0
    ? meta.dolzinaCm
    : null

  if (dolzina != null) {
    linije.push({ geo: { x1: 0, y1: 0, x2: dolzina, y2: 0 }, layer: 'OGRAJA' })
    if (typeof meta.visinaCm === 'number' && meta.visinaCm > 0) {
      linije.push({ geo: { x1: 0, y1: meta.visinaCm, x2: dolzina, y2: meta.visinaCm }, layer: 'ROCNIK' })
    }
    for (const x of pozicijeStebrov(dolzina, meta.stebri)) {
      krogi.push({ geo: { x, y: 0, r: 3 }, layer: 'STEBRI' })
    }
  }

  let y = -14
  const dodajBesedilo = (vsebina: string): void => {
    besedila.push({ geo: { x: 0, y, visina: 8, vsebina }, layer: 'META' })
    y -= 12
  }
  dodajBesedilo(meta.naslov)
  dodajBesedilo(dolzina != null
    ? `Dolzina: ${dxfStevilo(dolzina)} cm${meta.visinaCm != null && meta.visinaCm > 0 ? ` · rocnik visina: ${dxfStevilo(meta.visinaCm)} cm` : ''}${meta.stebri != null && meta.stebri > 0 ? ` · stebri: ${meta.stebri}` : ''}${meta.naklonDeg != null ? ` · naklon: ${dxfStevilo(meta.naklonDeg)}°` : ''}`
    : 'Dolzina: NI PODANA — risba vsebuje samo metapodatke (poslovna mera manjka)')
  if (meta.projekt) dodajBesedilo(`Projekt: ${meta.projekt}`)
  if (meta.lokacija) dodajBesedilo(`Lokacija: ${meta.lokacija}`)
  if (meta.operater) dodajBesedilo(`Operater: ${meta.operater}`)
  dodajBesedilo(`Datum: ${meta.datum ?? '—'}${meta.verzija != null ? ` · verzija ${meta.verzija}` : ''}`)
  dodajBesedilo('ROKSAL — enote risbe: 1 = 1 cm (razviti prikaz ograje)')

  return sestaviDxf(linije, krogi, besedila)
}
