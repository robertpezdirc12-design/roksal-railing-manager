// pdf-mini — minimalen lasten generator PDF 1.4 (BREZ zunanjih paketov)
// A4 595×842 pt · standardna fonta Helvetica + Helvetica-Bold (Type1)
// · WinAnsiEncoding + /Differences za č/š/ž/Č/Š/Ž
// · koordinate iz LEVEGA ZGORNJEGA kota (interno flip: pdfY = 842 − y)
// · objekti + xref tabela + trailer → Uint8Array

export const PAGE_W = 595
export const PAGE_H = 842

export type Rgb = [number, number, number]

export const NAVY: Rgb = [0.114, 0.169, 0.243]
export const AMBER: Rgb = [0.961, 0.62, 0.043]
export const GRAY: Rgb = [0.42, 0.45, 0.5]
export const LIGHT: Rgb = [0.55, 0.58, 0.62]

// ─── kodiranje znakov → byte (WinAnsi + caron preslikave) ─────────────────────
// č/š/ž/Č/Š/Ž po dogovoru kot 0xE8/0x9A/0x9E/0xC8/0x8A/0x8E;
// ker v cp1252 č (0xE8) pomeni "è", v /Differences ta byte povežemo z glifom
// /ccaron — v vseh pregledovalnikih se izriše pravilen č.

const SPECIAL_BYTES: Record<string, number> = {
  // caron (po dogovoru 0xE8/0x9A/0x9E/0xC8/0x8A/0x8E — glifi razrešeni prek /Differences)
  'č': 0xE8, 'š': 0x9A, 'ž': 0x9E, 'Č': 0xC8, 'Š': 0x8A, 'Ž': 0x8E,
  // tipografski znaki (WinAnsi)
  '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, '‹': 0x8B, 'Œ': 0x8C, '‘': 0x91,
  '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, '›': 0x9B, 'œ': 0x9C,
}

/** Znak → byte v izhodnem nizu (null = ne znamo). */
function charByte (ch: string): number | null {
  const special = SPECIAL_BYTES[ch]
  if (special !== undefined) return special
  const code = ch.codePointAt(0) ?? 63
  if (code <= 255) return code
  // poskus: odstrani diakritike (npr. ć → c)
  const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (base.length >= 1) {
    const bc = base.codePointAt(0) ?? 63
    if (base.length === 1 && bc <= 255) return bc
  }
  return null
}

/** Niz → WinAnsi bajti (neznani znaki → '?'). */
export function encodePdf (s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(s.length)
  let n = 0
  for (const ch of s) {
    const b = charByte(ch)
    out[n++] = b ?? 63 // '?'
  }
  return out.subarray(0, n)
}

function esc (s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

// ─── širine znakov Helvetica / Helvetica-Bold (1/1000 em, vir: standardni AFM) ─
const W_DIGITS = 556

const W_UPPER_HELV: Record<string, number> = {
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
}
const W_LOWER_HELV: Record<string, number> = {
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
}
const W_PUNCT_HELV: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667,
  "'": 191, '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333,
  '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584,
  '?': 556, '@': 1015, '[': 278, '\\': 278, ']': 278, '^': 469, '_': 556,
  '`': 333, '{': 334, '|': 260, '}': 334, '~': 584,
}
const W_UPPER_BOLD: Record<string, number> = {
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 556, K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
}
const W_LOWER_BOLD: Record<string, number> = {
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278,
  j: 278, k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389,
  s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
}
const W_PUNCT_BOLD: Record<string, number> = {
  ' ': 278, '!': 333, '"': 474, '#': 556, '$': 556, '%': 889, '&': 722,
  "'": 238, '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333,
  '.': 278, '/': 278, ':': 333, ';': 333, '<': 584, '=': 584, '>': 584,
  '?': 611, '@': 975, '[': 333, '\\': 278, ']': 333, '^': 584, '_': 556,
  '`': 333, '{': 389, '|': 280, '}': 389, '~': 584,
}

