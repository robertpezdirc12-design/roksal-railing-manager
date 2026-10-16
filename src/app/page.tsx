'use client'

// Roksal Railing Manager — REKONSTRUKCIJA R431
// Ena stran (/): prijava → ogrodje z IA (DANES | PROJEKTI | ZAJEM | PISARNA | PROFIL)

import { useEffect, useState } from 'react'
import { useAppStore, type SessionUser } from '@/lib/store'
import { apiGet } from '@/lib/api-client'
import { LoginScreen } from '@/components/roksal/login-screen'
import { AppShell } from '@/components/roksal/app-shell'
import { RoksalMark } from '@/components/roksal/logo'

export default function Home () {
  const token = useAppStore((s) => s.token)
  const user = useAppStore((s) => s.user)
  const setAuth = useAppStore((s) => s.setAuth)
  const clearAuth = useAppStore((s) => s.clearAuth)
  const [booting, setBooting] = useState(true)

  // R538: validacija ob zagonu za oba nosilca seje. Žeton v pomnilniku
  // (sveža prijava → Bearer pot) ALI uporabnik brez žetona (vrneča seja prek
  // httpOnly piškotka `roksal_session`, ki ga JS ne vidi — ista validacijska
  // ruta prek piškotka avtenticira). Brez obojega ni kaj preverjati →
  // prijavni zaslon. uspeh → osveži uporabnika (token je lahko null — piškotek
  // prevzame avtentikacijo api klicev); neuspeh → clearAuth (piškotek je
  // potekel/revociran, torej prijavni zaslon).
  useEffect(() => {
    let cancelled = false
    async function boot () {
      if (!token && !useAppStore.getState().user) { setBooting(false); return }
      try {
        const res = await apiGet<{ user: SessionUser | null }>('/api/auth/session')
        if (!cancelled && res.user) setAuth(token, res.user)
        if (!cancelled && !res.user) clearAuth()
      } catch {
        if (!cancelled) clearAuth()
      } finally {
        if (!cancelled) setBooting(false)
      }
    }
    void boot()
    return () => { cancelled = true }
  }, [token, setAuth, clearAuth])

  if (booting) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background" role="status" aria-live="polite">
        <RoksalMark className="size-12 text-roksal-ink" />
        <p className="text-sm text-muted-foreground">Nalagam prijavo…</p>
      </div>
    )
  }

  return user ? <AppShell /> : <LoginScreen />
}
