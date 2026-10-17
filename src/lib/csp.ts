// csp — R543: EN VIR politike Content-Security-Policy za aplikacijo.
// ČIST modul (BREZ uvozov): uvozi ga next.config.ts (jiti prevede TS uvoz)
// in testni mostiči (tests/r543.py prek bun import './src/lib/csp.ts').
//
// R536 je postavil Report-Only glavo (opazovalno obdobje). R543 doda:
//  • način 'enforce' (izvršilna glava) — env stikalo CSP_MODE, privzeto
//    'report' (NESPREMEMBA za tekoče namestitve);
//  • frame-src 'self' blob: — popravlja PDF predogled (pdf.tsx prikaže
//    object URL v <iframe>; brez te direktive bi podedoval default-src
//    'self' in blob: bil zavrnjen — luknja odkrita v raziskavi R543-a);
//  • frame-ancestors SAMO izrecno (CSP_FRAME_ANCESTORS): privzeto je
//    IZPUŠČEN, ker bi v enforce načinu prelomil peskovniški predogled
//    (vgrajeni iframe). Zaščita pred clickjackingom ostaja prek glave
//    X-Frame-Options: SAMEORIGIN (next.config.ts); produkcija, ki želi
//    strožjo direktivo, jo nastavi izrecno (npr. 'none');
//  • 'unsafe-eval' SAMO v razvoju (dev strežnik ga rabi; produkcija ga
//    ne dobi več — poročila o njem so dobrodošla tudi v report načinu).

export interface CspOptions {
  /** 'report' = glava Report-Only (opazovanje), 'enforce' = izvršilna glava. */
  mode: 'report' | 'enforce'
  /** 'dev' doda 'unsafe-eval' v script-src (Next dev strežnik uporablja eval). */
  env: 'production' | 'dev'
  /** Neobvezna vrednost direktive frame-ancestors (npr. 'none'). Izpuščena,
   *  če ni podana — peskovniški predogled iframe (R543-a past). */
  frameAncestors?: string
}

export interface CspPolicy {
  headerName: 'Content-Security-Policy-Report-Only' | 'Content-Security-Policy'
  policy: string
}

/** Normalizira vrednost frame-ancestors: gola ključna beseda (none/self) se
 *  ovije v narekovaje (CSP sintaksa zahteva 'none', ne none), ostalo
 *  (izvori, npr. https://primer.si, ali že navedeni nizi 'none') gre
 *  nespremenjeno — prijazno do obeh zapisov env spremenljivke. */
function normalizeFrameAncestors (v: string): string {
  const t = v.trim()
  if (/^(none|self)$/i.test(t)) return `'${t.toLowerCase()}'`
  return t
}

/** Zgradi politiko + ime glave iz opcij. Glej zgornji komentar za direktive. */
export function buildCsp (opts: CspOptions): CspPolicy {
  const scriptSrc = opts.env === 'dev'
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'"

  const direktive: string[] = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'self' blob:", // R543: PDF predogled (blob: object URL v iframe)
  ]
  if (opts.frameAncestors) direktive.push(`frame-ancestors ${normalizeFrameAncestors(opts.frameAncestors)}`)
  direktive.push('report-uri /api/csp-report')

  return {
    headerName: opts.mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
    policy: direktive.join('; '),
  }
}