function charWidthUnits (ch: string, bold: boolean): number {
  if (ch >= '0' && ch <= '9') return W_DIGITS
  const upper = bold ? W_UPPER_BOLD : W_UPPER_HELV
  const lower = bold ? W_LOWER_BOLD : W_LOWER_HELV
  const punct = bold ? W_PUNCT_BOLD : W_PUNCT_HELV
  if (upper[ch] !== undefined) return upper[ch]
  if (lower[ch] !== undefined) return lower[ch]
  if (punct[ch] !== undefined) return punct[ch]
  // diakritiki (č/š/ž/è/…) → širina osnovnega znaka
  const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (base !== ch && base.length >= 1) {
    const b = base[0]
    if (upper[b] !== undefined) return upper[b]
    if (lower[b] !== undefined) return lower[b]
    if (punct[b] !== undefined) return punct[b]
  }
  return 556
}

/** Širina niza v točkah pri podani velikosti fonta. */
export function textWidth (str: string, size: number, bold = false): number {
  let units = 0
  for (const ch of str) units += charWidthUnits(ch, bold)
  return (units / 1000) * size
}

// ─── builder ─────────────────────────────────────────────────────────────────

interface TextOpts {
  size?: number
  bold?: boolean
  color?: Rgb
  /** poravnava: 'left' (privzeto) | 'right' | 'center' — x je rob besedila */
  align?: 'left' | 'right' | 'center'
}
interface LineOpts { width?: number; color?: Rgb }
interface RectOpts { fill?: Rgb; stroke?: Rgb; width?: number }

interface PageBuf { ops: string[] }

const fmtN = (v: number): string => String(Math.round(v * 100) / 100)

export class PdfDoc {
  private pages: PageBuf[] = [{ ops: [] }]
  private active = 0
  private footerFn: ((page: number, total: number, doc: PdfDoc) => void) | null = null

  /** aktivna stran (0-based) — tja pišejo .text/.line/.rect */
  get pageIndex (): number { return this.active }

  /** Zacni novo stran (vrne indeks) in jo naredi aktivno. */
  addPage (): number {
    this.pages.push({ ops: [] })
    this.active = this.pages.length - 1
    return this.active
  }

  /** Nastavi nogo, izrisano ob build() na vsako stran (page 0-based, total). */
  footer (fn: (page: number, total: number, doc: PdfDoc) => void): void {
    this.footerFn = fn
  }

  /** Besedilo — y je osnovnica od ZGORNJEGA roba strani. */
  text (x: number, y: number, str: string, opts: TextOpts = {}): this {
    const size = opts.size ?? 10
    const bold = opts.bold ?? false
    const color = opts.color ?? [0, 0, 0]
    let tx = x
    if (opts.align === 'right') tx = x - textWidth(str, size, bold)
    else if (opts.align === 'center') tx = x - textWidth(str, size, bold) / 2
    const py = PAGE_H - y
    this.pages[this.pageIndex].ops.push(
      `BT /${bold ? 'F2' : 'F1'} ${fmtN(size)} Tf ${fmtN(color[0])} ${fmtN(color[1])} ${fmtN(color[2])} rg ` +
      `1 0 0 1 ${fmtN(tx)} ${fmtN(py)} Tm (${esc(str)}) Tj ET`
    )
    return this
  }

  /** Ravna črta (koordinate od zgornjega roba). */
  line (x1: number, y1: number, x2: number, y2: number, opts: LineOpts = {}): this {
    const w = opts.width ?? 0.5
    const color = opts.color ?? [0.75, 0.77, 0.8]
    this.pages[this.pageIndex].ops.push(
      `${fmtN(w)} w ${fmtN(color[0])} ${fmtN(color[1])} ${fmtN(color[2])} RG ` +
      `${fmtN(x1)} ${fmtN(PAGE_H - y1)} m ${fmtN(x2)} ${fmtN(PAGE_H - y2)} l S`
    )
    return this
  }

