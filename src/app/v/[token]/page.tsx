import type { Metadata } from 'next'
import { PublicViz } from '@/components/roksal/public-viz'

// /v/[token] — JAVNA STRAN VIZUALIZATORJA (R480 — issue #9 §10)
// Stranka z žetonom povezave (VizLink 'pv-…') BREZ PRIJAVE vidi variante A/B/C
// svojega projekta (PREJ/POTEM) in prijavi izbor. Izven prijavnega ogrodja —
// dostop ureja izključno žeton (enaka vrata kot /api/public/viz?token=…).
//
// NOINDEX: žetoni so osebni in časovno omejeni — javni vizualizator NE sme
// priti v iskalnike (meta robots noindex,nofollow).

export const metadata: Metadata = {
  title: 'Izbira variante ograje — ROKSAL',
  description: 'Javni vizualizator ROKSAL — primerjava variant ograje in prijava izbire.',
  robots: { index: false, follow: false },
}

type Params = { params: Promise<{ token: string }> }

export default async function VizualizatorPage ({ params }: Params) {
  const { token } = await params
  return <PublicViz token={token} />
}
