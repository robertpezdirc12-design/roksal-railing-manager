'use client'

// R535 (revizija analize): ErrorBoundary na nivoju App Router rute.
// Prej: ena neobdelana napaka v renderju kateregakoli od 41 modulov je pomenila
// BELU STRAN celotne aplikacije (Suspense lovi samo nalaganje, ne napak).
// Sedaj: padli render pokaže to ploščo, ostanki aplikacije ostanejo uporabni,
// gumb „Poskusi znova“ pokliče reset() (ponovni poskus renderja iste rute).
// Podrobnosti (stack, digest) gredo v razvijalsko konzolo — NE v uporabniški UI.

import { useEffect } from 'react'
import { RotateCcw, TriangleAlert } from '@/components/roksal/custom-icons'

export default function RouteError ({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // izpis v konzolo (dev) — Vercelu pride samodejno z reportom
    console.error('[roksal] napaka renderja rute:', error)
  }, [error])

  return (
    <main
      role="alert"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 rounded-xl border border-dashed p-10 text-center"
    >
      <TriangleAlert className="size-10 text-amber-500" aria-hidden />
      <div className="text-lg font-medium text-foreground">Nekaj je šlo narobe</div>
      <div className="max-w-md text-sm text-muted-foreground">
        Stran ali modul se ni uspešno izrisal. Preostanek aplikacije še deluje —
        poskusite znova ali se vrnite na začetek.
        {error.digest ? <span className="sr-only"> Koda napake: {error.digest}</span> : null}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          <RotateCcw className="size-4" aria-hidden /> Poskusi znova
        </button>
        <button
          type="button"
          onClick={() => { window.location.href = '/' }}
          className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm hover:bg-muted"
        >
          Nazaj na začetek
        </button>
      </div>
    </main>
  )
}
