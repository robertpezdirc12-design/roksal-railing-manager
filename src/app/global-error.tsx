'use client'

// R535: global-error — ZADNJA obramba (napaka v SAMI layout strukturi /rute).
// Razlika od error.tsx: ta komponenta mora izrisati <html> in <body> sama,
// zato uporablja vgrajene (inline) sloge — ne zanaša se na CSS naloženosti.

export default function GlobalError ({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  console.error('[roksal] napaka korena:', error)
  return (
    <html lang="sl">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#f8fafc',
          color: '#1d2b3e',
        }}
      >
        <main
          role="alert"
          style={{ maxWidth: 480, padding: 32, textAlign: 'center' }}
        >
          <div style={{ fontSize: 40, lineHeight: 1 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: '16px 0 8px' }}>
            Aplikacija je naletela na napako
          </h1>
          <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>
            Napaka v ogrodju strani. Osvežite stran ali se vrnite na prijavo.
          </p>
          <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: '8px 16px', fontSize: 14, borderRadius: 8,
                border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer',
              }}
            >
              Poskusi znova
            </button>
            <button
              type="button"
              onClick={() => { window.location.href = '/' }}
              style={{
                padding: '8px 16px', fontSize: 14, borderRadius: 8,
                border: '1px solid #cbd5e1', background: 'transparent', cursor: 'pointer',
              }}
            >
              Na začetek
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