  /** Pravokotnik — (x, y) je LEVI ZGORNJI vogal, w/h velikost. */
  rect (x: number, y: number, w: number, h: number, opts: RectOpts = {}): this {
    const py = PAGE_H - y - h
    const parts: string[] = []
    if (opts.fill) {
      const c = opts.fill
      parts.push(`${fmtN(c[0])} ${fmtN(c[1])} ${fmtN(c[2])} rg`)
    }
    if (opts.stroke) {
      const c = opts.stroke
      parts.push(`${fmtN(opts.width ?? 0.5)} w ${fmtN(c[0])} ${fmtN(c[1])} ${fmtN(c[2])} RG`)
    }
    parts.push(`${fmtN(x)} ${fmtN(py)} ${fmtN(w)} ${fmtN(h)} re ${opts.fill && opts.stroke ? 'B' : opts.fill ? 'f' : 'S'}`)
    this.pages[this.pageIndex].ops.push(parts.join(' '))
    return this
  }

  /** Prelomi niz na vrstice, ki ustrezajo maxWidth (točke). */
  wrap (str: string, maxWidth: number, size: number, bold = false): string[] {
    const words = str.split(/\s+/).filter(Boolean)
    const lines: string[] = []
    let cur = ''
    for (const word of words) {
      const test = cur ? `${cur} ${word}` : word
      if (textWidth(test, size, bold) <= maxWidth || !cur) cur = test
      else { lines.push(cur); cur = word }
    }
    if (cur) lines.push(cur)
    return lines
  }

  /** Zgradi dokument → Uint8Array (PDF 1.4). Izvede tudi nogo na vseh straneh. */
  build (): Uint8Array<ArrayBuffer> {
    return this.assemble()
  }

  /** Notranja izdelava: izvede nogo, namera offsete, sestavi bajte. */
  private assemble (): Uint8Array<ArrayBuffer> {
    if (this.footerFn) {
      const total = this.pages.length
      const lastActive = this.active
      for (let i = 0; i < total; i++) {
        this.active = i
        this.footerFn(i, total, this)
      }
      this.active = lastActive
    }

    const nPages = this.pages.length
    // objekti: 1 katalog, 2 pages, 3/4 fonti, nato 5+2i stran, 6+2i vsebina
    const totalObjs = 4 + 2 * nPages

    const chunks: Uint8Array[] = []
    const offsets: number[] = new Array(totalObjs + 1).fill(0)
    let pos = 0
    const push = (b: Uint8Array | string) => {
      const bytes = typeof b === 'string' ? encodePdf(b) : b
      chunks.push(bytes)
      pos += bytes.length
    }

    push('%PDF-1.4\n')
    push('%\u00E2\u00E3\u00CF\u00D3\n') // binarna oznaka (stevilnim orodjem pove: binary)

    const kids = Array.from({ length: nPages }, (_, i) => `${5 + 2 * i} 0 R`).join(' ')

    offsets[1] = pos
    push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
    offsets[2] = pos
    push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${nPages} >>\nendobj\n`)

    // fonti — WinAnsi + Differences: caron glifi na dogovorjenih bytih
    const DIFFS = '/BaseEncoding /WinAnsiEncoding /Differences [138 /Scaron 154 /scaron 142 /Zcaron 158 /zcaron 200 /Ccaron 232 /ccaron]'
    offsets[3] = pos
    push(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << ${DIFFS} >> >>\nendobj\n`)
    offsets[4] = pos
    push(`4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding << ${DIFFS} >> >>\nendobj\n`)

    for (let i = 0; i < nPages; i++) {
      const content = encodePdf(this.pages[i].ops.join('\n'))
      const pageNum = 5 + 2 * i
      const contNum = 6 + 2 * i
      offsets[pageNum] = pos
      push(`${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contNum} 0 R >>\nendobj\n`)
      offsets[contNum] = pos
      push(`${contNum} 0 obj\n<< /Length ${content.length} >>\nstream\n`)
      push(content)
      push('\nendstream\nendobj\n')
    }

    // xref + trailer
    const xrefPos = pos
    let xref = `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`
    for (let i = 1; i <= totalObjs; i++) {
      xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
    }
    push(xref)
    push(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`)

    // sestavi v en Uint8Array
    const out = new Uint8Array(pos)
    let o = 0
    for (const c of chunks) { out.set(c, o); o += c.length }
    return out
  }
}

/** Priročnik: dokument iz ene strani brez noge. */
export function pdfDoc (): PdfDoc { return new PdfDoc() }
