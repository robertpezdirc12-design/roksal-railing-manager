'use client'

// MERITVE S KAMERO — vodila za vodenje zajema (R455 §4): mreža tretjin +
// vodoravnica + središče čez živi predogled kamere.
// R537-a: selitev iz meritve-kamera.tsx (faza ZAJEM).

/** R455: vodila v živem predogledu (§4) — mreža + vodoravnica + središče. */
export function Vodila () {
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <line x1="33.33" y1="0" x2="33.33" y2="100" stroke="#ffffff88" strokeWidth="0.3" />
      <line x1="66.66" y1="0" x2="66.66" y2="100" stroke="#ffffff88" strokeWidth="0.3" />
      <line x1="0" y1="33.33" x2="100" y2="33.33" stroke="#ffffff88" strokeWidth="0.3" />
      <line x1="0" y1="66.66" x2="100" y2="66.66" stroke="#ffffff88" strokeWidth="0.3" />
      <line x1="0" y1="50" x2="100" y2="50" stroke="#f59e0bcc" strokeWidth="0.5" strokeDasharray="2 1.5" />
      <circle cx="50" cy="50" r="1.2" fill="none" stroke="#f59e0bcc" strokeWidth="0.4" />
    </svg>
  )
}
